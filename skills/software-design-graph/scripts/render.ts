import type { Location } from '../../software-design/scripts/diagnostics.ts';
import type {
  DataExpression,
  ElementUse,
  Fact,
  Field,
  Follow,
  Selection,
} from '../../software-design/scripts/model.ts';
import type { ValidatedDesign } from '../../software-design/scripts/service.ts';
import type { Graph, GraphEdge, GraphNode, Relation } from './graph-model.ts';

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
function impossible(value: never): never {
  throw new Error(`Unknown graph variant: ${String(value)}`);
}
// Injective code-point encoding keeps same-name declarations and punctuation distinct.
function id(name: string): string {
  return `n_${Array.from(name, (c) => c.codePointAt(0)!.toString(16)).join('_')}`;
}
function label(text: string): string {
  return text.replace(/[&"#<>\\|;:\[\]{}()`\r\n]/g, (c) => `#${c.codePointAt(0)!};`);
}
function cell(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\|/g, '&#124;')
    .replace(/`/g, '&#96;')
    .replace(/\r?\n/g, '<br/>');
}
function heading(text: string): string {
  return text.replace(/[\\`*_[\]<>#]/g, (c) => `\\${c}`).replace(/[\r\n]/g, ' ');
}
function location(at: Location): string {
  return `${at.path}:${at.line}:${at.column}`;
}
function uses(values: readonly ElementUse[]): string {
  return values.map((v) => v.target).join(', ') || '—';
}
function fields(values: readonly Field[]): string {
  return values.map((v) => `${v.name}: ${expression(v.value)} — ${v.doc}`).join('\n') || '—';
}
function fact(value: Fact): string {
  switch (value.kind) {
    case 'Returned':
      return `Returned ${value.via.connection.target}.${value.via.operation}.${value.branch}`;
    case 'Occurred':
      return `Occurred ${value.event.target}`;
    default:
      return impossible(value);
  }
}
function follow(value: Follow): string {
  switch (value.kind) {
    case 'End':
      return 'End';
    case 'Next':
      return `Next: ${value.targets.map((t) => `${t.connection.target}.${t.operation}`).join(' | ')}; duties: ${value.duties.length}; ${value.doc}`;
    case 'Later':
      return `Later: ${value.duties.length} duties; ${value.doc}`;
    default:
      return impossible(value);
  }
}
function expression(value: DataExpression): string {
  switch (value.kind) {
    case 'Reference':
      return value.target;
    case 'Application':
      return `${value.definition.target}<${value.arguments.map((a) => a.text).join(', ')}> = ${expression(value.resolved)}`;
    case 'Parameter':
      return value.constraint ? `${value.name} extends ${value.constraint.text}` : value.name;
    case 'Scalar':
      return value.type.text;
    case 'Value':
      return `Value(${value.doc}): ${expression(value.value)}`;
    case 'Opaque':
      return `Opaque(${value.key}): ${value.doc}`;
    case 'Struct':
      return `Struct(${value.doc}) { ${fields(value.fields)} }`;
    case 'Tuple':
      return `Tuple(${value.doc}) [${value.items.map(expression).join(', ')}]`;
    case 'Apply':
      return `Apply(${value.doc}): ${value.lambda.text}<${expression(value.argument)}>`;
    case 'Choice':
      return `Choice(${value.doc}): ${value.cases.map((c) => `${c.name} (${c.doc}) { ${fields(c.fields)} }`).join(' | ')}`;
    case 'Outcome':
      return `Outcome(${value.doc}): ${value.variants.map((v) => `${v.name} (${v.doc}) { ${fields(v.fields)} }; ${follow(v.follow)}`).join(' | ')}`;
    default:
      return impossible(value);
  }
}
function selection(value: Selection): string {
  switch (value.kind) {
    case 'Role':
      return `Role — unbound; candidates: ${uses(value.candidates)}`;
    case 'Bound':
      return `Bound — ${value.provider.target}; composition: ${value.composition}; binding: ${value.binding}`;
    default:
      return impossible(value);
  }
}
/** A readable, exhaustive summary. The JSON view retains every domain payload field. */
function detail(node: GraphNode): string {
  switch (node.kind) {
    case 'Data':
      return expression(node.details.expression);
    case 'Family':
      return node.details.lambda.text;
    case 'Carrier':
    case 'CarrierMember':
      return `key: ${node.details.key}; HKT: ${node.details.lambda.text}; laws: ${node.details.laws.join('\n') || '—'}`;
    case 'Connection':
      return `${node.details.port.kind}; ${node.details.port.kind === 'Face' ? `invariant: ${node.details.port.invariant}; ` : ''}laws: ${node.details.port.laws.join('\n') || '—'}`;
    case 'Module':
      return `core: ${uses(node.details.core)}; ports: ${uses(node.details.ports)}; provides: ${uses(node.details.provides)}; requires: ${uses(node.details.requires)}; public: ${uses(node.details.public)}; parts: ${uses(node.details.parts)}`;
    case 'Unit':
      return `types: ${uses(node.details.types)}; ports: ${uses(node.details.ports)}; provides: ${uses(node.details.provides)}; plugsInto: ${uses(node.details.plugsInto)}`;
    case 'External':
      return `provides: ${uses(node.details.provides)}; uses: ${uses(node.details.uses)}`;
    case 'Lifecycle':
      return `key: ${node.details.key.target}; starts: ${fact(node.details.starts)}; ends: ${fact(node.details.ends)}; within: ${node.details.within?.target ?? '—'}`;
    case 'Scenario':
      return `context: ${node.details.context.kind === 'Contracts' ? 'Contracts' : node.details.context.composition.target}; steps: ${node.details.steps.length}; ending: ${node.details.ends.kind}`;
    case 'Event':
      return `confirms: ${node.details.confirms.target}; payload: ${expression(node.details.payload)}`;
    case 'Scope':
      return `${node.details.scopeKind}: ${uses(node.details.contains)}`;
    case 'Composition':
      return `${node.details.bindings.length} declared bindings; not selected unless this view names the composition`;
    case 'Auxiliary':
      return `${node.details.generic ? 'Generic; ' : ''}${node.details.expression.text}`;
    case 'Operation':
      return `parameters: ${fields(node.details.params)}\nresult: ${expression(node.details.result)}`;
    case 'Field':
      return expression(node.details.value);
    case 'Case':
      return fields(node.details.fields);
    case 'Variant':
      return `${fields(node.details.fields)}\n${follow(node.details.follow)}`;
    case 'Duty': {
      const by = node.details.by;
      switch (by.kind) {
        case 'Caller':
          return `caller; completes: ${fact(node.details.complete)}`;
        case 'Provider':
          return `provider role of originating call; completes: ${fact(node.details.complete)}`;
        case 'Participant':
          return `${by.participant.target}; completes: ${fact(node.details.complete)}`;
        default:
          return impossible(by);
      }
    }
    case 'Fact':
      return fact(node.details);
    case 'Step':
      return `${node.details.kind === 'Call' ? `${node.details.actor.target}; ` : ''}${fact(node.details.fact)}`;
    case 'Application':
      return expression(node.details);
    case 'Expose':
      return `${node.details.by.target} exposes ${node.details.connection.target} from ${node.details.from.target}`;
    case 'Binding':
      return `${node.details.consumer.target} / ${node.details.connection.target}: ${node.details.provider.target} (declaration, not a global selection)`;
    case 'Role':
      return `${node.details.consumer.target} / ${node.details.connection.target}: ${selection(node.details)}`;
    case 'Completion': {
      const completion = node.details;
      switch (completion.kind) {
        case 'Complete':
          return 'Complete (finite declared scenario only)';
        case 'Interrupted':
          return `Interrupted; handoff: ${completion.responsible.target}; ${completion.doc}`;
        default:
          return impossible(completion);
      }
    }
    default:
      return impossible(node);
  }
}
function compareEdges(a: GraphEdge, b: GraphEdge): number {
  return (
    compare(a.from, b.from) ||
    compare(a.relation, b.relation) ||
    compare(a.to, b.to) ||
    compare(a.label, b.label) ||
    compare(a.at.path, b.at.path) ||
    a.at.line - b.at.line ||
    a.at.column - b.at.column
  );
}
function nodes(graph: Graph): GraphNode[] {
  return [...graph.nodes.values()].sort((a, b) => compare(a.id, b.id));
}
function edges(graph: Graph): GraphEdge[] {
  return [...graph.out.values()].flat().sort(compareEdges);
}
function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  return (
    [headers, headers.map(() => '---'), ...rows].map((row) => `| ${row.map(cell).join(' | ')} |`).join('\n') +
    '\n'
  );
}
function block(lines: readonly string[]): string {
  return `\`\`\`mermaid\n${lines.join('\n')}\n\`\`\`\n`;
}
function nodeAt(graph: Graph, key: string): GraphNode {
  const node = graph.nodes.get(key);
  if (!node) throw new Error(`Validated graph has no node ${key}`);
  return node;
}
function nodeLabel(node: GraphNode): string {
  return node.kind === 'Role'
    ? `${node.name} [${node.details.kind === 'Role' ? 'unbound Role' : 'Bound'}]`
    : `${node.name} [${node.kind}]`;
}
function diagram(graph: Graph, selected: readonly GraphEdge[], isolated: readonly string[] = []): string {
  const ids = new Set(isolated);
  for (const edge of selected) {
    ids.add(edge.from);
    ids.add(edge.to);
  }
  if (!ids.size) return '无此类声明。\n';
  return block([
    'flowchart TB',
    ...[...ids].sort(compare).map((key) => `  ${id(key)}["${label(nodeLabel(nodeAt(graph, key)))}"]`),
    ...selected.map(
      (e) =>
        `  ${id(e.from)} ${e.relation === 'candidate' ? '-.->' : '-->'}|"${label(e.relation === 'candidate' ? 'candidate (not selected)' : e.relation === 'bound-to' ? 'bound-to (selected)' : e.label)}"| ${id(e.to)}`,
    ),
  ]);
}
const compositionRelations: Partial<Record<Relation, true>> = {
  part: true,
  owns: true,
  'can-provide': true,
  uses: true,
  contract: true,
  candidate: true,
  'bound-to': true,
  exposes: true,
  'forwarded-from': true,
  'public-material': true,
};
/** Choose a focused view of existing edges; never compute eligibility or a provider. */
function compositionEdges(all: readonly GraphEdge[], participants: ReadonlySet<string>): GraphEdge[] {
  const roles = new Set(
    all.filter((e) => e.relation === 'uses' && participants.has(e.from)).map((e) => e.to),
  );
  const local = new Set(
    all.filter((e) => compositionRelations[e.relation] && (participants.has(e.from) || roles.has(e.from))),
  );
  const contracts = new Set(
    [...local].filter((e) => e.relation === 'contract' || e.relation === 'can-provide').map((e) => e.to),
  );
  return all.filter((e) => local.has(e) || (e.relation === 'can-provide' && contracts.has(e.to)));
}
function detailTable(values: readonly GraphNode[]): string {
  return table(
    ['ID', '名称 / 种类', '说明', '结构 / 契约', '源码'],
    values.map((n) => [n.id, `${n.name} / ${n.kind}`, n.doc, detail(n), location(n.at)]),
  );
}

/** Stable, lossless domain projection. No compiler objects or graph maps cross stdout. */
export function renderJson(graph: Graph, validated: ValidatedDesign): string {
  return (
    JSON.stringify(
      { context: graph.context, nodes: nodes(graph), edges: edges(graph), report: validated.report },
      null,
      2,
    ) + '\n'
  );
}

export function renderMarkdown(graph: Graph, validated: ValidatedDesign): string {
  const allNodes = nodes(graph),
    allEdges = edges(graph);
  const modules = allNodes.filter((n) => n.kind === 'Module');
  const units = allNodes.filter((n) => n.kind === 'Unit');
  const context =
    graph.context.kind === 'Contracts'
      ? 'Contracts（契约与提供角色；未选择提供方）'
      : `Composition: ${graph.context.composition}`;
  const sections: string[] = [
    '# 运行时设计图\n',
    table(
      ['当前视图', '自动检查', '人工审查'],
      [[context, validated.report.kind, validated.report.review.kind]],
    ),
    '本次结果来自已验证设计，调用结束即释放；不是持久索引。候选虚线不是已选依赖；只有当前组合的 bound-to 实线表示局部选择。图上的路径仅是结构路径，不证明可执行调用链。\n',
    '## 模块树\n',
    diagram(
      graph,
      allEdges.filter((e) => e.relation === 'part'),
      modules.map((n) => n.id),
    ),
    '## 材料与边界\n',
    detailTable(
      allNodes.filter((n) => ['Module', 'Unit', 'External', 'Data', 'Family', 'Auxiliary'].includes(n.kind)),
    ),
    '## 逐模块组成\n',
  ];
  for (const module of modules) {
    const participants = new Set([module.id, ...module.details.parts.map((p) => p.target)]);
    sections.push(
      `### ${heading(module.name)}\n`,
      table(['模块 ID', '说明'], [[module.id, module.doc]]),
      diagram(graph, compositionEdges(allEdges, participants), [...participants]),
    );
  }
  sections.push(
    '## 业务接入\n',
    diagram(
      graph,
      compositionEdges(allEdges, new Set(units.map((u) => u.id))),
      units.map((u) => u.id),
    ),
    '## 当前角色与选择\n',
    detailTable(allNodes.filter((n) => n.kind === 'Role')),
    '## 公开与组合声明\n',
    '以下为全部声明；它们不改变上表当前上下文的选择。\n',
    detailTable(
      allNodes.filter((n) => n.kind === 'Composition' || n.kind === 'Binding' || n.kind === 'Expose'),
    ),
    '## 范围\n',
  );
  for (const kind of ['process', 'lifecycle', 'trust', 'deploy'] as const) {
    const scopes = new Set(
      allNodes.filter((n) => n.kind === 'Scope' && n.details.scopeKind === kind).map((n) => n.id),
    );
    sections.push(
      `### ${kind}\n`,
      diagram(
        graph,
        allEdges.filter((e) => e.relation === 'contains' && scopes.has(e.from)),
        [...scopes],
      ),
    );
  }
  sections.push(
    '## 场景时序\n',
    '时序仅表示有限声明事实，不模拟运行值。场景自身上下文独立标明，不以当前视图的组合替换。虚线调用只指向契约，不表示当前已选提供方；实线调用表示该场景在当前所选组合中的显式绑定。每步旁注保留场景自身的 Role / Bound 事实。\n',
  );
  for (const scenario of allNodes.filter((n) => n.kind === 'Scenario')) {
    const facts = validated.facts.scenarios.find((s) => s.scenario === scenario.id);
    if (!facts) throw new Error(`Validated scenario has no relation facts: ${scenario.id}`);
    const ownContext = facts.context.kind === 'Contracts' ? 'Contracts' : facts.context.composition.target;
    const sameContext =
      facts.context.kind === 'Contracts'
        ? graph.context.kind === 'Contracts'
        : graph.context.kind === 'Composition' &&
          facts.context.composition.target === graph.context.composition;
    const participants = new Set<string>();
    const lines: string[] = [];
    const rows: string[][] = [];
    scenario.details.steps.forEach((step, index) => {
      const established = facts.steps.find((s) => s.index === index);
      if (!established || established.kind !== step.kind)
        throw new Error(`Validated scenario step facts mismatch: ${scenario.id}/${index}`);
      if (step.kind === 'Call' && established.kind === 'Call') {
        const choice = established.selection;
        const destination =
          choice.kind === 'Bound' && sameContext ? choice.provider.target : choice.connection.target;
        participants.add(step.actor.target);
        participants.add(destination);
        lines.push(
          `  ${id(step.actor.target)}${choice.kind === 'Bound' && sameContext ? '->>' : '-->>'}${id(destination)}: ${label(`${index + 1}. ${fact(step.fact)}`)}`,
        );
        lines.push(`  Note over ${id(destination)}: ${label(selection(choice))}`);
        rows.push([
          String(index + 1),
          step.actor.target,
          fact(step.fact),
          selection(choice),
          location(step.at),
        ]);
      } else if (step.kind === 'Event' && established.kind === 'Event') {
        participants.add(established.confirmer.target);
        lines.push(
          `  Note over ${id(established.confirmer.target)}: ${label(`${index + 1}. ${fact(step.fact)}; confirmed here`)}`,
        );
        rows.push([
          String(index + 1),
          established.confirmer.target,
          fact(step.fact),
          'Event confirmer',
          location(step.at),
        ]);
      }
    });
    sections.push(
      `### ${heading(scenario.name)}\n`,
      table(
        ['场景 ID', '说明', '场景上下文', '当前视图上下文'],
        [[scenario.id, scenario.doc, ownContext, context]],
      ),
    );
    if (participants.size)
      sections.push(
        block([
          'sequenceDiagram',
          ...[...participants]
            .sort(compare)
            .map((p) => `  participant ${id(p)} as ${label(nodeAt(graph, p).name)}`),
          ...lines,
        ]),
      );
    sections.push(
      table(['步骤', '动作人 / 确认者', '事实', '角色 / 绑定', '源码'], rows),
      table(
        ['义务序号（0 起）', '完成步骤（0 起）', '依据'],
        facts.matches.map((m) => [String(m.duty), String(m.completedAt), m.basis]),
      ),
    );
    const ending = facts.ending;
    switch (ending.kind) {
      case 'Complete':
        sections.push('结束：Complete；仅表示本有限场景的义务与 Next 检查通过，不确认真实运行履责。\n');
        break;
      case 'Interrupted':
        sections.push(
          table(
            ['结束', '接手方', '未匹配义务（0 起）', '待继续 Next'],
            [
              [
                ending.kind,
                ending.responsible.target,
                ending.unmatchedDuties.join(', ') || '—',
                ending.pendingNext.map((p) => `${p.actor} from step ${p.fromStep}`).join('\n') || '—',
              ],
            ],
          ),
        );
        break;
      default:
        impossible(ending);
    }
  }
  sections.push(
    '## 连接与操作\n',
    detailTable(allNodes.filter((n) => n.kind === 'Connection' || n.kind === 'Operation')),
    '## 参数、结果与 HKT 应用\n',
    detailTable(allNodes.filter((n) => n.kind === 'Field' || n.kind === 'Application')),
    '## 分支与后继\n',
    detailTable(allNodes.filter((n) => n.kind === 'Case' || n.kind === 'Variant')),
    '## 载体与准入定律\n',
    detailTable(allNodes.filter((n) => n.kind === 'Carrier' || n.kind === 'CarrierMember')),
    '## 义务、事实与生命周期\n',
    detailTable(
      allNodes.filter(
        (n) => n.kind === 'Duty' || n.kind === 'Fact' || n.kind === 'Lifecycle' || n.kind === 'Event',
      ),
    ),
    '## 自动检查与人工边界\n',
    table(
      ['阶段', '已建立的结构事实'],
      validated.report.evidence.map((e) => [e.stage, e.facts.join('\n')]),
    ),
    '自动结构检查通过；设计语义尚需人工审查。以下事项没有被图或自动检查证明，也不因查看过本结果而被确认。\n',
    table(
      ['人工事项', '说明', '源码'],
      validated.report.review.items.map((i) => [i.topic, i.message, location(i.at)]),
    ),
  );
  return sections.join('\n');
}
