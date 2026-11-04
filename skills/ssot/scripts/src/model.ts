// 由 LikeC4 结构派生的事实：模块名映射、业务归属与契约标记。
// 全部是对 Structure 的纯函数。
import type { C4Element, Structure } from "./compile/likec4";

export const ELEMENT_KINDS = ["actor", "system", "container", "component"] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];

export const TAG_CONTRACT = "contract";
export const TAG_BUSINESS = "business";

export function parseElementKind(k: string): ElementKind | null {
  return ELEMENT_KINDS.find((kind) => kind === k) ?? null;
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


/** 模块名 → 元素 fqn（只含 #contract 元素）。 */
export function elementOfModule(s: Structure): Map<string, string> {
  return new Map(contractElements(s).map((e) => [moduleNameOf(e.fqn), e.fqn]));
}
