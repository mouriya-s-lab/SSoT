// C4 逻辑视图的投影：LikeC4 计算后的视图 → 渲染器要画的节点、边界、分组与箭头。
// 纵向顺序按调用方向（发起方在上），由布局从箭头计算；作者不写任何布局或样式。
import type { C4Element, C4View, Structure } from "../compile/likec4";
import { assertNever } from "../diag";
import { hasTag, parseElementKind } from "../model";

export type C4NodeKind = "person" | "system" | "external" | "container" | "component";

export interface C4DiagramNode {
  readonly id: string;
  readonly title: string;
  readonly kind: C4NodeKind;
  readonly technology: string | null;
  readonly description: string;
  /** 视图里最近的可见祖先；null：画在图的顶层。 */
  readonly parent: string | null;
  /** 所属分组的 id；null：不在分组里。 */
  readonly group: string | null;
  /** true：它在本视图里有可见的子元素，画成边界框。 */
  readonly boundary: boolean;
}

/** 同一父元素下 metadata `group` 相同的兄弟元素；在每张图里由这一处声明画出。 */
export interface C4DiagramGroup {
  readonly id: string;
  readonly name: string;
  readonly parent: string | null;
}

export interface C4DiagramEdge {
  readonly source: string;
  readonly target: string;
  readonly label: string | null;
}

export interface C4Diagram {
  readonly view: string;
  readonly title: string;
  readonly description: string;
  readonly nodes: readonly C4DiagramNode[];
  readonly groups: readonly C4DiagramGroup[];
  readonly edges: readonly C4DiagramEdge[];
}

function nodeKind(e: C4Element): C4NodeKind {
  const kind = parseElementKind(e.kind);
  if (kind === null) throw new Error(`元素 ${e.fqn} 的种类 '${e.kind}' 不在约定内；先运行 ssot check`);
  switch (kind) {
    case "actor": return "person";
    case "system": return hasTag(e, "external") ? "external" : "system";
    case "container": return "container";
    case "component": return "component";
    default: return assertNever(kind);
  }
}

function groupName(e: C4Element): string | null {
  const value = e.metadata["group"];
  if (value === undefined) return null;
  if (typeof value !== "string") throw new Error(`元素 ${e.fqn} 的 metadata group 只能写一个组名；先运行 ssot check`);
  return value;
}

export function projectC4View(s: Structure, view: C4View): C4Diagram {
  if (view.type !== "element") throw new Error(`视图 ${view.id} 不是逻辑视图`);
  const visible = new Set(view.nodes);
  const element = (fqn: string): C4Element => {
    const e = s.elements.get(fqn);
    if (!e) throw new Error(`视图 ${view.id} 引用了不存在的元素 ${fqn}`);
    return e;
  };
  const visibleParent = (fqn: string): string | null => {
    let p = element(fqn).parent;
    while (p !== null && !visible.has(p)) p = element(p).parent;
    return p;
  };
  const parents = new Map(view.nodes.map((fqn) => [fqn, visibleParent(fqn)]));
  const withChildren = new Set([...parents.values()].filter((p): p is string => p !== null));
  const groups = new Map<string, C4DiagramGroup>();
  const nodes = view.nodes.map((fqn): C4DiagramNode => {
    const e = element(fqn), parent = parents.get(fqn) ?? null, name = groupName(e);
    let group: string | null = null;
    if (name !== null) {
      group = `group:${parent ?? ""}:${name}`;
      if (!groups.has(group)) groups.set(group, { id: group, name, parent });
    }
    return { id: fqn, title: e.title, kind: nodeKind(e), technology: e.technology, description: e.description, parent, group, boundary: withChildren.has(fqn) };
  });
  return {
    view: view.id,
    title: view.title ?? view.id,
    description: view.description,
    nodes,
    groups: [...groups.values()],
    edges: view.edges.map((edge) => ({ source: edge.source, target: edge.target, label: edge.label })),
  };
}
