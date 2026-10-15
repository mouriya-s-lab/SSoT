import type {
  Anchor,
  DesignGraph,
  ScopeSpec,
} from './graph-model.ts';

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function named<T extends { readonly name: string }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => compare(left.name, right.name));
}

function strings(items: readonly string[]): string[] {
  return [...items].sort(compare);
}

function assertNever(value: never): never {
  throw new Error(`无法导出未知的设计种类：${String(value)}`);
}

// Code-point encoding is injective, including names that ordinary slugification merges.
function id(role: string, name: string): string {
  return `${role}_${Array.from(name, character => character.codePointAt(0)!.toString(16)).join('_')}`;
}

function label(text: string): string {
  return text.replace(/[&"#<>\\|;:\[\]{}()`\r\n]/g, character => `#${character.codePointAt(0)!};`);
}

function cell(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\|/g, '&#124;').replace(/`/g, '&#96;').replace(/\r?\n/g, '<br/>');
}

function heading(text: string): string {
  return text.replace(/[\\`*_[\]<>#]/g, character => `\\${character}`).replace(/[\r\n]/g, ' ');
}

function block(lines: readonly string[]): string {
  return `\`\`\`mermaid\n${lines.join('\n')}\n\`\`\`\n`;
}

/** 导出设计图的 Markdown：组成、接入、范围、场景，以及连接与生命周期。 */
export function renderMarkdown(graph: DesignGraph): string {
  const nodes = new Map(graph.nodes.map(node => [node.name, node]));
  const modules = named(graph.modules);
  const moduleByName = new Map(modules.map(module => [module.name, module]));
  const units = named(graph.units);
  const title = (name: string): string => {
    const node = nodes.get(name);
    return node?.doc ? `${name}：${node.doc}` : name;
  };
  const declaration = (name: string, role = 'node'): string =>
    `${id(role, name)}["${label(title(name))}"]`;
  const provider = (connection: string): string | undefined => {
    const candidates = modules.filter(module => module.provides.includes(connection));
    candidates.sort((left, right) =>
      (nodes.get(right.name)?.place.length ?? 0) - (nodes.get(left.name)?.place.length ?? 0)
      || compare(left.name, right.name));
    return candidates[0]?.name ?? units.find(unit => unit.provides.includes(connection))?.name;
  };
  const users = (connection: string): string[] => strings([
    ...modules.filter(module => module.requires.includes(connection)).map(module => module.name),
    ...units.filter(unit => unit.plugsInto.includes(connection)).map(unit => unit.name),
  ]);
  const sections = ['# 设计图\n', '## 模块树\n'];
  if (modules.length > 0) {
    sections.push(block([
      'flowchart TB',
      ...modules.map(module => `  ${declaration(module.name)}`),
      ...modules.flatMap(module => strings(module.parts).map(part =>
        `  ${id('node', module.name)} -->|"包含"| ${id('node', part)}`)),
    ]));
  } else {
    sections.push('没有架构模块。\n');
  }

  if (modules.length > 0) {
    sections.push('## 模块\n', '| 模块 | 说明 | 提供 | 需要 | 核心元素 | 子模块 |', '| --- | --- | --- | --- | --- | --- |');
    const list = (names: readonly string[]): string => strings(names).map(cell).join('、') || '—';
    for (const module of modules) {
      sections.push(`| ${cell(module.name)} | ${cell(nodes.get(module.name)?.doc ?? '')} | ${list(module.provides)} | ${list(module.requires)} | ${list(module.core)} | ${list(module.parts)} |`);
    }
    sections.push('');
  }

  const containsModule = (root: string, target: string, visited: ReadonlySet<string> = new Set()): boolean => {
    if (root === target) return true;
    if (visited.has(root)) return false;
    const next = new Set([...visited, root]);
    return moduleByName.get(root)?.parts.some(part => containsModule(part, target, next)) ?? false;
  };
  for (const module of modules.filter(module => module.parts.length > 0)) {
    const parts = strings(module.parts);
    const directPart = (name: string): string | undefined =>
      parts.find(part => containsModule(part, name));
    const edges = new Set<string>();
    const boundary = (direction: 'provides' | 'requires', connection: string): string =>
      id(direction, connection);
    const edge = (from: string, connection: string, to: string): void => {
      if (from !== to) edges.add(`  ${from} -->|"${label(connection)}"| ${to}`);
    };
    for (const requirer of modules) {
      const part = directPart(requirer.name);
      if (part === undefined) continue;
      for (const connection of strings(requirer.requires)) {
        const owner = provider(connection);
        const providingPart = owner === undefined ? undefined : directPart(owner);
        if (providingPart !== undefined) {
          edge(id('node', part), connection, id('node', providingPart));
        } else if (module.requires.includes(connection)) {
          edge(id('node', part), connection, boundary('requires', connection));
        }
      }
    }
    for (const connection of strings(module.provides)) {
      const owner = provider(connection);
      const part = owner === undefined ? undefined : directPart(owner);
      if (part !== undefined) edge(boundary('provides', connection), connection, id('node', part));
    }
    sections.push(`## 组成：${heading(module.name)}\n`, block([
      'flowchart TB',
      ...parts.map(part => `  ${declaration(part)}`),
      ...strings(module.provides).map(connection =>
        `  ${boundary('provides', connection)}["${label(`提供 ${title(connection)}`)}"]`),
      ...strings(module.requires).map(connection =>
        `  ${boundary('requires', connection)}["${label(`需要 ${title(connection)}`)}"]`),
      ...strings([...edges]),
    ]));
  }

  sections.push('## 业务接入\n');
  if (units.length > 0) {
    const participants = new Set(units.map(unit => unit.name));
    const edges: string[] = [];
    for (const unit of units) {
      for (const connection of strings(unit.plugsInto)) {
        const owner = provider(connection);
        if (owner === undefined) continue;
        participants.add(owner);
        edges.push(`  ${id('node', unit.name)} -->|"${label(connection)}"| ${id('node', owner)}`);
      }
    }
    sections.push(block([
      'flowchart TB',
      ...strings([...participants]).map(name => `  ${declaration(name)}`),
      ...strings(edges),
    ]));
  } else {
    sections.push('没有业务单元。\n');
  }

  for (const kind of strings([...new Set(graph.scopes.map(scope => scope.kind))])) {
    const scopes = named(graph.scopes.filter(scope => scope.kind === kind));
    const byName = new Map(scopes.map(scope => [scope.name, scope]));
    const children = new Set(scopes.flatMap(scope => scope.contains.filter(name => byName.has(name))));
    const emitted = new Set<string>();
    const lines = ['flowchart TB'];
    const emit = (name: string, indent: string): void => {
      if (emitted.has(name)) return;
      emitted.add(name);
      const scope = byName.get(name);
      if (scope === undefined) {
        lines.push(`${indent}${declaration(name)}`);
        return;
      }
      lines.push(`${indent}subgraph ${id('scope', name)}["${label(title(name))}"]`);
      for (const child of strings(scope.contains)) emit(child, `${indent}  `);
      lines.push(`${indent}end`);
    };
    for (const scope of scopes.filter(scope => !children.has(scope.name))) emit(scope.name, '  ');
    sections.push(`## 范围：${scopeTitle(scopes[0]!.kind)}\n`, block(lines));
  }

  for (const scenario of named(graph.scenarios)) {
    const participants = new Set<string>();
    const messages: string[] = [];
    for (const step of scenario.steps) {
      const owner = provider(step.target.connection);
      const receiver = owner ?? step.target.connection;
      participants.add(step.actor);
      participants.add(receiver);
      messages.push(
        `  ${id('actor', step.actor)} ->> ${id('actor', receiver)}: "${label(`${step.target.connection}.${step.target.op}`)}"`,
        `  Note over ${id('actor', receiver)}: "${label(`分支：${step.take}`)}"`,
      );
    }
    sections.push(`## 场景：${heading(title(scenario.name))}\n`, block([
      'sequenceDiagram',
      ...strings([...participants]).map(name => `  participant ${id('actor', name)} as "${label(title(name))}"`),
      ...messages,
    ]));
  }

  sections.push('## 连接\n', '| 名称 | 点或面 | 不变量 | 操作与结局分支 | 定律 | 提供方 | 使用方 |', '| --- | --- | --- | --- | --- | --- | --- |');
  for (const connection of named(graph.connections)) {
    const ops = connection.ops.map(op =>
      `${cell(op.name)}：${cell(op.doc)}（${op.branches.map(cell).join('、')}）`).join('<br/>');
    sections.push(`| ${cell(connection.name)} | ${connection.shape === 'Point' ? '连接点' : '连接面'} | ${cell(connection.invariant ?? '—')} | ${ops} | ${connection.laws.map(cell).join('<br/>') || '—'} | ${cell(provider(connection.name) ?? '未声明')} | ${users(connection.name).map(cell).join('、') || '—'} |`);
  }
  sections.push('\n## 生命周期\n', '| 名称 | 说明 | 开始锚点 | 结束锚点 |', '| --- | --- | --- | --- |');
  for (const lifecycle of named(graph.lifecycles)) {
    sections.push(`| ${cell(lifecycle.name)} | ${cell(nodes.get(lifecycle.name)?.doc ?? '')} | ${cell(anchorText(lifecycle.start))} | ${cell(anchorText(lifecycle.end))} |`);
  }
  return `${sections.join('\n').trimEnd()}\n`;
}

function scopeTitle(kind: ScopeSpec['kind']): string {
  switch (kind) {
    case 'process': return '进程或主机';
    case 'lifecycle': return '生命周期';
    case 'trust': return '信任';
    case 'deploy': return '部署';
    default: return assertNever(kind);
  }
}

function anchorText(anchor: Anchor): string {
  switch (anchor.kind) {
    case 'Op': return `${anchor.target.connection}.${anchor.target.op}`;
    case 'External': return `${anchor.name}（外部事件）`;
    default: return assertNever(anchor);
  }
}

/** 导出稳定缩进的完整设计图 JSON；场景步骤、定律和后续操作保留声明顺序。 */
export function renderJson(graph: DesignGraph): string {
  const normalized: DesignGraph = {
    nodes: named(graph.nodes).map(node => ({
      name: node.name, kind: node.kind, doc: node.doc, layer: node.layer,
      place: [...node.place], at: { file: node.at.file, line: node.at.line },
    })),
    connections: named(graph.connections).map(connection => ({
      name: connection.name, shape: connection.shape, invariant: connection.invariant,
      ops: connection.ops.map(op => ({ name: op.name, doc: op.doc, branches: [...op.branches], outcome: op.outcome })),
      laws: [...connection.laws],
    })),
    outcomes: named(graph.outcomes).map(outcome => ({ name: outcome.name, branches: [...outcome.branches] })),
    modules: named(graph.modules).map(module => ({
      name: module.name, provides: strings(module.provides), requires: strings(module.requires),
      core: strings(module.core), parts: strings(module.parts),
    })),
    units: named(graph.units).map(unit => ({
      name: unit.name, plugsInto: strings(unit.plugsInto), provides: strings(unit.provides), types: strings(unit.types),
    })),
    scopes: named(graph.scopes).map(scope => ({ name: scope.name, kind: scope.kind, contains: strings(scope.contains) })),
    lifecycles: named(graph.lifecycles).map(lifecycle => ({ name: lifecycle.name, start: normalizeAnchor(lifecycle.start), end: normalizeAnchor(lifecycle.end) })),
    scenarios: named(graph.scenarios).map(scenario => ({
      name: scenario.name, steps: scenario.steps.map(step => ({
        actor: step.actor, target: { connection: step.target.connection, op: step.target.op },
        take: step.take, at: { file: step.at.file, line: step.at.line },
      })),
    })),
    continuations: [...graph.continuations].sort((left, right) =>
      compare(left.owner, right.owner) || compare(left.op ?? '', right.op ?? '') || compare(left.variant, right.variant))
      .map(continuation => ({ owner: continuation.owner, op: continuation.op, variant: continuation.variant,
        then: continuation.then.map(target => ({ connection: target.connection, op: target.op })),
      })),
    references: [...graph.references].sort((left, right) =>
      compare(left.from, right.from) || compare(left.to, right.to)
      || compare(left.at.file, right.at.file) || left.at.line - right.at.line)
      .map(reference => ({ from: reference.from, to: reference.to, at: { file: reference.at.file, line: reference.at.line } })),
    problems: [...graph.problems].sort((left, right) =>
      compare(left.at.file, right.at.file) || left.at.line - right.at.line || compare(left.message, right.message))
      .map(problem => ({ at: { file: problem.at.file, line: problem.at.line }, message: problem.message })),
  };
  return `${JSON.stringify(normalized, null, 2)}\n`;
}

function normalizeAnchor(anchor: Anchor): Anchor {
  switch (anchor.kind) {
    case 'Op': return { kind: 'Op', target: { connection: anchor.target.connection, op: anchor.target.op } };
    case 'External': return { kind: 'External', name: anchor.name };
    default: return assertNever(anchor);
  }
}
