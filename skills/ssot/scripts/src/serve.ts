// ssot serve：本地网页上浏览设计的全部图（与 ssot render 同一份 site.ts 结果），设计文件一改就重画并推给页面；
// 使用者在页面上留的批注也由这个进程收下并落盘，ssot comment 经它读写。
import { type FSWatcher, watch } from "node:fs";
import { join, sep } from "node:path";
import { assertNever, format } from "./diag";
import { applyChange, edgeRev, itemRev, loadThreads, parseChange, saveThreads, storePath } from "./review";
import { type DiagramKind, type SiteDiagram, type SiteEdge, type SiteItem, buildSite } from "./site";

/** 页面拿到的一份结果：最近一次成功构建的图，加上最近一次构建（可能失败）的诊断。 */
interface Published {
  readonly version: number;
  readonly building: boolean;
  readonly failed: boolean;
  readonly diagnostics: readonly string[];
  readonly diagrams: readonly DiagramView[];
}

/** /api/site 里的一张图：每个节点与每条箭头带上内容指纹 rev，页面与 ssot comment 用它判断批注指着的元素后来改没改。 */
export interface DiagramView {
  readonly id: string;
  readonly kind: DiagramKind;
  readonly title: string;
  readonly description: string;
  readonly parent: string | null;
  /** 画布（不含图例）的大小与 SVG；图例另放在 legend，页面把它画在画布之外。 */
  readonly width: number;
  readonly height: number;
  readonly svg: string;
  readonly legend: string;
  readonly items: Readonly<Record<string, SiteItem & { readonly rev: string }>>;
  readonly edges: readonly (SiteEdge & { readonly rev: string })[];
}

function viewOf(d: SiteDiagram): DiagramView {
  return {
    id: d.id, kind: d.kind, title: d.title, description: d.description, parent: d.parent, width: d.svg.canvas.width, height: d.svg.canvas.height, svg: d.svg.canvas.svg, legend: d.svg.legend.svg,
    items: Object.fromEntries(Object.entries(d.items).map(([id, item]) => [id, { ...item, rev: itemRev(item) }])),
    edges: d.edges.map((edge) => ({ ...edge, rev: edgeRev(edge) })),
  };
}

const PAGE = join(import.meta.dir, "serve", "page.html");

/** design：设计根目录（含 structure/、contract/、behavior/）。 */
export async function serve(design: string, structure: string, port: number): Promise<number> {
  let published: Published = { version: 0, building: true, failed: false, diagnostics: [], diagrams: [] };
  const listeners = new Set<ReadableStreamDefaultController<string>>();
  const announce = (): void => {
    const message = `event: site\ndata: ${JSON.stringify({ version: published.version, building: published.building })}\n\n`;
    for (const listener of listeners) listener.enqueue(message);
  };

  const store = storePath(design);
  let threads = loadThreads(store);
  const announceThreads = (): void => {
    for (const listener of listeners) listener.enqueue("event: threads\ndata: {}\n\n");
  };

  // 构建在进行中又有文件改动时，只记下“还要再建一次”，当前这次结束后接着建；不并发构建。
  let running = false, again = false;
  const rebuild = async (): Promise<void> => {
    if (running) { again = true; return; }
    running = true;
    do {
      again = false;
      published = { ...published, building: true };
      announce();
      const started = performance.now();
      try {
        const site = await buildSite(structure);
        const diagnostics = site.diagnostics.map(format);
        published = site.kind === "ok"
          ? { version: published.version + 1, building: false, failed: false, diagnostics, diagrams: site.diagrams.map(viewOf) }
          : { version: published.version + 1, building: false, failed: true, diagnostics, diagrams: published.diagrams };
        console.log(`${site.kind === "ok" ? "已重画" : "构建失败，保留上一版图"}：${site.kind === "ok" ? site.diagrams.length : published.diagrams.length} 张图，${diagnostics.length} 条诊断，${Math.round(performance.now() - started)} ms`);
      } catch (error) {
        published = { version: published.version + 1, building: false, failed: true, diagnostics: [String(error instanceof Error ? error.stack ?? error.message : error)], diagrams: published.diagrams };
        console.error(published.diagnostics[0]);
      }
      announce();
    } while (again);
    running = false;
  };

  let timer: Timer | undefined;
  const watcher: FSWatcher = watch(design, { recursive: true }, (_event, file) => {
    if (file === null) return;
    const name = String(file);
    // .gen/ 由 ssot gen 写出，图不读它；隐藏文件与编辑器的临时文件也不触发重画。
    if (name.split(sep).some((part) => part.startsWith(".")) || name.endsWith("~")) return;
    clearTimeout(timer);
    timer = setTimeout(() => void rebuild(), 150);
  });

  const server = Bun.serve({
    port,
    idleTimeout: 0,
    async fetch(request) {
      const url = new URL(request.url);
      switch (url.pathname) {
        case "/":
          return new Response(Bun.file(PAGE), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
        case "/api/site":
          return Response.json({ version: published.version, building: published.building, failed: published.failed, diagnostics: published.diagnostics, diagrams: published.diagrams });
        case "/api/threads": {
          if (request.method !== "POST") return Response.json({ design, threads });
          const change = parseChange(await request.json().catch(() => null));
          if (change === null) return Response.json({ error: "请求体不是一次批注改动" }, { status: 400 });
          const result = applyChange(threads, change, new Date().toISOString());
          switch (result.kind) {
            case "unknown-thread":
              return Response.json({ error: `没有批注 ${result.thread}` }, { status: 404 });
            case "unknown-message":
              return Response.json({ error: `批注 ${result.thread} 里没有 ${result.message} 这句话` }, { status: 404 });
            case "not-editable":
              return Response.json({ error: `批注 ${result.thread} 的 ${result.message} 不是你说的，或者已经删了` }, { status: 409 });
            case "ok":
              saveThreads(store, design, result.threads);
              threads = result.threads;
              announceThreads();
              return Response.json({ design, threads });
            default:
              return assertNever(result);
          }
        }
        case "/events": {
          let self: ReadableStreamDefaultController<string> | null = null;
          const stream = new ReadableStream<string>({
            start(controller) {
              self = controller;
              listeners.add(controller);
              controller.enqueue(`event: site\ndata: ${JSON.stringify({ version: published.version, building: published.building })}\n\n`);
              controller.enqueue("event: threads\ndata: {}\n\n");
            },
            cancel() { if (self) listeners.delete(self); },
          });
          return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
        }
        default:
          return new Response("not found", { status: 404 });
      }
    },
  });
  console.log(`ssot serve：http://localhost:${server.port}/  （监视 ${design}，Ctrl-C 结束）`);
  await rebuild();
  const stopped = Promise.withResolvers<void>();
  const stop = (): void => { watcher.close(); void server.stop(true); stopped.resolve(); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await stopped.promise;
  return 0;
}
