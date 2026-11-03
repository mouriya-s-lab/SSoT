// 逐层评审包：显示边的成员取自计算视图，落实义务只取自模型声明关系。
import type { C4Relation, Structure } from "./compile/likec4";
import { type Diagnostic, diag, format, view } from "./diag";
import { within } from "./model";

interface ReviewRelation {
  readonly source: string;
  readonly target: string;
  readonly kind: string;
  readonly title: string;
}

/** 汇总边下一条真实关系的端点：它自己的标题与标签，以及它在本层归入的节点。 */
interface Endpoint {
  readonly fqn: string;
  readonly title: string;
  readonly tags: readonly string[];
  readonly shownAs: string;
}

/** 真实关系与本层声明的关系：它就是本层两节点之间的声明；细化本层两节点之间的同种声明；本层两节点之间没有同种声明。 */
type Layering = "declared" | "refines" | "undeclared";

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
  };
}

function endpoint(structure: Structure, nodes: readonly string[], fqn: string): Endpoint {
  const element = structure.elements.get(fqn)!;
  const shownAs = nodes.filter((node) => within(fqn, node)).sort((a, b) => b.length - a.length)[0] ?? fqn;
  return { fqn, title: element.title, tags: element.tags, shownAs };
}

function layering(relation: C4Relation, all: readonly C4Relation[], from: string, to: string): Layering {
  const between = (r: C4Relation) => r.source === from && r.target === to;
  if (between(relation)) return "declared";
  return all.some((r) => between(r) && r.kind === relation.kind) ? "refines" : "undeclared";
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
    "每条边下列出它代表的、模型里声明的全部关系。端点不是本层节点时，另列该端点的标题与标签，以及它在本层归入哪个节点；带 #contract 的端点有自己的契约模块，是该元素的契约入口。",
    "关系种类：`calls` 是运行期调用目标，`uses` 只用目标的契约词汇，二者都是源依赖目标；`callback` 是运行期回调一个依赖自己的元素，不形成依赖。",
    "",
  );
  if (packet.edges.length === 0) lines.push("无。", "");
  const layeringText = { declared: "本层两节点之间的声明", refines: "细化本层两节点之间的同种声明", undeclared: "本层两节点之间没有同种声明" } as const;
  for (const edge of packet.edges) {
    lines.push(`### \`${edge.from}\` → \`${edge.to}\``, "");
    for (const { relation, source, target, layering } of edge.underlying) {
      lines.push(`- ${markdown(relationText(relation))}（${layeringText[layering]}）`);
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
