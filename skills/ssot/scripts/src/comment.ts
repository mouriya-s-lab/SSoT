// ssot comment：读使用者在 ssot serve 页面上留的批注、回复、标为已解决、自己在图上落一条，以及守着页面、使用者一有动作就打一行。
// 批注由运行中的 ssot serve 保管，这里只向它请求。
import { assertNever } from "./diag";
import { asRecord } from "./guard";
import { type Anchor, type Author, type Thread, type ThreadChange, spoken, waitingOn } from "./review";
import type { DiagramView } from "./serve";

/** agent 自己落批注的位置：节点、箭头（两端加序号，从 0 起）或图上的坐标。 */
export type Spot =
  | { readonly kind: "node"; readonly node: string }
  | { readonly kind: "edge"; readonly source: string; readonly target: string; readonly ordinal: number }
  | { readonly kind: "point"; readonly x: number; readonly y: number };

export type CommentAction =
  | { readonly kind: "list"; readonly all: boolean }
  /** text 为 null：从标准输入读。 */
  | { readonly kind: "reply"; readonly thread: string; readonly text: string | null }
  | { readonly kind: "resolve"; readonly thread: string }
  | { readonly kind: "add"; readonly diagram: string; readonly spot: Spot; readonly text: string | null }
  | { readonly kind: "watch" };

/** 命令行 ssot comment <design> 之后的部分；不合用法时为 null。option 取一个选项的值。 */
export function parseCommentArgs(rest: readonly string[], option: (name: string) => string | null): CommentAction | null {
  const [verb, thread] = rest;
  if (verb === undefined || verb.startsWith("--")) return { kind: "list", all: rest.includes("--all") };
  switch (verb) {
    case "watch":
      return { kind: "watch" };
    case "reply":
    case "resolve":
      if (thread === undefined || thread.startsWith("--")) return null;
      return verb === "reply" ? { kind: "reply", thread, text: option("--text") } : { kind: "resolve", thread };
    case "add": {
      const diagram = option("--diagram"), node = option("--node"), edge = option("--edge"), x = option("--x"), y = option("--y");
      if (diagram === null || [node, edge, x ?? y].filter((v) => v !== null).length !== 1) return null;
      let spot: Spot;
      if (node !== null) spot = { kind: "node", node };
      else if (edge !== null) {
        // <起点>-><终点>[#n]：#2 是这两端之间的第二条，省略即第一条。
        const m = /^(.+?)->(.+?)(?:#(\d+))?$/.exec(edge);
        if (m === null || (m[3] !== undefined && Number(m[3]) < 1)) return null;
        spot = { kind: "edge", source: m[1]!, target: m[2]!, ordinal: m[3] === undefined ? 0 : Number(m[3]) - 1 };
      } else {
        const px = Number(x), py = Number(y);
        if (x === null || y === null || !Number.isFinite(px) || !Number.isFinite(py)) return null;
        spot = { kind: "point", x: px, y: py };
      }
      return { kind: "add", diagram, spot, text: option("--text") };
    }
    default:
      return null;
  }
}

type Fetched<T> = { readonly kind: "ok"; readonly value: T } | { readonly kind: "failed"; readonly message: string };

/** 提示里给出的命令：端口是默认的 5180 时不写。 */
const invoke = (design: string, port: number, rest = ""): string => `ssot comment ${design} ${rest}${port === 5180 ? "" : ` --port ${port}`}`.replace(/ +$/, "");

/** 向端口上的 ssot serve 请求批注；它不在运行、不是 ssot serve、或者服务的是另一个设计时失败。 */
async function request(design: string, port: number, change: ThreadChange | null): Promise<Fetched<readonly Thread[]>> {
  const url = `http://localhost:${port}/api/threads`;
  let response: Response;
  try {
    response = change === null ? await fetch(url) : await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(change) });
  } catch {
    return { kind: "failed", message: `端口 ${port} 上没有运行中的 ssot serve：先运行 ssot serve ${design} --port ${port}` };
  }
  const answer = asRecord(await response.json().catch(() => null));
  if (answer !== null && typeof answer.error === "string") return { kind: "failed", message: answer.error };
  if (answer === null || typeof answer.design !== "string") return { kind: "failed", message: `端口 ${port} 上的不是带批注的 ssot serve` };
  if (answer.design !== design) return { kind: "failed", message: `端口 ${port} 上的 ssot serve 服务的是 ${answer.design}，不是 ${design}：用 --port 指到这个设计的 ssot serve` };
  // 设计路径对上了，就是本工具的 ssot serve，threads 是它按 Thread 写出的。
  return { kind: "ok", value: answer.threads as readonly Thread[] };
}

