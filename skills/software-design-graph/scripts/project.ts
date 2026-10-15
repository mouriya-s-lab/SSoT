import type { ValidatedDesign } from '../../software-design/scripts/service.ts';
import type {
  DataExpression,
  Element,
  Fact,
  Field,
  Follow,
  Operation,
  TypeExpression,
} from '../../software-design/scripts/model.ts';
import type { Location } from '../../software-design/scripts/diagnostics.ts';
import { operations } from '../../software-design/scripts/validate.ts';
import { compareEdges } from './engine.ts';
import type { ElementNode, Graph, GraphContext, GraphEdge, GraphNode, Relation } from './graph-model.ts';
/** Members derive their identity from named positions, never documentation or compiler ids. */
export function memberId(owner: string, kind: string, name: string): string {
  return `${owner}/${kind}/${encodeURIComponent(name)}`;
}
function elementNode(e: Element): ElementNode {
  const base = { id: e.id, name: e.name, doc: e.doc, at: e.at };
  switch (e.kind) {
    case 'Data':
      return { ...base, kind: e.kind, details: e };
    case 'Family':
      return { ...base, kind: e.kind, details: e };
    case 'Carrier':
      return { ...base, kind: e.kind, details: e };
    case 'Connection':
      return { ...base, kind: e.kind, details: e };
    case 'Module':
      return { ...base, kind: e.kind, details: e };
    case 'Unit':
      return { ...base, kind: e.kind, details: e };
    case 'External':
      return { ...base, kind: e.kind, details: e };
    case 'Lifecycle':
      return { ...base, kind: e.kind, details: e };
    case 'Scenario':
      return { ...base, kind: e.kind, details: e };
    case 'Event':
      return { ...base, kind: e.kind, details: e };
    case 'Scope':
      return { ...base, kind: e.kind, details: e };
    case 'Composition':
      return { ...base, kind: e.kind, details: e };
    case 'Auxiliary':
      return { ...base, kind: e.kind, details: e };
  }
}
/** Only a sealed five-stage result enters. The returned maps have no mutable producer after return. */
export function buildGraph(validated: ValidatedDesign, context: GraphContext): Graph {
  const { design, facts } = validated;
  const elements = new Map(design.elements.map((e) => [e.id, e]));
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const add = (node: GraphNode): void => {
    if (nodes.has(node.id)) throw new Error(`Duplicate validated Graph identity ${node.id}`);
    nodes.set(node.id, node);
  };
  const edge = (
    from: string,
    to: string,
    relation: Relation,
    at: Location,
    label: string = relation,
  ): void => {
    edges.push({ from, to, relation, label, at });
  };
  for (const element of design.elements) add(elementNode(element));
  const typeEdges = (from: string, type: TypeExpression, relation: Relation = 'reference'): void => {
    for (const use of type.references) edge(from, use.target, relation, use.at);
  };
  const outcomeOwner = (
    owner: string,
    value: DataExpression,
    position: string,
    seen = new Set<string>(),
  ): string | undefined => {
    if (value.kind === 'Outcome') return owner;
    if (value.kind === 'Value') return outcomeOwner(owner, value.value, `${position}.value`, seen);
    if (value.kind === 'Application')
      return outcomeOwner(memberId(owner, 'Application', position), value.resolved, 'resolved', seen);
    if (value.kind === 'Reference' && !seen.has(value.target)) {
      const target = elements.get(value.target);
      if (target?.kind !== 'Data') return undefined;
      seen.add(value.target);
      return outcomeOwner(target.id, target.expression, 'data', seen);
    }
    return undefined;
  };
  const factNode = (owner: string, fact: Fact, position: string): string => {
    const id = memberId(owner, 'Fact', position);
    add({
      id,
      name: fact.kind === 'Returned' ? `${fact.via.operation}.${fact.branch}` : 'Occurred',
      doc: '',
      at: fact.at,
      kind: 'Fact',
      details: fact,
    });
    if (fact.kind === 'Occurred') edge(id, fact.event.target, 'reference', fact.event.at);
    else {
      edge(id, fact.via.connection.target, 'reference', fact.via.connection.at);
      const operation = memberId(fact.via.connection.target, 'Operation', fact.via.operation);
      edge(id, operation, 'reference', fact.at, fact.branch);
      const connection = elements.get(fact.via.connection.target);
      const op = operations(connection).find((o) => o.name === fact.via.operation);
      const branchOwner = op
        ? outcomeOwner(memberId(operation, 'Application', 'result'), op.result, 'result')
        : undefined;
      if (branchOwner) edge(id, memberId(branchOwner, 'Variant', fact.branch), 'reference', fact.at);
    }
    return id;
  };
  const follow = (owner: string, value: Follow): void => {
    if (value.kind === 'End') return;
    if (value.kind === 'Next')
      for (const target of value.targets)
        edge(
          owner,
          memberId(target.connection.target, 'Operation', target.operation),
          'next',
          target.at,
          value.doc,
        );
    value.duties.forEach((duty, index) => {
      const id = memberId(owner, 'Duty', String(index));
      add({ id, name: `Duty ${index + 1}`, doc: duty.doc, at: duty.at, kind: 'Duty', details: duty });
      edge(owner, id, 'duty', duty.at, value.doc);
      if (duty.by.kind === 'Participant')
        edge(id, duty.by.participant.target, 'reference', duty.by.participant.at, 'responsible');
      edge(id, factNode(id, duty.complete, 'complete'), 'completes', duty.at);
    });
  };
  const fields = (owner: string, values: readonly Field[], relation: 'field' | 'parameter'): void => {
    for (const field of values) {
      const id = memberId(owner, 'Field', field.name);
      add({ id, name: field.name, doc: field.doc, at: field.at, kind: 'Field', details: field });
      edge(owner, id, relation, field.at);
      data(id, field.value, field.at, 'value');
    }
  };
  const data = (owner: string, value: DataExpression, at: Location, position: string): void => {
    switch (value.kind) {
      case 'Reference':
        edge(owner, value.target, 'reference', value.at);
        break;
      case 'Scalar':
        typeEdges(owner, value.type);
        break;
      case 'Parameter':
        if (value.constraint) typeEdges(owner, value.constraint);
        break;
      case 'Opaque':
        break;
      case 'Value':
        data(owner, value.value, at, `${position}.value`);
        break;
      case 'Struct':
        fields(owner, value.fields, 'field');
        break;
      case 'Tuple':
        value.items.forEach((item, index) => {
          const id = memberId(owner, 'Application', `${position}.${index}`);
          add({
            id,
            name: `Tuple ${index}`,
            doc: 'doc' in item ? item.doc : '',
            at,
            kind: 'Application',
            details: item,
          });
          edge(owner, id, 'type-argument', at, String(index));
          data(id, item, at, 'item');
        });
        break;
      case 'Application': {
        const id = memberId(owner, 'Application', position);
        add({ id, name: 'Generic application', doc: '', at, kind: 'Application', details: value });
        edge(owner, id, 'type-argument', at);
        edge(id, value.definition.target, 'applies', value.definition.at);
        for (const argument of value.arguments) typeEdges(id, argument, 'type-argument');
        data(id, value.resolved, at, 'resolved');
        break;
      }
      case 'Apply': {
        const id = memberId(owner, 'Application', position);
        add({ id, name: value.lambda.text, doc: value.doc, at, kind: 'Application', details: value });
        edge(owner, id, 'applies', at);
        typeEdges(id, value.lambda, 'applies');
        data(id, value.argument, at, 'argument');
        break;
      }
      case 'Choice':
        for (const c of value.cases) {
          const id = memberId(owner, 'Case', c.name);
          add({ id, name: c.name, doc: c.doc, at: c.at, kind: 'Case', details: c });
          edge(owner, id, 'case', c.at);
          fields(id, c.fields, 'field');
        }
        break;
      case 'Outcome':
        for (const variant of value.variants) {
          const id = memberId(owner, 'Variant', variant.name);
          add({
            id,
            name: variant.name,
            doc: variant.doc,
            at: variant.at,
            kind: 'Variant',
            details: variant,
          });
          edge(owner, id, 'case', variant.at);
          fields(id, variant.fields, 'field');
          follow(id, variant.follow);
        }
        break;
    }
  };
  const operation = (owner: string, value: Operation): void => {
    const id = memberId(owner, 'Operation', value.name);
    add({ id, name: value.name, doc: value.doc, at: value.at, kind: 'Operation', details: value });
    edge(owner, id, 'reference', value.at, 'operation');
    fields(id, value.params, 'parameter');
    const resultId = memberId(id, 'Application', 'result');
    add({
      id: resultId,
      name: `${value.name} result`,
      doc: 'doc' in value.result ? value.result.doc : '',
      at: value.at,
      kind: 'Application',
      details: value.result,
    });
    edge(id, resultId, 'result', value.at);
    data(resultId, value.result, value.at, 'result');
  };
  for (const element of design.elements) {
    switch (element.kind) {
      case 'Data':
        data(element.id, element.expression, element.at, 'data');
        break;
      case 'Family':
      case 'Carrier':
        typeEdges(element.id, element.lambda);
        break;
      case 'Connection': {
        for (const carrier of element.port.carriers) {
          if (carrier.kind === 'Reference')
            edge(element.id, carrier.carrier.target, 'carrier', carrier.carrier.at);
          else {
            add({
              id: carrier.id,
              name: carrier.key,
              doc: carrier.doc,
              at: carrier.at,
              kind: 'CarrierMember',
              details: carrier,
            });
            edge(element.id, carrier.id, 'carrier', carrier.at);
            typeEdges(carrier.id, carrier.lambda);
          }
        }
        for (const op of operations(element)) operation(element.id, op);
        break;
      }
      case 'Module':
        for (const part of element.parts) edge(element.id, part.target, 'part', part.at);
        break;
      case 'Unit':
      case 'External':
        break;
      case 'Event':
        edge(element.id, element.confirms.target, 'confirms', element.confirms.at);
        data(element.id, element.payload, element.at, 'payload');
        break;
      case 'Lifecycle':
        edge(element.id, factNode(element.id, element.starts, 'starts'), 'starts', element.at);
        edge(element.id, factNode(element.id, element.ends, 'ends'), 'ends', element.at);
        edge(element.id, element.key.target, 'key', element.key.at);
        if (element.within) edge(element.id, element.within.target, 'within', element.within.at);
        break;
      case 'Scope':
        for (const member of element.contains) edge(element.id, member.target, 'contains', member.at);
        break;
      case 'Scenario': {
        element.steps.forEach((step, index) => {
          const id = memberId(element.id, 'Step', String(index));
          add({ id, name: `Step ${index + 1}`, doc: '', at: step.at, kind: 'Step', details: step });
          edge(element.id, id, 'step', step.at);
          edge(id, factNode(id, step.fact, 'fact'), 'takes', step.at);
          if (step.kind === 'Call') edge(id, step.actor.target, 'takes', step.actor.at, 'actor');
        });
        const id = memberId(element.id, 'Completion', 'ending');
        add({
          id,
          name: element.ends.kind,
          doc: element.ends.kind === 'Interrupted' ? element.ends.doc : '',
          at: element.at,
          kind: 'Completion',
          details: element.ends,
        });
        edge(element.id, id, 'takes', element.at, 'ending');
        if (element.ends.kind === 'Interrupted')
          edge(id, element.ends.responsible.target, 'handoff', element.ends.responsible.at);
        if (element.context.kind === 'Composition')
          edge(element.id, element.context.composition.target, 'composition', element.context.composition.at);
        break;
      }
      case 'Composition':
        element.bindings.forEach((binding, index) => {
          const id = memberId(element.id, 'Binding', String(index));
          add({
            id,
            name: `Binding ${index + 1}`,
            doc: binding.doc,
            at: binding.at,
            kind: 'Binding',
            details: binding,
          });
          edge(element.id, id, 'binding', binding.at);
          edge(id, binding.consumer.target, 'reference', binding.consumer.at, 'consumer');
          edge(id, binding.connection.target, 'contract', binding.connection.at);
          edge(id, binding.provider.target, 'reference', binding.provider.at, 'provider');
        });
        break;
      case 'Auxiliary':
        typeEdges(element.id, element.expression);
        break;
    }
  }
  for (const own of facts.ownership) edge(own.owner, own.element, 'owns', elements.get(own.element)!.at);
  for (const capability of facts.capabilities)
    edge(capability.provider.target, capability.connection.target, 'can-provide', capability.connection.at);
  facts.exposures.forEach((exposure, index) => {
    const id = memberId(
      exposure.by.target,
      'Expose',
      `${exposure.connection.target}/${exposure.from.target}`,
    );
    add({
      id,
      name: `Expose ${index + 1}`,
      doc: exposure.doc,
      at: exposure.at,
      kind: 'Expose',
      details: exposure,
    });
    edge(exposure.by.target, id, 'exposes', exposure.at);
    edge(exposure.by.target, exposure.connection.target, 'exposes', exposure.at);
    edge(exposure.by.target, exposure.from.target, 'forwarded-from', exposure.from.at);
    edge(id, exposure.connection.target, 'contract', exposure.connection.at);
    edge(id, exposure.from.target, 'forwarded-from', exposure.from.at);
  });
  for (const boundary of facts.publicMaterials) {
    for (const material of boundary.explicit)
      edge(
        boundary.boundary,
        material,
        'public-material',
        elements.get(material)!.at,
        'explicit public closure',
      );
    for (const contract of boundary.contracts) {
      const at =
        design.references.find((r) => r.from === boundary.boundary && r.to === contract.connection)?.at ??
        elements.get(boundary.boundary)!.at;
      for (const material of contract.materials)
        edge(contract.connection, material, 'public-material', at, `contract at ${boundary.boundary}`);
    }
  }
  const selections =
    context.kind === 'Contracts'
      ? facts.contracts
      : facts.compositions.find((c) => c.composition === context.composition)?.selections;
  if (!selections) throw new Error('Graph context must name an existing validated Composition');
  for (const selection of selections) {
    const id = memberId(selection.consumer.target, 'Role', selection.connection.target);
    const connection = elements.get(selection.connection.target)!;
    add({
      id,
      name: `${elements.get(selection.consumer.target)!.name}.${connection.name} role`,
      doc:
        selection.kind === 'Role'
          ? 'Unbound contract role; candidates are not selected providers'
          : 'Explicitly bound in this composition',
      at: selection.connection.at,
      kind: 'Role',
      details: selection,
    });
    edge(selection.consumer.target, id, 'uses', selection.connection.at);
    edge(id, selection.connection.target, 'contract', selection.connection.at);
    if (selection.kind === 'Role')
      for (const candidate of selection.candidates) edge(id, candidate.target, 'candidate', candidate.at);
    else {
      edge(id, selection.provider.target, 'bound-to', selection.provider.at);
      edge(
        id,
        memberId(selection.composition, 'Binding', String(selection.binding)),
        'binding',
        selection.connection.at,
      );
    }
  }
  for (const reference of design.references) edge(reference.from, reference.to, 'reference', reference.at);
  const outgoing = new Map<string, GraphEdge[]>();
  const incoming = new Map<string, GraphEdge[]>();
  const edgeKeys = new Set<string>();
  for (const e of edges.sort(compareEdges)) {
    if (!nodes.has(e.from) || !nodes.has(e.to))
      throw new Error(`Validated graph has a missing edge endpoint: ${e.from} / ${e.to}`);
    const key = JSON.stringify([e.from, e.to, e.relation, e.label, e.at]);
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    const out = outgoing.get(e.from) ?? [];
    out.push(e);
    outgoing.set(e.from, out);
    const inc = incoming.get(e.to) ?? [];
    inc.push(e);
    incoming.set(e.to, inc);
  }
  return {
    context,
    nodes: new Map([...nodes].sort(([a], [b]) => a.localeCompare(b))),
    out: outgoing,
    incoming,
  };
}
