// 切片归属：一个元素、关系、视图或文件由哪个写作叶子、在哪个 scope 下写。status 与 check --base 共用这里的定义。
// scope 的取值：write-level 取视图 id，元素还没有视图时取元素 fqn；write-contract 取元素 fqn；
// write-behavior 取 Quint 模块名；write-deploy 取部署视图 id。
import type { Structure } from "./compile/likec4";

export type Leaf = "ssot-write-level" | "ssot-write-deploy" | "ssot-write-contract" | "ssot-write-behavior";

export interface Slice {
  readonly skill: Leaf;
  readonly scope: string;
}

/** 元素 P 这一层（P 的直接子元素与它们之间的关系）的 scope；P 为 null 是顶层 index。 */
export function levelScope(s: Structure, parent: string | null): string {
  if (parent === null) return "index";
  return s.views.find((v) => v.type === "element" && v.viewOf === parent)?.id ?? parent;
}

/** 元素 E 由它父元素的那一层写下。 */
export function elementSlice(s: Structure, fqn: string): Slice {
  return { skill: "ssot-write-level", scope: levelScope(s, s.elements.get(fqn)?.parent ?? null) };
}

/** 两端的最近公共祖先；没有公共祖先时为 null（顶层）。 */
export function commonParent(a: string, b: string): string | null {
  const pa = a.split(".");
  const pb = b.split(".");
  let n = 0;
  // 只比到两端各自的父路径为止：公共祖先必须是两端的真祖先。
  while (n < pa.length - 1 && n < pb.length - 1 && pa[n] === pb[n]) n++;
  return n === 0 ? null : pa.slice(0, n).join(".");
}

/** 关系声明在两端最近公共祖先的那一层（逐层声明，见 ssot-write-level）。 */
export function relationSlice(s: Structure, source: string, target: string): Slice {
  return { skill: "ssot-write-level", scope: levelScope(s, commonParent(source, target)) };
}

/** 视图 V：元素视图属于被展开元素的那一层，部署视图属于 write-deploy，index 属于顶层。 */
export function viewSlice(s: Structure, id: string): Slice {
  const v = s.views.find((x) => x.id === id);
  if (v?.type === "deployment") return { skill: "ssot-write-deploy", scope: id };
  return { skill: "ssot-write-level", scope: v?.viewOf ? levelScope(s, v.viewOf) : id };
}

export const contractSlice = (fqn: string): Slice => ({ skill: "ssot-write-contract", scope: fqn });
export const behaviorSlice = (module: string): Slice => ({ skill: "ssot-write-behavior", scope: module });
