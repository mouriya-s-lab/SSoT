import assert from "node:assert/strict";
import type { Subprocess } from "bun";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { storePath } from "../../scripts/src/review";
import type { DiagramView } from "../../scripts/src/serve";

const BASE = join(import.meta.dir, "..", "base");
const SSOT = join(import.meta.dir, "..", "..", "scripts", "ssot.ts");

interface Site {
  readonly version: number;
  readonly building: boolean;
  readonly failed: boolean;
  readonly diagrams: readonly DiagramView[];
}

async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = probe.port!;
  await probe.stop(true);
  return port;
}

async function until(ready: () => Promise<boolean>, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await ready()) return;
    await Bun.sleep(100);
  }
  assert.fail(`${ms} ms 内没有等到：${what}`);
}

async function collect(stream: ReadableStream<Uint8Array>, into: string[]): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      into.push(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
    }
  }
}

export async function verifyServeComment(): Promise<number> {
  const dir = mkdtempSync("/tmp/ssot-serve-test-");
  cpSync(BASE, dir, { recursive: true });
  const port = await freePort();
  const url = `http://localhost:${port}`;
  const server = Bun.spawn(["bun", SSOT, "serve", dir, "--port", String(port)], { stdout: "pipe", stderr: "pipe" });
  let watcher: Subprocess<"ignore", "pipe", "pipe"> | null = null;
  const cli = async (...args: string[]): Promise<{ readonly code: number; readonly out: string }> => {
    const p = Bun.spawn(["bun", SSOT, "comment", dir, ...args, "--port", String(port)], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { code, out: out + err };
  };
  const human = async (change: Readonly<Record<string, unknown>>): Promise<void> => {
    const response = await fetch(`${url}/api/threads`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ author: "human", ...change }) });
    assert.equal(response.status, 200, `使用者的改动应当被收下：${JSON.stringify(change)}`);
  };
  const site = async (): Promise<Site> => (await (await fetch(`${url}/api/site`)).json()) as Site;
  try {
    await until(async () => (await fetch(`${url}/api/threads`).catch(() => null))?.ok === true, 30_000, "ssot serve 开始监听");

    const first = await site();
    assert.equal(first.building, false);
    assert.equal(first.failed, false);
    const index = first.diagrams.find((d) => d.id === "index");
    assert.ok(index?.items.shop !== undefined, `首次构建之后应当有 index 图与节点 shop：${first.diagrams.map((d) => d.id).join(", ")}`);

    await human({ kind: "open", anchor: { kind: "node", diagram: "index", node: "shop", dx: 0.5, dy: 0.5, at: { x: 10, y: 10 }, rev: index.items.shop.rev }, text: "Shop 要不要拆开？" });
    const lines: string[] = [];
    watcher = Bun.spawn(["bun", SSOT, "comment", dir, "watch", "--port", String(port)], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    void collect(watcher.stdout, lines);
    await until(async () => lines.length >= 1, 30_000, "watch 的第一行");
    assert.match(lines[0]!, /^ssot 批注 · 已有 1 条在等 agent 回复（t1）/);

    const replied = await cli("reply", "t1", "--text", "暂不拆");
    assert.equal(replied.code, 0, replied.out);
    await human({ kind: "reply", thread: "t1", text: "那报表呢" });
    await until(async () => lines.length >= 2, 30_000, "使用者回复的那一行");
    assert.match(lines[1]!, /^ssot 批注 t1 · 使用者回复 · 图 index「[^」]*」› 节点 shop「Shop」/);
    assert.ok(lines[1]!.includes("「那报表呢」"), lines[1]!);

    await human({ kind: "status", thread: "t1", status: "resolved" });
    await until(async () => lines.length >= 3, 30_000, "标为已解决的那一行");
    assert.match(lines[2]!, /^ssot 批注 t1 · 使用者标为已解决 · /);
    await human({ kind: "status", thread: "t1", status: "open" });
    await until(async () => lines.length >= 4, 30_000, "重新打开的那一行");
    assert.ok(lines[3]!.startsWith("ssot 批注 t1 · 使用者重新打开 · ") && lines[3]!.endsWith(` · 全文：ssot comment ${dir} --port ${port}`), lines[3]!);

    const listed = await cli();
    assert.equal(listed.code, 0, listed.out);
    assert.ok(listed.out.includes("› 节点 shop「Shop」") && !listed.out.includes("（落下之后改过）"), listed.out);
    assert.ok(listed.out.includes("1 条未解决，其中 1 条等 agent 回复"), listed.out);

    const model = join(dir, "structure", "model.c4");
    writeFileSync(model, readFileSync(model, "utf8").replace("description '下单与记账'", "description '下单、退款与记账'"));
    await until(async () => { const s = await site(); return s.version > first.version && !s.building; }, 120_000, "改动之后的重画");
    const redrawn = await site();
    assert.equal(redrawn.failed, false);
    const stale = await cli();
    assert.ok(stale.out.includes("› 节点 shop「Shop」") && stale.out.includes("（落下之后改过）"), stale.out);

    return 6;
  } finally {
    watcher?.kill();
    server.kill();
    await Promise.all([watcher?.exited, server.exited]);
    rmSync(dir, { recursive: true, force: true });
    rmSync(storePath(dir), { force: true });
  }
}
