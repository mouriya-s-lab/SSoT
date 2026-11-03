// 作用域：一个逐层视图 = 该视图计算后的节点。诊断按 Subject 归属筛选；归属不到元素的（global）总是报告。
import type { Structure } from "./compile/likec4";
import { type Diagnostic, type Subject, assertNever } from "./diag";

export type Scope = { readonly kind: "all" } | { readonly kind: "view"; readonly id: string; readonly nodes: ReadonlySet<string> };

export function resolveScope(s: Structure, viewId: string | null): Scope | { kind: "unknown"; id: string } {
  if (viewId === null) return { kind: "all" };
  const v = s.views.find((x) => x.id === viewId && x.type === "element");
  return v ? { kind: "view", id: v.id, nodes: new Set(v.nodes) } : { kind: "unknown", id: viewId };
}

/** 端点在视图里的显示节点：视图节点中包含它的最深者。 */
function shownAs(nodes: ReadonlySet<string>, fqn: string): string | null {
  let best: string | null = null;
  for (const n of nodes) if ((fqn === n || fqn.startsWith(`${n}.`)) && (best === null || n.length > best.length)) best = n;
  return best;
}

export function inScope(scope: Scope, subject: Subject): boolean {
  if (scope.kind === "all") return true;
  switch (subject.kind) {
    case "global":
      return true;
    case "element":
      return scope.nodes.has(subject.fqn);
    case "elements":
      return subject.fqns.some((f) => scope.nodes.has(f));
    case "relation": {
      // 关系在视图里按 LikeC4 的提升规则显示为两个节点之间的边；两端落到不同节点才算这一层的连接。
      const a = shownAs(scope.nodes, subject.source);
      const b = shownAs(scope.nodes, subject.target);
      return a !== null && b !== null && a !== b;
    }
    case "view":
      return subject.id === scope.id;
    default:
      return assertNever(subject);
  }
}

export function partition(scope: Scope, ds: readonly Diagnostic[]): { readonly shown: Diagnostic[]; readonly hidden: number } {
  const shown = ds.filter((d) => inScope(scope, d.subject));
  return { shown, hidden: ds.length - shown.length };
}
