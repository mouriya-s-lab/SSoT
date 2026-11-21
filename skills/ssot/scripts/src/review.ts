// 批注：使用者在 ssot serve 的页面上点图上任意一处留下的话，agent 经 ssot comment 读取、回复，也可以自己在图上落一条问使用者。
// 批注是使用者与会话之间的对话，不是设计的一部分：存在安装目录下，不写进设计目录。ssot serve 进程是它唯一的写入者。
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertNever } from "./diag";
import { asRecord } from "./guard";
import { DATA } from "./install";
import type { SiteEdge, SiteItem } from "./site";

/** 图的坐标。 */
export interface Point { readonly x: number; readonly y: number }

/**
 * 批注落在图上哪里。落在节点或箭头上的跟着那个元素走，重画后布局变了也指着同一处；
 * 那个元素后来改了（rev 对不上）是 stale，没了是 orphan。
 * at：落下时在图上的位置，元素没了图钉就停在这里；agent 按 id 落的批注没有位置，为 null。
 * rev：落下时那个元素的内容指纹（见 itemRev、edgeRev）。
 */
export type Anchor =
  /** dx、dy 是落点在节点外框里的相对位置（左上角 0，右下角 1）。 */
  | { readonly kind: "node"; readonly diagram: string; readonly node: string; readonly dx: number; readonly dy: number; readonly at: Point | null; readonly rev: string }
  /** 箭头用两端的节点 id 加它在同一对端点之间的序号（从 0 起）；along 是落点沿线的相对位置（起点 0，终点 1）。 */
  | { readonly kind: "edge"; readonly diagram: string; readonly source: string; readonly target: string; readonly ordinal: number; readonly along: number; readonly at: Point | null; readonly rev: string }
  /** 空白处：near 是落下时离落点最近的几个节点 id，由近到远，让读批注的一方知道它在哪一带。 */
  | { readonly kind: "point"; readonly diagram: string; readonly at: Point; readonly near: readonly string[] };

export type Author = "human" | "agent";
export type ThreadStatus = "open" | "resolved";

/** 一句话现在的样子：还在（可能改过），或者被说话的人删了。删了的留个位置，对话的先后不乱。 */
export type Content =
  | { readonly kind: "text"; readonly text: string; readonly editedAt: string | null }
  | { readonly kind: "deleted"; readonly deletedAt: string };

export interface Message {
  readonly id: string;
  readonly author: Author;
  /** ISO 8601 时间。 */
  readonly at: string;
  readonly content: Content;
}

export interface Thread {
  readonly id: string;
  readonly anchor: Anchor;
  readonly status: ThreadStatus;
  /** 最近一次改状态的是谁、在什么时候；新开的批注是开它的人。 */
  readonly statusBy: Author;
  readonly statusAt: string;
  readonly messages: readonly Message[];
}

/** 对批注的一次改动。编辑与删除只能针对自己说的话。 */
export type ThreadChange =
  | { readonly kind: "open"; readonly anchor: Anchor; readonly author: Author; readonly text: string }
  | { readonly kind: "reply"; readonly thread: string; readonly author: Author; readonly text: string }
  | { readonly kind: "edit"; readonly thread: string; readonly message: string; readonly author: Author; readonly text: string }
  | { readonly kind: "delete"; readonly thread: string; readonly message: string; readonly author: Author }
  | { readonly kind: "status"; readonly thread: string; readonly status: ThreadStatus; readonly author: Author };

export type ChangeResult =
  | { readonly kind: "ok"; readonly threads: readonly Thread[] }
  | { readonly kind: "unknown-thread"; readonly thread: string }
  | { readonly kind: "unknown-message"; readonly thread: string; readonly message: string }
  /** 要改或删的那句话不是请求方说的，或者已经删了。 */
  | { readonly kind: "not-editable"; readonly thread: string; readonly message: string };

