// 一份设计的全部图：C4 逻辑视图 → 部署视图 → 契约分层图 → 每个契约模块的盒子图、类型图、读写表 → 组合图。
// ssot render 把每张图截成 PNG；ssot serve 把同一份结果连同节点详情与跳转交给浏览器页面。
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { type C4Relation, type C4View, type Structure, compileLikeC4 } from "./compile/likec4";
import { type QuintModule, compileBehavior } from "./compile/quint";
import { type ProofObligation, checkObligations, compileVdm } from "./compile/vdm";
import { type Diagnostic, assertNever, element, global } from "./diag";
import { generateContract } from "./gen/contract";
import { elementOfModule } from "./model";
import { importCycleRules, isRunnable } from "./rules/cross";
import { type AccessTable, projectAccess } from "./render/access";
import { type BoxDiagram, type BoxObligation, type BoxPredicate, projectBox } from "./render/box";
import { type C4Diagram, projectC4View, projectDeploymentView } from "./render/c4";
import { type CompositionDiagram, projectComposition } from "./render/composition";
import { type LayersDiagram, projectLayers } from "./render/layers";
import { type DiagramSvg, accessSvg, boxSvg, c4Notation, c4Svg, compositionSvg, layersSvg, obligationTally, sampleText, typesSvg } from "./render/svg";
import { type TypeShape, type TypesDiagram, projectTypes } from "./render/types";

export type DiagramKind = "view" | "deployment" | "layers" | "box" | "types" | "access" | "composition";

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
  const vdmFiles = files(join(root, "contract"), ".vdmsl");
  const vdm = await compileVdm(vdmFiles, () => global, null);
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
    // 证明义务在自己的进程里跑，与行为编译并行。
    const [modules, checked] = await Promise.all([
      Promise.all(behaviorFiles.map((file) => compileBehavior(join(behavior, basename(file)), basename(file, ".qnt"), generated, work, (path) => path.replace(stage, root), { origins: contract.origins, subjectOf }))),
      checkObligations(vdmFiles, null),
    ]);
    if (checked.kind === "failed") return { kind: "failed", diagnostics: [...front, ...modules.flatMap((m) => m.diagnostics), checked.diagnostic] };
    const obligations: readonly ProofObligation[] = checked.obligations;
    const diagnostics = [...front, ...modules.flatMap((m) => m.diagnostics)];
    if (modules.some((m) => m.kind === "failed")) return { kind: "failed", diagnostics };
    const compositions: { readonly module: QuintModule; readonly diagram: CompositionDiagram }[] = [];
    for (const m of modules) {
      if (m.kind !== "ok" || !isRunnable(m.module)) continue;
      compositions.push({ module: m.module, diagram: projectComposition(await Bun.file(m.module.typecheckOut).json(), m.module, vdm.project) });
    }
    compositions.sort((a, b) => a.module.name.localeCompare(b.module.name));
    const contractModules = vdm.project.modules.filter((m) => owner.has(m.name)).sort((a, b) => a.name.localeCompare(b.name));
    const tables = new Map(contractModules.flatMap((m) => { const t = projectAccess(m); return t === null ? [] : [[m.name, t] as const]; }));
    const links = new Links(s, owner, compositions.map((c) => c.diagram), new Set(tables.keys()));
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
    if (contractModules.length > 0) {
      const layers = projectLayers(s, vdm.project, owner);
      diagrams.push(layersEntry(links, layers, await layersSvg(layers)));
    }
    for (const m of contractModules) {
      const box = projectBox(m, obligations);
      diagrams.push(boxEntry(links, box, await boxSvg(box)));
      const types = projectTypes(vdm.project, m.name, obligations);
      diagrams.push(typesEntry(links, types, await typesSvg(types)));
      const table = tables.get(m.name);
      if (table) diagrams.push(accessEntry(links, table, accessSvg(table)));
    }
    for (const { diagram } of compositions) diagrams.push(compositionEntry(links, diagram, await compositionSvg(diagram)));
    return { kind: "ok", diagrams, diagnostics };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

