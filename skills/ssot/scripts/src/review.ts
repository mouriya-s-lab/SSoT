// 批注：使用者在 ssot serve 的页面上对一张图、图上的一个节点或一条箭头留下的话，agent 经 ssot comment 读取并回复。
// 批注是使用者对会话说的话，不是设计的一部分：存在安装目录下，不写进设计目录。ssot serve 进程是它唯一的写入者。
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertNever } from "./diag";
import { asRecord } from "./guard";
import { DATA } from "./install";

/** 批注指向哪里。节点用图上的节点 id；箭头用两端的节点 id 加它在同一对端点之间的序号（从 0 起）。 */
export type Anchor =
  | { readonly kind: "diagram"; readonly diagram: string }
  | { readonly kind: "node"; readonly diagram: string; readonly node: string }
  | { readonly kind: "edge"; readonly diagram: string; readonly source: string; readonly target: string; readonly ordinal: number };

export type Author = "human" | "agent";
export type ThreadStatus = "open" | "resolved";

export interface Message {
  readonly author: Author;
  readonly text: string;
  /** ISO 8601 时间。 */
  readonly at: string;
}

export interface Thread {
  readonly id: string;
  readonly anchor: Anchor;
  readonly status: ThreadStatus;
  readonly messages: readonly Message[];
}

/** 对批注的一次改动：新开一条、在一条下面回复、改它的状态。 */
export type ThreadChange =
  | { readonly kind: "open"; readonly anchor: Anchor; readonly author: Author; readonly text: string }
  | { readonly kind: "reply"; readonly thread: string; readonly author: Author; readonly text: string }
  | { readonly kind: "status"; readonly thread: string; readonly status: ThreadStatus };

export type ChangeResult =
  | { readonly kind: "ok"; readonly threads: readonly Thread[] }
  | { readonly kind: "unknown-thread"; readonly thread: string };

// 请求体与批注文件里反复出现的三种字段：非空的名字、去掉首尾空白后非空的正文、作者。
const name = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const body = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null);
const author = (v: unknown): Author | null => (v === "human" || v === "agent" ? v : null);

export function parseAnchor(raw: unknown): Anchor | null {
  const v = asRecord(raw);
  if (v === null) return null;
  const diagram = name(v.diagram);
  if (diagram === null) return null;
  switch (v.kind) {
    case "diagram":
      return { kind: "diagram", diagram };
    case "node": {
      const node = name(v.node);
      return node === null ? null : { kind: "node", diagram, node };
    }
    case "edge": {
      const source = name(v.source), target = name(v.target), ordinal = v.ordinal;
      if (source === null || target === null || typeof ordinal !== "number" || !Number.isInteger(ordinal) || ordinal < 0) return null;
      return { kind: "edge", diagram, source, target, ordinal };
    }
    default:
      return null;
  }
}

/** 页面与 ssot comment 发来的请求体；不合格式时为 null。 */
export function parseChange(raw: unknown): ThreadChange | null {
  const v = asRecord(raw);
  if (v === null) return null;
  switch (v.kind) {
    case "open": {
      const anchor = parseAnchor(v.anchor), by = author(v.author), text = body(v.text);
      return anchor === null || by === null || text === null ? null : { kind: "open", anchor, author: by, text };
    }
    case "reply": {
      const thread = name(v.thread), by = author(v.author), text = body(v.text);
      return thread === null || by === null || text === null ? null : { kind: "reply", thread, author: by, text };
    }
    case "status": {
      const thread = name(v.thread);
      return thread === null || (v.status !== "open" && v.status !== "resolved") ? null : { kind: "status", thread, status: v.status };
    }
    default:
      return null;
  }
}

function parseMessage(raw: unknown): Message | null {
  const v = asRecord(raw);
  if (v === null) return null;
  const by = author(v.author), text = body(v.text), at = name(v.at);
  return by === null || text === null || at === null ? null : { author: by, text, at };
}

function parseThread(raw: unknown): Thread | null {
  const v = asRecord(raw);
  if (v === null || !Array.isArray(v.messages) || v.messages.length === 0 || (v.status !== "open" && v.status !== "resolved")) return null;
  const id = name(v.id), anchor = parseAnchor(v.anchor);
  if (id === null || anchor === null) return null;
  const messages: Message[] = [];
  for (const item of v.messages) {
    const m = parseMessage(item);
    if (m === null) return null;
    messages.push(m);
  }
  return { id, anchor, status: v.status, messages };
}

/** 批注不删除，所以编号按条数递增。回复一条已解决的批注会把它重新打开：有新的话，就还没说完。 */
export function applyChange(threads: readonly Thread[], change: ThreadChange, at: string): ChangeResult {
  switch (change.kind) {
    case "open":
      return { kind: "ok", threads: [...threads, { id: `t${threads.length + 1}`, anchor: change.anchor, status: "open", messages: [{ author: change.author, text: change.text, at }] }] };
    case "reply":
      if (!threads.some((t) => t.id === change.thread)) return { kind: "unknown-thread", thread: change.thread };
      return { kind: "ok", threads: threads.map((t) => (t.id === change.thread ? { ...t, status: "open", messages: [...t.messages, { author: change.author, text: change.text, at }] } : t)) };
    case "status":
      if (!threads.some((t) => t.id === change.thread)) return { kind: "unknown-thread", thread: change.thread };
      return { kind: "ok", threads: threads.map((t) => (t.id === change.thread ? { ...t, status: change.status } : t)) };
    default:
      return assertNever(change);
  }
}

/** 一条未解决的批注在等谁：最后一句是使用者说的，就在等 agent。 */
export const waitingOn = (thread: Thread): Author => (thread.messages[thread.messages.length - 1]!.author === "human" ? "agent" : "human");

/** 一个设计目录的批注文件。 */
export const storePath = (design: string): string => join(DATA, "review", `${createHash("sha256").update(design).digest("hex").slice(0, 16)}.json`);

export function loadThreads(path: string): readonly Thread[] {
  if (!existsSync(path)) return [];
  const malformed = new Error(`批注文件不是 ssot 写出的格式：${path}`);
  const stored = asRecord(JSON.parse(readFileSync(path, "utf8")));
  if (stored === null || !Array.isArray(stored.threads)) throw malformed;
  const threads: Thread[] = [];
  for (const item of stored.threads) {
    const t = parseThread(item);
    if (t === null) throw malformed;
    threads.push(t);
  }
  return threads;
}

export function saveThreads(path: string, design: string, threads: readonly Thread[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const staged = `${path}.writing`;
  writeFileSync(staged, `${JSON.stringify({ design, threads }, null, 2)}\n`);
  renameSync(staged, path);
}