// 请求体与批注文件里反复出现的字段：非空的名字、去掉首尾空白后非空的正文、作者、有限的数。
const name = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const body = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null);
const author = (v: unknown): Author | null => (v === "human" || v === "agent" ? v : null);
const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const fraction = (v: unknown): number | null => { const n = finite(v); return n !== null && n >= 0 && n <= 1 ? n : null; };

function parsePoint(raw: unknown): Point | null {
  const v = asRecord(raw);
  if (v === null) return null;
  const x = finite(v.x), y = finite(v.y);
  return x === null || y === null ? null : { x, y };
}

/** at 必须出现：位置未知时写 null。 */
function parseAt(v: Readonly<Record<string, unknown>>): { readonly at: Point | null } | null {
  if (v.at === null) return { at: null };
  const at = parsePoint(v.at);
  return at === null ? null : { at };
}

export function parseAnchor(raw: unknown): Anchor | null {
  const v = asRecord(raw);
  if (v === null) return null;
  const diagram = name(v.diagram);
  if (diagram === null) return null;
  switch (v.kind) {
    case "node": {
      const node = name(v.node), dx = fraction(v.dx), dy = fraction(v.dy), at = parseAt(v), rev = name(v.rev);
      return node === null || dx === null || dy === null || at === null || rev === null ? null : { kind: "node", diagram, node, dx, dy, at: at.at, rev };
    }
    case "edge": {
      const source = name(v.source), target = name(v.target), ordinal = v.ordinal, along = fraction(v.along), at = parseAt(v), rev = name(v.rev);
      if (source === null || target === null || typeof ordinal !== "number" || !Number.isInteger(ordinal) || ordinal < 0 || along === null || at === null || rev === null) return null;
      return { kind: "edge", diagram, source, target, ordinal, along, at: at.at, rev };
    }
    case "point": {
      const at = parsePoint(v.at);
      if (at === null || !Array.isArray(v.near)) return null;
      const near: string[] = [];
      for (const item of v.near) {
        const id = name(item);
        if (id === null) return null;
        near.push(id);
      }
      return { kind: "point", diagram, at, near };
    }
    default:
      return null;
  }
}

/** 页面与 ssot comment 发来的请求体；不合格式时为 null。 */
export function parseChange(raw: unknown): ThreadChange | null {
  const v = asRecord(raw);
  if (v === null) return null;
  const by = author(v.author);
  if (by === null) return null;
  switch (v.kind) {
    case "open": {
      const anchor = parseAnchor(v.anchor), text = body(v.text);
      return anchor === null || text === null ? null : { kind: "open", anchor, author: by, text };
    }
    case "reply": {
      const thread = name(v.thread), text = body(v.text);
      return thread === null || text === null ? null : { kind: "reply", thread, author: by, text };
    }
    case "edit": {
      const thread = name(v.thread), message = name(v.message), text = body(v.text);
      return thread === null || message === null || text === null ? null : { kind: "edit", thread, message, author: by, text };
    }
    case "delete": {
      const thread = name(v.thread), message = name(v.message);
      return thread === null || message === null ? null : { kind: "delete", thread, message, author: by };
    }
    case "status": {
      const thread = name(v.thread);
      return thread === null || (v.status !== "open" && v.status !== "resolved") ? null : { kind: "status", thread, status: v.status, author: by };
    }
    default:
      return null;
  }
}

function parseContent(raw: unknown): Content | null {
  const v = asRecord(raw);
  if (v === null) return null;
  switch (v.kind) {
    case "text": {
      const text = body(v.text), editedAt = v.editedAt === null ? null : name(v.editedAt);
      return text === null || (v.editedAt !== null && editedAt === null) ? null : { kind: "text", text, editedAt };
    }
    case "deleted": {
      const deletedAt = name(v.deletedAt);
      return deletedAt === null ? null : { kind: "deleted", deletedAt };
    }
    default:
      return null;
  }
}

function parseMessage(raw: unknown): Message | null {
  const v = asRecord(raw);
  if (v === null) return null;
  const id = name(v.id), by = author(v.author), at = name(v.at), content = parseContent(v.content);
  return id === null || by === null || at === null || content === null ? null : { id, author: by, at, content };
}