/** 从一个模型元素能跳去的图：它的下钻视图、显示它的其他视图、它的契约盒子、类型图与读写表、调用它的组合图。 */
class Links {
  private readonly moduleOf: ReadonlyMap<string, string>;
  /** tables：有读写表（即有状态）的契约模块。 */
  constructor(private readonly s: Structure, owner: ReadonlyMap<string, string>, private readonly compositions: readonly CompositionDiagram[], private readonly tables: ReadonlySet<string>) {
    this.moduleOf = new Map([...owner].map(([module, fqn]) => [fqn, module]));
  }

  module(fqn: string): string | null {
    return this.moduleOf.get(fqn) ?? null;
  }

  ofElement(fqn: string, here: string): SiteLink[] {
    const module = this.module(fqn);
    return [...this.drillDown(fqn, here), ...(module !== null ? this.ofModule(module, here) : []), ...this.shownIn(fqn, here)];
  }

  /** 以这个元素为对象的视图。 */
  drillDown(fqn: string, here: string): SiteLink[] {
    return this.s.views.flatMap((v) => v.type === "element" && v.viewOf === fqn && v.id !== here ? [{ label: `Open ${v.title ?? v.id}`, diagram: v.id }] : []);
  }

  /** 画了这个元素、但不以它为对象的视图。 */
  shownIn(fqn: string, here: string): SiteLink[] {
    return this.s.views.flatMap((v) => v.type === "element" && v.viewOf !== fqn && v.id !== here && v.nodes.includes(fqn) ? [{ label: `Shown in ${v.title ?? v.id}`, diagram: v.id }] : []);
  }

  ofModule(module: string, here: string): SiteLink[] {
    const out: SiteLink[] = [];
    if (`box:${module}` !== here) out.push({ label: `Contract box ${module}`, diagram: `box:${module}` });
    if (`types:${module}` !== here) out.push({ label: `Types of ${module}`, diagram: `types:${module}` });
    if (this.tables.has(module) && `access:${module}` !== here) out.push({ label: `Read / write table of ${module}`, diagram: `access:${module}` });
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
      links: [...links.ofModule(m.module, "layers"), ...links.drillDown(m.element, "layers"), ...links.shownIn(m.element, "layers")],
    };
  }
  return {
    id: "layers", file: "layers.png", kind: "layers", title: "Contract layers", description: "Who imports whose definitions", parent: null, svg, items,
    edges: layers.imports.map((i) => ({ source: i.from, target: i.to, label: i.names.join(", "), relations: [] })),
  };
}

const predicateFacts = (label: string, p: BoxPredicate | null): (readonly [string, string])[] =>
  p === null ? [] : [[label, p.text], ...(p.sample !== null ? [[`${label} sampled`, sampleText(p.sample)] as const] : [])];
const obligationFacts = (obligations: readonly BoxObligation[]): (readonly [string, string])[] =>
  [["Proof obligations", obligationTally(obligations)], ...[...obligations].sort((a, b) => a.number - b.number).map((o) => [`PO ${o.number}`, `${o.kind} · ${o.status}`] as const)];

function boxEntry(links: Links, box: BoxDiagram, svg: DiagramSvg): SiteDiagram {
  const id = `box:${box.module}`, items: Record<string, SiteItem> = {};
  const moduleLinks = [{ label: "Contract layers", diagram: "layers" }, ...links.ofElement(box.element, id)];
  for (const port of box.ports) {
    items[port.name] = {
      title: port.name, kind: port.kind === "operation" ? "Port · operation" : "Port · function", description: "",
      facts: [
        ["Inputs", port.inputs.join(" * ") || "()"], ["Output", port.output],
        ...(port.ext ? [["Reads", port.ext.rd.join(", ") || "—"] as const, ["Writes", port.ext.wr.join(", ") || "—"] as const] : []),
        ...predicateFacts("pre", port.pre), ...predicateFacts("post", port.post), ...obligationFacts(port.obligations),
      ],
      links: moduleLinks,
    };
  }
  if (box.state) {
    items[`state:${box.state.name}`] = {
      title: box.state.name, kind: "State", description: "",
      facts: [
        ...box.state.fields.map((f) => ["Field", f] as const), ...predicateFacts("inv", box.state.inv),
        ...(box.state.init ? [["init", box.state.init.clause] as const, ["Initial value", box.state.init.value ?? "VDMJ could not compute it (see diagnostics)"] as const] : []),
        ...obligationFacts(box.state.obligations),
      ],
      links: moduleLinks,
    };
  }
  return {
    id, file: `box-${box.module}.png`, kind: "box", title: `Contract box · ${box.module}`, description: box.element, parent: "layers", svg, items,
    edges: box.ports.flatMap((port) => [{ source: port.name, target: port.name, label: port.inputs.join(" * ") || "()", relations: [] }, { source: port.name, target: port.name, label: port.output, relations: [] }]),
  };
}

