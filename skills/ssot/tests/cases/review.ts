import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Thread, applyChange, loadThreads, parseChange, saveThreads, waitingOn } from "../../scripts/src/review";

function applied(threads: readonly Thread[], raw: unknown, at: string): readonly Thread[] {
  const change = parseChange(raw);
  assert.notEqual(change, null, `请求体应当被接受：${JSON.stringify(raw)}`);
  const result = applyChange(threads, change!, at);
  assert.equal(result.kind, "ok");
  return result.kind === "ok" ? result.threads : threads;
}

export function verifyReview(): number {
  const edge = { kind: "edge", diagram: "index", source: "shop", target: "pay", ordinal: 1, along: 0.4 };
  const blank = { kind: "point", diagram: "index", x: 320.5, y: 88, near: ["shop", "pay"] };

  // 1. 使用者新开一条：编号从 t1 起，未解决，等 agent；正文去掉首尾空白
  let threads = applied([], { kind: "open", anchor: edge, author: "human", text: "  方向反了\n" }, "2026-11-22T00:00:00.000Z");
  assert.deepEqual(threads, [{ id: "t1", anchor: edge, status: "open", messages: [{ author: "human", text: "方向反了", at: "2026-11-22T00:00:00.000Z" }] }]);
  assert.equal(waitingOn(threads[0]!), "agent");

  // 2. agent 回复之后轮到使用者
  threads = applied(threads, { kind: "reply", thread: "t1", author: "agent", text: "已改" }, "2026-11-22T00:01:00.000Z");
  assert.equal(waitingOn(threads[0]!), "human");
  assert.equal(threads[0]!.status, "open");

  // 3. 标为已解决之后，使用者再说一句会把它重新打开，又轮到 agent
  threads = applied(threads, { kind: "status", thread: "t1", status: "resolved" }, "2026-11-22T00:02:00.000Z");
  assert.equal(threads[0]!.status, "resolved");
  threads = applied(threads, { kind: "reply", thread: "t1", author: "human", text: "标签也要改" }, "2026-11-22T00:03:00.000Z");
  assert.equal(threads[0]!.status, "open");
  assert.equal(waitingOn(threads[0]!), "agent");
  assert.deepEqual(threads[0]!.messages.map((m) => m.author), ["human", "agent", "human"]);

  // 4. 第二条批注的编号接着排，不与第一条相撞
  threads = applied(threads, { kind: "open", anchor: blank, author: "human", text: "这里缺一个系统" }, "2026-11-22T00:04:00.000Z");
  assert.deepEqual(threads.map((t) => t.id), ["t1", "t2"]);
  assert.deepEqual(threads[1]!.anchor, blank);
  threads = applied(threads, { kind: "open", anchor: { kind: "node", diagram: "index", node: "shop", dx: 0.9, dy: 0.1 }, author: "human", text: "职责太宽" }, "2026-11-22T00:04:30.000Z");

  // 5. 对不存在的批注回复或改状态：报出那个编号，不改任何批注
  assert.deepEqual(applyChange(threads, { kind: "reply", thread: "t9", author: "agent", text: "x" }, "2026-11-22T00:05:00.000Z"), { kind: "unknown-thread", thread: "t9" });
  assert.deepEqual(applyChange(threads, { kind: "status", thread: "t9", status: "resolved" }, "2026-11-22T00:05:00.000Z"), { kind: "unknown-thread", thread: "t9" });

  // 6. 不合格式的请求体一律拒绝：空白正文、未知作者、未知状态、箭头序号不是非负整数、沿线位置出了线、落点缺坐标或不是数、邻近节点不是名字、未知的落点与改动
  for (const bad of [
    { kind: "open", anchor: edge, author: "human", text: "   " },
    { kind: "open", anchor: edge, author: "reviewer", text: "x" },
    { kind: "status", thread: "t1", status: "closed" },
    { kind: "open", anchor: { ...edge, ordinal: -1 }, author: "human", text: "x" },
    { kind: "open", anchor: { ...edge, ordinal: 0.5 }, author: "human", text: "x" },
    { kind: "open", anchor: { ...edge, along: 1.2 }, author: "human", text: "x" },
    { kind: "open", anchor: { kind: "node", diagram: "index", node: "shop" }, author: "human", text: "x" },
    { kind: "open", anchor: { ...blank, x: "320" }, author: "human", text: "x" },
    { kind: "open", anchor: { ...blank, y: Number.NaN }, author: "human", text: "x" },
    { kind: "open", anchor: { ...blank, near: ["shop", 3] }, author: "human", text: "x" },
    { kind: "open", anchor: { kind: "diagram", diagram: "index" }, author: "human", text: "x" },
    { kind: "delete", thread: "t1" },
    null,
    "open",
  ]) assert.equal(parseChange(bad), null, `请求体应当被拒绝：${JSON.stringify(bad)}`);

  // 7. 落盘之后读回来的是同一份批注；没有文件时是空的；文件不是批注格式时报错而不是当成空的
  const dir = mkdtempSync("/tmp/ssot-review-test-");
  try {
    const path = join(dir, "nested", "threads.json");
    assert.deepEqual(loadThreads(path), []);
    saveThreads(path, "/some/design", threads);
    assert.deepEqual(loadThreads(path), threads);
    const broken = join(dir, "broken.json");
    writeFileSync(broken, JSON.stringify({ design: "/some/design", threads: [{ id: "t1", anchor: edge, status: "open", messages: [] }] }));
    assert.throws(() => loadThreads(broken), /批注文件/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  return 7;
}
