// 一份设计的全部图：C4 逻辑视图 → 部署视图 → 契约分层图 → 盒子图 → 组合图。
// ssot render 把每张图截成 PNG；ssot serve 把同一份结果连同节点详情与跳转交给浏览器页面。
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { type C4Relation, type C4View, type Structure, compileLikeC4 } from "./compile/likec4";
import { type QuintModule, compileBehavior } from "./compile/quint";
import { compileVdm } from "./compile/vdm";
import { type Diagnostic, assertNever, element, global } from "./diag";
import { generateContract } from "./gen/contract";
import { elementOfModule } from "./model";
import { importCycleRules, isRunnable } from "./rules/cross";
import { type BoxDiagram, projectBox } from "./render/box";
import { type C4Diagram, projectC4View, projectDeploymentView } from "./render/c4";
import { type CompositionDiagram, projectComposition } from "./render/composition";
import { type LayersDiagram, projectLayers } from "./render/layers";
import { type DiagramSvg, boxSvg, c4Notation, c4Svg, compositionSvg, layersSvg } from "./render/svg";

export type DiagramKind = "view" | "deployment" | "layers" | "box" | "composition";

/** 页面上一处可以跳去的图。 */
export interface SiteLink { readonly label: string; readonly diagram: string }

/** 图上一个节点（SVG 里 data-node 的值）的详情。 */
export interface SiteItem {
  readonly title: string;
  /** 记法：Container、Contract module、Port · op 之类。 */
  readonly kind: string;
  readonly description: string;
  readonly facts: readonly (readonly [string, string])[];
  readonly links: readonly SiteLink[];
}

/** 图上一条箭头（SVG 里 data-edge 的值是它的下标）。 */
export interface SiteEdge {
  readonly source: string;
  readonly target: string;
  readonly label: string | null;
  /** 箭头合并的模型关系；契约分层图与组合图的箭头不是模型关系，为空。 */
  readonly relations: readonly { readonly title: string; readonly description: string; readonly source: string; readonly target: string }[];
}

export interface SiteDiagram {
  readonly id: string;
  /** render 写出的文件名。 */
  readonly file: string;
  readonly kind: DiagramKind;
  readonly title: string;
  readonly description: string;
  /** 面包屑的上一级图；null：顶层。 */
  readonly parent: string | null;
  readonly svg: DiagramSvg;
  readonly items: Readonly<Record<string, SiteItem>>;
  readonly edges: readonly SiteEdge[];
}

export type SiteBuild =
  | { readonly kind: "ok"; readonly diagrams: readonly SiteDiagram[]; readonly diagnostics: readonly Diagnostic[] }
  | { readonly kind: "failed"; readonly diagnostics: readonly Diagnostic[] };

export function renderOrder(views: readonly C4View[]): C4View[] {
  const rank = (v: C4View): number => v.id === "index" ? 0 : v.type === "deployment" ? 2 : 1;
  return [...views].sort((a, b) => rank(a) - rank(b)
    || (a.viewOf?.split(".").length ?? 0) - (b.viewOf?.split(".").length ?? 0)
    || (a.viewOf ?? a.id).localeCompare(b.viewOf ?? b.id)
    || a.id.localeCompare(b.id));
}

const files = (dir: string, extension: string): string[] => existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith(extension)).sort().map((file) => join(dir, file)) : [];

