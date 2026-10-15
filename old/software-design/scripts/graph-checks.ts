import type {
  DesignGraph, DesignNode, Layer, ModuleSpec, NodeKind, ScopeSpec,
  UnitSpec, Violation,
} from './graph-model.ts';

/** 引用发生的一侧、目录及载体；文档可额外指认直接子模块。 */
export type Viewpoint = {
  /** 类型表达式或说明文档。 */
  readonly kind: 'Type' | 'Document';
  /** 引用所在的一侧。 */
  readonly layer: Layer;
  /** 架构模块或业务单元的目录段。 */
  readonly place: readonly string[];
};

type Role = 'Core' | 'Connection' | 'Container' | 'Free';
type Ownership =
  | { readonly kind: 'Owned'; readonly owner: DesignNode }
  | { readonly kind: 'Free' }
  | { readonly kind: 'Invalid'; readonly message: string };
type Context = {
  readonly nodes: ReadonlyMap<string, DesignNode>;
  readonly modules: ReadonlyMap<string, ModuleSpec>;
  readonly units: ReadonlyMap<string, UnitSpec>;
  readonly ownership: ReadonlyMap<string, Ownership>;
};

function assertNever(value: never): never {
  throw new Error(`未处理的设计种类：${String(value)}`);
}

function role(kind: NodeKind): Role {
  switch (kind) {
    case 'Value': case 'Opaque': case 'Struct': case 'Outcome': case 'Lifecycle': return 'Core';
    case 'Point': case 'Face': return 'Connection';
    case 'Module': case 'Unit': return 'Container';
    case 'External': case 'Scope': case 'Scenario': return 'Free';
    default: return assertNever(kind);
  }
}

function ancestor(parent: readonly string[], child: readonly string[]): boolean {
  return parent.length <= child.length && parent.every((part, index) => part === child[index]);
}

function samePlace(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && ancestor(a, b);
}

function placeName(layer: Layer, place: readonly string[]): string {
  return [layer, ...place].join('/');
}

function findOwnership(node: DesignNode, context: Omit<Context, 'ownership'>): Ownership {
  const nodeRole = role(node.kind);
  if (nodeRole === 'Free' || nodeRole === 'Container') return { kind: 'Free' };
  const providers: DesignNode[] = [];
  for (const candidate of context.nodes.values()) {
    if (candidate.layer !== node.layer) continue;
    if (node.layer === 'architecture' && candidate.kind === 'Module') {
      const spec = context.modules.get(candidate.name);
      if (spec && (nodeRole === 'Core' ? spec.core : spec.provides).includes(node.name)) providers.push(candidate);
    } else if (node.layer === 'business' && candidate.kind === 'Unit') {
      const spec = context.units.get(candidate.name);
      if (spec && (nodeRole === 'Core' ? spec.types : spec.provides).includes(node.name)) providers.push(candidate);
    }
  }
  const field = node.layer === 'architecture' ? (nodeRole === 'Core' ? 'Module.core' : 'Module.provides')
    : (nodeRole === 'Core' ? 'Unit.types' : 'Unit.provides');
  const shared = node.layer === 'architecture' && nodeRole === 'Connection';
  if (providers.length === 0 || (!shared && providers.length !== 1)) {
    return { kind: 'Invalid', message: `${node.name} 必须出现在${shared ? '至少一个' : '恰好一个'} ${field} 中；实际为 ${providers.length} 个` };
  }
  providers.sort((a, b) => a.place.length - b.place.length || a.name.localeCompare(b.name));
  if (shared && providers.some((provider, index) => index > 0 && !ancestor(providers[index - 1]!.place, provider.place))) {
    return { kind: 'Invalid', message: `${node.name} 的提供模块必须位于同一条祖先链上：${providers.map(provider => provider.name).join('、')}` };
  }
  const owner = providers[providers.length - 1]!;
  if (!samePlace(owner.place, node.place)) {
    return { kind: 'Invalid', message: `${node.name} 必须与所有者 ${owner.name} 声明在同一目录；应为 ${placeName(owner.layer, owner.place)}` };
  }
  return { kind: 'Owned', owner };
}

