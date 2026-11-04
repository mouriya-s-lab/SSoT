// 编译阶段：Quint。只读 CLI 的 --out JSON（parse/compile/typecheck/run）与 --source-map；不读控制台文本。
import { availableParallelism } from "node:os";
import { dirname, join, resolve } from "node:path";
import { type Diagnostic, type Position, type Subject, diag, global } from "../diag";
import { type Origin } from "../gen/contract";
import { quintCommand } from "../install";

export interface QuintLoc {
  readonly source: string;
  readonly start: { readonly line: number; readonly col: number };
  readonly end?: { readonly line: number; readonly col: number };
}

export interface QuintError {
  readonly explanation: string;
  readonly locs: readonly QuintLoc[];
}

/** Raw compiler JSON is confined to this projection boundary. */
type JsonValue = null | boolean | number | string | JsonValue[] | { readonly [key: string]: JsonValue };

interface Declaration {
  readonly id: number;
  readonly kind: string;
  readonly name?: string;
  readonly qualifier?: string;
  readonly typeAnnotation?: {
    readonly id?: number;
    readonly kind?: string;
    readonly res?: { readonly kind: string; readonly name?: string };
  };
  readonly expr?: JsonValue;
}

interface CompileOutput {
  readonly stage: string;
  readonly errors: readonly QuintError[];
  readonly modules?: readonly { readonly name: string; readonly declarations: readonly Declaration[] }[];
  readonly table?: Readonly<Record<string, { readonly id: number; readonly name?: string }>>;
}

interface SourceMap {
  readonly sourceIndex: Readonly<Record<string, string>>;
  readonly map: Readonly<Record<string, readonly [string | number, QuintLoc["start"], QuintLoc["start"]]>>;
}

export interface QuintAttribution {
  readonly origins: ReadonlyMap<number, Origin>;
  readonly subjectOf: (module: string) => Subject;
}

export type DeclKind = "var" | "const" | "typedef" | "action" | "def" | "val" | "puredef" | "pureval" | "run" | "temporal" | "nondet" | "assume";

export interface QuintDecl {
  readonly name: string;
  readonly kind: DeclKind;
  readonly at: Position | null;
  /** 声明里引用到的生成模块（经 Call 变体或该模块的类型构造子）。 */
  readonly modules: readonly string[];
  /** References resolved by the compiler to declarations in this runnable module. */
  readonly references: readonly string[];
  /** Integer literal expression, without evaluating arbitrary definitions. */
  readonly intLiteral: number | null;
  /** 变量声明的类型解析到的生成类型（模块、类型名）；不是生成类型时为 null。 */
  readonly varType: { readonly module: string; readonly name: string } | null;
  /** 变量的类型是 contract::Call。 */
  readonly isCallVar: boolean;
}

export interface QuintModule {
  readonly file: string;
  readonly name: string;
  readonly decls: readonly QuintDecl[];
  /** 编译时 `quint typecheck --out` 写下的未展平 IR（对暂存文件、读本次新生成的 contract.qnt）；初态检查直接读它。 */
  readonly typecheckOut: string;
}

export type QuintCompile =
  | { readonly kind: "ok"; readonly module: QuintModule; readonly diagnostics: readonly Diagnostic[] }
  | { readonly kind: "failed"; readonly diagnostics: readonly Diagnostic[] };

/**
 * 每个 quint 子进程自成一个进程组（detached → setsid）。rust 后端的求值器是 quint 的子进程，只杀 quint 会把它留成孤儿继续跑，
 * 所以截止、调用结束与 ssot 自身退出时都按组杀；脱离了终端的进程组收不到终端的 Ctrl-C，由这里转发。
 */
const live = new Set<number>();

function killGroup(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch (e) {
    if (!(e instanceof Error && "code" in e && e.code === "ESRCH")) throw e;
  }
}

process.on("exit", () => {
  for (const pid of live) killGroup(pid);
});
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const)
  process.on(signal, () => process.exit(code));

/** 同时运行的 quint 进程数；留一个核给并行的 QuickCheck。 */
const SLOTS = Math.max(1, availableParallelism() - 1);
let running = 0;
const waiting: (() => void)[] = [];

async function acquire(): Promise<void> {
  if (running < SLOTS) {
    running++;
    return;
  }
  const { promise, resolve } = Promise.withResolvers<void>();
  waiting.push(resolve);
  await promise;
}

function release(): void {
  const next = waiting.shift();
  if (next) next();
  else running--;
}

/** 一次 quint 调用怎样结束，以及进程本身运行了多久（不含在进程池里排队的时间）。 */
export interface QuintExit {
  readonly kind: "exited" | "timeout";
  readonly ms: number;
}

