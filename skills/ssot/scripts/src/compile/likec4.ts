// 编译阶段：LikeC4。进程内加载工作区，只读模型 API 与 getErrors() 的结构化结果。
import { fileURLToPath } from "node:url";
import { loadLikeC4 } from "../install";
import { type Diagnostic, type Position, diag, global } from "../diag";

export type Metadata = Readonly<Record<string, string | readonly string[]>>;

export interface C4Element {
  readonly fqn: string;
  readonly title: string;
  readonly description: string;
  readonly kind: string;
  /** null：元素没有写 technology。 */
  readonly technology: string | null;
  readonly parent: string | null;
  readonly children: readonly string[];
  readonly tags: readonly string[];
  readonly metadata: Metadata;
  readonly at: Position | null;
}

export interface C4Relation {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  /** null：关系没有写种类。 */
  readonly kind: string | null;
  readonly title: string | null;
  /** 关系自己的 description；没写时为空串。 */
  readonly description: string;
  readonly tags: readonly string[];
  readonly metadata: Metadata;
  readonly at: Position | null;
}

export type ViewType = "element" | "dynamic" | "deployment";

/** 视图里画出的一条箭头：LikeC4 把关系提升到视图里可见的最近祖先之后的结果。 */
export interface C4ViewEdge {
  readonly source: string;
  readonly target: string;
  /** null：合并了多条关系且没有一条直接连在这两个节点之间。 */
  readonly label: string | null;
  /** 这条箭头合并的模型关系（C4Relation.id）。 */
  readonly relations: readonly string[];
}

/** 部署视图里画出的部署节点或实例；id 是部署模型里的路径（如 `coreNet.ledger`）。 */
export type C4DeploymentPlacement =
  | { readonly kind: "node"; readonly id: string; readonly title: string; readonly nodeKind: string; readonly parent: string | null; readonly tags: readonly string[]; readonly description: string; readonly technology: string | null }
  | { readonly kind: "instance"; readonly id: string; readonly title: string; readonly element: string; readonly parent: string | null; readonly tags: readonly string[]; readonly description: string; readonly technology: string | null };

/** 部署视图计算后的节点与箭头，端点是部署路径。 */
export interface C4DeploymentLayout {
  readonly placements: readonly C4DeploymentPlacement[];
  readonly edges: readonly C4ViewEdge[];
}

/** 视图里会定下图的样子、因而禁止由作者书写的规则。 */
export type ViewRuleKind = "group" | "rank" | "autoLayout" | "style" | "globalStyle";

/** 作者在源码里写下的一条视图规则；逻辑视图与部署图的形状、颜色、图例、分组与纵向顺序都由 `ssot render` 计算。 */
export interface C4ViewRule {
  readonly kind: ViewRuleKind;
  readonly at: Position | null;
}

export interface C4View {
  readonly id: string;
  readonly type: ViewType;
  readonly viewOf: string | null;
  readonly title: string | null;
  /** 视图自己的 description；没写时为空串。 */
  readonly description: string;
  /** 计算后（展开 include 规则）的元素节点。 */
  readonly nodes: readonly string[];
  /** 计算后的箭头，端点都是 nodes 里的元素。 */
  readonly edges: readonly C4ViewEdge[];
  /** 部署视图的部署节点、实例与它们之间的箭头；不是部署视图时为 null。 */
  readonly deployment: C4DeploymentLayout | null;
  /** 作者在视图声明里写下的规则（按源码次序），元素视图与部署视图都收。 */
  readonly writtenRules: readonly C4ViewRule[];
  /** false：LikeC4 自动生成的视图（没有源位置）。 */
  readonly declared: boolean;
  readonly at: Position | null;
}

export interface Structure {
  readonly elements: ReadonlyMap<string, C4Element>;
  readonly relations: readonly C4Relation[];
  readonly views: readonly C4View[];
  /** `views { ... }` 块里写在视图之外的样式规则；它们作用到块内的每张视图。 */
  readonly viewBlockRules: readonly C4ViewRule[];
  readonly spec: {
    readonly elementKinds: readonly string[];
    readonly relationKinds: readonly string[];
    readonly tags: readonly string[];
  };
}

export type C4Result =
  | { readonly kind: "ok"; readonly structure: Structure; readonly diagnostics: readonly Diagnostic[] }
  | { readonly kind: "failed"; readonly diagnostics: readonly Diagnostic[] };

