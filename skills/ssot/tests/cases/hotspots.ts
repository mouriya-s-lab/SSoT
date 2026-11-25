import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HotspotReport } from "../../scripts/src/hotspots";

const SSOT = join(import.meta.dir, "..", "..", "scripts", "ssot.ts");

function gitExec(cwd: string, args: readonly string[]): void {
  const r = Bun.spawnSync(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
  assert.equal(r.exitCode, 0, `git ${args.join(" ")} failed: ${r.stderr.toString()}`);
}

async function runHotspots(args: readonly string[]): Promise<{ readonly code: number; readonly report: HotspotReport }> {
  const proc = Bun.spawn(["bun", SSOT, "hotspots", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, SSOT_GH_DISABLED: "1" },
  });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  assert.equal(stderr.trim(), "", `unexpected stderr: ${stderr}`);
  return { code, report: JSON.parse(stdout) as HotspotReport };
}

export async function verifyHotspotsCommand(): Promise<number> {
  const repo = mkdtempSync("/tmp/ssot-hotspots-test-");
  try {
    gitExec(repo, ["init"]);
    mkdirSync(join(repo, "src", "checkout"), { recursive: true });
    mkdirSync(join(repo, "src", "catalog"), { recursive: true });

    // Commit 1: initial baseline + lockfile + legacy file that will later be deleted
    writeFileSync(join(repo, "src", "checkout", "fulfillment.ts"), "export const fulfill = () => 1;\n");
    writeFileSync(join(repo, "src", "checkout", "inventory.ts"), "export const reserve = () => 1;\n");
    writeFileSync(join(repo, "src", "catalog", "products.ts"), "export const list = () => [];\n");
    writeFileSync(join(repo, "src", "checkout", "legacy.ts"), "export const old = 1;\n");
    writeFileSync(join(repo, "package-lock.json"), "{}\n");
    gitExec(repo, ["add", "."]);
    gitExec(repo, ["commit", "-m", "feat: initial checkout and catalog"]);

    // Commit 2: fix #42 touching both fulfillment.ts and inventory.ts
    writeFileSync(join(repo, "src", "checkout", "fulfillment.ts"), "export const fulfill = () => 2;\nexport const release = () => true;\n");
    writeFileSync(join(repo, "src", "checkout", "inventory.ts"), "export const reserve = () => 2;\nexport const rejectReleased = true;\n");
    writeFileSync(join(repo, "package-lock.json"), "{\"lockfileVersion\":3}\n");
    gitExec(repo, ["add", "."]);
    gitExec(repo, ["commit", "-m", "fix(checkout): reject late reserve after release (#42)\n\nLate in-flight reserve locked released item."]);

    // Commit 3: fix #108 touching fulfillment.ts and inventory.ts again
    writeFileSync(join(repo, "src", "checkout", "fulfillment.ts"), "export const fulfill = () => 3;\nexport const recoverCrash = () => true;\n");
    writeFileSync(join(repo, "src", "checkout", "inventory.ts"), "export const reserve = () => 3;\n");
    gitExec(repo, ["add", "."]);
    gitExec(repo, ["commit", "-m", "fix(checkout): handle crash before cancel anchor (Fixes #108)"]);

    // Commit 4: another fix on fulfillment.ts for #42 + remove legacy.ts
    writeFileSync(join(repo, "src", "checkout", "fulfillment.ts"), "export const fulfill = () => 4;\nexport const writeOnce = () => true;\n");
    rmSync(join(repo, "src", "checkout", "legacy.ts"));
    gitExec(repo, ["add", "-A"]);
    gitExec(repo, ["commit", "-m", "fix(checkout): prevent duplicate outcome write (#42)"]);

    // 1. 全仓热点分析：文件榜单、模块榜单、协同改动、热点 commit、反推 issue
    const full = await runHotspots([repo, "--top", "5"]);
    assert.equal(full.code, 0);
    assert.equal(full.report.kind, "ok");
    assert.equal(full.report.totalCommits, 4);
    assert.equal(full.report.totalFixCommits, 3);

    // 锁文件与已删除文件不进入当前热点
    assert.equal(full.report.files.some((f) => f.file === "package-lock.json"), false);
    assert.equal(full.report.files.some((f) => f.file.endsWith("legacy.ts")), false);

    // 改动最多的前两名是 fulfillment.ts（4 次提交，3 次修复）与 inventory.ts（3 次提交，2 次修复）
    assert.equal(full.report.files[0]?.file, "src/checkout/fulfillment.ts");
    assert.equal(full.report.files[0]?.commits, 4);
    assert.equal(full.report.files[0]?.fixCommits, 3);
    assert.deepEqual(full.report.files[0]?.issueRefs, [42, 108]);

    assert.equal(full.report.files[1]?.file, "src/checkout/inventory.ts");
    assert.equal(full.report.files[1]?.commits, 3);
    assert.equal(full.report.files[1]?.fixCommits, 2);
    assert.deepEqual(full.report.files[1]?.issueRefs, [42, 108]);

    // 模块热点第一名是 src/checkout
    assert.equal(full.report.modules[0]?.module, "src/checkout");
    assert.equal(full.report.modules[0]?.fixCommits, 3);

    // 协同改动热点识别出 fulfillment.ts 与 inventory.ts 共改 3 次（其中修复 2 次）
    const pair = full.report.coChanges.find(
      (p) => p.fileA === "src/checkout/fulfillment.ts" && p.fileB === "src/checkout/inventory.ts",
    );
    assert.notEqual(pair, undefined);
    assert.equal(pair?.sharedCommits, 3);
    assert.equal(pair?.sharedFixCommits, 2);

    // 反推到 issue：#42 与 #108
    const issue42 = full.report.issues.find((i) => i.number === 42);
    assert.notEqual(issue42, undefined);
    assert.equal(issue42?.commits.length, 2);
    assert.deepEqual(issue42?.hotspotFiles, ["src/checkout/fulfillment.ts", "src/checkout/inventory.ts"]);

    const issue108 = full.report.issues.find((i) => i.number === 108);
    assert.notEqual(issue108, undefined);
    assert.equal(issue108?.commits.length, 1);

    // 2. 子目录 scope 过滤：只看 src/catalog
    const scoped = await runHotspots([join(repo, "src", "catalog")]);
    assert.equal(scoped.code, 0);
    assert.equal(scoped.report.kind, "ok");
    assert.equal(scoped.report.scope, "src/catalog");
    assert.deepEqual(scoped.report.files.map((f) => f.file), ["src/catalog/products.ts"]);

    // 3. 非法参数与不存在路径
    const badOpt = await runHotspots([repo, "--top", "0"]);
    assert.equal(badOpt.code, 2);
    assert.equal(badOpt.report.kind, "failed");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
  return 3;
}
