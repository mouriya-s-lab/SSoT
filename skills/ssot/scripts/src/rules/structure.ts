// 跨载体之前的结构规则：只看 LikeC4 模型（CONVENTIONS §2）。
import type { C4Element, Structure } from "../compile/likec4";
import { type Diagnostic, assertNever, diag, element, relation, view } from "../diag";
import {
  ELEMENT_KINDS,
  type ElementKind,
  RELATION_KINDS,
  TAG_BUSINESS,
  TAG_CONTRACT,
  TAG_SHARED,
  ancestors,
  hasTag,
  isBusiness,
  isContract,
  isDependency,
  parseElementKind,
  parseRelationKind,
  within,
} from "../model";

const ID = /^[A-Za-z][A-Za-z0-9]*$/;

function rank(k: ElementKind): number {
  switch (k) {
    case "actor":
      return 0;
    case "system":
      return 1;
    case "container":
      return 2;
    case "component":
      return 3;
    default:
      return assertNever(k);
  }
}

function kinds(s: Structure): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const k of s.spec.elementKinds)
    if (parseElementKind(k) === null)
      out.push(diag("struct.kinds", { kind: "global" }, null, `specification 声明了约定之外的元素种类 '${k}'；只允许 ${ELEMENT_KINDS.join("/")}`));
  for (const k of s.spec.relationKinds)
    if (parseRelationKind(k) === null)
      out.push(diag("struct.kinds", { kind: "global" }, null, `specification 声明了约定之外的关系种类 '${k}'；只允许 ${RELATION_KINDS.join("/")}`));
  for (const e of s.elements.values())
    if (parseElementKind(e.kind) === null) out.push(diag("struct.kinds", element(e.fqn), e.at, `元素种类 '${e.kind}' 不在约定内`));
  for (const r of s.relations)
    if (parseRelationKind(r.kind) === null)
      out.push(diag("struct.kinds", relation(r.source, r.target), r.at, r.kind === null ? "关系没有写种类" : `关系种类 '${r.kind}' 不在约定内`));
  return out;
}

function nesting(s: Structure): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const e of s.elements.values()) {
    const k = parseElementKind(e.kind);
    if (k === null) continue;
    if (k === "actor") {
      if (e.parent !== null) out.push(diag("struct.nesting", element(e.fqn), e.at, "actor 只能在顶层"));
      if (e.children.length > 0) out.push(diag("struct.nesting", element(e.fqn), e.at, "actor 不能有子元素"));
      continue;
    }
    if (e.parent === null) continue;
    const pk = parseElementKind(s.elements.get(e.parent)!.kind);
    if (pk === null || pk === "actor") continue;
    const finer = rank(k) > rank(pk) || (k === "component" && pk === "component");
    if (!finer) out.push(diag("struct.nesting", element(e.fqn), e.at, `${k} 嵌套在 ${pk} ${e.parent} 之下：子元素必须比父元素细`));
  }
  return out;
}

function ids(s: Structure): Diagnostic[] {
  const out: Diagnostic[] = [];
  const need = new Set<string>();
  for (const e of s.elements.values()) if (isContract(e)) for (const x of [e.fqn, ...ancestors(s, e.fqn)]) need.add(x);
  for (const fqn of need) {
    const seg = fqn.split(".").at(-1)!;
    if (!ID.test(seg)) out.push(diag("struct.ids", element(fqn), s.elements.get(fqn)!.at, `承载契约的元素及其祖先的 id 只能由字母和数字组成：'${seg}'`));
  }
  return out;
}

function tags(s: Structure): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const e of s.elements.values()) {
    if (hasTag(e, TAG_SHARED)) {
      if (!isContract(e)) out.push(diag("contract.module", element(e.fqn), e.at, `#${TAG_SHARED} 必须同时带 #${TAG_CONTRACT}`));
      if (e.children.length === 0) out.push(diag("contract.module", element(e.fqn), e.at, `#${TAG_SHARED} 只能放在有子元素的元素上`));
    }
  }
  return out;
}

function layering(s: Structure): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const e of s.elements.values()) {
    if (!hasTag(e, TAG_BUSINESS)) continue;
    if (parseElementKind(e.kind) === "actor") out.push(diag("struct.layering", element(e.fqn), e.at, "actor 不得带 #business"));
    const dup = ancestors(s, e.fqn).find((a) => hasTag(s.elements.get(a)!, TAG_BUSINESS));
    if (dup) out.push(diag("struct.layering", element(e.fqn), e.at, `祖先 ${dup} 已是业务元素，#business 重复标记`));
  }
  for (const r of s.relations) {
    const k = parseRelationKind(r.kind);
    if (k === null || !isDependency(k)) continue;
    const src = s.elements.get(r.source)!;
    if (parseElementKind(src.kind) === "actor") continue;
    if (!isBusiness(s, r.source) && isBusiness(s, r.target))
      out.push(diag("struct.layering", relation(r.source, r.target), r.at, `架构元素 ${r.source} 以 ${k} 依赖业务元素 ${r.target}`));
  }
  return out;
}

