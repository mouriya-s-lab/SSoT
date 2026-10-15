import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

export type ProcessGroupMember = {
  readonly pid: number;
  readonly processGroup: number;
  readonly command: string;
};
export type CliResult = {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly json: unknown;
  readonly processGroup: number;
  readonly nativeAtExit: readonly ProcessGroupMember[];
  readonly nativeBeforeCleanup: readonly ProcessGroupMember[];
  readonly groupBeforeCleanup: readonly ProcessGroupMember[];
};
export type JsonRecord = { readonly [key: string]: unknown };
export function record(value: unknown): JsonRecord {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), 'expected JSON record');
  return value as JsonRecord;
}
export function array(value: unknown): readonly unknown[] {
  assert(Array.isArray(value), 'expected JSON array');
  return value;
}
export function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}
export function outputJson(result: CliResult): JsonRecord {
  return record(result.json);
}
export function succeeds(result: CliResult): CliResult {
  assert.equal(result.timedOut, false, `CLI timed out: ${JSON.stringify(result.argv)}`);
  assert.equal(result.exitCode, 0, JSON.stringify(result));
  assert.equal(result.signal, null, JSON.stringify(result));
  return result;
}
async function pause(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  await promise;
}
function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}
/** Exact detached-group membership is authoritative; argv need not mention the design root. */
export function processesInGroup(processGroup: number): readonly ProcessGroupMember[] {
  const processes: ProcessGroupMember[] = [];
  for (const line of execFileSync('ps', ['-axo', 'pid=,pgid=,command='], { encoding: 'utf8' }).split('\n')) {
    if (!line.trim()) continue;
    const parsed = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    assert(parsed, `unable to parse process observation: ${line}`);
    if (Number(parsed[2]) === processGroup)
      processes.push({ pid: Number(parsed[1]), processGroup, command: parsed[3]! });
  }
  return processes.sort((a, b) => a.pid - b.pid);
}
/** Observe natural native shutdown before cleanup; always terminate only our owned group. */
export async function runCli(
  entry: string,
  args: readonly string[],
  cwd: string,
  observeBeforeCleanup?: () => void,
): Promise<CliResult> {
  const argv = [process.execPath, resolve(entry), ...args];
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let nativeAtExit: readonly ProcessGroupMember[] = [];
  let nativeBeforeCleanup: readonly ProcessGroupMember[] = [];
  let groupBeforeCleanup: readonly ProcessGroupMember[] = [];
  const child = spawn(argv[0]!, argv.slice(1), {
    cwd,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  const exited = Promise.withResolvers<[number | null, NodeJS.Signals | null]>();
  const closed = Promise.withResolvers<void>();
  child.once('error', exited.reject);
  child.once('exit', (code, signal) => exited.resolve([code, signal]));
  child.once('close', () => closed.resolve());
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    if (child.pid !== undefined) signalGroup(child.pid, 'SIGTERM');
  }, 45_000);
  const killTimeout = setTimeout(() => {
    if (timedOut && child.pid !== undefined) signalGroup(child.pid, 'SIGKILL');
  }, 45_500);
  let exitCode: number | null = null;
  let signal: NodeJS.Signals | null = null;
  try {
    [exitCode, signal] = await exited.promise;
    assert(child.pid !== undefined, 'spawned CLI has no owned process group');
    clearTimeout(timeout);
    clearTimeout(killTimeout);
    groupBeforeCleanup = processesInGroup(child.pid);
    nativeAtExit = groupBeforeCleanup.filter((member) => /(?:^|\s)--api(?:\s|$)/.test(member.command));
    // Passive grace is bounded; no signal is sent until evidence has been logged and asserted.
    if (!timedOut) {
      const deadline = Date.now() + 500;
      while (groupBeforeCleanup.length > 0 && Date.now() < deadline) {
        await pause(25);
        groupBeforeCleanup = processesInGroup(child.pid);
      }
    }
    nativeBeforeCleanup = groupBeforeCleanup.filter((member) => /(?:^|\s)--api(?:\s|$)/.test(member.command));
    console.log(
      JSON.stringify({
        acceptance: 'native-before-cleanup',
        argv,
        processGroup: child.pid,
        exitCode,
        signal,
        timedOut,
        nativeAtExit,
        nativeBeforeCleanup,
        groupBeforeCleanup,
      }),
    );
    observeBeforeCleanup?.();
    if (!timedOut) {
      assert.deepEqual(
        groupBeforeCleanup,
        [],
        `child process survived natural CLI exit in owned group ${child.pid}`,
      );
    }
  } catch (error) {
    console.log(
      JSON.stringify({
        acceptance: 'cli-lifecycle-failure',
        argv,
        cwd,
        processGroup: child.pid ?? null,
        exitCode,
        signal,
        timedOut,
        stdout,
        stderr,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    throw error;
  } finally {
    clearTimeout(timeout);
    clearTimeout(killTimeout);
    if (child.pid !== undefined) {
      signalGroup(child.pid, 'SIGTERM');
      await pause(100);
      signalGroup(child.pid, 'SIGKILL');
    }
    // A descendant retaining pipes must not turn cleanup/reaping into an unbounded wait.
    const reap = Promise.withResolvers<void>();
    const reapTimeout = setTimeout(
      () =>
        reap.reject(
          new Error(`CLI streams did not close after owned-group cleanup: ${JSON.stringify(argv)}`),
        ),
      2_000,
    );
    closed.promise.then(reap.resolve, reap.reject);
    try {
      await reap.promise;
    } finally {
      clearTimeout(reapTimeout);
    }
  }
  let json: unknown;
  try {
    json = parseJson(stdout);
  } catch {
    json = undefined;
  }
  assert(child.pid !== undefined);
  const result: CliResult = {
    argv,
    cwd,
    exitCode,
    signal,
    timedOut,
    stdout,
    stderr,
    json,
    processGroup: child.pid,
    nativeAtExit,
    nativeBeforeCleanup,
    groupBeforeCleanup,
  };
  console.log(JSON.stringify({ acceptance: 'cli', ...result }));
  return result;
}

type SnapshotEntry =
  | { readonly kind: 'Directory' }
  | { readonly kind: 'File'; readonly content: Buffer; readonly digest: string }
  | { readonly kind: 'Symlink'; readonly target: string };
export type TreeSnapshot = ReadonlyMap<string, SnapshotEntry>;
/** Skill source snapshots omit only dependency contents, never output/cache/build directories. */
export function snapshot(root: string, scope: 'Complete' | 'SkillSource' = 'Complete'): TreeSnapshot {
  const entries = new Map<string, SnapshotEntry>();
  function walk(path: string): void {
    const at = relative(root, path);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      entries.set(at, { kind: 'Symlink', target: readlinkSync(path) });
      return;
    }
    if (stat.isDirectory()) {
      entries.set(at, { kind: 'Directory' });
      if (scope === 'SkillSource' && basename(path) === 'node_modules') return;
      for (const name of readdirSync(path).sort()) walk(join(path, name));
      return;
    }
    assert(stat.isFile(), `unexpected special file in test-owned tree: ${path}`);
    const content = readFileSync(path);
    entries.set(at, { kind: 'File', content, digest: createHash('sha256').update(content).digest('hex') });
  }
  walk(root);
  return entries;
}
function comparable(tree: TreeSnapshot): readonly unknown[] {
  return [...tree].map(([path, entry]) =>
    entry.kind === 'File'
      ? [path, entry.kind, entry.digest]
      : entry.kind === 'Symlink'
        ? [path, entry.kind, entry.target]
        : [path, entry.kind],
  );
}
export function sameTree(before: TreeSnapshot, after: TreeSnapshot): void {
  assert.deepEqual(
    comparable(after),
    comparable(before),
    'CLI changed the test-owned repository (including hidden/output files)',
  );
}
export function restore(root: string, tree: TreeSnapshot): void {
  assert(root.startsWith('/tmp/software-design-accept-'), `refusing to restore unowned root ${root}`);
  rmSync(root, { recursive: true, force: true });
  for (const [path, entry] of tree) {
    const target = join(root, path);
    if (entry.kind === 'Directory') mkdirSync(target, { recursive: true });
    else {
      mkdirSync(dirname(target), { recursive: true });
      if (entry.kind === 'File') writeFileSync(target, entry.content);
      else symlinkSync(entry.target, target);
    }
  }
}

export type AcceptanceWorkspace = {
  readonly root: string;
  readonly repo: string;
  readonly design: string;
  readonly parentEntry: string;
  readonly graphEntry: string;
  readonly parent: (...args: string[]) => Promise<CliResult>;
  readonly graph: (...args: string[]) => Promise<CliResult>;
  readonly write: (path: string, content: string) => void;
  readonly read: (path: string) => string;
  readonly replace: (path: string, before: string, after: string) => void;
  readonly readOnly: <T>(run: () => Promise<T>) => Promise<T>;
  readonly isolated: <T>(run: () => Promise<T>) => Promise<T>;
  readonly close: () => void;
};
export function createWorkspace(): AcceptanceWorkspace {
  const root = mkdtempSync('/tmp/software-design-accept-');
  const repo = join(root, 'repo');
  const design = join(repo, 'design');
  mkdirSync(repo);
  const here = dirname(fileURLToPath(import.meta.url));
  const parentEntry = resolve(process.env.SOFTWARE_DESIGN_PARENT_ENTRY ?? join(here, '../scripts/design.ts'));
  const graphEntry = resolve(
    process.env.SOFTWARE_DESIGN_GRAPH_ENTRY ?? join(here, '../../software-design-graph/scripts/graph.ts'),
  );
  const skillRoots = [
    ...new Set([parentEntry, graphEntry].map((entry) => realpathSync(dirname(dirname(entry))))),
  ];
  const buildRoots = [...new Set(skillRoots.map((skill) => resolve(skill, '../..', '.design-build')))].filter(
    (build) => !skillRoots.some((skill) => build === skill || build.startsWith(`${skill}/`)),
  );
  function sourceSnapshots(): readonly {
    readonly path: string;
    readonly scope: 'Complete' | 'SkillSource';
    readonly tree: TreeSnapshot;
  }[] {
    return [
      ...skillRoots.map((path) => ({
        path,
        scope: 'SkillSource' as const,
        tree: snapshot(path, 'SkillSource'),
      })),
      ...buildRoots.map((path) => ({
        path,
        scope: 'Complete' as const,
        tree: lstatSync(path, { throwIfNoEntry: false }) ? snapshot(path) : new Map<string, SnapshotEntry>(),
      })),
    ];
  }
  function trackedCli(entry: string, args: readonly string[], readOnlyFixture: boolean): Promise<CliResult> {
    const sources = sourceSnapshots();
    const before = readOnlyFixture ? snapshot(root) : undefined;
    return runCli(entry, args, repo, () => {
      for (const source of sources) {
        const after = lstatSync(source.path, { throwIfNoEntry: false })
          ? snapshot(source.path, source.scope)
          : new Map<string, SnapshotEntry>();
        assert.deepEqual(
          comparable(after),
          comparable(source.tree),
          `CLI modified source/emission tree ${source.path} before cleanup`,
        );
      }
      if (before !== undefined) sameTree(before, snapshot(root));
      console.log(
        JSON.stringify({
          acceptance: 'trees-before-cleanup',
          argv: [entry, ...args],
          sourceRoots: sources.map((source) => source.path),
          fixtureRoot: readOnlyFixture ? root : null,
          unchanged: true,
        }),
      );
    });
  }
  console.log(JSON.stringify({ acceptance: 'workspace', root, parentEntry, graphEntry }));
  const read = (path: string): string => readFileSync(join(design, path), 'utf8');
  function write(path: string, content: string): void {
    const target = resolve(design, path);
    assert(target.startsWith(`${design}/`), `write escaped test design: ${path}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  async function readOnly<T>(run: () => Promise<T>): Promise<T> {
    const before = snapshot(root);
    try {
      return await run();
    } finally {
      sameTree(before, snapshot(root));
    }
  }
  return {
    root,
    repo,
    design,
    parentEntry,
    graphEntry,
    parent: (...args) =>
      trackedCli(
        parentEntry,
        args,
        args[0] === 'check' || (args[0] === 'upgrade' && args.includes('--check')),
      ),
    graph: (...args) => trackedCli(graphEntry, args, true),
    write,
    read,
    replace(path, before, after) {
      const content = read(path);
      assert.equal(
        content.split(before).length,
        2,
        `mutation anchor must occur exactly once: ${path}: ${before}`,
      );
      write(path, content.replace(before, after));
    },
    readOnly,
    async isolated(run) {
      const before = snapshot(root);
      try {
        return await run();
      } finally {
        restore(root, before);
      }
    },
    close() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
