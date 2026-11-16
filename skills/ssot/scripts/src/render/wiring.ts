// 接线这一面：接线索引（每个可运行 Quint 模块一张卡片）→ 组合图 → 性质图。
import type { QuintModule } from "../compile/quint";
import type { CompositionDiagram } from "./composition";

/** 接线索引里的一张卡片：这张接线图围绕的担心、接进来的契约盒子与规模。 */
export interface WiringSummary {
  readonly module: string;
  /** 开头注释里“盒子：”之前的部分（担心）；没有“盒子：”行时是整段开头注释。 */
  readonly concern: readonly string[];
  /** 步骤调用或读取反馈的契约模块。 */
  readonly boxes: readonly string[];
  readonly steps: number;
  readonly wires: number;
  readonly properties: number;
  readonly targets: number;
}

export interface PropertyCard {
  readonly name: string;
  /** 紧贴声明之上的注释（需求编号与说明）。 */
  readonly comment: readonly string[];
  readonly text: string;
}
export interface CoverageTarget extends PropertyCard {
  /** `maxSteps_<名字>` 声明的步数；没有声明时为 null（用默认值）。 */
  readonly maxSteps: number | null;
}

/** 性质图：组合图下面一层，写出 safety、它的各个合取项与覆盖目标的原文。 */
export interface PropertiesDiagram {
  readonly module: string;
  readonly safety: PropertyCard | null;
  /** safety 直接引用的本模块 val，按在文件里的次序。 */
  readonly conjuncts: readonly PropertyCard[];
  readonly targets: readonly CoverageTarget[];
}

const card = (d: QuintModule["decls"][number]): PropertyCard => {
  if (d.source === null) throw new Error(`${d.name} 没有表达式原文`);
  return { name: d.name, comment: d.source.comment, text: d.source.text };
};

/** 按在文件里的位置排：编译器给出的声明次序不是源码次序。 */
const bySource = (a: QuintModule["decls"][number], b: QuintModule["decls"][number]): number => {
  if (a.at === null || b.at === null) throw new Error(`${a.at === null ? a.name : b.name} 没有源码位置`);
  return a.at.line - b.at.line || a.at.col - b.at.col;
};

export function projectProperties(module: QuintModule): PropertiesDiagram {
  const safety = module.decls.find((d) => d.kind === "val" && d.name === "safety") ?? null;
  const conjuncts = safety === null ? [] : module.decls.filter((d) => d.kind === "val" && safety.references.includes(d.name)).sort(bySource);
  const targets = module.decls.filter((d) => d.kind === "val" && d.name.startsWith("witness")).sort(bySource).map((d): CoverageTarget => ({
    ...card(d),
    maxSteps: module.decls.find((m) => m.kind === "pureval" && m.name === `maxSteps_${d.name}`)?.intLiteral ?? null,
  }));
  return { module: module.name, safety: safety === null ? null : card(safety), conjuncts: conjuncts.map(card), targets };
}

export function projectWiring(module: QuintModule, composition: CompositionDiagram, properties: PropertiesDiagram): WiringSummary {
  const boxesAt = module.header.findIndex((line) => line.startsWith("盒子："));
  const concern = (boxesAt < 0 ? module.header : module.header.slice(0, boxesAt)).map((line, i) => i === 0 ? line.replace(/^担心：/, "") : line);
  return {
    module: module.name,
    concern,
    boxes: [...new Set(composition.edges.flatMap((e) => e.kind === "call" || e.kind === "read" ? [e.contract] : []))].sort(),
    steps: composition.nodes.filter((n) => n.kind === "step").length,
    wires: composition.nodes.filter((n) => n.kind === "wire").length,
    properties: properties.conjuncts.length,
    targets: properties.targets.length,
  };
}
