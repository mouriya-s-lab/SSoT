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


export interface C4View {
  readonly id: string;
  readonly type: ViewType;
  readonly viewOf: string | null;
  /** 计算后（展开 include 规则）的元素节点。 */
  readonly nodes: readonly string[];
  /** false：LikeC4 自动生成的视图（没有源位置）。 */
  readonly declared: boolean;
  readonly at: Position | null;
}

export interface Structure {
  readonly elements: ReadonlyMap<string, C4Element>;
  readonly relations: readonly C4Relation[];
  readonly views: readonly C4View[];
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
    const views: C4View[] = [...model.views()].map((v) => {
      const at = position(ls.locate({ view: v.id }));
      return {
        id: v.id,
        type: viewType(v._type),
        viewOf: v.viewOf?.id ?? null,
        nodes: [...v.nodes()].flatMap((n) => (n.element ? [n.element.id] : [])),
        declared: at !== null,
        at,
      };
    });
    const spec = model.specification;
    return {
      kind: "ok",
      diagnostics: [],
      structure: {
        elements,
        relations,
        views,
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