/** 两端提升到最近公共祖先之下的兄弟；一端是另一端的祖先时返回 null。 */
function lift(a: string, b: string): { parent: string | null; from: string; to: string } | null {
  if (within(a, b) || within(b, a)) return null;
  const as = a.split(".");
  const bs = b.split(".");
  let i = 0;
  while (as[i] === bs[i]) i++;
  return {
    parent: i === 0 ? null : as.slice(0, i).join("."),
    from: as.slice(0, i + 1).join("."),
    to: bs.slice(0, i + 1).join("."),
  };
}

function acyclic(s: Structure): Diagnostic[] {
  const graphs = new Map<string, Map<string, Set<string>>>();
  for (const r of s.relations) {
    const k = parseRelationKind(r.kind);
    if (k === null || !isDependency(k)) continue;
    const l = lift(r.source, r.target);
    if (l === null) continue;
    const key = l.parent ?? "";
    const g = graphs.get(key) ?? new Map<string, Set<string>>();
    graphs.set(key, g);
    const succ = g.get(l.from) ?? new Set<string>();
    g.set(l.from, succ);
    succ.add(l.to);
  }
  const out: Diagnostic[] = [];
  for (const [parent, g] of [...graphs].sort(([a], [b]) => a.localeCompare(b))) {
    for (const scc of stronglyConnected(g)) {
      if (scc.length < 2) continue;
      const subject = parent === "" ? { kind: "global" as const } : element(parent);
      const at = parent === "" ? null : s.elements.get(parent)!.at;
      out.push(diag("struct.acyclic", subject, at, `${parent === "" ? "顶层" : parent} 之下的兄弟依赖成环：${scc.sort().join(", ")}`));
    }
  }
  return out;
}

function stronglyConnected(g: Map<string, Set<string>>): string[][] {
  const nodes = new Set<string>([...g.keys(), ...[...g.values()].flatMap((x) => [...x])]);
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const on = new Set<string>();
  const out: string[][] = [];
  const visit = (v: string): void => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    on.add(v);
    for (const w of g.get(v) ?? []) {
      if (!idx.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (on.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        on.delete(w);
        comp.push(w);
      } while (w !== v);
      out.push(comp);
    }
  };
  for (const v of [...nodes].sort()) if (!idx.has(v)) visit(v);
  return out;
}

function views(s: Structure): Diagnostic[] {
  const out: Diagnostic[] = [];
  const nonLeaf = [...s.elements.values()].filter((e) => e.children.length > 0);
  const scoped = new Map<string, string[]>();
  for (const v of s.views) {
    switch (v.type) {
      case "deployment":
        continue;
      case "dynamic":
        out.push(diag("struct.views", view(v.id), v.at, "动态视图表达时序，时序属于 Quint，LikeC4 里不允许"));
        continue;
      case "element":
        break;
      default:
        return assertNever(v.type);
    }
    if (v.viewOf === null) {
      if (v.id !== "index") {
        out.push(diag("struct.views", view(v.id), v.at, "顶层视图只能有一个，id 为 index；其他元素视图必须写 `of <元素>`"));
        continue;
      }
      for (const n of v.nodes)
        if (s.elements.get(n)?.parent !== null)
          out.push(diag("struct.views", view(v.id), v.at, `顶层视图只能含顶层元素，出现了 ${n}`));
      continue;
    }
    const of = s.elements.get(v.viewOf)!;
    scoped.set(of.fqn, [...(scoped.get(of.fqn) ?? []), v.id]);
    if (of.children.length === 0) {
      out.push(diag("struct.views", view(v.id), v.at, `${of.fqn} 没有子元素，不应有 view of`));
      continue;
    }
    out.push(...scopedViewContents(s, of, v.id, v.nodes, v.at));
  }
  for (const e of nonLeaf) {
    const vs = scoped.get(e.fqn) ?? [];
    if (vs.length === 0) out.push(diag("struct.views", element(e.fqn), e.at, `有子元素的元素 ${e.fqn} 没有 view of`));
    if (vs.length > 1) out.push(diag("struct.views", element(e.fqn), e.at, `${e.fqn} 有多个 view of：${vs.join(", ")}`));
  }
  return out;
}

function scopedViewContents(s: Structure, of: C4Element, id: string, nodes: readonly string[], at: C4Element["at"]): Diagnostic[] {
  const out: Diagnostic[] = [];
  const present = new Set(nodes);
  for (const c of of.children)
    if (!present.has(c)) out.push(diag("struct.views", view(id), at, `视图缺少直接子元素 ${c}`));
  const connected = (x: string): boolean =>
    s.relations.some((r) =>
      ([[r.source, r.target], [r.target, r.source]] satisfies readonly (readonly [string, string])[]).some(
        ([inside, outside]) => within(inside, of.fqn) && inside !== of.fqn && (within(outside, x) || within(x, outside)),
      ),
    );
  for (const n of nodes) {
    if (n === of.fqn || of.children.includes(n)) continue;
    if (within(n, of.fqn)) {
      out.push(diag("struct.views", view(id), at, `视图展开了孙辈元素 ${n}；逐层视图只含直接子元素`));
      continue;
    }
    if (!connected(n)) out.push(diag("struct.views", view(id), at, `外部元素 ${n} 与 ${of.fqn} 的子元素没有关系，不应出现在该层视图`));
  }
  return out;
}

export function structureRules(s: Structure): Diagnostic[] {
  return [...kinds(s), ...nesting(s), ...ids(s), ...tags(s), ...layering(s), ...acyclic(s), ...views(s)];
}