function makeContext(graph: DesignGraph): Context {
  const nodes = new Map<string, DesignNode>();
  const duplicates = new Set<string>();
  for (const node of graph.nodes) {
    if (nodes.has(node.name)) duplicates.add(node.name);
    else nodes.set(node.name, node);
  }
  for (const name of duplicates) nodes.delete(name);
  const base = {
    nodes,
    modules: new Map(graph.modules.map(spec => [spec.name, spec])),
    units: new Map(graph.units.map(spec => [spec.name, spec])),
  };
  const ownership = new Map<string, Ownership>();
  for (const node of nodes.values()) ownership.set(node.name, findOwnership(node, base));
  return { ...base, ownership };
}

function reach(context: Context, from: Viewpoint, name: string): string | undefined {
  const target = context.nodes.get(name);
  if (!target) return '没有这个元素';
  if (from.layer === 'architecture' && target.layer === 'business') return '架构不能引用业务元素';
  if (from.layer === 'business' && target.layer === 'architecture') return undefined;
  const targetRole = role(target.kind);
  if (targetRole === 'Free') return undefined;
  const ownership = context.ownership.get(name);
  if (from.layer === 'business') {
    if (!ownership || ownership.kind !== 'Owned' || samePlace(ownership.owner.place, from.place)) return undefined;
    return targetRole === 'Connection' ? undefined : `不能引用其他业务单元 ${ownership.owner.name} 的内部类型`;
  }
  const owner = targetRole === 'Container' ? target : ownership?.kind === 'Owned' ? ownership.owner : undefined;
  if (!owner) return undefined;
  if (targetRole === 'Core') {
    return ancestor(owner.place, from.place) ? undefined : `只能引用本模块或祖先模块的核心元素；${name} 属于 ${owner.name}`;
  }
  if (ancestor(from.place, owner.place) && owner.place.length > from.place.length) {
    switch (from.kind) {
      case 'Type': return `类型不能引用后代模块 ${owner.name} 的${targetRole === 'Connection' ? '连接' : '模块元素'}`;
      case 'Document': return owner.place.length === from.place.length + 1 ? undefined : `文档只能引用直接子模块；${name} 位于更深的后代模块 ${owner.name}`;
      default: return assertNever(from.kind);
    }
  }
  return undefined;
}

/** 判断给定位置能否引用具名元素；允许时返回 undefined，否则返回中文原因。 */
export function reachable(graph: DesignGraph, from: Viewpoint, name: string): string | undefined {
  return reach(makeContext(graph), from, name);
}

function checkTree(context: Context, violations: Violation[]): void {
  const architecture = new Map<string, DesignNode[]>();
  const business = new Map<string, DesignNode[]>();
  architecture.set('', []);
  for (const node of context.nodes.values()) {
    const groups = node.layer === 'architecture' ? architecture : business;
    const key = node.place.join('/');
    const group = groups.get(key);
    if (group) group.push(node);
    else groups.set(key, [node]);
  }
  for (const [layer, groups, kind] of [
    ['architecture', architecture, 'Module'], ['business', business, 'Unit'],
  ] as const) {
    for (const [place, nodes] of groups) {
      const containers = nodes.filter(node => node.kind === kind);
      if (containers.length !== 1) {
        violations.push({
          at: containers[1]?.at ?? nodes[0]?.at ?? { file: `${layer}/${place ? `${place}/` : ''}README.md`, line: 0 },
          message: `${layer}/${place} 必须声明恰好一个 ${kind}；实际为 ${containers.length} 个`,
        });
      }
    }
  }
  const modules = [...context.nodes.values()].filter(node => node.layer === 'architecture' && node.kind === 'Module');
  for (const parent of modules) {
    const spec = context.modules.get(parent.name);
    if (!spec) continue;
    const expected = modules.filter(child => child.place.length === parent.place.length + 1 && ancestor(parent.place, child.place)).map(child => child.name);
    const missing = expected.filter(name => !spec.parts.includes(name));
    const extra = spec.parts.filter(name => !expected.includes(name));
    if (missing.length || extra.length || new Set(spec.parts).size !== spec.parts.length) {
      violations.push({ at: parent.at, message: `${parent.name}.parts 必须恰好列出直接子模块：${expected.join('、') || '无'}；实际为：${spec.parts.join('、') || '无'}` });
    }
  }
}

