// C4 逻辑视图、契约分层图、盒子图与组合图由 ssot 用 ELK 绘制；部署视图仍由 LikeC4 导出。
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { type C4View, compileLikeC4 } from "./compile/likec4";
import { compileBehavior } from "./compile/quint";
import { compileVdm } from "./compile/vdm";
import { assertNever, element, format, global } from "./diag";
import { generateContract } from "./gen/contract";
import { likec4Command, loadDiagramTools } from "./install";
import { elementOfModule } from "./model";
import { importCycleRules, isRunnable } from "./rules/cross";
import { projectBox } from "./render/box";
import { projectC4View } from "./render/c4";
import { projectComposition } from "./render/composition";
import { projectLayers } from "./render/layers";
import { boxSvg, c4Svg, compositionSvg, layersSvg, screenshotSvg } from "./render/svg";

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
  const dir = output === null ? mkdtempSync("/tmp/ssot-render-") : resolve(output);
  const stage = mkdtempSync("/tmp/ssot-render-work-");
  const images = join(stage, "images"), behavior = join(stage, "behavior"), work = join(stage, "work");
  mkdirSync(images);
  mkdirSync(behavior);
  mkdirSync(work);
  mkdirSync(join(stage, ".gen"));
  const root = dirname(resolve(structure));
  const files = (dir: string, extension: string): string[] => existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith(extension)).sort().map((file) => join(dir, file)) : [];
  const owner = elementOfModule(compiled.structure);
  const subjectOf = (module: string) => owner.has(module) ? element(owner.get(module)!) : global;
  try {
    const vdm = await compileVdm(files(join(root, "contract"), ".vdmsl"), () => global, new Set());
    for (const diagnostic of vdm.diagnostics) console.error(format(diagnostic));
    if (vdm.kind === "failed") return 1;
    const cycles = importCycleRules(vdm.project, subjectOf);
    for (const diagnostic of cycles) console.error(format(diagnostic));
    if (cycles.length > 0) return 1;
    const contract = generateContract(vdm.project, new Set(owner.keys()), subjectOf);
    for (const diagnostic of contract.diagnostics) console.error(format(diagnostic));
    if (contract.diagnostics.some((diagnostic) => diagnostic.severity === "error")) return 1;
    writeFileSync(join(stage, ".gen", "contract.qnt"), contract.text);
    const behaviorFiles = files(join(root, "behavior"), ".qnt");
    for (const file of behaviorFiles) copyFileSync(file, join(behavior, basename(file)));
    const generated = new Set(["contract", ...owner.keys(), ...contract.callModules]);
    const modules = await Promise.all(behaviorFiles.map((file) => compileBehavior(join(behavior, basename(file)), basename(file, ".qnt"), generated, work, (path) => path.replace(stage, root), { origins: contract.origins, subjectOf })));
    for (const module of modules) for (const diagnostic of module.diagnostics) console.error(format(diagnostic));
    if (modules.some((module) => module.kind === "failed")) return 1;
    const views = renderOrder(compiled.structure.views);
    const deployments = views.filter((view) => view.type === "deployment");
    if (deployments.length > 0) {
      const run = Bun.spawn([...likec4Command(), "export", "png", "--flat", "--notation", "--description", ...deployments.flatMap((view) => ["-f", view.id]), "-o", images, structure], { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, code] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]);
      if (code !== 0) {
        console.error(stdout + stderr);
        return code;
      }
    }
    const outputs: { file: string; id: string }[] = [];
    const boxes = vdm.project.modules.filter((module) => owner.has(module.name)).sort((a, b) => a.name.localeCompare(b.name));
    const compositions = modules.flatMap((module) => module.kind === "ok" && isRunnable(module.module) ? [module.module] : []).sort((a, b) => a.name.localeCompare(b.name));
    const { chromium } = await loadDiagramTools();
    const browser = await chromium.launch();
    try {
      for (const view of views) {
        switch (view.type) {
          case "element":
            await screenshotSvg(browser, await c4Svg(projectC4View(compiled.structure, view)), join(images, `${view.id}.png`));
            break;
          case "deployment":
            break;
          case "dynamic":
            throw new Error(`动态视图 ${view.id} 不应通过检查`);
          default:
            assertNever(view.type);
        }
        outputs.push({ file: `${view.id}.png`, id: view.id });
      }
      if (boxes.length > 0) {
        await screenshotSvg(browser, await layersSvg(projectLayers(compiled.structure, vdm.project, owner)), join(images, "layers.png"));
        outputs.push({ file: "layers.png", id: "layers" });
      }
      for (const module of boxes) {
        const file = `box-${module.name}.png`;
        await screenshotSvg(browser, await boxSvg(projectBox(module)), join(images, file));
        outputs.push({ file, id: `box:${module.name}` });
      }
      for (const module of compositions) {
        const file = `composition-${module.name}.png`;
        const ir: unknown = await Bun.file(module.typecheckOut).json();
        await screenshotSvg(browser, await compositionSvg(projectComposition(ir, module, vdm.project)), join(images, file));
        outputs.push({ file, id: `composition:${module.name}` });
      }
    } finally {
      await browser.close();
    }
    for (const output of outputs) {
      const file = join(images, output.file);
      if (!existsSync(file) || statSync(file).size === 0) {
        console.error(`没有导出 ${output.id} 的 PNG：${file}`);
        return 1;
      }
    }
    mkdirSync(dir, { recursive: true });
    for (const output of outputs) copyFileSync(join(images, output.file), join(dir, output.file));
    for (const output of outputs) console.log(`${join(dir, output.file)}\t${output.id}`);
    return 0;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