function parseThread(raw: unknown): Thread | null {
  const v = asRecord(raw);
  if (v === null || !Array.isArray(v.messages) || v.messages.length === 0 || (v.status !== "open" && v.status !== "resolved")) return null;
  const id = name(v.id), anchor = parseAnchor(v.anchor), statusBy = author(v.statusBy), statusAt = name(v.statusAt);
  if (id === null || anchor === null || statusBy === null || statusAt === null) return null;
  const messages: Message[] = [];
  for (const item of v.messages) {
    const m = parseMessage(item);
    if (m === null) return null;
    messages.push(m);
  }
  return { id, anchor, status: v.status, statusBy, statusAt, messages };
}

/** 下一个编号：已有编号的数字部分最大值加一。批注从不移除，编号也就不会重用。 */
function nextId(ids: readonly string[], prefix: string): string {
  let top = 0;
  for (const id of ids) {
    const n = Number(id.slice(prefix.length));
    if (id.startsWith(prefix) && Number.isInteger(n) && n > top) top = n;
  }
  return `${prefix}${top + 1}`;
}

/** 回复会把已解决的批注重新打开：有新的话，就还没说完。 */
export function applyChange(threads: readonly Thread[], change: ThreadChange, at: string): ChangeResult {
  if (change.kind === "open") {
    const thread: Thread = { id: nextId(threads.map((t) => t.id), "t"), anchor: change.anchor, status: "open", statusBy: change.author, statusAt: at, messages: [{ id: "m1", author: change.author, at, content: { kind: "text", text: change.text, editedAt: null } }] };
    return { kind: "ok", threads: [...threads, thread] };
  }
  const target = threads.find((t) => t.id === change.thread);
  if (target === undefined) return { kind: "unknown-thread", thread: change.thread };
  const update = (next: Thread): ChangeResult => ({ kind: "ok", threads: threads.map((t) => (t.id === next.id ? next : t)) });
  switch (change.kind) {
    case "reply":
      return update({ ...target, status: "open", statusBy: target.status === "open" ? target.statusBy : change.author, statusAt: target.status === "open" ? target.statusAt : at, messages: [...target.messages, { id: nextId(target.messages.map((m) => m.id), "m"), author: change.author, at, content: { kind: "text", text: change.text, editedAt: null } }] });
    case "edit":
    case "delete": {
      const message = target.messages.find((m) => m.id === change.message);
      if (message === undefined) return { kind: "unknown-message", thread: change.thread, message: change.message };
      if (message.author !== change.author || message.content.kind === "deleted") return { kind: "not-editable", thread: change.thread, message: change.message };
      const content: Content = change.kind === "edit" ? { kind: "text", text: change.text, editedAt: at } : { kind: "deleted", deletedAt: at };
      return update({ ...target, messages: target.messages.map((m) => (m.id === message.id ? { ...m, content } : m)) });
    }
    case "status":
      return update({ ...target, status: change.status, statusBy: change.author, statusAt: at });
    default:
      return assertNever(change);
  }
}

/** 还在的话；全删了的批注页面与列表都不再显示。 */
export const spoken = (thread: Thread): readonly Message[] => thread.messages.filter((m) => m.content.kind === "text");

/** 一条批注在等谁：已解决或者话全删了不等谁；否则最后一句还在的话是使用者说的，就在等 agent。 */
export function waitingOn(thread: Thread): Author | null {
  const last = spoken(thread).at(-1);
  if (thread.status === "resolved" || last === undefined) return null;
  return last.author === "human" ? "agent" : "human";
}

const fingerprint = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 12);
/** 节点内容的指纹：标题、记法、描述、事实任一改了就变；下钻链接不算，它跟着别的图变。 */
export const itemRev = (item: SiteItem): string => fingerprint([item.title, item.kind, item.description, item.facts]);
/** 箭头内容的指纹：标签或合并的关系改了就变。 */
export const edgeRev = (edge: SiteEdge): string => fingerprint([edge.label, edge.relations]);

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
