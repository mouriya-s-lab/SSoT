// PNG 由已安装的 LikeC4 导出；这里只给导出结果安排宏观到微观的阅读顺序。
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type C4View, compileLikeC4 } from "./compile/likec4";
import { format } from "./diag";
import { likec4Command } from "./install";

export function renderOrder(views: readonly C4View[]): C4View[] {
  const rank = (v: C4View): number => v.id === "index" ? 0 : v.type === "deployment" ? 2 : 1;
  return [...views].sort((a, b) => rank(a) - rank(b)
    || (a.viewOf?.split(".").length ?? 0) - (b.viewOf?.split(".").length ?? 0)
    || (a.viewOf ?? a.id).localeCompare(b.viewOf ?? b.id)
    || a.id.localeCompare(b.id));
}

export async function render(structure: string, output: string | null): Promise<number> {
  const compiled = await compileLikeC4(structure);
  for (const d of compiled.diagnostics) console.error(format(d));
  if (compiled.kind === "failed") return 1;
  const dir = output === null ? mkdtempSync(join(tmpdir(), "ssot-render-")) : resolve(output);
  mkdirSync(dir, { recursive: true });
  const run = Bun.spawn([...likec4Command(), "export", "png", "--flat", "--notation", "-o", dir, structure], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]);
  if (code !== 0) {
    console.error(stdout + stderr);
    return code;
  }
  const views = renderOrder(compiled.structure.views);
  for (const v of views) {
    const file = join(dir, `${v.id}.png`);
    if (!existsSync(file)) {
      console.error(`LikeC4 没有导出视图 ${v.id} 的 PNG：${file}`);
      return 1;
    }
  }
  for (const v of views) console.log(`${join(dir, `${v.id}.png`)}\t${v.id}`);
  return 0;
}
