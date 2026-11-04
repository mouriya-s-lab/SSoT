// 逐层评审包：显示边的成员取自计算视图，落实义务只取自模型声明关系。
import type { C4Relation, Structure } from "./compile/likec4";
import { type Diagnostic, assertNever, diag, format, view } from "./diag";
import { within } from "./model";

interface ReviewRelation {
  readonly source: string;
  readonly target: string;
  readonly kind: string;
  readonly title: string;
  /** 关系自己的依据与理由；没写时为空串。 */
  readonly description: string;
}

/** 汇总边下一条真实关系的端点：它自己的标题与标签，以及它在本层归入的节点。 */
interface Endpoint {
  readonly fqn: string;
  readonly title: string;
  readonly tags: readonly string[];
  readonly shownAs: string;
}

/**
 * 真实关系在本层的位置：本层两节点之间的声明本身；细化同一条边下另一条更浅的同种关系（`of`，取最深的那条）；
 * 或者同一条边下没有它细化的同种关系，只是在本层显示为这条边。
 */
type Layering =
  | { readonly kind: "declared" }
  | { readonly kind: "refines"; readonly of: ReviewRelation }
  | { readonly kind: "shown" };

interface EdgeRelation {
  readonly relation: ReviewRelation;
  readonly source: Endpoint;
  readonly target: Endpoint;
  readonly layering: Layering;
}

export interface ReviewPacket {
  readonly view: string;
  readonly expanded: string | null;
  readonly expandedContract: boolean;
  readonly nodes: readonly {
    readonly fqn: string;
    readonly title: string;
    readonly kind: string;
    readonly tags: readonly string[];
    readonly description: string;
    readonly parent: string | null;
  }[];
  readonly edges: readonly {
    readonly from: string;
    readonly to: string;
    readonly underlying: readonly EdgeRelation[];
  }[];
  readonly obligations: readonly {
    readonly relation: ReviewRelation;
    readonly realizedBy: readonly string[];
  }[];
}

interface Obligation {
  readonly relation: C4Relation;
  readonly realizedBy: readonly string[];
}

function obligations(structure: Structure, expanded: string | null): Obligation[] {
  if (expanded === null) return [];
  const children = structure.elements.get(expanded)!.children;
  return structure.relations.flatMap((relation) => {
    const outgoing = relation.source === expanded && !within(relation.target, expanded);
    const incoming = relation.target === expanded && !within(relation.source, expanded);
    if (!outgoing && !incoming) return [];
    const external = outgoing ? relation.target : relation.source;
    const realizedBy = children.filter((child) => structure.relations.some((candidate) =>
      candidate.kind === relation.kind
      && (outgoing
        ? within(candidate.source, child) && within(candidate.target, external)
        : within(candidate.target, child) && within(candidate.source, external)),
    ));
    return [{ relation, realizedBy }];
  });
}

function reviewRelation(relation: C4Relation): ReviewRelation {
  return {
    source: relation.source,
    target: relation.target,
    kind: relation.kind ?? "",
    title: relation.title ?? "",
    description: relation.description,
  };
}

function endpoint(structure: Structure, nodes: readonly string[], fqn: string): Endpoint {
  const element = structure.elements.get(fqn)!;
  const shownAs = nodes.filter((node) => within(fqn, node)).sort((a, b) => b.length - a.length)[0] ?? fqn;
  return { fqn, title: element.title, tags: element.tags, shownAs };
}

function layering(relation: C4Relation, all: readonly C4Relation[], from: string, to: string): Layering {
  if (relation.source === from && relation.target === to) return { kind: "declared" };
  // 同种、两端各为它的祖先或自身、且不是它自己的关系；取两端最深的一条。
  const coarser = all
    .filter((r) => r !== relation && r.kind === relation.kind && within(relation.source, r.source) && within(relation.target, r.target))
    .sort((a, b) => b.source.length + b.target.length - (a.source.length + a.target.length));
  return coarser.length === 0 ? { kind: "shown" } : { kind: "refines", of: reviewRelation(coarser[0]!) };
}

export function reviewPacket(structure: Structure, viewId: string): ReviewPacket | null {
  const selected = structure.views.find((candidate) => candidate.id === viewId && candidate.type === "element");
  if (!selected) return null;
  const relations = new Map(structure.relations.map((relation) => [relation.id, relation]));
  return {
    view: selected.id,
    expanded: selected.viewOf,
    expandedContract: selected.viewOf !== null && structure.elements.get(selected.viewOf)!.tags.includes("contract"),
    nodes: selected.nodes.map((fqn) => {
      const element = structure.elements.get(fqn)!;
      return {
        fqn: element.fqn,
        title: element.title,
        kind: element.kind,
        tags: element.tags,
        description: element.description,
        parent: element.parent,
      };
    }),
    edges: selected.edges.map((edge) => {
      const underlying = edge.relations.map((id) => relations.get(id)!);
      return {
        from: edge.from,
        to: edge.to,
        underlying: underlying.map((relation) => ({
          relation: reviewRelation(relation),
          source: endpoint(structure, selected.nodes, relation.source),
          target: endpoint(structure, selected.nodes, relation.target),
          layering: layering(relation, underlying, edge.from, edge.to),
        })),
      };
    }),
    obligations: obligations(structure, selected.viewOf).map((obligation) => ({
      relation: reviewRelation(obligation.relation),
      realizedBy: obligation.realizedBy,
    })),
  };
}

function relationText(relation: ReviewRelation): string {
  return `${relation.source} -[${relation.kind || "未声明种类"}]-> ${relation.target}${relation.title ? `：${relation.title}` : ""}`;
}