/** structure：设计里的 structure/ 目录；contract/ 与 behavior/ 是它的兄弟目录。 */
export async function buildSite(structure: string): Promise<SiteBuild> {
  const compiled = await compileLikeC4(structure);
  if (compiled.kind === "failed") return compiled;
  const s = compiled.structure, root = dirname(resolve(structure));
  const owner = elementOfModule(s);
  const subjectOf = (module: string) => owner.has(module) ? element(owner.get(module)!) : global;
  const vdm = await compileVdm(files(join(root, "contract"), ".vdmsl"), () => global, new Set());
  if (vdm.kind === "failed") return { kind: "failed", diagnostics: [...compiled.diagnostics, ...vdm.diagnostics] };
  const cycles = importCycleRules(vdm.project, subjectOf);
  if (cycles.length > 0) return { kind: "failed", diagnostics: [...compiled.diagnostics, ...vdm.diagnostics, ...cycles] };
  const contract = generateContract(vdm.project, new Set(owner.keys()), subjectOf);
  const front = [...compiled.diagnostics, ...vdm.diagnostics, ...contract.diagnostics];
  if (contract.diagnostics.some((d) => d.severity === "error")) return { kind: "failed", diagnostics: front };
  const stage = mkdtempSync("/tmp/ssot-site-");
  try {
    const behavior = join(stage, "behavior"), work = join(stage, "work");
    for (const dir of [behavior, work, join(stage, ".gen")]) mkdirSync(dir);
    writeFileSync(join(stage, ".gen", "contract.qnt"), contract.text);
    const behaviorFiles = files(join(root, "behavior"), ".qnt");
    for (const file of behaviorFiles) copyFileSync(file, join(behavior, basename(file)));
    const generated = new Set(["contract", ...owner.keys(), ...contract.callModules]);
    const modules = await Promise.all(behaviorFiles.map((file) => compileBehavior(join(behavior, basename(file)), basename(file, ".qnt"), generated, work, (path) => path.replace(stage, root), { origins: contract.origins, subjectOf })));
    const diagnostics = [...front, ...modules.flatMap((m) => m.diagnostics)];
    if (modules.some((m) => m.kind === "failed")) return { kind: "failed", diagnostics };
    const compositions: { readonly module: QuintModule; readonly diagram: CompositionDiagram }[] = [];
    for (const m of modules) {
      if (m.kind !== "ok" || !isRunnable(m.module)) continue;
      compositions.push({ module: m.module, diagram: projectComposition(await Bun.file(m.module.typecheckOut).json(), m.module, vdm.project) });
    }
    compositions.sort((a, b) => a.module.name.localeCompare(b.module.name));
    const boxes = vdm.project.modules.filter((m) => owner.has(m.name)).sort((a, b) => a.name.localeCompare(b.name)).map(projectBox);
    const links = new Links(s, owner, compositions.map((c) => c.diagram));
    const diagrams: SiteDiagram[] = [];
    for (const view of renderOrder(s.views)) {
      switch (view.type) {
        case "element": {
          const diagram = projectC4View(s, view);
          diagrams.push(c4Entry(s, links, view, "view", diagram, await c4Svg(diagram)));
          break;
        }
        case "deployment": {
          const diagram = projectDeploymentView(s, view);
          diagrams.push(c4Entry(s, links, view, "deployment", diagram, await c4Svg(diagram)));
          break;
        }
        case "dynamic":
          throw new Error(`动态视图 ${view.id} 不应通过检查`);
        default:
          assertNever(view.type);
      }
    }
    if (boxes.length > 0) {
      const layers = projectLayers(s, vdm.project, owner);
      diagrams.push(layersEntry(links, layers, await layersSvg(layers)));
    }
    for (const box of boxes) diagrams.push(boxEntry(links, box, await boxSvg(box)));
    for (const { diagram } of compositions) diagrams.push(compositionEntry(links, diagram, await compositionSvg(diagram)));
    return { kind: "ok", diagrams, diagnostics };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

/** 从一个模型元素能跳去的图：它的下钻视图、显示它的其他视图、它的契约盒子、调用它的组合图。 */
class Links {
  private readonly moduleOf: ReadonlyMap<string, string>;
  constructor(private readonly s: Structure, owner: ReadonlyMap<string, string>, private readonly compositions: readonly CompositionDiagram[]) {
    this.moduleOf = new Map([...owner].map(([module, fqn]) => [fqn, module]));
  }

  module(fqn: string): string | null {
    return this.moduleOf.get(fqn) ?? null;
  }

  ofElement(fqn: string, here: string): SiteLink[] {
    const out: SiteLink[] = [];
    for (const v of this.s.views) if (v.type === "element" && v.viewOf === fqn && v.id !== here) out.push({ label: `Open ${v.title ?? v.id}`, diagram: v.id });
    const module = this.module(fqn);
    if (module !== null) out.push(...this.ofModule(module, here));
    for (const v of this.s.views) if (v.type === "element" && v.viewOf !== fqn && v.id !== here && v.nodes.includes(fqn)) out.push({ label: `Shown in ${v.title ?? v.id}`, diagram: v.id });
    return out;
  }

  ofModule(module: string, here: string): SiteLink[] {
    const out: SiteLink[] = [];
    if (`box:${module}` !== here) out.push({ label: `Contract box ${module}`, diagram: `box:${module}` });
    for (const c of this.compositions)
      if (`composition:${c.module}` !== here && c.edges.some((e) => (e.kind === "call" || e.kind === "read") && e.contract === module))
        out.push({ label: `Composed in ${c.module}`, diagram: `composition:${c.module}` });
    return out;
  }

  relationFacts(fqn: string): (readonly [string, string])[] {
    const title = (id: string): string => this.s.elements.get(id)?.title ?? id;
    return [
      ...this.s.relations.filter((r) => r.source === fqn).map((r) => ["Calls", `${title(r.target)}${r.title ? ` · ${r.title}` : ""}`] as const),
      ...this.s.relations.filter((r) => r.target === fqn).map((r) => ["Called by", `${title(r.source)}${r.title ? ` · ${r.title}` : ""}`] as const),
    ];
  }

  relations(ids: readonly string[]): SiteEdge["relations"] {
    const byId = new Map<string, C4Relation>(this.s.relations.map((r) => [r.id, r]));
    const title = (id: string): string => this.s.elements.get(id)?.title ?? id;
    return ids.flatMap((id) => {
      const r = byId.get(id);
      return r ? [{ title: r.title ?? "", description: r.description, source: title(r.source), target: title(r.target) }] : [];
    });
  }
}

/** 下钻视图的上一级：视图对象最近的、自己也有视图的祖先；都没有时是 index。 */
function parentView(s: Structure, view: C4View): string | null {
  if (view.id === "index" || view.type !== "element") return null;
  let p = view.viewOf === null ? null : s.elements.get(view.viewOf)?.parent ?? null;
  while (p !== null) {
    const of = s.views.find((v) => v.type === "element" && v.viewOf === p);
    if (of) return of.id;
    p = s.elements.get(p)?.parent ?? null;
  }
  return s.views.some((v) => v.id === "index") ? "index" : null;
}

function c4Entry(s: Structure, links: Links, view: C4View, kind: "view" | "deployment", diagram: C4Diagram, svg: DiagramSvg): SiteDiagram {
  const items: Record<string, SiteItem> = {};
  for (const node of diagram.nodes) {
    const e = node.element === null ? null : s.elements.get(node.element) ?? null;
    const module = node.element === null ? null : links.module(node.element);
    items[node.id] = {
      title: node.title,
      kind: `${c4Notation(node.kind)}${node.technology ? `: ${node.technology}` : ""}`,
      description: node.description,
      facts: [
        ...(node.element === node.id ? [["Path", node.id] as const] : [["Deployment path", node.id] as const, ...(node.element !== null ? [["Element", node.element] as const] : [])]),
        ...node.tags.map((t) => ["Tag", `#${t}`] as const),
        ...(module !== null ? [["Contract module", module] as const] : []),
        ...(typeof e?.metadata["group"] === "string" ? [["Group", e.metadata["group"]] as const] : []),
        ...(node.element !== null ? links.relationFacts(node.element) : []),
      ],
      links: node.element !== null ? links.ofElement(node.element, view.id) : [],
    };
  }
  return {
    id: view.id, file: `${view.id}.png`, kind, title: diagram.title, description: diagram.description, parent: parentView(s, view), svg, items,
    edges: diagram.edges.map((e) => ({ source: e.source, target: e.target, label: e.label, relations: links.relations(e.relations) })),
  };
}

function layersEntry(links: Links, layers: LayersDiagram, svg: DiagramSvg): SiteDiagram {
  const items: Record<string, SiteItem> = {};
  for (const m of layers.modules) {
    items[m.module] = {
      title: m.module, kind: `Contract module · ${m.tier}`, description: m.title,
      facts: [["Element", m.element], ...layers.imports.filter((i) => i.from === m.module).map((i) => ["Imports", `${i.to} · ${i.names.join(", ")}`] as const), ...layers.imports.filter((i) => i.to === m.module).map((i) => ["Imported by", `${i.from} · ${i.names.join(", ")}`] as const)],
      links: [...links.ofModule(m.module, "layers"), ...links.ofElement(m.element, "layers").filter((l) => !l.diagram.startsWith("box:") && !l.diagram.startsWith("composition:"))],
    };
  }
  return {
    id: "layers", file: "layers.png", kind: "layers", title: "Contract layers", description: "Who imports whose definitions", parent: null, svg, items,
    edges: layers.imports.map((i) => ({ source: i.from, target: i.to, label: i.names.join(", "), relations: [] })),
  };
}

function boxEntry(links: Links, box: BoxDiagram, svg: DiagramSvg): SiteDiagram {
  const id = `box:${box.module}`, items: Record<string, SiteItem> = {};
  for (const port of box.ports) {
    items[port.name] = {
      title: port.name, kind: port.kind === "operation" ? "Port · operation" : "Port · function", description: "",
      facts: [["Inputs", port.inputs.join(" * ") || "()"], ["Output", port.output], ...(port.ext ? [["Reads", port.ext.rd.join(", ") || "—"] as const, ["Writes", port.ext.wr.join(", ") || "—"] as const] : [])],
      links: [{ label: "Contract layers", diagram: "layers" }, ...links.ofElement(box.element, id).filter((l) => l.diagram !== id)],
    };
  }
  return {
    id, file: `box-${box.module}.png`, kind: "box", title: `Contract box · ${box.module}`, description: box.element, parent: "layers", svg, items,
    edges: box.ports.flatMap((port) => [{ source: port.name, target: port.name, label: port.inputs.join(" * ") || "()", relations: [] }, { source: port.name, target: port.name, label: port.output, relations: [] }]),
  };
}

function compositionEntry(links: Links, c: CompositionDiagram, svg: DiagramSvg): SiteDiagram {
  const id = `composition:${c.module}`, items: Record<string, SiteItem> = {};
  for (const node of c.nodes) {
    switch (node.kind) {
      case "step": {
        const own = c.edges.filter((e) => e.step === node.id);
        const contracts = [...new Set(own.flatMap((e) => e.kind === "call" || e.kind === "read" ? [e.contract] : []))];
        items[`step:${node.id}`] = {
          title: node.id, kind: "Step · action", description: "",
          facts: own.map((e): readonly [string, string] => {
            switch (e.kind) {
              case "take": return ["Takes", e.wire];
              case "put": return ["Puts", e.wire];
              case "update": return ["Updates", e.wire];
              case "call": return ["Calls", `${e.contract}.${e.operations.join(", ")}`];
              case "read": return ["Reads", e.contract];
              default: return assertNever(e);
            }
          }),
          links: contracts.flatMap((m) => links.ofModule(m, id)),
        };
        break;
      }
      case "wire":
        items[`wire:${node.id}`] = { title: node.id, kind: "Wire · behavior variable", description: "", facts: [["Type", node.type], ...c.edges.flatMap((e) => e.kind !== "call" && e.kind !== "read" && e.wire === node.id ? [[e.kind === "take" ? "Taken by" : e.kind === "put" ? "Put by" : "Updated by", e.step] as const] : [])], links: [] };
        break;
      case "contract": break;
      default: assertNever(node);
    }
  }
  return {
    id, file: `composition-${c.module}.png`, kind: "composition", title: `Composition · ${c.module}`, description: "Steps, wires and the contract calls each step makes", parent: null, svg, items,
    // 与 compositionSvg 的 data-edge 下标一致：契约调用与读取不画成箭头。
    edges: c.edges.flatMap((e): SiteEdge[] => {
      switch (e.kind) {
        case "take": return [{ source: `wire:${e.wire}`, target: `step:${e.step}`, label: "take", relations: [] }];
        case "put": return [{ source: `step:${e.step}`, target: `wire:${e.wire}`, label: "put", relations: [] }];
        case "update": return [{ source: `step:${e.step}`, target: `wire:${e.wire}`, label: "update", relations: [] }];
        case "call": case "read": return [];
        default: return assertNever(e);
      }
    }),
  };
}
