import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { humanEvents, parseCommentArgs } from "../../scripts/src/comment";
import { type Thread, applyChange, loadThreads, parseChange, saveThreads, spoken, waitingOn } from "../../scripts/src/review";

function applied(threads: readonly Thread[], raw: unknown, at: string): readonly Thread[] {
  const change = parseChange(raw);
  assert.notEqual(change, null, `请求体应当被接受：${JSON.stringify(raw)}`);
  const result = applyChange(threads, change!, at);
  assert.equal(result.kind, "ok", `改动应当成功：${JSON.stringify(raw)}`);
  return result.kind === "ok" ? result.threads : threads;
}

const kinds = (before: readonly Thread[], after: readonly Thread[]): string[] => humanEvents(before, after).map((e) => `${e.kind}:${e.thread.id}`);

export function verifyReview(): number {
  const edge = { kind: "edge", diagram: "index", source: "shop", target: "pay", ordinal: 1, along: 0.4, at: { x: 260, y: 140 }, rev: "e1" };
  const blank = { kind: "point", diagram: "index", at: { x: 320.5, y: 88 }, near: ["shop", "pay"] };
  const node = { kind: "node", diagram: "index", node: "shop", dx: 1, dy: 0, at: null, rev: "n1" };

  // 1. 使用者新开一条：编号从 t1 起，第一句是 m1，未解决，等 agent；正文去掉首尾空白；状态记在开它的人名下
  let threads: readonly Thread[] = applied([], { kind: "open", anchor: edge, author: "human", text: "  方向反了\n" }, "2026-11-22T00:00:00.000Z");
  assert.deepEqual(threads, [{ id: "t1", anchor: edge, status: "open", statusBy: "human", statusAt: "2026-11-22T00:00:00.000Z", messages: [{ id: "m1", author: "human", at: "2026-11-22T00:00:00.000Z", content: { kind: "text", text: "方向反了", editedAt: null } }] }]);
  assert.equal(waitingOn(threads[0]!), "agent");
  assert.deepEqual(kinds([], threads), ["opened:t1"]);

  // 2. agent 回复之后轮到使用者；agent 的动作不算使用者的动作
  let before: readonly Thread[] = threads;
  threads = applied(threads, { kind: "reply", thread: "t1", author: "agent", text: "已改" }, "2026-11-22T00:01:00.000Z");
  assert.equal(waitingOn(threads[0]!), "human");
  assert.deepEqual(threads[0]!.messages.map((m) => m.id), ["m1", "m2"]);
  assert.deepEqual(kinds(before, threads), []);

  // 3. agent 标为已解决：不唤醒自己；使用者回复把它重新打开，只报一次回复，不另报重新打开
  before = threads;
  threads = applied(threads, { kind: "status", thread: "t1", status: "resolved", author: "agent" }, "2026-11-22T00:02:00.000Z");
  assert.equal(waitingOn(threads[0]!), null);
  assert.deepEqual(kinds(before, threads), []);
  before = threads;
  threads = applied(threads, { kind: "reply", thread: "t1", author: "human", text: "标签也要改" }, "2026-11-22T00:03:00.000Z");
  assert.equal(threads[0]!.status, "open");
  assert.equal(threads[0]!.statusBy, "human");
  assert.equal(waitingOn(threads[0]!), "agent");
  assert.deepEqual(kinds(before, threads), ["replied:t1"]);

  // 4. 使用者在页面上标为已解决、再重新打开：各报一次
  before = threads;
  threads = applied(threads, { kind: "status", thread: "t1", status: "resolved", author: "human" }, "2026-11-22T00:03:30.000Z");
  assert.deepEqual(kinds(before, threads), ["resolved:t1"]);
  before = threads;
  threads = applied(threads, { kind: "status", thread: "t1", status: "open", author: "human" }, "2026-11-22T00:03:40.000Z");
  assert.deepEqual(kinds(before, threads), ["reopened:t1"]);

  // 5. 使用者改自己的话、删自己的话：各报一次；改 agent 的话、删已经删了的话被拒绝，批注不变
  before = threads;
  threads = applied(threads, { kind: "edit", thread: "t1", message: "m3", author: "human", text: "标签改成「请求扣款」" }, "2026-11-22T00:04:00.000Z");
  assert.deepEqual(threads[0]!.messages[2]!.content, { kind: "text", text: "标签改成「请求扣款」", editedAt: "2026-11-22T00:04:00.000Z" });
  assert.deepEqual(kinds(before, threads), ["edited:t1"]);
  assert.deepEqual(applyChange(threads, { kind: "edit", thread: "t1", message: "m2", author: "human", text: "x" }, "2026-11-22T00:05:00.000Z"), { kind: "not-editable", thread: "t1", message: "m2" });
  before = threads;
  threads = applied(threads, { kind: "delete", thread: "t1", message: "m3", author: "human" }, "2026-11-22T00:05:00.000Z");
  assert.deepEqual(kinds(before, threads), ["deleted:t1"]);
  assert.deepEqual(applyChange(threads, { kind: "delete", thread: "t1", message: "m3", author: "human" }, "2026-11-22T00:05:30.000Z"), { kind: "not-editable", thread: "t1", message: "m3" });
  // 删掉之后最后一句还在的话是 agent 的，轮到使用者
  assert.equal(waitingOn(threads[0]!), "human");

  // 6. 一条批注的话全删了：不再等谁，也不再显示
  threads = applied(threads, { kind: "open", anchor: blank, author: "human", text: "这里缺一个系统" }, "2026-11-22T00:06:00.000Z");
  threads = applied(threads, { kind: "delete", thread: "t2", message: "m1", author: "human" }, "2026-11-22T00:06:10.000Z");
  assert.equal(spoken(threads[1]!).length, 0);
  assert.equal(waitingOn(threads[1]!), null);

  // 7. 编号接着最大的排；agent 也能落批注，它落的批注等使用者
  threads = applied(threads, { kind: "open", anchor: node, author: "agent", text: "这个节点要不要拆开？" }, "2026-11-22T00:07:00.000Z");
  assert.deepEqual(threads.map((t) => t.id), ["t1", "t2", "t3"]);
  assert.equal(waitingOn(threads[2]!), "human");

  // 8. 对不存在的批注或不存在的话改动：报出编号，不改任何批注
  assert.deepEqual(applyChange(threads, { kind: "reply", thread: "t9", author: "agent", text: "x" }, "2026-11-22T00:08:00.000Z"), { kind: "unknown-thread", thread: "t9" });
  assert.deepEqual(applyChange(threads, { kind: "edit", thread: "t1", message: "m9", author: "human", text: "x" }, "2026-11-22T00:08:00.000Z"), { kind: "unknown-message", thread: "t1", message: "m9" });

  // 9. 不合格式的请求体一律拒绝
  for (const bad of [
    { kind: "open", anchor: edge, author: "human", text: "   " },
    { kind: "open", anchor: edge, author: "reviewer", text: "x" },
    { kind: "status", thread: "t1", status: "closed", author: "human" },
    { kind: "status", thread: "t1", status: "resolved" },
    { kind: "open", anchor: { ...edge, ordinal: -1 }, author: "human", text: "x" },
    { kind: "open", anchor: { ...edge, along: 1.2 }, author: "human", text: "x" },
    { kind: "open", anchor: { ...edge, rev: "" }, author: "human", text: "x" },
    { kind: "open", anchor: { ...node, dx: 1.5 }, author: "human", text: "x" },
    { kind: "open", anchor: { kind: "node", diagram: "index", node: "shop", dx: 0, dy: 0, rev: "n1" }, author: "human", text: "x" },
    { kind: "open", anchor: { ...blank, at: null }, author: "human", text: "x" },
    { kind: "open", anchor: { ...blank, at: { x: "320", y: 1 } }, author: "human", text: "x" },
    { kind: "open", anchor: { ...blank, near: ["shop", 3] }, author: "human", text: "x" },
    { kind: "edit", thread: "t1", message: "m1", author: "human", text: " " },
    { kind: "delete", thread: "t1", author: "human" },
    null,
    "open",
  ]) assert.equal(parseChange(bad), null, `请求体应当被拒绝：${JSON.stringify(bad)}`);

  // 10. 命令行：箭头写作 起点->终点#n，#n 从 1 数；落点三选一
  const option = (args: readonly string[]) => (name: string): string | null => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] ?? null : null; };
  const add = (...args: string[]) => parseCommentArgs(["add", ...args], option(args));
  assert.deepEqual(add("--diagram", "index", "--edge", "shop->pay#2"), { kind: "add", diagram: "index", spot: { kind: "edge", source: "shop", target: "pay", ordinal: 1 }, text: null });
  assert.deepEqual(add("--diagram", "index", "--edge", "a.b->c"), { kind: "add", diagram: "index", spot: { kind: "edge", source: "a.b", target: "c", ordinal: 0 }, text: null });
  assert.equal(add("--diagram", "index", "--edge", "shop->pay#0"), null);
  assert.equal(add("--diagram", "index", "--node", "shop", "--x", "1", "--y", "2"), null);
  assert.equal(add("--diagram", "index", "--x", "1"), null);
  assert.equal(add("--node", "shop"), null);

  // 11. 落盘之后读回来的是同一份批注；没有文件时是空的；文件不是批注格式时报错而不是当成空的
  const dir = mkdtempSync("/tmp/ssot-review-test-");
  try {
    const path = join(dir, "nested", "threads.json");
    assert.deepEqual(loadThreads(path), []);
    saveThreads(path, "/some/design", threads);
    assert.deepEqual(loadThreads(path), threads);
    const broken = join(dir, "broken.json");
    writeFileSync(broken, JSON.stringify({ design: "/some/design", threads: [{ ...threads[0], messages: [] }] }));
    assert.throws(() => loadThreads(broken), /批注文件/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  return 11;
}