type Located = { uri: string; range: { start: { line: number; character: number } } } | null | undefined;

function position(loc: Located): Position | null {
  if (!loc) return null;
  return { file: fileURLToPath(loc.uri), line: loc.range.start.line + 1, col: loc.range.start.character + 1 };
}

function viewType(t: string): ViewType {
  switch (t) {
    case "element":
    case "dynamic":
    case "deployment":
      return t;
    default:
      throw new Error(`LikeC4 返回了未知的视图类型 ${t}`);
  }
}

type UnknownRecord = Readonly<Record<string, unknown>>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

/** 计算视图里不保留 view 规则；作者写过哪些规则只能读工作区文档的解析结果。 */
const RULE_KINDS: Readonly<Record<string, ViewRuleKind>> = {
  ViewRuleGroup: "group",
  ViewRuleRank: "rank",
  ViewRuleAutoLayout: "autoLayout",
  ViewRuleStyle: "style",
  ViewRuleGlobalStyle: "globalStyle",
  DeploymentViewRuleStyle: "style",
};

/** 只挑元素、不改图的样子，不是禁止项。 */
const HARMLESS_RULE_TYPES: Readonly<Record<string, true>> = {
  ViewRulePredicate: true,
  ViewRuleGlobalPredicateRef: true,
  DeploymentViewRulePredicate: true,
  ViewRuleAncestors: true,
};

function rulePosition(node: UnknownRecord, file: string): Position | null {
  const start = asRecord(asRecord(asRecord(node.$cstNode)?.range)?.start);
  const [line, character] = [start?.line, start?.character];
  if (typeof line !== "number" || typeof character !== "number") return null;
  return { file, line: line + 1, col: character + 1 };
}

function viewRule(rule: unknown, file: string): C4ViewRule | null {
  const node = asRecord(rule);
  const type = node?.$type;
  if (node === null || typeof type !== "string") throw new Error("LikeC4 的视图规则没有 $type");
  if (HARMLESS_RULE_TYPES[type] === true) return null;
  const kind = RULE_KINDS[type];
  if (kind === undefined) throw new Error(`LikeC4 返回了未知的视图规则 ${type}；无法判定作者写了什么`);
  return { kind, at: rulePosition(node, file) };
}

function documentsOf(compiler: unknown): readonly unknown[] {
  const services = asRecord(asRecord(asRecord(compiler)?.languageServices)?.services);
  const documents = asRecord(asRecord(asRecord(services?.shared)?.workspace)?.LangiumDocuments);
  const all = documents?.all;
  if (all === null || typeof all !== "object" || !(Symbol.iterator in all))
    throw new Error("LikeC4 没有暴露工作区文档，无法检查视图里写下的规则");
  return [...(all as Iterable<unknown>)];
}

/** 元素视图与部署视图声明里的规则按视图 id 收集；`views` 块里视图之外的样式规则另收一份。 */
function writtenViewRules(compiler: unknown): { readonly views: ReadonlyMap<string, readonly C4ViewRule[]>; readonly blocks: readonly C4ViewRule[] } {
  const views = new Map<string, readonly C4ViewRule[]>();
  const blocks: C4ViewRule[] = [];
  for (const document of documentsOf(compiler)) {
    const doc = asRecord(document);
    const ast = asRecord(asRecord(doc?.parseResult)?.value);
    if (ast?.$type !== "LikeC4Grammar") continue;
    const uri = typeof doc?.uri === "string" ? doc.uri : doc?.uri === undefined ? null : String(doc.uri);
    if (uri === null || !uri.startsWith("file:")) continue;
    const file = fileURLToPath(uri);
    for (const declared of Array.isArray(ast.views) ? ast.views : []) {
      const block = asRecord(declared);
      for (const rule of Array.isArray(block?.styles) ? block.styles : []) {
        const mapped = viewRule(rule, file);
        if (mapped !== null) blocks.push(mapped);
      }
      for (const declaredView of Array.isArray(block?.views) ? block.views : []) {
        const view = asRecord(declaredView);
        if ((view?.$type !== "ElementView" && view?.$type !== "DeploymentView") || typeof view.name !== "string") continue;
        const body = asRecord(view.body);
        views.set(view.name, (Array.isArray(body?.rules) ? body.rules : []).flatMap((rule) => {
          const mapped = viewRule(rule, file);
          return mapped === null ? [] : [mapped];
        }));
      }
    }
  }
  return { views, blocks };
}