/** 每次 Quint 调用都有截止（从进程启动算起，不含排队）；超时被杀时 kind 为 "timeout"，调用方据此报诊断，不死等。 */
export async function quint(args: readonly string[], deadlineMs = 300_000): Promise<QuintExit> {
  await acquire();
  try {
    const proc = Bun.spawn([...quintCommand(), ...args], { stdout: "pipe", stderr: "pipe", detached: true });
    const started = performance.now();
    live.add(proc.pid);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(proc.pid);
    }, deadlineMs);
    try {
      await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      await proc.exited;
      return { kind: timedOut ? "timeout" : "exited", ms: Math.round(performance.now() - started) };
    } finally {
      clearTimeout(timer);
      killGroup(proc.pid);
      live.delete(proc.pid);
    }
  } finally {
    release();
  }
}

export function quintPosition(l: QuintLoc, mapFile: (f: string) => string): Position {
  return { file: mapFile(l.source), line: l.start.line + 1, col: l.start.col + 1 };
}

export function errorDiagnostics(
  errors: readonly QuintError[],
  mapFile: (f: string) => string,
  rule: "compile.quint" = "compile.quint",
  subjectOf: (error: QuintError) => Subject = () => global,
): Diagnostic[] {
  const seen = new Set<string>();
  const out: Diagnostic[] = [];
  for (const e of errors) {
    const at = e.locs[0] ? quintPosition(e.locs[0], mapFile) : null;
    const key = `${e.explanation}@${at?.file}:${at?.line}:${at?.col}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(diag(rule, subjectOf(e), at, e.explanation.trim()));
  }
  return out;
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await Bun.file(path).text()) as T;
}

/** 单独类型检查生成的 contract.qnt（被 import 的文件里的语法错误不一定会传到 import 方）。 */
export async function typecheckFile(file: string, outDir: string, tag: string): Promise<readonly QuintError[]> {
  const out = join(outDir, `${tag}.typecheck.json`);
  await quint(["typecheck", file, "--out", out]);
  return (await readJson<{ errors: QuintError[] }>(out)).errors;
}

function declKind(d: Declaration): DeclKind | null {
  switch (d.kind) {
    case "var":
    case "const":
    case "typedef":
    case "assume":
      return d.kind;
    case "def":
      switch (d.qualifier) {
        case "action":
        case "def":
        case "val":
        case "puredef":
        case "pureval":
        case "run":
        case "temporal":
        case "nondet":
          return d.qualifier;
        default:
          throw new Error(`Quint 返回了未知的定义修饰 ${d.qualifier}`);
      }
    default:
      return null; // import / export / instance 不是声明。
  }
}

function callErrorSubjects(
  c: CompileOutput,
  map: SourceMap,
  file: string,
  generated: ReadonlySet<string>,
  mapFile: (f: string) => string,
  attribution: QuintAttribution,
): (error: QuintError) => Subject {
  const locationOf = (id: number): QuintLoc | null => {
    const entry = map.map[String(id)];
    const source = entry ? map.sourceIndex[String(entry[0])] : undefined;
    return entry && source ? { source: mapFile(source), start: entry[1], end: entry[2] } : null;
  };
  const generatedFile = mapFile(resolve(dirname(file), "..", ".gen", "contract.qnt"));
  const constructors = new Map<number, { readonly module: string; readonly loc: QuintLoc }>();
  for (const m of c.modules ?? []) {
    if (m.name === "contract" || !generated.has(m.name)) continue;
    for (const d of m.declarations) {
      if (d.kind !== "def" || d.typeAnnotation?.res?.kind !== "const" || d.typeAnnotation.res.name !== "Call") continue;
      const loc = locationOf(d.id);
      if (!loc || loc.source !== generatedFile) continue;
      const origin = attribution.origins.get(loc.start.line + 1);
      if (origin?.module === m.name) constructors.set(d.id, { module: origin.module, loc });
    }
  }
  const calls: { readonly module: string; readonly loc: QuintLoc }[] = [];
  const visit = (node: JsonValue | undefined): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (node === null || typeof node !== "object") return;
    if (node.kind === "app" && typeof node.id === "number") {
      const def = c.table?.[String(node.id)];
      const constructor = def ? constructors.get(def.id) : undefined;
      const loc = constructor ? locationOf(node.id) : null;
      if (constructor && loc && loc.source === mapFile(file)) calls.push({ module: constructor.module, loc });
    }
    for (const value of Object.values(node)) visit(value);
  };
  for (const m of c.modules ?? []) for (const d of m.declarations) visit(d.expr);
  const beforeOrEqual = (a: QuintLoc["start"], b: QuintLoc["start"]): boolean =>
    a.line < b.line || (a.line === b.line && a.col <= b.col);
  const samePoint = (a: QuintLoc["start"], b: QuintLoc["start"]): boolean => a.line === b.line && a.col === b.col;
  return (error) => {
    const owners = new Set<string>();
    for (const loc of error.locs) {
      const source = mapFile(loc.source);
      for (const constructor of constructors.values()) {
        const span = constructor.loc;
        if (source === span.source && span.end && beforeOrEqual(span.start, loc.start) && beforeOrEqual(loc.end ?? loc.start, span.end)) owners.add(constructor.module);
      }
      for (const call of calls) {
        if (source === call.loc.source && samePoint(loc.start, call.loc.start) && (!loc.end || (call.loc.end && samePoint(loc.end, call.loc.end)))) owners.add(call.module);
      }
    }
    const owner = owners.size === 1 ? owners.values().next().value : undefined;
    return owner ? attribution.subjectOf(owner) : global;
  };
}

/** 编译一个行为文件（模块名 = 文件名）。generated：生成的 Quint 模块名集合（含 contract）。 */
export async function compileBehavior(
  file: string,
  moduleName: string,
  generated: ReadonlySet<string>,
  outDir: string,
  mapFile: (f: string) => string,
  attribution: QuintAttribution,
): Promise<QuintCompile> {
  const out = join(outDir, `${moduleName}.compile.json`);
  const sm = join(outDir, `${moduleName}.sourcemap.json`);
  // 用 typecheck 的 --out：它带未展平的 modules、table、types。compile 的展平器在合法的嵌套模块 import 上会误报（Quint 0.33.1）。
  // typecheck 与 parse 读同一个文件、写各自的输出，并发运行；parse 的源码映射只在 typecheck 走到类型检查阶段时才用到。
  await Promise.all([
    quint(["typecheck", file, "--out", out]),
    quint(["parse", file, "--source-map", sm, "--out", join(outDir, `${moduleName}.parse.json`)]),
  ]);
  const c = await readJson<CompileOutput>(out);
  if ((c.errors.length > 0 && c.stage !== "typechecking") || !c.modules || !c.table) return { kind: "failed", diagnostics: errorDiagnostics(c.errors, mapFile) };
  const map = await readJson<SourceMap>(sm);
  if (c.errors.length > 0) {
    return { kind: "failed", diagnostics: errorDiagnostics(c.errors, mapFile, "compile.quint", callErrorSubjects(c, map, file, generated, mapFile, attribution)) };
  }
  const at = (id: number): Position | null => {
    const e = map.map[String(id)];
    return e ? quintPosition({ source: map.sourceIndex[e[0]]!, start: e[1] }, mapFile) : null;
  };

  // 定义 id → 所在模块。
  const ownerOf = new Map<number, string>();
  for (const m of c.modules) for (const d of m.declarations) ownerOf.set(d.id, m.name);
  const table = c.table;
  const self = c.modules.find((m) => m.name === moduleName);
  if (!self) return { kind: "failed", diagnostics: [diag("compile.quint", global, { file: mapFile(file), line: 1, col: 1 }, `行为文件里没有与文件名同名的模块 ${moduleName}`)] };

  const referencesOf = (node: JsonValue | undefined): { modules: string[]; references: string[] } => {
    const modules = new Set<string>();
    const references = new Set<string>();
    const walk = (x: JsonValue | undefined): void => {
      if (Array.isArray(x)) return x.forEach(walk);
      if (x === null || typeof x !== "object") return;
      if ((x.kind === "app" || x.kind === "name") && typeof x.id === "number") {
        const def = table[String(x.id)];
        const owner = def ? ownerOf.get(def.id) : undefined;
        if (owner === moduleName && def?.name) references.add(def.name);
        if (owner === "contract" && def?.name && generated.has(def.name)) modules.add(def.name);
        else if (owner && owner !== "contract" && owner !== "Vdm" && generated.has(owner)) modules.add(owner);
      }
      // `match lastCall { | soroi_workspace(op) => … }` 编译成 matchVariant，变体标签是字符串，不经名字解析。
      if (x.kind === "app" && x.opcode === "matchVariant" && Array.isArray(x.args)) {
        for (const a of x.args) {
          if (a !== null && typeof a === "object" && !Array.isArray(a) && a.kind === "str" && typeof a.value === "string" && a.value !== "contract" && generated.has(a.value)) modules.add(a.value);
        }
      }
      for (const v of Object.values(x)) walk(v);
    };
    walk(node);
    return { modules: [...modules].sort(), references: [...references].sort() };
  };
  const decls: QuintDecl[] = [];
  for (const d of self.declarations) {
    const kind = declKind(d);
    if (kind === null || d.name === undefined) continue;
    const ann = kind === "var" && d.typeAnnotation ? table[String(d.typeAnnotation.id)] : undefined;
    const owner = ann ? ownerOf.get(ann.id) : undefined;
    const varType = ann?.name && owner && generated.has(owner) ? { module: owner, name: ann.name } : null;
    const refs = referencesOf(d.expr);
    const expr = d.expr;
    const intLiteral = expr !== null && typeof expr === "object" && !Array.isArray(expr) && expr.kind === "int" && typeof expr.value === "number" ? expr.value : null;
    decls.push({
      name: d.name,
      kind,
      at: at(d.id),
      modules: refs.modules,
      references: refs.references,
      intLiteral,
      varType,
      isCallVar: varType?.module === "contract" && varType.name === "Call",
    });
  }
  return { kind: "ok", module: { file: mapFile(file), name: moduleName, decls, typecheckOut: out }, diagnostics: [] };
}