/** 同一个 ssot serve 的 /api/site。 */
async function diagramsOf(port: number): Promise<readonly DiagramView[]> {
  // 端口上是本工具的 ssot serve（request 核对过它服务的设计），/api/site 按 DiagramView 写出。
  const site = (await (await fetch(`http://localhost:${port}/api/site`)).json()) as { readonly diagrams: readonly DiagramView[] };
  return site.diagrams;
}

/** 批注指着的元素现在怎样：还在、落下之后改过、已经不在图上。落在空白处的没有元素。 */
type Standing = "fresh" | "stale" | "orphan";
function standing(anchor: Anchor, diagram: DiagramView | undefined): Standing {
  switch (anchor.kind) {
    case "point":
      return diagram ? "fresh" : "orphan";
    case "node": {
      const item = diagram?.items[anchor.node];
      return item === undefined ? "orphan" : item.rev === anchor.rev ? "fresh" : "stale";
    }
    case "edge": {
      const edge = diagram?.edges.filter((e) => e.source === anchor.source && e.target === anchor.target)[anchor.ordinal];
      return edge === undefined ? "orphan" : edge.rev === anchor.rev ? "fresh" : "stale";
    }
    default:
      return assertNever(anchor);
  }
}
const STANDING: Readonly<Record<Standing, string>> = { fresh: "", stale: "（落下之后改过）", orphan: "（已经不在图上）" };

/** 一行说清批注落在哪：哪张图，哪个节点、哪条箭头或哪片空白。 */
function where(anchor: Anchor, diagrams: readonly DiagramView[]): string {
  const diagram = diagrams.find((d) => d.id === anchor.diagram);
  if (diagram === undefined) return `图 ${anchor.diagram}（现在的设计里没有这张图）`;
  const title = (id: string): string => (diagram.items[id] ? `${id}「${diagram.items[id].title}」` : id);
  const tail = STANDING[standing(anchor, diagram)];
  switch (anchor.kind) {
    case "point":
      return `图 ${diagram.id}「${diagram.title}」› 空白处 (${Math.round(anchor.at.x)}, ${Math.round(anchor.at.y)})${anchor.near.length > 0 ? `，最近的节点由近到远：${anchor.near.map(title).join("、")}` : ""}`;
    case "node":
      return `图 ${diagram.id}「${diagram.title}」› 节点 ${title(anchor.node)}${diagram.items[anchor.node] ? ` [${diagram.items[anchor.node]!.kind}]` : ""}${tail}`;
    case "edge": {
      const edge = diagram.edges.filter((e) => e.source === anchor.source && e.target === anchor.target)[anchor.ordinal];
      return `图 ${diagram.id}「${diagram.title}」› 箭头 ${title(anchor.source)} → ${title(anchor.target)}${anchor.ordinal > 0 ? `（这两端之间的第 ${anchor.ordinal + 1} 条）` : ""}${edge?.label ? `「${edge.label}」` : ""}${tail}`;
    }
    default:
      return assertNever(anchor);
  }
}

const who = (author: Author): string => (author === "human" ? "使用者" : "agent");
const clock = (at: string): string => new Date(at).toLocaleString("sv").slice(5, 16);

function print(t: Thread, diagrams: readonly DiagramView[]): void {
  const waiting = waitingOn(t);
  console.log(`${t.id} · ${t.status === "resolved" ? `已解决（${who(t.statusBy)}）` : waiting === "agent" ? "未解决，等 agent 回复" : "未解决，等使用者回复"}`);
  console.log(`  ${where(t.anchor, diagrams)}`);
  for (const m of t.messages) {
    const head = `  ${m.id} [${who(m.author)} ${clock(m.at)}]`;
    switch (m.content.kind) {
      case "text":
        console.log(`${head}${m.content.editedAt ? `（${clock(m.content.editedAt)} 改过）` : ""} ${m.content.text.replaceAll("\n", "\n    ")}`);
        break;
      case "deleted":
        console.log(`${head} （已删除）`);
        break;
      default:
        assertNever(m.content);
    }
  }
}