function cycles(edges: ReadonlyMap<string, readonly string[]>): readonly (readonly string[])[] {
  const result: string[][] = [];
  const names = [...edges.keys()].sort();
  for (const start of names) {
    const path = [start];
    const active = new Set(path);
    function visit(name: string): void {
      for (const next of new Set(edges.get(name) ?? [])) {
        if (next === start) result.push([...path, start]);
        else if (next > start && !active.has(next)) {
          active.add(next);
          path.push(next);
          visit(next);
          path.pop();
          active.delete(next);
        }
      }
    }
    visit(start);
  }
  return result;
}

function checkAvailability(graph: DesignGraph, context: Context, violations: Violation[]): void {
  const moduleProviders = new Set(graph.modules.flatMap(module => module.provides));
  for (const module of graph.modules) {
    const node = context.nodes.get(module.name);
    if (!node) continue;
    for (const name of new Set(module.requires)) {
      const ownership = context.ownership.get(name);
      const ownerNode = ownership?.kind === 'Owned' ? ownership.owner : undefined;
      if (ownerNode && ownerNode.layer === 'architecture' && ownerNode.place.length >= node.place.length
        && node.place.every((segment, index) => ownerNode.place[index] === segment)) {
        violations.push({ at: node.at, message: `${module.name}.requires 中的连接 ${name} 由本模块或它的子模块提供，不是外部需要；从 requires 中去掉` });
        continue;
      }
      if (node.place.length > 0 && !moduleProviders.has(name)) violations.push({ at: node.at, message: `${module.name}.requires 中的连接 ${name} 没有模块提供` });
    }
  }
  for (const unit of graph.units) {
    const node = context.nodes.get(unit.name);
    if (!node) continue;
    for (const name of new Set(unit.plugsInto)) {
      if (!moduleProviders.has(name) && !graph.units.some(provider => provider.name !== unit.name && provider.provides.includes(name))) {
        violations.push({ at: node.at, message: `${unit.name}.plugsInto 中的连接 ${name} 没有模块或其他业务单元提供` });
      }
    }
  }
  const edges = new Map<string, readonly string[]>();
  for (const module of graph.modules) {
    const targets: string[] = [];
    for (const name of module.requires) {
      const ownership = context.ownership.get(name);
      if (ownership?.kind === 'Owned' && ownership.owner.kind === 'Module') targets.push(ownership.owner.name);
    }
    edges.set(module.name, targets);
  }
  for (const cycle of cycles(edges)) {
    const at = context.nodes.get(cycle[0]!)?.at;
    if (at) violations.push({ at, message: `模块依赖成环：${cycle.join(' → ')}` });
  }
}

function checkScopes(graph: DesignGraph, context: Context, violations: Violation[]): void {
  const scopes = new Map<string, ScopeSpec>(graph.scopes.map(scope => [scope.name, scope]));
  const memberships = new Map<string, string>();
  const edges = new Map<string, readonly string[]>();
  for (const scope of graph.scopes) {
    const node = context.nodes.get(scope.name);
    if (!node) continue;
    for (const member of new Set(scope.contains)) {
      const key = `${scope.kind}:${member}`;
      const previous = memberships.get(key);
      if (previous) violations.push({ at: node.at, message: `${member} 在 ${scope.kind} 范围中只能有一个直接所属范围；已属于 ${previous}，不能再属于 ${scope.name}` });
      else memberships.set(key, scope.name);
      const nested = scopes.get(member);
      if (nested && nested.kind !== scope.kind) {
        violations.push({ at: node.at, message: `范围 ${scope.name}（${scope.kind}）不能包含不同种类的范围 ${member}（${nested.kind}）` });
      }
    }
    edges.set(scope.name, scope.contains.filter(member => scopes.has(member)));
  }
  for (const cycle of cycles(edges)) {
    const at = context.nodes.get(cycle[0]!)?.at;
    if (at) violations.push({ at, message: `范围包含成环：${cycle.join(' → ')}` });
  }
}

