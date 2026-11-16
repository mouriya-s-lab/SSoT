// ssot render：把设计的全部图（见 site.ts）截成 PNG 写进输出目录。
import { existsSync, mkdirSync, mkdtempSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { format } from "./diag";
import { loadDiagramTools } from "./install";
import { screenshotSvg } from "./render/svg";
import { buildSite } from "./site";

export async function render(structure: string, output: string | null): Promise<number> {
  const site = await buildSite(structure);
  for (const d of site.diagnostics) console.error(format(d));
  if (site.kind === "failed") return 1;
  const dir = output === null ? mkdtempSync("/tmp/ssot-render-") : resolve(output);
  mkdirSync(dir, { recursive: true });
  const { chromium } = await loadDiagramTools();
  const browser = await chromium.launch();
  try {
    for (const diagram of site.diagrams) await screenshotSvg(browser, diagram.svg, join(dir, diagram.file));
  } finally {
    await browser.close();
  }
  for (const diagram of site.diagrams) {
    const file = join(dir, diagram.file);
    if (!existsSync(file) || statSync(file).size === 0) {
      console.error(`没有导出 ${diagram.id} 的 PNG：${file}`);
      return 1;
    }
  }
  for (const diagram of site.diagrams) console.log(`${join(dir, diagram.file)}\t${diagram.id}`);
  return 0;
}
