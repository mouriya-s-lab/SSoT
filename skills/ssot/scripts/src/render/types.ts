// 契约类型图：一个契约模块的类型定义与状态，各自的结构，以及它们引用到的、别的模块的类型。
import type { ProofObligation, VdmDefinition, VdmProject, VdmType } from "../compile/vdm";
import { assertNever } from "../diag";
import { type BoxObligation, type BoxPredicate, clauseText, obligationsOf, vdmTypeName } from "./box";

/** 类型的结构：记录列字段，并列列出各个选项，引号类型是一个值，其余（基本类型、集合、序列、映射、可选、积）写成一个类型式。 */
export type TypeShape =
  | { readonly kind: "record"; readonly fields: readonly { readonly name: string; readonly type: string }[] }
  | { readonly kind: "union"; readonly alternatives: readonly string[] }
  | { readonly kind: "quote"; readonly value: string }
  | { readonly kind: "alias"; readonly type: string };

export interface TypeNode {
  /** `模块\`名字`。 */
  readonly id: string;
  /** 定义它的模块；与图的模块不同时，它是从那个模块引来的。 */
  readonly module: string;
  readonly name: string;
  readonly category: "type" | "state";
  readonly shape: TypeShape;
  readonly inv: BoxPredicate | null;
  readonly obligations: readonly BoxObligation[];
}

/** source 的结构里用到了 target；fields 是用到它的记录字段名，source 不是记录时为空。 */
export interface TypeEdge {
  readonly source: string;
  readonly target: string;
  readonly fields: readonly string[];
}

export interface TypesDiagram {
  readonly module: string;
  readonly element: string;
  readonly nodes: readonly TypeNode[];
  readonly edges: readonly TypeEdge[];
}

const typeId = (module: string, name: string): string => `${module}\`${name}`;

function shapeOf(type: VdmType): TypeShape {
  switch (type.kind) {
    case "record": return { kind: "record", fields: type.fields.map((f) => ({ name: f.name, type: vdmTypeName(f.type) })) };
    case "union": return { kind: "union", alternatives: type.types.map(vdmTypeName) };
    case "quote": return { kind: "quote", value: vdmTypeName(type) };
    case "nat": case "nat1": case "int": case "rat": case "real": case "bool": case "char": case "token": case "void": case "unknown":
    case "parameter": case "ref": case "seq": case "seq1": case "set": case "set1": case "map": case "inmap": case "optional": case "product":
    case "function": case "operation":
      return { kind: "alias", type: vdmTypeName(type) };
    default: return assertNever(type);
  }
}

/** 一个类型式里引用到的具名类型（`ref` 与嵌套的 `record`），按出现顺序、不重复。 */
function referencesOf(type: VdmType, out: Map<string, { readonly module: string; readonly name: string }>): void {
  switch (type.kind) {
    case "nat": case "nat1": case "int": case "rat": case "real": case "bool": case "char": case "token": case "void": case "unknown":
    case "parameter": case "quote":
      return;
    case "ref": out.set(typeId(type.module, type.name), { module: type.module, name: type.name }); return;
    case "record": out.set(typeId(type.module, type.name), { module: type.module, name: type.name }); return;
    case "seq": case "seq1": case "set": case "set1": referencesOf(type.element, out); return;
    case "map": case "inmap": referencesOf(type.from, out); referencesOf(type.to, out); return;
    case "optional": referencesOf(type.type, out); return;
    case "product": case "union": for (const t of type.types) referencesOf(t, out); return;
    case "function": case "operation": for (const t of type.params) referencesOf(t, out); referencesOf(type.result, out); return;
    default: assertNever(type);
  }
}

type Named = Extract<VdmDefinition, { readonly category: "type" | "state" }>;

/** 一个定义顶层结构的各部分：记录与状态逐个字段（标上字段名），其他类型整体算一部分。 */
function partsOf(d: Named): { readonly label: string | null; readonly type: VdmType }[] {
  switch (d.category) {
    case "type": return d.type.kind === "record" ? d.type.fields.map((f) => ({ label: f.name, type: f.type })) : [{ label: null, type: d.type }];
    case "state": return d.fields.map((f) => ({ label: f.name, type: f.type }));
    default: return assertNever(d);
  }
}

/** 自引用（递归类型）不成边：它在框里的字段类型上已经看得到。 */
function edgesOf(source: string, d: Named): TypeEdge[] {
  const fields = new Map<string, string[]>();
  for (const part of partsOf(d)) {
    const refs = new Map<string, { readonly module: string; readonly name: string }>();
    referencesOf(part.type, refs);
    for (const target of refs.keys()) {
      if (target === source) continue;
      const via = fields.get(target) ?? [];
      if (part.label !== null) via.push(part.label);
      fields.set(target, via);
    }
  }
  return [...fields].map(([target, via]) => ({ source, target, fields: via }));
}

function node(module: string, d: Named, obligations: readonly ProofObligation[]): TypeNode {
  switch (d.category) {
    case "type":
      return { id: typeId(module, d.name), module, name: d.name, category: "type", shape: shapeOf(d.type), inv: d.inv === null ? null : { text: clauseText(d.inv), sample: d.invSample }, obligations: obligationsOf(obligations, module, d.name) };
    case "state":
      return { id: typeId(module, d.name), module, name: d.name, category: "state", shape: { kind: "record", fields: d.fields.map((f) => ({ name: f.name, type: vdmTypeName(f.type) })) }, inv: d.inv === null ? null : { text: clauseText(d.inv), sample: d.invSample }, obligations: obligationsOf(obligations, module, d.name) };
    default: return assertNever(d);
  }
}

/**
 * 模块自己的类型与状态都画；它们引用到、或模块显式引入的别的模块的类型也画，标出来源模块，但不再展开那些类型的引用。
 * 引用到的类型在项目里找不到定义时（只可能是 VDMJ 已报错的情况）抛错，不画成空框。
 */
export function projectTypes(project: VdmProject, moduleName: string, obligations: readonly ProofObligation[]): TypesDiagram {
  const named = new Map<string, { readonly module: string; readonly definition: Named }>();
  for (const m of project.modules) for (const d of m.definitions) if (d.category === "type" || d.category === "state") named.set(typeId(m.name, d.name), { module: m.name, definition: d });
  const module = project.modules.find((m) => m.name === moduleName);
  if (!module) throw new Error(`没有契约模块 ${moduleName}`);
  const own = module.definitions.filter((d): d is Named => d.category === "type" || d.category === "state");
  const nodes = own.map((d) => node(module.name, d, obligations));
  const edges = own.flatMap((d) => edgesOf(typeId(module.name, d.name), d));
  const foreign = new Set<string>([
    ...edges.map((e) => e.target).filter((id) => !id.startsWith(`${module.name}\``)),
    ...module.imports.flatMap((i) => i.items.flatMap((item) => item.kind === "type" ? [typeId(i.module, item.name)] : [])),
  ]);
  for (const id of foreign) {
    const found = named.get(id);
    if (!found) throw new Error(`${module.name} 引用的类型 ${id} 在契约里没有定义`);
    nodes.push(node(found.module, found.definition, obligations));
  }
  return { module: module.name, element: module.name.replaceAll("_", "."), nodes, edges };
}