/** contract：被展开元素带 #contract 时为它的 fqn。 */
function unrealizedMessage(relation: ReviewRelation, contract: string | null): string {
  const own = contract === null ? "" : `；${contract} 带 #contract，这条关系也可能由它自己的契约模块直接承接，由评审对照契约判断`;
  return `上一层声明关系 ${relationText(relation)} 在本层没有子元素落实${own}`;
}

export function reviewDiagnostics(structure: Structure): Diagnostic[] {
  return structure.views.flatMap((selected) => {
    if (selected.type !== "element" || !selected.declared) return [];
    const contract = selected.viewOf !== null && structure.elements.get(selected.viewOf)!.tags.includes("contract") ? selected.viewOf : null;
    return obligations(structure, selected.viewOf)
      .filter((obligation) => obligation.realizedBy.length === 0)
      .map((obligation) => diag(
        "view.unrealized",
        view(selected.id),
        obligation.relation.at,
        unrealizedMessage(reviewRelation(obligation.relation), contract),
        "info",
      ));
  });
}

function markdown(text: string): string {
  return text.replace(/[\\`*_[\]<>|#]/g, "\\$&").replace(/\r?\n/g, " ");
}

export function renderPacket(packet: ReviewPacket): string {
  const lines = [
    `# 逐层评审包：${markdown(packet.view)}`,
    "",
    `展开元素：${packet.expanded === null ? "顶层（无）" : `\`${packet.expanded}\``}`,
    "",
    "## 本层节点",
    "",
  ];
  if (packet.nodes.length === 0) lines.push("无。", "");
  for (const node of packet.nodes) {
    lines.push(
      `- \`${node.fqn}\` — ${markdown(node.title)}（${markdown(node.kind)}）`,
      `  - 父元素：${node.parent === null ? "无（顶层）" : `\`${node.parent}\``}`,
      `  - 标签：${node.tags.length === 0 ? "无" : node.tags.map((tag) => `#${markdown(tag)}`).join("、")}`,
      `  - 描述：${node.description ? markdown(node.description) : "无"}`,
      "",
    );
  }
  lines.push(
    "## 本层显示的边与全部真实关系",
    "",
    "每条边下列出它代表的、模型里声明的全部关系，以及每条关系自己的依据（没写的标“依据：无”）。同一条边下的关系是同一条通路在不同深度的声明：标“细化”的那条把它所细化的那条落到更深的元素上，不是另一条通路。端点不是本层节点时，另列该端点的标题与标签，以及它在本层归入哪个节点。",
    "标签：`#contract` 表示该元素有自己的 VDM 契约模块；没有 `#contract` 只说明它没有契约模块，不说明它不能被调用。`#leaf` 只表示作者决定不再拆分它。其余标签按模型原样列出。",
    "关系种类：`calls` 是运行期调用目标，`uses` 只用目标的契约词汇，二者都是源依赖目标；`callback` 是运行期回调一个依赖自己的元素，不形成依赖。",
    "",
  );
  if (packet.edges.length === 0) lines.push("无。", "");
  for (const edge of packet.edges) {
    lines.push(`### \`${edge.from}\` → \`${edge.to}\``, "");
    for (const { relation, source, target, layering } of edge.underlying) {
      let position: string;
      switch (layering.kind) {
        case "declared": position = "本层两节点之间的声明"; break;
        case "refines": position = `细化 ${markdown(relationText(layering.of))}`; break;
        case "shown": position = "下层元素之间的声明，在本层显示为这条边"; break;
        default: position = assertNever(layering);
      }
      lines.push(`- ${markdown(relationText(relation))}（${position}）`, `  - 依据：${relation.description ? markdown(relation.description) : "无"}`);
      for (const [side, end] of [["源端", source], ["目标端", target]] as const) {
        if (end.fqn === end.shownAs) continue;
        const tags = end.tags.length === 0 ? "无标签" : end.tags.map((tag) => `#${markdown(tag)}`).join("、");
        lines.push(`  - ${side} \`${end.fqn}\`：${markdown(end.title)}；${tags}；在本层归入 \`${end.shownAs}\``);
      }
    }
    lines.push("");
  }
  const contract = packet.expandedContract ? packet.expanded : null;
  lines.push("## 上一层声明的对外关系与本层落实者", "");
  if (packet.obligations.length === 0) lines.push("无。", "");
  for (const obligation of packet.obligations) {
    const none = contract === null ? "没有子元素落实" : `没有子元素落实；\`${contract}\` 带 #contract，也可能由它自己的契约模块直接承接`;
    lines.push(
      `- ${markdown(relationText(obligation.relation))}`,
      `  - 依据：${obligation.relation.description ? markdown(obligation.relation.description) : "无"}`,
      `  - 本层落实者：${obligation.realizedBy.length === 0 ? none : obligation.realizedBy.map((fqn) => `\`${fqn}\``).join("、")}`,
      "",
    );
  }
  lines.push(
    "## 上一层声明关系中没有子元素落实的",
    "",
    "只核对上一层已经声明的关系；需求要求、但模型里任何一层都没有声明的通路不在此列，要对照需求原文判断。",
    "",
  );
  const unrealized = packet.obligations.filter((obligation) => obligation.realizedBy.length === 0);
  if (unrealized.length === 0) lines.push("无。", "");
  for (const obligation of unrealized) {
    lines.push(`- ${markdown(format(diag("view.unrealized", view(packet.view), null, unrealizedMessage(obligation.relation, contract), "info")))}`, "");
  }
  return lines.join("\n");
}
