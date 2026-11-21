// ssot comment：读使用者在 ssot serve 页面上留的批注、回复、标为已解决。批注由运行中的 ssot serve 保管，这里只向它请求。
import { assertNever } from "./diag";
import { asRecord } from "./guard";
import { type Anchor, type Thread, type ThreadChange, waitingOn } from "./review";
import type { SiteEdge, SiteItem } from "./site";

export type CommentAction =
  | { readonly kind: "list"; readonly all: boolean }
  /** text 为 null：从标准输入读。 */
  | { readonly kind: "reply"; readonly thread: string; readonly text: string | null }
  | { readonly kind: "resolve"; readonly thread: string };

/** /api/site 里定位一条批注要用的部分。 */
interface Outline {
  readonly id: string;
  readonly title: string;
  readonly items: Readonly<Record<string, SiteItem>>;
  readonly edges: readonly SiteEdge[];
}

type Fetched<T> = { readonly kind: "ok"; readonly value: T } | { readonly kind: "failed"; readonly message: string };

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

function where(anchor: Anchor, diagrams: readonly Outline[]): string[] {
  const diagram = diagrams.find((d) => d.id === anchor.diagram);
  const lines = [`  图：${anchor.diagram}${diagram ? `「${diagram.title}」` : "（现在的设计里没有这张图）"}`];
  const title = (id: string): string => (diagram?.items[id] ? `${id}「${diagram.items[id].title}」` : id);
  switch (anchor.kind) {
    case "diagram":
      break;
    case "node": {
      const item = diagram?.items[anchor.node];
      lines.push(`  节点：${anchor.node}${item ? `「${item.title}」[${item.kind}]` : diagram ? "（这张图上已经没有它）" : ""}`);
      break;
    }
    case "edge": {
      const edge = diagram?.edges.filter((e) => e.source === anchor.source && e.target === anchor.target)[anchor.ordinal];
      lines.push(`  箭头：${title(anchor.source)} → ${title(anchor.target)}${anchor.ordinal > 0 ? `（这两端之间的第 ${anchor.ordinal + 1} 条）` : ""}${edge ? (edge.label ? ` ·「${edge.label}」` : "") : diagram ? "（这张图上已经没有它）" : ""}`);
      break;
    }
    default:
      assertNever(anchor);
  }
  return lines;
}

function print(t: Thread, diagrams: readonly Outline[]): void {
  console.log(`${t.id} · ${t.status === "open" ? `未解决，等${waitingOn(t) === "agent" ? " agent " : "使用者"}回复` : "已解决"}`);
  for (const line of where(t.anchor, diagrams)) console.log(line);
  for (const m of t.messages) console.log(`  [${m.author === "human" ? "使用者" : "agent"} ${new Date(m.at).toLocaleString("sv")}] ${m.text.replaceAll("\n", "\n    ")}`);
}

export async function comment(design: string, port: number, action: CommentAction): Promise<number> {
  let change: ThreadChange | null;
  switch (action.kind) {
    case "list":
      change = null;
      break;
    case "reply": {
      const text = (action.text ?? (await Bun.stdin.text())).trim();
      if (text === "") {
        console.log("回复是空的：用 --text 给出，或从标准输入写入");
        return 2;
      }
      change = { kind: "reply", thread: action.thread, author: "agent", text };
      break;
    }
    case "resolve":
      change = { kind: "status", thread: action.thread, status: "resolved" };
      break;
    default:
      return assertNever(action);
  }
  const threads = await request(design, port, change);
  if (threads.kind === "failed") {
    console.log(threads.message);
    return 2;
  }
  // 同一个 ssot serve 的 /api/site；这里只用每张图的标题、节点与箭头。
  const site = (await (await fetch(`http://localhost:${port}/api/site`)).json()) as { readonly diagrams: readonly Outline[] };
  if (action.kind !== "list") {
    // 改动之后回显那一条，让调用者看到它现在的样子。
    for (const t of threads.value) if (t.id === action.thread) print(t, site.diagrams);
    return 0;
  }
  const open = threads.value.filter((t) => t.status === "open");
  for (const t of action.all ? threads.value : open) {
    print(t, site.diagrams);
    console.log("");
  }
  const resolved = threads.value.length - open.length;
  console.log(`${open.length} 条未解决，其中 ${open.filter((t) => waitingOn(t) === "agent").length} 条等 agent 回复${resolved > 0 ? `；${resolved} 条已解决${action.all ? "" : "（--all 列出）"}` : ""}`);
  return 0;
}