/** 把 agent 指定的位置换成批注落点；那张图或那个元素不在时给出原因。 */
function anchorAt(diagrams: readonly DiagramView[], id: string, spot: Spot): Fetched<Anchor> {
  const diagram = diagrams.find((d) => d.id === id);
  if (diagram === undefined) return { kind: "failed", message: `没有图 ${id}：现有的图是 ${diagrams.map((d) => d.id).join("、")}` };
  switch (spot.kind) {
    case "node": {
      const item = diagram.items[spot.node];
      if (item === undefined) return { kind: "failed", message: `图 ${id} 上没有节点 ${spot.node}：它的节点是 ${Object.keys(diagram.items).join("、")}` };
      return { kind: "ok", value: { kind: "node", diagram: id, node: spot.node, dx: 1, dy: 0, at: null, rev: item.rev } };
    }
    case "edge": {
      const edge = diagram.edges.filter((e) => e.source === spot.source && e.target === spot.target)[spot.ordinal];
      if (edge === undefined) return { kind: "failed", message: `图 ${id} 上 ${spot.source} 与 ${spot.target} 之间没有第 ${spot.ordinal + 1} 条箭头` };
      return { kind: "ok", value: { kind: "edge", diagram: id, source: spot.source, target: spot.target, ordinal: spot.ordinal, along: 0.5, at: null, rev: edge.rev } };
    }
    case "point":
      return { kind: "ok", value: { kind: "point", diagram: id, at: { x: spot.x, y: spot.y }, near: [] } };
    default:
      return assertNever(spot);
  }
}

async function text(given: string | null): Promise<string> {
  return (given ?? (await Bun.stdin.text())).trim();
}

export async function comment(design: string, port: number, action: CommentAction): Promise<number> {
  if (action.kind === "watch") return watch(design, port);
  let change: ThreadChange | null;
  switch (action.kind) {
    case "list":
      change = null;
      break;
    case "reply": {
      const said = await text(action.text);
      if (said === "") {
        console.log("回复是空的：用 --text 给出，或从标准输入写入");
        return 2;
      }
      change = { kind: "reply", thread: action.thread, author: "agent", text: said };
      break;
    }
    case "resolve":
      change = { kind: "status", thread: action.thread, status: "resolved", author: "agent" };
      break;
    case "add": {
      const said = await text(action.text);
      if (said === "") {
        console.log("批注是空的：用 --text 给出，或从标准输入写入");
        return 2;
      }
      let anchor: Fetched<Anchor>;
      try {
        anchor = anchorAt(await diagramsOf(port), action.diagram, action.spot);
      } catch {
        anchor = { kind: "failed", message: `端口 ${port} 上没有运行中的 ssot serve：先运行 ssot serve ${design} --port ${port}` };
      }
      if (anchor.kind === "failed") {
        console.log(anchor.message);
        return 2;
      }
      change = { kind: "open", anchor: anchor.value, author: "agent", text: said };
      break;
    }
    default:
      return assertNever(action);
  }
  const threads = await request(design, port, change);
  if (threads.kind === "failed") {
    console.log(threads.message);
    return 2;
  }
  const diagrams = await diagramsOf(port);
  switch (action.kind) {
    case "reply":
    case "resolve":
      // 改动之后回显那一条，让调用者看到它现在的样子。
      for (const t of threads.value) if (t.id === action.thread) print(t, diagrams);
      return 0;
    case "add":
      print(threads.value.at(-1)!, diagrams);
      return 0;
    case "list":
      break;
    default:
      return assertNever(action);
  }
  const shown = threads.value.filter((t) => spoken(t).length > 0);
  const open = shown.filter((t) => t.status === "open"), mine = open.filter((t) => waitingOn(t) === "agent");
  for (const t of action.all ? shown : open) {
    print(t, diagrams);
    console.log("");
  }
  const resolved = shown.length - open.length;
  console.log(`${open.length} 条未解决，其中 ${mine.length} 条等 agent 回复${resolved > 0 ? `；${resolved} 条已解决${action.all ? "" : "（--all 列出）"}` : ""}`);
  if (mine.length > 0) {
    console.log(`回复：处理之后写明改了什么或为什么不改 · ${invoke(design, port, `reply ${mine[0]!.id} --text '<改了什么或你的回答>'`)}`);
    console.log(`解决：只在使用者说这一条已经解决时 · ${invoke(design, port, `resolve ${mine[0]!.id}`)}`);
  }
  return 0;
}

// ---------- watch ----------

/** 使用者的一次动作。 */
type HumanEvent =
  | { readonly kind: "opened"; readonly thread: Thread; readonly text: string }
  | { readonly kind: "replied"; readonly thread: Thread; readonly text: string }
  | { readonly kind: "edited"; readonly thread: Thread; readonly text: string }
  | { readonly kind: "deleted"; readonly thread: Thread }
  | { readonly kind: "resolved"; readonly thread: Thread }
  | { readonly kind: "reopened"; readonly thread: Thread };

/** 一份批注里使用者每个动作的记号：一句话的现状（还在、改过、删了），以及使用者改的状态。 */
function marks(threads: readonly Thread[]): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const t of threads) {
    for (const m of t.messages) if (m.author === "human") out.set(`${t.id}/${m.id}`, m.content.kind === "text" ? `text@${m.content.editedAt ?? ""}` : "deleted");
    if (t.statusBy === "human") out.set(`${t.id}/status`, `${t.status}@${t.statusAt}`);
  }
  return out;
}

