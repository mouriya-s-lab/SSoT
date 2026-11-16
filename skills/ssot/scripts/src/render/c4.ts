// C4 逻辑视图的投影：LikeC4 计算后的视图 → 渲染器要画的节点、边界、分组与箭头。
// 纵向顺序按调用方向（发起方在上），由布局从箭头计算；作者不写任何布局或样式。
import type { C4Element, C4View, C4ViewEdge, Structure } from "../compile/likec4";
import { assertNever } from "../diag";
import { TAG_EXTERNAL, hasTag, parseElementKind } from "../model";

export type C4NodeKind = "person" | "system" | "external" | "container" | "store" | "component" | "deploymentNode";

export interface C4DiagramNode {
  /** 逻辑视图：元素 fqn；部署视图：部署路径。 */
  readonly id: string;
  /** 它代表的模型元素；部署节点不代表元素，为 null。 */
  readonly element: string | null;
  readonly title: string;
  readonly kind: C4NodeKind;
  /** 部署节点：部署节点的种类（如 host）。 */
  readonly technology: string | null;
  /** 部署节点的标签（如信任边界）；逻辑元素不在图上显示标签，为空。 */
  readonly tags: readonly string[];
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


export interface C4Diagram {
  readonly view: string;
  readonly title: string;
  readonly description: string;
  readonly nodes: readonly C4DiagramNode[];
  readonly groups: readonly C4DiagramGroup[];
  readonly edges: readonly C4ViewEdge[];
}

function nodeKind(e: C4Element): C4NodeKind {
  const kind = parseElementKind(e.kind);
  if (kind === null) throw new Error(`元素 ${e.fqn} 的种类 '${e.kind}' 不在约定内；先运行 ssot check`);
  switch (kind) {
    case "actor": return "person";
    case "system": return hasTag(e, TAG_EXTERNAL) ? "external" : "system";
    case "container": return "container";
    case "store": return "store";
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
    return { id: fqn, element: fqn, title: e.title, kind: nodeKind(e), technology: e.technology, tags: [], description: e.description, parent, group, boundary: withChildren.has(fqn) };
  });
  return {
    view: view.id,
    title: view.title ?? view.id,
    description: view.description,
    nodes,
    groups: [...groups.values()],
    edges: view.edges,
  };
}

/** 部署视图：部署节点画成边界框（标题旁写种类与标签），实例按它所属元素的种类画成 C4 元素。 */
export function projectDeploymentView(s: Structure, view: C4View): C4Diagram {
  if (view.deployment === null) throw new Error(`视图 ${view.id} 不是部署视图`);
  const placements = view.deployment.placements;
  const visible = new Set(placements.map((p) => p.id));
  const withChildren = new Set(placements.flatMap((p) => p.parent !== null && visible.has(p.parent) ? [p.parent] : []));
  const nodes = placements.map((p): C4DiagramNode => {
    const parent = p.parent !== null && visible.has(p.parent) ? p.parent : null;
    switch (p.kind) {
      case "node":
        return { id: p.id, element: null, title: p.title, kind: "deploymentNode", technology: p.nodeKind, tags: p.tags, description: p.description, parent, group: null, boundary: withChildren.has(p.id) };
      case "instance": {
        const e = s.elements.get(p.element);
        if (!e) throw new Error(`部署实例 ${p.id} 引用了不存在的元素 ${p.element}`);
        return { id: p.id, element: p.element, title: p.title, kind: nodeKind(e), technology: p.technology, tags: [], description: p.description, parent, group: null, boundary: false };
      }
      default: return assertNever(p);
    }
  });
  return { view: view.id, title: view.title ?? view.id, description: view.description, nodes, groups: [], edges: view.deployment.edges };
}
