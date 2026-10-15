import { reject, type Diagnostic, type Location, type Result } from './diagnostics.ts';
import type {
  Capability,
  CompositionContext,
  DataExpression,
  Duty,
  DutyMatch,
  Element,
  ElementUse,
  Exposure,
  Fact,
  Follow,
  Module,
  Operation,
  OperationRef,
  Ownership,
  Participant,
  RelationFacts,
  ResolvedDesign,
  Scenario,
  ScenarioFacts,
  Selection,
} from './model.ts';
export function isParticipant(element: Element | undefined): element is Participant {
  return element?.kind === 'Module' || element?.kind === 'Unit' || element?.kind === 'External';
}
export function operations(element: Element | undefined): readonly Operation[] {
  return element?.kind === 'Connection'
    ? element.port.kind === 'Point'
      ? [element.port.operation]
      : element.port.operations
    : [];
}
export function used(participant: Participant): readonly ElementUse[] {
  switch (participant.kind) {
    case 'Module':
      return participant.requires;
    case 'Unit':
      return participant.plugsInto;
    case 'External':
      return participant.uses;
  }
}
export type ProviderFacts = {
  readonly elements: ReadonlyMap<string, Element>;
  readonly parents: ReadonlyMap<string, string>;
  readonly capabilities: readonly Capability[];
  readonly offered: ReadonlyMap<string, ReadonlySet<string>>;
};
function ancestors(id: string, parents: ReadonlyMap<string, string>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  let next: string | undefined = id;
  while (next && !seen.has(next)) {
    seen.add(next);
    result.push(next);
    next = parents.get(next);
  }
  return result;
}
/** The only eligibility predicate: candidates, bindings and scenario witnesses share it. */
export function eligibleProvider(
  consumer: ElementUse,
  connection: ElementUse,
  provider: ElementUse,
  facts: ProviderFacts,
):
  | { readonly kind: 'Eligible' }
  | {
      readonly kind: 'Ineligible';
      readonly code: 'NoCapability' | 'HiddenCapability' | 'InternalRequirement';
      readonly at: Location;
    } {
  if (
    !facts.capabilities.some(
      (c) => c.provider.target === provider.target && c.connection.target === connection.target,
    )
  )
    return { kind: 'Ineligible', code: 'NoCapability', at: provider.at };
  const c = facts.elements.get(consumer.target);
  const p = facts.elements.get(provider.target);
  if (!isParticipant(c) || !isParticipant(p))
    return { kind: 'Ineligible', code: 'NoCapability', at: provider.at };
  const ca = ancestors(c.id, facts.parents);
  const pa = ancestors(p.id, facts.parents);
  if (c.kind === 'Module' && p.kind === 'Module' && pa.includes(c.id))
    return { kind: 'Ineligible', code: 'InternalRequirement', at: provider.at };
  if (p.kind !== 'Module' || ca.includes(p.id)) return { kind: 'Eligible' };
  let child: string | undefined;
  for (const boundary of pa) {
    if (ca.includes(boundary)) break;
    const module = facts.elements.get(boundary);
    const exposed =
      child === undefined
        ? facts.offered.get(boundary)?.has(connection.target)
        : module?.kind === 'Module' &&
          module.reexports.some((e) => e.connection.target === connection.target && e.from.target === child);
    if (!exposed) return { kind: 'Ineligible', code: 'HiddenCapability', at: provider.at };
    child = boundary;
  }
  return { kind: 'Eligible' };
}
/** Explicit data dependencies only; native HKT results and participant definitions are not unfolded. */
export function dataReferences(expression: DataExpression): readonly ElementUse[] {
  switch (expression.kind) {
    case 'Reference':
      return [{ target: expression.target, at: expression.at }];
    case 'Application':
      return [
        expression.definition,
        ...expression.arguments.flatMap((a) => a.references),
        ...dataReferences(expression.resolved),
      ];
    case 'Parameter':
      return expression.constraint?.references ?? [];
    case 'Scalar':
      return expression.type.references;
    case 'Value':
      return dataReferences(expression.value);
    case 'Opaque':
      return [];
    case 'Struct':
      return expression.fields.flatMap((f) => dataReferences(f.value));
    case 'Tuple':
      return expression.items.flatMap(dataReferences);
    case 'Apply':
      return [...expression.lambda.references, ...dataReferences(expression.argument)];
    case 'Choice':
      return expression.cases.flatMap((c) => c.fields.flatMap((f) => dataReferences(f.value)));
    case 'Outcome':
      return expression.variants.flatMap((v) => [
        ...v.fields.flatMap((f) => dataReferences(f.value)),
        ...followReferences(v.follow),
      ]);
  }
}
function factReferences(fact: Fact): readonly ElementUse[] {
  return fact.kind === 'Returned' ? [fact.via.connection] : [fact.event];
}
function followReferences(follow: Follow): readonly ElementUse[] {
  return follow.kind === 'End'
    ? []
    : [
        ...(follow.kind === 'Next' ? follow.targets.map((t) => t.connection) : []),
        ...follow.duties.flatMap((d) => [
          ...factReferences(d.complete),
          ...(d.by.kind === 'Participant' ? [d.by.participant] : []),
        ]),
      ];
}
export function resolvedData(
  expression: DataExpression,
  elements: ReadonlyMap<string, Element>,
  seen: ReadonlySet<string> = new Set(),
): DataExpression {
  if (expression.kind === 'Application') return resolvedData(expression.resolved, elements, seen);
  if (expression.kind === 'Value') return resolvedData(expression.value, elements, seen);
  if (expression.kind !== 'Reference' || seen.has(expression.target)) return expression;
  const target = elements.get(expression.target);
  if (target?.kind !== 'Data') return expression;
  const next = new Set(seen);
  next.add(expression.target);
  return resolvedData(target.expression, elements, next);
}
export function operationFor(
  reference: OperationRef,
  elements: ReadonlyMap<string, Element>,
): Operation | undefined {
  return operations(elements.get(reference.connection.target)).find((o) => o.name === reference.operation);
}
function branchFor(
  fact: Extract<Fact, { kind: 'Returned' }>,
  elements: ReadonlyMap<string, Element>,
): { readonly valid: boolean; readonly follow: Follow; readonly fields: readonly DataExpression[] } {
  const op = operationFor(fact.via, elements);
  if (!op) return { valid: false, follow: { kind: 'End' }, fields: [] };
  const result = resolvedData(op.result, elements);
  if (result.kind !== 'Outcome')
    return { valid: fact.branch === 'done', follow: { kind: 'End' }, fields: [op.result] };
  const variant = result.variants.find((v) => v.name === fact.branch);
  return {
    valid: Boolean(variant),
    follow: variant?.follow ?? { kind: 'End' },
    fields: variant?.fields.map((f) => f.value) ?? [],
  };
}
function factEqual(a: Fact, b: Fact): boolean {
  return a.kind === 'Occurred'
    ? b.kind === 'Occurred' && a.event.target === b.event.target
    : b.kind === 'Returned' &&
        a.via.connection.target === b.via.connection.target &&
        a.via.operation === b.via.operation &&
        a.branch === b.branch;
}
function hasCycle(vertices: readonly string[], edges: ReadonlyMap<string, readonly string[]>): boolean {
  const active = new Set<string>();
  const done = new Set<string>();
  const visit = (id: string): boolean => {
    if (active.has(id)) return true;
    if (done.has(id)) return false;
    active.add(id);
    for (const to of edges.get(id) ?? []) if (visit(to)) return true;
    active.delete(id);
    done.add(id);
    return false;
  };
  return vertices.some(visit);
}
/** Source directories, declaration identity and copied semantic values are the only input. */
export function validateRelations(design: ResolvedDesign): Result<RelationFacts> {
  const elements = new Map(design.elements.map((e) => [e.id, e]));
  const errors: Diagnostic[] = [];
  const error = (
    code: Extract<Diagnostic, { stage: 'relations' }>['code'],
    at: Location,
    message: string,
    related: readonly Location[] = [],
  ): void => {
    errors.push({ stage: 'relations', code, at, message, related });
  };
  const ownership: Ownership[] = [];
  const owners = new Map<string, string>();
  const parents = new Map<string, string>();
  const modules = design.elements.filter((e): e is Module => e.kind === 'Module');
  const participants = design.elements.filter(isParticipant);
  const samePlace = (a: Element, b: Element): boolean =>
    a.place.layer === b.place.layer && a.place.module.join('/') === b.place.module.join('/');
  const duplicate = (items: readonly ElementUse[], what: string): void => {
    const seen = new Map<string, Location>();
    for (const item of items) {
      const first = seen.get(item.target);
      if (first) error('DuplicateKey', item.at, `Duplicate ${what}: ${item.target}`, [first]);
      else seen.set(item.target, item.at);
    }
  };
  for (const directory of design.directories) {
    if (
      directory.place.layer === 'relations' ||
      (directory.place.layer === 'business' && directory.place.module.length === 0)
    )
      continue;
    const kind = directory.place.layer === 'architecture' ? 'Module' : 'Unit';
    const found = design.elements.filter(
      (e) =>
        e.kind === kind &&
        e.place.layer === directory.place.layer &&
        e.place.module.join('/') === directory.place.module.join('/'),
    );
    if (found.length !== 1)
      error(
        'InvalidComposition',
        { path: `${directory.path}/README.md`, line: 1, column: 1 },
        `Directory must declare exactly one ${kind}; found ${found.length}`,
      );
  }
  const root = modules.find((m) => m.place.module.length === 0);
  if (!root)
    error(
      'InvalidComposition',
      { path: 'architecture/README.md', line: 1, column: 1 },
      'Root Module is required',
    );
  for (const participant of participants) {
    for (const [name, list] of participant.kind === 'Module'
      ? ([
          ['core', participant.core],
          ['ports', participant.ports],
          ['provides', participant.provides],
          ['requires', participant.requires],
          ['public', participant.public],
          ['parts', participant.parts],
        ] as const)
      : participant.kind === 'Unit'
        ? ([
            ['types', participant.types],
            ['ports', participant.ports],
            ['provides', participant.provides],
            ['plugsInto', participant.plugsInto],
          ] as const)
        : ([
            ['provides', participant.provides],
            ['uses', participant.uses],
          ] as const))
      duplicate(list, name);
    if (participant.kind === 'External') continue;
    const materials = participant.kind === 'Module' ? participant.core : participant.types;
    for (const [list, connection] of [
      [materials, false],
      [participant.ports, true],
    ] as const)
      for (const use of list) {
        const e = elements.get(use.target);
        const valid =
          e &&
          (connection
            ? e.kind === 'Connection'
            : ['Data', 'Family', 'Carrier', 'Event', 'Lifecycle'].includes(e.kind));
        if (!valid || !e || !samePlace(e, participant)) {
          error(
            'InvalidOwnership',
            use.at,
            `Invalid ${connection ? 'port' : 'material'} ownership: ${use.target}`,
          );
          continue;
        }
        const previous = owners.get(e.id);
        if (previous && previous !== participant.id)
          error('InvalidOwnership', use.at, `${e.id} has more than one owner`, [elements.get(previous)!.at]);
        else if (!previous) {
          owners.set(e.id, participant.id);
          ownership.push({ element: e.id, owner: participant.id });
        }
      }
    if (participant.kind === 'Module') {
      const expected = modules.filter(
        (m) =>
          m.place.module.length === participant.place.module.length + 1 &&
          m.place.module.slice(0, -1).join('/') === participant.place.module.join('/'),
      );
      if (
        participant.parts.length !== expected.length ||
        expected.some((m) => !participant.parts.some((p) => p.target === m.id))
      )
        error(
          'InvalidComposition',
          participant.at,
          'parts must be exactly the directly nested module directories',
        );
      for (const child of participant.parts) {
        if (elements.get(child.target)?.kind !== 'Module')
          error('InvalidComposition', child.at, 'part must be a Module');
        else parents.set(child.target, participant.id);
      }
    }
  }
  for (const e of design.elements) {
    if (
      ['Data', 'Family', 'Carrier', 'Connection', 'Event', 'Lifecycle'].includes(e.kind) &&
      !owners.has(e.id)
    )
      error('InvalidOwnership', e.at, `Definition has no core/types/ports owner: ${e.id}`);
    if (e.kind === 'Auxiliary' && e.place.layer !== 'relations') {
      const owner = participants.find((p) => p.kind !== 'External' && samePlace(p, e));
      if (owner) {
        owners.set(e.id, owner.id);
        ownership.push({ element: e.id, owner: owner.id });
      }
    }
    if (
      e.place.layer === 'relations' &&
      !['External', 'Scope', 'Scenario', 'Composition', 'Auxiliary'].includes(e.kind)
    )
      error(
        'InvalidOwnership',
        e.at,
        'relations may contain relation declarations and auxiliary definitions only',
      );
  }
  if (
    hasCycle(
      modules.map((m) => m.id),
      new Map(modules.map((m) => [m.id, m.parts.map((p) => p.target)])),
    )
  )
    error(
      'InvalidComposition',
      root?.at ?? { path: 'architecture', line: 1, column: 1 },
      'Module composition contains a cycle',
    );
  const opaqueKeys = new Map<string, Element>();
  for (const e of design.elements)
    if (e.kind === 'Data') {
      let descriptor = e.expression;
      while (descriptor.kind === 'Application') descriptor = descriptor.resolved;
      if (descriptor.kind !== 'Opaque') continue;
      const previous = opaqueKeys.get(descriptor.key);
      if (previous)
        error('DuplicateKey', e.at, `Opaque key is already declared: ${descriptor.key}`, [previous.at]);
      else opaqueKeys.set(descriptor.key, e);
    }
  const capabilities: Capability[] = [];
  const exposures: Exposure[] = [];
  const offered = new Map<string, Set<string>>();
  const contracts = new Map<string, Set<string>>();
  for (const p of participants) {
    const offer = new Set(p.provides.map((c) => c.target));
    if (p.kind === 'Module') for (const e of p.reexports) offer.add(e.connection.target);
    offered.set(p.id, offer);
    contracts.set(p.id, new Set([...offer, ...used(p).map((c) => c.target)]));
    for (const c of [...p.provides, ...used(p)])
      if (elements.get(c.target)?.kind !== 'Connection')
        error('InvalidBinding', c.at, 'Capability and usage declarations require a Connection');
    for (const c of p.provides) capabilities.push({ connection: c, provider: { target: p.id, at: p.at } });
  }
  for (const m of modules) {
    const seen = new Map<string, Location>();
    for (const e of m.reexports) {
      const key = `${e.connection.target}\0${e.from.target}`;
      const first = seen.get(key);
      if (first) error('DuplicateKey', e.at, 'Duplicate Expose path', [first]);
      else seen.set(key, e.at);
      const from = elements.get(e.from.target);
      if (from?.kind === 'Module') {
        if (!m.parts.some((p) => p.target === from.id) || !offered.get(from.id)?.has(e.connection.target))
          error('PrivateReference', e.at, 'Expose must follow a direct child public capability');
      } else if (from?.kind === 'External') {
        if (
          !from.provides.some((c) => c.target === e.connection.target) ||
          !m.requires.some((c) => c.target === e.connection.target)
        )
          error(
            'InvalidBinding',
            e.at,
            'External Expose needs its declared capability and this Module requires',
          );
      } else error('InvalidBinding', e.at, 'Expose source must be a direct child Module or External');
      exposures.push(e);
    }
  }
  const outgoing = new Map<string, ElementUse[]>();
  for (const r of design.references) {
    const list = outgoing.get(r.from) ?? [];
    list.push({ target: r.to, at: r.at });
    outgoing.set(r.from, list);
  }
  const materialClosure = (roots: readonly string[]): Set<string> => {
    const result = new Set<string>();
    const visit = (id: string): void => {
      if (result.has(id)) return;
      const e = elements.get(id);
      if (!e) return;
      result.add(id);
      if (isParticipant(e)) return;
      let refs: readonly ElementUse[] = [];
      switch (e.kind) {
        case 'Data':
          refs = dataReferences(e.expression);
          break;
        case 'Event':
          refs = [e.confirms, ...dataReferences(e.payload)];
          break;
        case 'Lifecycle':
          refs = [e.key];
          break;
        case 'Carrier':
        case 'Family':
          refs = e.lambda.references;
          break;
        case 'Auxiliary':
          refs = outgoing.get(id) ?? [];
          break;
        default:
          return;
      }
      if (e.kind === 'Data' || e.kind === 'Family' || e.kind === 'Carrier')
        refs = [...refs, ...(outgoing.get(id) ?? [])];
      for (const r of refs) {
        const target = elements.get(r.target);
        if (target?.kind !== 'Connection' && target?.kind !== 'Lifecycle') visit(r.target);
      }
    };
    for (const r of roots) visit(r);
    return result;
  };
  const explicit = new Map<string, Set<string>>();
  const publicRoots = new Map(modules.map((m) => [m.id, new Set(m.public.map((root) => root.target))]));
  const sortedModules = [...modules].sort((a, b) => b.place.module.length - a.place.module.length);
  for (const m of sortedModules) {
    const visible = new Set<string>();
    for (const r of m.public) {
      const target = elements.get(r.target);
      const owner = owners.get(r.target);
      if (!target || !['Data', 'Event', 'Lifecycle'].includes(target.kind)) {
        error('PrivateReference', r.at, 'public roots must be Data, Event or Lifecycle');
        continue;
      }
      if (owner !== m.id && !m.parts.some((p) => publicRoots.get(p.target)?.has(r.target)))
        error(
          'PrivateReference',
          r.at,
          'public must follow an owner or direct child explicit public root path',
        );
      for (const id of materialClosure([r.target])) visible.add(id);
    }
    explicit.set(m.id, visible);
  }
  const contractMaterials = new Map<string, Set<string>>();
  for (const e of design.elements)
    if (e.kind === 'Connection') {
      const seeds = operations(e)
        .flatMap((op) => [...op.params.flatMap((f) => dataReferences(f.value)), ...dataReferences(op.result)])
        .map((r) => r.target);
      const carrierSeen = new Map<string, Location>();
      for (const carrier of e.port.carriers) {
        const c = carrier.kind === 'Reference' ? elements.get(carrier.carrier.target) : carrier;
        if (!c || (c.kind !== 'Carrier' && c.kind !== 'Inline')) {
          error('InvalidBinding', e.at, 'Connection carrier must resolve to Carrier');
          continue;
        }
        const previous = carrierSeen.get(c.key);
        const at = carrier.kind === 'Reference' ? carrier.carrier.at : carrier.at;
        if (previous) error('DuplicateKey', at, `Duplicate carrier option ${c.key}`, [previous]);
        else carrierSeen.set(c.key, at);
        if (carrier.kind === 'Reference') seeds.push(carrier.carrier.target);
        else seeds.push(...carrier.lambda.references.map((r) => r.target));
      }
      contractMaterials.set(e.id, materialClosure(seeds));
    }
  const ownerOf = (e: Element): string | undefined => (isParticipant(e) ? e.id : owners.get(e.id));
  const explicitReachable = (from: string, target: string): boolean => {
    const owner = owners.get(target);
    if (!owner) return false;
    if (owner === from) return true;
    const fromAncestors = ancestors(from, parents);
    const ownerAncestors = ancestors(owner, parents);
    if (fromAncestors.includes(owner)) return true;
    for (const boundary of ownerAncestors) {
      if (fromAncestors.includes(boundary)) return true;
      if (!explicit.get(boundary)?.has(target)) return false;
    }
    return true;
  };
  const visible = (from: string, target: string): boolean => {
    if (explicitReachable(from, target)) return true;
    for (const c of contracts.get(from) ?? []) if (contractMaterials.get(c)?.has(target)) return true;
    return false;
  };
  for (const [boundary, materials] of explicit)
    for (const id of materials) {
      const owner = owners.get(id);
      const e = elements.get(id);
      if (!owner || !e || isParticipant(e)) continue;
      if (owner !== boundary && !explicitReachable(boundary, id))
        error('PrivateReference', e.at, `Public closure cannot expose private material ${id}`);
    }
  for (const r of design.references) {
    const from = elements.get(r.from);
    const target = elements.get(r.to);
    if (!from || !target || from.place.layer === 'relations') continue;
    const owner = ownerOf(from);
    if (!owner) continue;
    if (isParticipant(target) || ['Scope', 'Scenario', 'Composition'].includes(target.kind)) continue;
    const targetOwner = owners.get(target.id);
    if (!targetOwner || targetOwner === owner) continue;
    if (target.kind === 'Connection') {
      const declarationOwner = owners.get(target.id);
      const fromAncestors = ancestors(owner, parents);
      if (declarationOwner && fromAncestors.includes(declarationOwner)) continue;
      if (contracts.get(owner)?.has(target.id)) continue;
      error('PrivateReference', r.at, `Connection is not declared at this boundary: ${target.id}`);
      continue;
    }
    if (!visible(owner, target.id))
      error('PrivateReference', r.at, `Private material ${target.id} is not visible to ${owner}`, [
        target.at,
      ]);
  }
  // A public contract can reuse material from an independently established
  // contract, but two new signatures cannot justify each other's private captures.
  const establishedContracts = new Set<string>();
  const connections = design.elements.filter((e) => e.kind === 'Connection');
  const permittedMaterial = (connection: string, owner: string, material: string): boolean => {
    const target = elements.get(material);
    const targetOwner = owners.get(material);
    if (
      !target ||
      !targetOwner ||
      isParticipant(target) ||
      targetOwner === owner ||
      explicitReachable(owner, material)
    )
      return true;
    return [...(contracts.get(owner) ?? [])].some(
      (other) =>
        other !== connection &&
        establishedContracts.has(other) &&
        contractMaterials.get(other)?.has(material),
    );
  };
  let progress = true;
  while (progress) {
    progress = false;
    for (const connection of connections) {
      const owner = owners.get(connection.id);
      if (!owner || establishedContracts.has(connection.id)) continue;
      if (
        [...(contractMaterials.get(connection.id) ?? [])].every((material) =>
          permittedMaterial(connection.id, owner, material),
        )
      ) {
        establishedContracts.add(connection.id);
        progress = true;
      }
    }
  }
  for (const connection of connections) {
    const owner = owners.get(connection.id);
    if (!owner) continue;
    for (const material of contractMaterials.get(connection.id) ?? [])
      if (!permittedMaterial(connection.id, owner, material))
        error('PrivateReference', connection.at, `Connection captures private material ${material}`, [
          elements.get(material)!.at,
        ]);
  }
  // Contract paths are independent of capability paths.
  for (const p of participants)
    for (const c of [...p.provides, ...used(p)]) {
      const declarationOwner = owners.get(c.target);
      if (!declarationOwner) continue;
      const path = ancestors(declarationOwner, parents);
      const fromAncestors = ancestors(p.id, parents);
      if (fromAncestors.includes(declarationOwner)) continue;
      for (const boundary of path) {
        if (fromAncestors.includes(boundary)) break;
        if (!contracts.get(boundary)?.has(c.target))
          error('PrivateReference', c.at, `Connection is hidden at boundary ${boundary}`);
      }
    }
  const explicitlyPublicAt = (boundary: string, target: string): boolean =>
    ancestors(boundary, parents).some((at) => explicit.get(at)?.has(target));
  for (const m of modules)
    for (const id of explicit.get(m.id) ?? []) {
      const life = elements.get(id);
      if (life?.kind !== 'Lifecycle') continue;
      for (const anchor of [life.starts, life.ends]) {
        if (anchor.kind === 'Returned' && !contracts.get(m.id)?.has(anchor.via.connection.target))
          error(
            'PrivateReference',
            life.at,
            'Public Lifecycle does not independently expose its Fact connection',
          );
        if (
          anchor.kind === 'Occurred' &&
          !explicitlyPublicAt(m.id, anchor.event.target) &&
          ![...(contracts.get(m.id) ?? [])].some((c) => contractMaterials.get(c)?.has(anchor.event.target))
        )
          error('PrivateReference', life.at, 'Public Lifecycle has a private event anchor');
      }
      if (life.within && !explicitlyPublicAt(m.id, life.within.target))
        error('PrivateReference', life.within.at, 'Public Lifecycle has a private within target');
    }
  const providerFacts: ProviderFacts = { elements, parents, capabilities, offered };
  const roles: Extract<Selection, { kind: 'Role' }>[] = [];
  for (const p of participants)
    for (const c of used(p)) {
      const consumer = { target: p.id, at: p.at };
      const candidates = capabilities
        .filter(
          (cap) =>
            cap.connection.target === c.target &&
            eligibleProvider(consumer, c, cap.provider, providerFacts).kind === 'Eligible',
        )
        .map((cap) => cap.provider)
        .sort((a, b) => a.target.localeCompare(b.target));
      roles.push({ kind: 'Role', consumer, connection: c, candidates });
    }
  const compositions: CompositionContext[] = [];
  for (const e of design.elements)
    if (e.kind === 'Composition') {
      const selections: Selection[] = [...roles];
      const seen = new Map<string, Location>();
      e.bindings.forEach((binding, index) => {
        const key = `${binding.consumer.target}\0${binding.connection.target}`;
        const first = seen.get(key);
        if (first)
          error('InvalidBinding', binding.at, 'Composition binds the same consumer/connection twice', [
            first,
          ]);
        else seen.set(key, binding.at);
        const role = roles.findIndex(
          (r) =>
            r.consumer.target === binding.consumer.target &&
            r.connection.target === binding.connection.target,
        );
        if (role < 0) {
          error('InvalidBinding', binding.at, 'Binding consumer did not declare this usage');
          return;
        }
        const eligible = eligibleProvider(
          binding.consumer,
          binding.connection,
          binding.provider,
          providerFacts,
        );
        if (eligible.kind === 'Ineligible') {
          error(
            eligible.code === 'HiddenCapability' ? 'PrivateReference' : 'InvalidBinding',
            binding.at,
            `Invalid provider: ${eligible.code}`,
          );
          return;
        }
        selections[role] = {
          kind: 'Bound',
          consumer: binding.consumer,
          connection: binding.connection,
          provider: binding.provider,
          composition: e.id,
          binding: index,
        };
      });
      compositions.push({ composition: e.id, selections });
    }
  // Only selected dependencies participate in same-level cycle checks.
  for (const context of compositions) {
    const levels = [
      ...modules.map((m) => m.parts.map((p) => p.target)),
      participants.filter((p) => p.kind === 'Unit').map((p) => p.id),
    ];
    for (const level of levels) {
      const project = (id: string): string | undefined =>
        ancestors(id, parents).find((a) => level.includes(a));
      const edges = new Map<string, string[]>();
      for (const selection of context.selections)
        if (selection.kind === 'Bound') {
          const from = project(selection.consumer.target);
          const to = project(selection.provider.target);
          if (from && to && from !== to) {
            const next = edges.get(from) ?? [];
            next.push(to);
            edges.set(from, next);
          }
        }
      if (hasCycle(level, edges))
        error(
          'DependencyCycle',
          elements.get(context.composition)!.at,
          'Declared composition has a same-level bound dependency cycle',
        );
    }
  }
  const scopes = design.elements.filter((e) => e.kind === 'Scope');
  const scopeParents = new Map<string, string>();
  for (const scope of scopes) {
    duplicate(scope.contains, 'scope member');
    for (const member of scope.contains) {
      const target = elements.get(member.target);
      if (!isParticipant(target) && !(target?.kind === 'Scope' && target.scopeKind === scope.scopeKind))
        error('InvalidScope', member.at, 'Scope contains Participants or scopes of the same kind only');
      const key = `${scope.scopeKind}\0${member.target}`;
      const first = scopeParents.get(key);
      if (first && first !== scope.id)
        error('InvalidScope', member.at, 'Member has two direct scopes of the same kind');
      else scopeParents.set(key, scope.id);
    }
  }
  if (
    hasCycle(
      scopes.map((s) => s.id),
      new Map(
        scopes.map((s) => [
          s.id,
          s.contains.filter((c) => elements.get(c.target)?.kind === 'Scope').map((c) => c.target),
        ]),
      ),
    )
  )
    error('InvalidScope', scopes[0]!.at, 'Scope nesting is cyclic');
  const validFact = (fact: Fact, code: 'InvalidScenario' | 'InvalidLifecycle'): boolean => {
    const valid =
      fact.kind === 'Returned'
        ? branchFor(fact, elements).valid
        : elements.get(fact.event.target)?.kind === 'Event';
    if (!valid) error(code, fact.at, 'Fact references an unknown operation, branch or event');
    return valid;
  };
  const containsKey = (
    expression: DataExpression,
    key: string,
    visited: ReadonlySet<string> = new Set(),
  ): boolean => {
    if (expression.kind === 'Reference') {
      if (expression.target === key) return true;
      if (visited.has(expression.target)) return false;
      const e = elements.get(expression.target);
      const next = new Set(visited);
      next.add(expression.target);
      return e?.kind === 'Data' && containsKey(e.expression, key, next);
    }
    switch (expression.kind) {
      case 'Application':
        return containsKey(expression.resolved, key, visited);
      case 'Value':
        return containsKey(expression.value, key, visited);
      case 'Struct':
        return expression.fields.some((f) => containsKey(f.value, key, visited));
      case 'Tuple':
        return expression.items.some((i) => containsKey(i, key, visited));
      case 'Apply':
        return containsKey(expression.argument, key, visited);
      case 'Choice':
        return expression.cases.some((c) => c.fields.some((f) => containsKey(f.value, key, visited)));
      case 'Outcome':
        return expression.variants.some((v) => v.fields.some((f) => containsKey(f.value, key, visited)));
      case 'Opaque':
      case 'Parameter':
      case 'Scalar':
        return false;
    }
  };
  const anchorContains = (fact: Fact, key: string): boolean => {
    if (fact.kind === 'Occurred') {
      const event = elements.get(fact.event.target);
      return event?.kind === 'Event' && containsKey(event.payload, key);
    }
    const op = operationFor(fact.via, elements);
    return Boolean(
      op &&
      [...op.params.map((f) => f.value), ...branchFor(fact, elements).fields].some((x) =>
        containsKey(x, key),
      ),
    );
  };
  const lifecycles = design.elements.filter((e) => e.kind === 'Lifecycle');
  for (const lifecycle of lifecycles) {
    if (elements.get(lifecycle.key.target)?.kind !== 'Data')
      error('InvalidLifecycle', lifecycle.key.at, 'Lifecycle key must be named Data');
    for (const fact of [lifecycle.starts, lifecycle.ends])
      if (validFact(fact, 'InvalidLifecycle') && !anchorContains(fact, lifecycle.key.target))
        error('InvalidLifecycle', fact.at, 'Lifecycle key must occur on each anchor side');
    if (lifecycle.within) {
      const outer = elements.get(lifecycle.within.target);
      if (outer?.kind !== 'Lifecycle')
        error('InvalidLifecycle', lifecycle.within.at, 'within must refer to Lifecycle');
      else {
        const owner = owners.get(lifecycle.id);
        const targetOwner = owners.get(outer.id);
        if (owner && targetOwner !== owner && !explicitReachable(owner, outer.id))
          error(
            'PrivateReference',
            lifecycle.within.at,
            'Cross-owner within requires an explicit public Lifecycle path',
          );
      }
    }
  }
  if (
    hasCycle(
      lifecycles.map((l) => l.id),
      new Map(lifecycles.map((l) => [l.id, l.within ? [l.within.target] : []])),
    )
  )
    error('InvalidLifecycle', lifecycles[0]!.at, 'Lifecycle.within is cyclic');
  // Validate every embedded fact, including those never exercised by a Scenario.
  const checkDataFacts = (expression: DataExpression): void => {
    switch (expression.kind) {
      case 'Application':
        checkDataFacts(expression.resolved);
        break;
      case 'Value':
        checkDataFacts(expression.value);
        break;
      case 'Struct':
        expression.fields.forEach((f) => checkDataFacts(f.value));
        break;
      case 'Tuple':
        expression.items.forEach(checkDataFacts);
        break;
      case 'Apply':
        checkDataFacts(expression.argument);
        break;
      case 'Choice':
        expression.cases.forEach((c) => c.fields.forEach((f) => checkDataFacts(f.value)));
        break;
      case 'Outcome':
        expression.variants.forEach((v) => {
          v.fields.forEach((f) => checkDataFacts(f.value));
          if (v.follow.kind !== 'End') {
            for (const d of v.follow.duties) {
              validFact(d.complete, 'InvalidScenario');
              if (d.by.kind === 'Participant' && !isParticipant(elements.get(d.by.participant.target)))
                error('InvalidScenario', d.by.participant.at, 'Duty needs a Participant');
            }
            if (v.follow.kind === 'Next')
              for (const target of v.follow.targets)
                if (!operationFor(target, elements))
                  error('InvalidScenario', target.at, 'Next target operation does not exist');
          }
        });
        break;
      case 'Reference':
      case 'Scalar':
      case 'Parameter':
      case 'Opaque':
        break;
    }
  };
  for (const e of design.elements) {
    if (e.kind === 'Data') checkDataFacts(e.expression);
    if (e.kind === 'Connection')
      for (const op of operations(e)) {
        op.params.forEach((p) => checkDataFacts(p.value));
        checkDataFacts(op.result);
      }
    if (e.kind === 'Event') {
      checkDataFacts(e.payload);
      if (!isParticipant(elements.get(e.confirms.target)))
        error('InvalidScenario', e.confirms.at, 'Event confirmer must be Participant');
    }
  }
  const scenarios: ScenarioFacts[] = [];
  for (const scenario of design.elements.filter((e): e is Scenario => e.kind === 'Scenario')) {
    const selections =
      scenario.context.kind === 'Contracts'
        ? roles
        : compositions.find(
            (c) =>
              scenario.context.kind === 'Composition' &&
              c.composition === scenario.context.composition.target,
          )?.selections;
    if (!selections) {
      error('InvalidScenario', scenario.at, 'Scenario references an unknown Composition');
      continue;
    }
    const steps: ScenarioFacts['steps'][number][] = [];
    const pending = new Map<
      string,
      { readonly fromStep: number; readonly targets: readonly OperationRef[] }
    >();
    const occurrences: {
      readonly duty: Duty;
      readonly createdAt: number;
      readonly actor: string;
      readonly selection: Selection;
    }[] = [];
    scenario.steps.forEach((step, index) => {
      validFact(step.fact, 'InvalidScenario');
      if (step.kind === 'Event') {
        const event = elements.get(step.fact.event.target);
        if (event?.kind === 'Event') steps.push({ kind: 'Event', index, confirmer: event.confirms });
        return;
      }
      const selection = selections.find(
        (s) =>
          s.consumer.target === step.actor.target && s.connection.target === step.fact.via.connection.target,
      );
      if (!selection) {
        error('InvalidScenario', step.actor.at, 'Call actor did not declare usage of this Connection');
        return;
      }
      steps.push({ kind: 'Call', index, selection });
      const expected = pending.get(step.actor.target);
      if (
        expected &&
        !expected.targets.some(
          (t) =>
            t.connection.target === step.fact.via.connection.target &&
            t.operation === step.fact.via.operation,
        )
      )
        error(
          'InvalidScenario',
          step.at,
          'Next constrains this actor next Call, not another actor or an event',
        );
      pending.delete(step.actor.target);
      const branch = branchFor(step.fact, elements);
      if (branch.follow.kind === 'Next')
        pending.set(step.actor.target, { fromStep: index, targets: branch.follow.targets });
      if (branch.follow.kind !== 'End')
        for (const duty of branch.follow.duties)
          occurrences.push({ duty, createdAt: index, actor: step.actor.target, selection });
    });
    const eligible: { readonly step: number; readonly basis: DutyMatch['basis'] }[][] = occurrences.map(
      (occurrence) => {
        const candidates: { step: number; basis: DutyMatch['basis'] }[] = [];
        scenario.steps.forEach((step, index) => {
          if (index <= occurrence.createdAt || !factEqual(step.fact, occurrence.duty.complete)) return;
          const event = step.kind === 'Event' ? elements.get(step.fact.event.target) : undefined;
          const actor =
            step.kind === 'Call'
              ? step.actor.target
              : event?.kind === 'Event'
                ? event.confirms.target
                : undefined;
          const by = occurrence.duty.by;
          if (
            (by.kind === 'Caller' && actor === occurrence.actor) ||
            (by.kind === 'Participant' && actor === by.participant.target)
          )
            candidates.push({ step: index, basis: 'DeclaredParticipant' });
          if (by.kind === 'Provider') {
            const s = occurrence.selection;
            if (s.kind === 'Bound' && actor === s.provider.target)
              candidates.push({ step: index, basis: 'SelectedBinding' });
            else if (s.kind === 'Role' && s.candidates.some((c) => c.target === actor))
              candidates.push({ step: index, basis: 'RoleWitness' });
          }
        });
        return candidates;
      },
    );
    const assigned = new Map<number, number>();
    const augment = (duty: number, seen: Set<number>): boolean => {
      for (const candidate of eligible[duty] ?? []) {
        if (seen.has(candidate.step)) continue;
        seen.add(candidate.step);
        const old = assigned.get(candidate.step);
        if (old === undefined || augment(old, seen)) {
          assigned.set(candidate.step, duty);
          return true;
        }
      }
      return false;
    };
    occurrences.forEach((_, index) => {
      augment(index, new Set());
    });
    const matches: DutyMatch[] = [...assigned]
      .map(([completedAt, duty]) => ({
        duty,
        completedAt,
        basis: eligible[duty]!.find((c) => c.step === completedAt)!.basis,
      }))
      .sort((a, b) => a.duty - b.duty);
    const unmatched = occurrences.map((_, i) => i).filter((i) => !matches.some((m) => m.duty === i));
    if (scenario.ends.kind === 'Complete') {
      if (pending.size)
        error('InvalidScenario', scenario.at, 'Complete scenario has pending actor Next calls');
      if (unmatched.length)
        error(
          'UnfulfilledDuty',
          scenario.at,
          `Complete scenario has ${unmatched.length} unmatched duty occurrences`,
        );
      scenarios.push({
        scenario: scenario.id,
        context: scenario.context,
        steps,
        matches,
        ending: { kind: 'Complete' },
      });
    } else {
      if (!scenario.steps.length)
        error('InvalidScenario', scenario.at, 'Interrupted scenario needs a last fact');
      if (!isParticipant(elements.get(scenario.ends.responsible.target)))
        error('InvalidScenario', scenario.ends.responsible.at, 'Interrupted responsible must be Participant');
      scenarios.push({
        scenario: scenario.id,
        context: scenario.context,
        steps,
        matches,
        ending: {
          kind: 'Interrupted',
          responsible: scenario.ends.responsible,
          unmatchedDuties: unmatched,
          pendingNext: [...pending].map(([actor, p]) => ({ actor, fromStep: p.fromStep })),
        },
      });
    }
  }
  if (errors.length) return reject(errors);
  return {
    kind: 'Accepted',
    value: {
      ownership,
      capabilities,
      exposures,
      publicMaterials: participants.map((p) => ({
        boundary: p.id,
        explicit: [...(explicit.get(p.id) ?? [])],
        contracts: [...(contracts.get(p.id) ?? [])].map((connection) => ({
          connection,
          materials: [...(contractMaterials.get(connection) ?? [])],
        })),
      })),
      contracts: roles,
      compositions,
      scenarios,
    },
  };
}
/** Visible names are scoped using the already established public-material facts. */
export function visibleElements(
  design: ResolvedDesign,
  facts: RelationFacts,
  place: { readonly layer: string; readonly module: readonly string[] },
): readonly Element[] {
  if (place.layer === 'relations') return design.elements;
  const owner = design.elements.find(
    (e) =>
      (e.kind === 'Module' || e.kind === 'Unit') &&
      e.place.layer === place.layer &&
      e.place.module.join('/') === place.module.join('/'),
  );
  const boundary = owner ? facts.publicMaterials.find((p) => p.boundary === owner.id) : undefined;
  const through = new Set([
    ...(boundary?.explicit ?? []),
    ...(boundary?.contracts.flatMap((c) => [c.connection, ...c.materials]) ?? []),
  ]);
  return design.elements.filter(
    (e) =>
      (e.place.layer === place.layer && e.place.module.join('/') === place.module.join('/')) ||
      isParticipant(e) ||
      through.has(e.id) ||
      (e.place.layer === 'architecture' &&
        place.layer === 'architecture' &&
        e.place.module.every((p, i) => p === place.module[i])),
  );
}