/** 两份批注之间使用者做了什么；新开批注与回复带出的状态变化不另算。 */
export function humanEvents(before: readonly Thread[], after: readonly Thread[]): readonly HumanEvent[] {
  const seen = marks(before), events: HumanEvent[] = [];
  for (const t of after) {
    let spokeNow = false;
    for (const m of t.messages) {
      if (m.author !== "human") continue;
      const key = `${t.id}/${m.id}`, was = seen.get(key);
      if (m.content.kind === "deleted") {
        if (was !== undefined && was !== "deleted") events.push({ kind: "deleted", thread: t });
        continue;
      }
      if (was === undefined) {
        spokeNow = true;
        events.push({ kind: m.id === t.messages[0]!.id ? "opened" : "replied", thread: t, text: m.content.text });
      } else if (was !== `text@${m.content.editedAt ?? ""}`) events.push({ kind: "edited", thread: t, text: m.content.text });
    }
    if (t.statusBy !== "human" || spokeNow) continue;
    // 状态由使用者改过：记号变了，或者之前那次改状态的是 agent（之前没有记号）。
    const was = seen.get(`${t.id}/status`);
    const changed = was === undefined ? before.some((b) => b.id === t.id) : was !== `${t.status}@${t.statusAt}`;
    if (changed) events.push({ kind: t.status === "resolved" ? "resolved" : "reopened", thread: t });
  }
  return events;
}

const flat = (s: string, room: number): string => { const one = s.replaceAll(/\s*\n\s*/g, " / "); return one.length > room ? `${one.slice(0, room - 1)}…` : one; };

/** 一个动作一行：哪条批注、做了什么、落在哪、原话，以及该跑的命令。宿主按行通知，所以不换行。 */
function line(event: HumanEvent, diagrams: readonly DiagramView[], design: string, port: number): string {
  const t = event.thread, head = `ssot 批注 ${t.id}`, at = where(t.anchor, diagrams);
  const answer = `处理后：${invoke(design, port, `reply ${t.id} --text '<改了什么或你的回答>'`)}`;
  switch (event.kind) {
    case "opened":
      return `${head} · 使用者新批注 · ${at} · 「${flat(event.text, 240)}」 · ${answer}`;
    case "replied":
      return `${head} · 使用者回复 · ${at} · 「${flat(event.text, 240)}」 · ${answer}`;
    case "edited":
      return `${head} · 使用者改了一句话，现在是「${flat(event.text, 240)}」 · ${at} · ${answer}`;
    case "deleted":
      return `${head} · 使用者删了一句话 · ${at} · 全文：${invoke(design, port, "--all")}`;
    case "resolved":
      return `${head} · 使用者标为已解决 · ${at}`;
    case "reopened":
      return `${head} · 使用者重新打开 · ${at} · 全文：${invoke(design, port)}`;
    default:
      return assertNever(event);
  }
}

/**
 * 守着 ssot serve：连上时若已有在等 agent 的批注先打一行，之后使用者每个动作打一行。
 * 一直连不上就退出；连上之后断开（serve 重启）则每 2 秒重连，重连后按断开前的那份比较，断开期间的动作不漏。
 */
async function watch(design: string, port: number): Promise<number> {
  let last: readonly Thread[] | null = null;
  for (;;) {
    let connected = false;
    try {
      const response = await fetch(`http://localhost:${port}/events`);
      if (!response.ok || response.body === null) throw new Error(`HTTP ${response.status}`);
      connected = true;
      const decoder = new TextDecoder();
      let buffer = "";
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (!frame.split("\n").includes("event: threads")) continue;
          const now = await request(design, port, null);
          if (now.kind === "failed") {
            console.log(now.message);
            return 2;
          }
          const diagrams = await diagramsOf(port);
          if (last === null) {
            const waiting = now.value.filter((t) => waitingOn(t) === "agent");
            if (waiting.length > 0) console.log(`ssot 批注 · 已有 ${waiting.length} 条在等 agent 回复（${waiting.map((t) => t.id).join("、")}） · 全文：${invoke(design, port)}`);
          } else for (const event of humanEvents(last, now.value)) console.log(line(event, diagrams, design, port));
          last = now.value;
        }
      }
    } catch (error) {
      if (!connected && last === null) {
        console.log(`端口 ${port} 上没有运行中的 ssot serve：先运行 ssot serve ${design} --port ${port}（${error instanceof Error ? error.message : String(error)}）`);
        return 2;
      }
    }
    await Bun.sleep(2000);
  }
}