export async function compileLikeC4(dir: string): Promise<C4Result> {
  const compiler = await (await loadLikeC4()).LikeC4.fromWorkspace(dir, { logger: false, printErrors: false, throwIfInvalid: false, watch: false });
  try {
    const errors = compiler.getErrors();
    if (errors.length > 0) {
      return {
        kind: "failed",
        diagnostics: errors.map((e) =>
          diag("compile.c4", global, { file: e.sourceFsPath, line: e.range.start.line + 1, col: e.range.start.character + 1 }, e.message),
        ),
      };
    }
    const model = await compiler.computedModel();
    const ls = compiler.languageServices;
    const elements = new Map<string, C4Element>();
    for (const e of model.elements()) {
      elements.set(e.id, {
        fqn: e.id,
        title: e.title,
        description: e.description.text ?? "",
        kind: e.kind,
        technology: e.technology ?? null,
        parent: e.parent?.id ?? null,
        children: [...e.children()].map((c) => c.id),
        tags: [...e.tags],
        metadata: e.metadata ?? {},
        at: position(ls.locate({ element: e.id })),
      });
    }
    const relations: C4Relation[] = [...model.relationships()].map((r) => ({
      id: r.id,
      source: r.source.id,
      target: r.target.id,
      kind: r.kind ?? null,
      title: r.title ?? null,
      description: r.description.text ?? "",
      tags: [...r.tags],
      metadata: r.metadata ?? {},
      at: position(ls.locate({ relation: r.id })),
    }));
    const written = writtenViewRules(compiler);
    const views: C4View[] = [...model.views()].map((v) => {
      const at = position(ls.locate({ view: v.id }));
      return {
        id: v.id,
        type: viewType(v._type),
        viewOf: v.viewOf?.id ?? null,
        title: v.title ?? null,
        description: v.$view.description?.txt ?? "",
        nodes: [...v.nodes()].flatMap((n) => (n.element ? [n.element.id] : [])),
        edges: [...v.edges()].flatMap((e) => (e.source.element && e.target.element ? [{ source: e.source.element.id, target: e.target.element.id, label: e.label ?? null, relations: [...e.$edge.relations] }] : [])),
        deployment: v.isDeploymentView() ? {
          placements: (() => {
            // LikeC4 把只装一个实例的部署节点折叠掉，图上只剩实例；信任边界就画在这种节点上，所以按部署模型补回实例的祖先节点。
            const placements: C4DeploymentPlacement[] = [...v.nodes()].map((n): C4DeploymentPlacement => {
              const common = { id: n.id, title: n.title, parent: n.deployment?.parent?.id ?? null, tags: [...n.tags], description: n.description.text ?? "", technology: n.technology ?? null };
              return n.element ? { kind: "instance", element: n.element.id, ...common } : { kind: "node", nodeKind: n.kind, ...common };
            });
            const shown = new Set(placements.map((p) => p.id));
            for (const n of [...v.nodes()]) {
              for (let p = n.deployment?.parent ?? null; p !== null && !shown.has(p.id); p = p.parent) {
                shown.add(p.id);
                placements.push({ kind: "node", id: p.id, title: p.title, nodeKind: p.kind, parent: p.parent?.id ?? null, tags: [...p.tags], description: p.description.text ?? "", technology: p.technology ?? null });
              }
            }
            return placements;
          })(),
          edges: [...v.edges()].map((e) => ({ source: e.source.id, target: e.target.id, label: e.label ?? null, relations: [...e.$edge.relations] })),
        } : null,
        writtenRules: written.views.get(v.id) ?? [],
        declared: at !== null,
        at,
      };
    });
    const viewIds = new Set(views.map((v) => v.id));
    for (const id of written.views.keys())
      if (!viewIds.has(id)) throw new Error(`LikeC4 的视图声明 ${id} 没有对应的视图`);
    const spec = model.specification;
    return {
      kind: "ok",
      diagnostics: [],
      structure: {
        elements,
        relations,
        views,
        viewBlockRules: written.blocks,
        spec: {
          elementKinds: Object.keys(spec.elements ?? {}),
          relationKinds: Object.keys(spec.relationships ?? {}),
          tags: Object.keys(spec.tags ?? {}),
        },
      },
    };
  } finally {
    await compiler.dispose();
  }
}