function checkScenarios(graph: DesignGraph, context: Context, violations: Violation[]): void {
  const connections = new Map(graph.connections.map(connection => [connection.name, connection]));
  for (const scenario of graph.scenarios) {
    for (const [index, step] of scenario.steps.entries()) {
      const actor = context.nodes.get(step.actor);
      let allowed = false;
      if (actor) {
        switch (actor.kind) {
          case 'External': allowed = true; break;
          case 'Module': allowed = context.modules.get(actor.name)?.requires.includes(step.target.connection) ?? false; break;
          case 'Unit': allowed = context.units.get(actor.name)?.plugsInto.includes(step.target.connection) ?? false; break;
          case 'Value': case 'Opaque': case 'Struct': case 'Outcome': case 'Point': case 'Face': case 'Lifecycle': case 'Scope': case 'Scenario': break;
          default: assertNever(actor.kind);
        }
      }
      if (!allowed) violations.push({ at: step.at, message: `场景 ${scenario.name} 第 ${index + 1} 步：参与方 ${step.actor} 必须是 External，或在 requires／plugsInto 中声明连接 ${step.target.connection} 的 Module／Unit` });
      const op = connections.get(step.target.connection)?.ops.find(operation => operation.name === step.target.op);
      if (!op) {
        violations.push({ at: step.at, message: `场景 ${scenario.name} 第 ${index + 1} 步：没有操作 ${step.target.connection}.${step.target.op}` });
        continue;
      }
      if (!op.branches.includes(step.take)) {
        violations.push({ at: step.at, message: `场景 ${scenario.name} 第 ${index + 1} 步：${step.target.connection}.${step.target.op} 没有结局分支 ${step.take}；可用分支：${op.branches.join('、')}` });
        continue;
      }
      const continuation = graph.continuations.find(item => item.variant === step.take && (
        op.outcome === undefined
          ? item.owner === step.target.connection && item.op === step.target.op
          : item.owner === op.outcome && item.op === undefined
      ));
      if (!continuation?.then.length) continue;
      const next = scenario.steps[index + 1];
      const targets = continuation.then.map(target => `${target.connection}.${target.op}`).join('、');
      if (!next) violations.push({ at: step.at, message: `场景 ${scenario.name} 不能在第 ${index + 1} 步的 ${step.take} 分支结束；必须继续：${targets}` });
      else if (!continuation.then.some(target => target.connection === next.target.connection && target.op === next.target.op)) {
        violations.push({ at: next.at, message: `场景 ${scenario.name} 第 ${index + 2} 步必须承接 ${step.take} 分支，调用：${targets}；实际为 ${next.target.connection}.${next.target.op}` });
      }
    }
  }
}

/** 检查抽取问题、归属、模块树、可见性、接入、依赖环、范围和场景。 */
export function checkGraph(graph: DesignGraph): readonly Violation[] {
  const violations: Violation[] = graph.problems.map(problem => ({ at: problem.at, message: problem.message }));
  const seen = new Map<string, DesignNode>();
  for (const node of graph.nodes) {
    const previous = seen.get(node.name);
    if (previous) violations.push({ at: node.at, message: `元素名 ${node.name} 重复；首次声明于 ${previous.at.file}:${previous.at.line}` });
    else seen.set(node.name, node);
  }
  const context = makeContext(graph);
  for (const [name, ownership] of context.ownership) {
    switch (ownership.kind) {
      case 'Owned': case 'Free': break;
      case 'Invalid': violations.push({ at: context.nodes.get(name)!.at, message: ownership.message }); break;
      default: assertNever(ownership);
    }
  }
  checkTree(context, violations);
  for (const reference of graph.references) {
    const node = context.nodes.get(reference.from);
    if (!node || node.kind === 'Module' || node.kind === 'Unit' || node.kind === 'Scope' || node.kind === 'Scenario') continue;
    const ownership = context.ownership.get(node.name);
    if (ownership?.kind === 'Invalid') continue;
    const reason = reach(context, { kind: 'Type', layer: node.layer, place: ownership?.kind === 'Owned' ? ownership.owner.place : node.place }, reference.to);
    if (reason) violations.push({ at: reference.at, message: `${reference.from} 不能引用 ${reference.to}：${reason}` });
  }
  checkAvailability(graph, context, violations);
  checkScopes(graph, context, violations);
  checkScenarios(graph, context, violations);
  return violations;
}