function shapeFacts(shape: TypeShape): (readonly [string, string])[] {
  switch (shape.kind) {
    case "record": return shape.fields.map((f) => ["Field", `${f.name} : ${f.type}`] as const);
    case "union": return shape.alternatives.map((a) => ["Alternative", a] as const);
    case "quote": return [["Value", shape.value]];
    case "alias": return [["Definition", shape.type]];
    default: return assertNever(shape);
  }
}

function typesEntry(links: Links, types: TypesDiagram, svg: DiagramSvg): SiteDiagram {
  const id = `types:${types.module}`, items: Record<string, SiteItem> = {};
  const names = new Map(types.nodes.map((n) => [n.id, n.name]));
  const name = (nodeId: string): string => {
    const found = names.get(nodeId);
    if (found === undefined) throw new Error(`类型图 ${types.module} 的连线指向不在图上的 ${nodeId}`);
    return found;
  };
  for (const node of types.nodes) {
    const imported = node.module !== types.module;
    items[node.id] = {
      title: node.name, kind: node.category === "state" ? "State" : imported ? `Type · from ${node.module}` : "Type", description: "",
      facts: [
        ["Module", node.module], ...shapeFacts(node.shape), ...predicateFacts("inv", node.inv),
        ...types.edges.filter((e) => e.source === node.id).map((e) => ["Uses", `${name(e.target)}${e.fields.length > 0 ? ` · via ${e.fields.join(", ")}` : ""}`] as const),
        ...types.edges.filter((e) => e.target === node.id).map((e) => ["Used by", `${name(e.source)}${e.fields.length > 0 ? ` · via ${e.fields.join(", ")}` : ""}`] as const),
        ...(node.obligations.length > 0 ? obligationFacts(node.obligations) : []),
      ],
      links: imported ? links.ofModule(node.module, id) : [],
    };
  }
  return {
    id, file: `types-${types.module}.png`, kind: "types", title: `Contract types · ${types.module}`, description: types.element, parent: `box:${types.module}`, svg, items,
    edges: types.edges.map((e) => ({ source: e.source, target: e.target, label: e.fields.length > 0 ? e.fields.join(", ") : null, relations: [] })),
  };
}

function accessEntry(links: Links, table: AccessTable, svg: DiagramSvg): SiteDiagram {
  const id = `access:${table.module}`, items: Record<string, SiteItem> = {};
  const moduleLinks = [{ label: "Contract layers", diagram: "layers" }, ...links.ofElement(table.element, id)];
  const fieldsWhere = (row: AccessTable["rows"][number], access: "rd" | "wr"): string => table.fields.filter((_, i) => row.cells[i] === access).join(", ") || "—";
  for (const row of table.rows) {
    items[row.operation] = {
      title: row.operation, kind: row.exported ? "Operation" : "Operation · internal", description: "",
      facts: [["Reads", fieldsWhere(row, "rd")], ["Writes", fieldsWhere(row, "wr")], ["Source", row.source === "ext" ? "ext clause" : "derived from body and post (no ext clause)"]],
      links: row.exported ? [{ label: `Port ${row.operation} in contract box`, diagram: `box:${table.module}` }] : [],
    };
  }
  table.fields.forEach((field, i) => {
    items[`field:${field}`] = {
      title: field, kind: `State field · ${table.state}`, description: "",
      facts: [
        ["Written by", table.rows.filter((r) => r.cells[i] === "wr").map((r) => r.operation).join(", ") || "—"],
        ["Read by", table.rows.filter((r) => r.cells[i] === "rd").map((r) => r.operation).join(", ") || "—"],
      ],
      links: moduleLinks,
    };
  });
  return { id, file: `access-${table.module}.png`, kind: "access", title: `Read / write · ${table.module}`, description: table.element, parent: `box:${table.module}`, svg, items, edges: [] };
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
