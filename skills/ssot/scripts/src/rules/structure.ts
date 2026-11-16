// 跨载体之前的结构规则：只看 LikeC4 模型。
import type { C4Element, Structure, ViewRuleKind } from "../compile/likec4";
import { type Diagnostic, assertNever, diag, element, global, relation, view } from "../diag";
import {
  ELEMENT_KINDS,
  GROUP_METADATA,
  TAG_BUSINESS,
  TAG_EXTERNAL,
  ancestors,
  hasTag,
  isContract,
  parseElementKind,
  within,
} from "../model";

/** 视图里禁止书写的规则，按写法称呼。 */
const RULE_NAMES: Readonly<Record<ViewRuleKind, string>> = {
  group: "group",
  rank: "rank",
  autoLayout: "autoLayout",
  style: "样式（style）",
  globalStyle: "全局样式（global style）",
};

const ID = /^[A-Za-z][A-Za-z0-9]*$/;


function kinds(s: Structure): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const k of s.spec.elementKinds)
    if (parseElementKind(k) === null)
      out.push(diag("struct.kinds", { kind: "global" }, null, `specification 声明了约定之外的元素种类 '${k}'；只允许 ${ELEMENT_KINDS.join("/")}`));
  for (const k of s.spec.relationKinds)
    out.push(diag("struct.kinds", { kind: "global" }, null, `specification 不得声明关系种类 '${k}'；关系只使用无种类的 ->`));
  for (const e of s.elements.values())
    if (parseElementKind(e.kind) === null) out.push(diag("struct.kinds", element(e.fqn), e.at, `元素种类 '${e.kind}' 不在约定内`));
  for (const r of s.relations)
    if (r.kind !== null)
      out.push(diag("struct.kinds", relation(r.source, r.target), r.at, `关系不得带种类 '${r.kind}'；只使用 ->`));
  return out;
}

function nesting(s: Structure): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const e of s.elements.values()) {
    const k = parseElementKind(e.kind);
    if (k === null) continue;
    switch (k) {
      case "actor":
        if (e.parent !== null) out.push(diag("struct.nesting", element(e.fqn), e.at, "actor 只能在顶层"));
        if (e.children.length > 0) out.push(diag("struct.nesting", element(e.fqn), e.at, "actor 不能有子元素"));
        break;
      case "system":
        if (e.parent !== null) out.push(diag("struct.nesting", element(e.fqn), e.at, "system 只能在顶层"));
        break;
      case "container":
      case "store":
      case "component": {
        const required = k === "component" ? "container" : "system";
        const parent = e.parent === null ? null : s.elements.get(e.parent);
        if (parent?.kind !== required)
          out.push(diag("struct.nesting", element(e.fqn), e.at, `${k} 的父元素必须是 ${required}`));
        if (k === "store" && e.children.length > 0)
          out.push(diag("struct.nesting", element(e.fqn), e.at, "store 不能有子元素：数据存储的内部划分是数据内容，不画进 C4"));
        break;
      }
      default:
        assertNever(k);
    }
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


function external(s: Structure): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const e of s.elements.values()) {
    if (!hasTag(e, TAG_EXTERNAL)) continue;
    if (parseElementKind(e.kind) !== "system" || e.parent !== null)
      out.push(diag("struct.external", element(e.fqn), e.at, `#external 只能标在顶层 system 上，${e.fqn} 是 ${e.kind}`));
    if (e.children.length > 0)
      out.push(diag("struct.external", element(e.fqn), e.at, `外部系统 ${e.fqn} 不能展开：别人负责的系统在本设计里是一个框`));
  }
  return out;
}

/** 分组是模型事实：`metadata group` 相同的元素是同一父元素下的兄弟，分组不嵌套。 */
function groups(s: Structure): Diagnostic[] {
  const out: Diagnostic[] = [];
  const members = new Map<string, { readonly parent: string | null; readonly fqn: string }>();
  for (const e of s.elements.values()) {
    const named = e.metadata[GROUP_METADATA];
    if (named === undefined) continue;
    if (typeof named !== "string" || named.trim() === "") {
      out.push(diag("struct.group", element(e.fqn), e.at, `metadata ${GROUP_METADATA} 只能写一个非空的组名`));
      continue;
    }
    const first = members.get(named);
    if (first === undefined) members.set(named, { parent: e.parent, fqn: e.fqn });
    else if (first.parent !== e.parent)
      out.push(diag("struct.group", element(e.fqn), e.at, `与 ${first.fqn} 同名分组 '${named}'，但不在同一父元素下；同一分组的成员只在这一个父元素下的兄弟之间`));
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
  return out;
}


function views(s: Structure): Diagnostic[] {
  const out: Diagnostic[] = [];
  const indexes = s.views.filter((v) => v.declared && v.id === "index" && v.type === "element" && v.viewOf === null);
  if (indexes.length !== 1)
    out.push(diag("struct.views", { kind: "global" }, null, `必须恰有一个顶层 index 视图，实际 ${indexes.length} 个`));
  const nonLeaf = [...s.elements.values()].filter((e) => e.children.length > 0);
  const scoped = new Map<string, string[]>();
  for (const v of s.views) {
    switch (v.type) {
      case "deployment":
        for (const rule of v.writtenRules)
          out.push(diag("struct.views", view(v.id), rule.at ?? v.at, `部署视图不写 ${RULE_NAMES[rule.kind]} 规则：部署视图由 ssot render 从模型绘制，实例的记法来自元素种类，节点颜色与图例来自节点标签`));
        continue;
      case "dynamic":
        out.push(diag("struct.views", view(v.id), v.at, "动态视图表达时序，时序属于 Quint，LikeC4 里不允许"));
        continue;
      case "element":
        break;
      default:
        return assertNever(v.type);
    }
    for (const rule of v.writtenRules)
      out.push(diag("struct.views", view(v.id), rule.at ?? v.at, `元素视图不写 ${RULE_NAMES[rule.kind]} 规则：图的形状、颜色、图例、分组与纵向顺序都由 ssot render 计算`));
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
  for (const rule of s.viewBlockRules)
    out.push(diag("struct.views", global, rule.at, `views 块里不写 ${RULE_NAMES[rule.kind]} 规则：逻辑视图与部署视图都由 ssot render 从模型绘制`));
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
  return [...kinds(s), ...nesting(s), ...external(s), ...groups(s), ...ids(s), ...layering(s), ...views(s)];
}
