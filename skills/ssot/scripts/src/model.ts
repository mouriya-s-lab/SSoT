// 由 LikeC4 结构派生的事实：模块名映射、业务归属、契约标记、import 允许集合。
// 全部是对 Structure 的纯函数。
import { assertNever } from "./diag";
import type { C4Element, Structure } from "./compile/likec4";

export const ELEMENT_KINDS = ["actor", "system", "container", "component"] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];
export const RELATION_KINDS = ["calls", "uses", "callback"] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

export const TAG_CONTRACT = "contract";
export const TAG_SHARED = "shared";
export const TAG_BUSINESS = "business";

export function parseElementKind(k: string): ElementKind | null {
  return ELEMENT_KINDS.find((kind) => kind === k) ?? null;
}

export function parseRelationKind(k: string | null): RelationKind | null {
  return RELATION_KINDS.find((kind) => kind === k) ?? null;
}

/** 关系是否授予 import、是否参与无环与分层检查。 */
export function isDependency(k: RelationKind): boolean {
  switch (k) {
    case "calls":
    case "uses":
      return true;
    case "callback":
      return false;
    default:
      return assertNever(k);
  }
}

/** fqn 的 `.` 换成 `_`，大小写不变。 */
export function moduleNameOf(fqn: string): string {
  return fqn.replaceAll(".", "_");
}

export function contractFileOf(fqn: string): string {
  return `${fqn}.vdmsl`;
}

export function ancestors(s: Structure, fqn: string): string[] {
  const out: string[] = [];
  let p = s.elements.get(fqn)?.parent ?? null;
  while (p !== null) {
    out.push(p);
    p = s.elements.get(p)?.parent ?? null;
  }
  return out;
}

/** a 是否等于 b 或在 b 的子树内。 */
export function within(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}.`);
}

export const hasTag = (e: C4Element, t: string): boolean => e.tags.includes(t);
export const isContract = (e: C4Element): boolean => hasTag(e, TAG_CONTRACT);

export function isBusiness(s: Structure, fqn: string): boolean {
  const e = s.elements.get(fqn);
  if (!e) return false;
  return hasTag(e, TAG_BUSINESS) || ancestors(s, fqn).some((a) => hasTag(s.elements.get(a)!, TAG_BUSINESS));
}

export function contractElements(s: Structure): C4Element[] {
  return [...s.elements.values()].filter(isContract);
}

/** 允许集合（模块名，已排序）。 */
export function allowedImports(s: Structure, fqn: string): string[] {
  const out = new Set<string>();
  for (const r of s.relations) {
    const k = parseRelationKind(r.kind);
    if (r.source !== fqn || k === null || !isDependency(k)) continue;
    const t = s.elements.get(r.target);
    if (t && isContract(t)) out.add(moduleNameOf(t.fqn));
  }
  for (const a of ancestors(s, fqn)) {
    const ae = s.elements.get(a)!;
    if (hasTag(ae, TAG_SHARED) && isContract(ae)) out.add(moduleNameOf(a));
  }
  return [...out].sort();
}

/** 模块名 → 元素 fqn（只含 #contract 元素）。 */
export function elementOfModule(s: Structure): Map<string, string> {
  return new Map(contractElements(s).map((e) => [moduleNameOf(e.fqn), e.fqn]));
}
