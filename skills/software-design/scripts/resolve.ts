import type { CompilerView, TypeHandle } from './compiler.ts';
import { reject, type Diagnostic, type Location, type Result } from './diagnostics.ts';
import type {
  Binding,
  CarrierUse,
  Completion,
  DataCase,
  DataExpression,
  Duty,
  Element,
  ElementUse,
  Exposure,
  Fact,
  Field,
  Follow,
  Named,
  Operation,
  OperationRef,
  Responsibility,
  ScenarioContext,
  Step,
  TypeExpression,
  ResolvedDesign,
} from './model.ts';
import type { SourceSet } from './workspace-model.ts';
const parseFailure = Symbol('resolve-failure');
type ParseFailure = { readonly [parseFailure]: Diagnostic };
function isParseFailure(error: unknown): error is ParseFailure {
  return typeof error === 'object' && error !== null && parseFailure in error;
}
const descriptorFields: Readonly<Record<string, readonly string[]>> = {
  Value: ['type'],
  Opaque: ['key'],
  Struct: ['fields'],
  Tuple: ['items'],
  Apply: ['lambda', 'argument'],
  Choice: ['cases'],
  Outcome: ['variants'],
  Case: ['fields'],
  Variant: ['fields', 'follow'],
  Carrier: ['key', 'lambda', 'laws'],
  Op: ['params', 'result'],
  Point: ['op', 'carriers', 'laws'],
  Face: ['invariant', 'ops', 'carriers', 'laws'],
  OpRef: ['connection', 'name'],
  Returned: ['via', 'branch'],
  Occurred: ['event'],
  Event: ['confirms', 'payload'],
  Duty: ['by', 'complete'],
  End: [],
  Next: ['targets', 'duties'],
  Later: ['duties'],
  Module: ['spec'],
  Unit: ['spec'],
  External: ['spec'],
  Lifecycle: ['spec'],
  Expose: ['connection', 'from'],
  Binding: ['consumer', 'connection', 'provider'],
  Composition: ['bindings'],
  Scope: ['kind', 'contains'],
  Step: ['actor', 'fact'],
  EventStep: ['fact'],
  Complete: [],
  Interrupted: ['responsible'],
  Scenario: ['steps', 'ends', 'assembly'],
  Uncomposed: [],
};
/** Every property below is compiler-resolved, never interpreted from TS spelling. */
export async function resolve(source: SourceSet, view: CompilerView): Promise<Result<ResolvedDesign>> {
  const declarations = new Map(view.declarations.map((d) => [d.id, d]));
  let at: Location = { path: 'tsconfig.json', line: 1, column: 1 };
  const fail = (
    code: Extract<Diagnostic, { stage: 'resolve' }>['code'],
    message: string,
    location = at,
  ): never => {
    throw {
      [parseFailure]: { stage: 'resolve', code, at: location, message, related: [] },
    } satisfies ParseFailure;
  };
  const prop = async (type: TypeHandle, name: string): Promise<TypeHandle> =>
    (await view.property(type, name)) ?? fail('InvalidDescriptor', `Missing descriptor field ${name}`);
  const literal = async (type: TypeHandle): Promise<string> => {
    const c = await view.classify(type);
    return c.kind === 'StringLiteral' ? c.value : fail('InvalidDescriptor', 'Expected a string literal');
  };
  const text = async (type: TypeHandle, key: string): Promise<string> => literal(await prop(type, key));
  const doc = async (type: TypeHandle): Promise<string> => {
    const d = await text(type, 'doc');
    if (!d.trim()) fail('EmptyDescription', 'Description must not be empty');
    return d;
  };
  const tag = async (type: TypeHandle): Promise<string> => {
    if (!(await view.isDescriptor(type)))
      fail('InvalidDescriptor', 'Type is not an authentic DSL descriptor', type.at);
    const name = await text(type, 'design');
    if (name === 'Family') return name; // F retains its own native TypeLambda fields.
    const keys = descriptorFields[name];
    if (!keys) return fail('InvalidDescriptor', `Unknown descriptor ${name}`, type.at);
    for (const member of await view.members(type))
      if (member.name !== 'design' && member.name !== 'doc' && !keys.includes(member.name))
        fail('UnknownMember', `Unknown ${name} field ${member.name}`, member.at);
    return name;
  };
  const tuple = async (type: TypeHandle): Promise<readonly TypeHandle[]> => {
    const r = await view.tuple(type);
    return r.kind === 'Accepted' ? r.value : fail('InvalidDescriptor', r.diagnostics[0].message);
  };
  const list = async (type: TypeHandle, key: string): Promise<readonly TypeHandle[]> => {
    const p = await view.property(type, key);
    return p ? tuple(p) : [];
  };
  const strings = async (type: TypeHandle, key: string): Promise<readonly string[]> => {
    const r: string[] = [];
    for (const t of await list(type, key)) r.push(await literal(t));
    return r;
  };
  const use = async (type: TypeHandle): Promise<ElementUse> => {
    const id = await view.canonical(type);
    if (!id || !declarations.has(id))
      return fail(
        'UnresolvedReference',
        `Expected a named design declaration, received ${await view.display(type)}`,
        type.at,
      );
    return { target: id, at: type.at ?? at };
  };
  const uses = async (type: TypeHandle, key: string): Promise<readonly ElementUse[]> => {
    const r: ElementUse[] = [];
    for (const t of await list(type, key)) r.push(await use(t));
    return r;
  };
  const expression = async (type: TypeHandle): Promise<TypeExpression> => ({
    text: await view.display(type),
    references: await view.references(type),
  });
  const exact = async (type: TypeHandle, keys: readonly string[]): Promise<void> => {
    for (const m of await view.members(type))
      if (!keys.includes(m.name)) fail('UnknownMember', `Unknown specification field ${m.name}`, m.at);
  };
  const opRef = async (type: TypeHandle): Promise<OperationRef> => {
    if ((await tag(type)) !== 'OpRef') fail('InvalidDescriptor', 'Expected OpRef', type.at);
    return {
      connection: await use(await prop(type, 'connection')),
      operation: await text(type, 'name'),
      at: type.at ?? at,
    };
  };
  const fact = async (type: TypeHandle): Promise<Fact> => {
    const t = await tag(type);
    if (t === 'Returned')
      return {
        kind: 'Returned',
        via: await opRef(await prop(type, 'via')),
        branch: await text(type, 'branch'),
        at: type.at ?? at,
      };
    if (t === 'Occurred')
      return { kind: 'Occurred', event: await use(await prop(type, 'event')), at: type.at ?? at };
    return fail('InvalidDescriptor', `Expected Fact, received ${t}`, type.at);
  };
  const duty = async (type: TypeHandle): Promise<Duty> => {
    if ((await tag(type)) !== 'Duty') fail('InvalidDescriptor', 'Expected Duty');
    const byType = await prop(type, 'by');
    const c = await view.classify(byType);
    let by: Responsibility;
    if (c.kind === 'StringLiteral' && c.value === 'caller') by = { kind: 'Caller' };
    else if (c.kind === 'StringLiteral' && c.value === 'provider') by = { kind: 'Provider' };
    else by = { kind: 'Participant', participant: await use(byType) };
    return {
      doc: await doc(type),
      at: type.at ?? at,
      by,
      complete: await fact(await prop(type, 'complete')),
    };
  };
  const follow = async (type: TypeHandle): Promise<Follow> => {
    const t = await tag(type);
    if (t === 'End') return { kind: 'End' };
    if (t !== 'Next' && t !== 'Later') return fail('InvalidDescriptor', `Unknown Follow ${t}`);
    const duties: Duty[] = [];
    for (const d of await list(type, 'duties')) duties.push(await duty(d));
    const description = await doc(type);
    if (t === 'Later') {
      if (!duties.length) fail('InvalidDescriptor', 'Later requires duties');
      return { kind: 'Later', doc: description, duties };
    }
    const targets: OperationRef[] = [];
    for (const target of await list(type, 'targets')) targets.push(await opRef(target));
    if (!targets.length) fail('InvalidDescriptor', 'Next requires targets');
    return { kind: 'Next', doc: description, targets, duties };
  };
  const fields = async (
    type: TypeHandle,
    visited: ReadonlySet<number>,
    definitions: ReadonlySet<string> = new Set(),
  ): Promise<readonly Field[]> => {
    const result: Field[] = [];
    for (const member of await view.members(type)) {
      const previous = at;
      at = member.at;
      result.push({
        name: member.name,
        doc: await doc(member.type),
        at,
        value: await data(member.type, visited, false, definitions),
      });
      at = previous;
    }
    return result;
  };
  const cases = async (
    type: TypeHandle,
    visited: ReadonlySet<number>,
    definitions: ReadonlySet<string>,
  ): Promise<readonly DataCase[]> => {
    const result: DataCase[] = [];
    for (const m of await view.members(type)) {
      if ((await tag(m.type)) !== 'Case') fail('InvalidDescriptor', 'Choice requires Case');
      result.push({
        name: m.name,
        doc: await doc(m.type),
        at: m.at,
        fields: await fields(await prop(m.type, 'fields'), visited, definitions),
      });
    }
    return result;
  };
  const data = async (
    type: TypeHandle,
    visited: ReadonlySet<number> = new Set(),
    expand = false,
    definitions: ReadonlySet<string> = new Set(),
  ): Promise<DataExpression> => {
    const id = await view.canonical(type);
    const declaration = id ? declarations.get(id) : undefined;
    const args = await view.arguments(type);
    const helper =
      declaration && (declaration.generic || (declaration.form === 'Interface' && !declaration.exported));
    if (!expand && id && definitions.has(id)) return { kind: 'Reference', target: id, at: type.at ?? at };
    if (!expand && id && declaration && !helper && type.id === declaration.type.id)
      return { kind: 'Reference', target: id, at: type.at ?? at };
    if (visited.has(type.id)) {
      if (id) return { kind: 'Reference', target: id, at: type.at ?? at };
      return fail('InvalidDescriptor', 'Anonymous recursive data needs a named definition', type.at);
    }
    const next = new Set(visited);
    next.add(type.id);
    const nextDefinitions = new Set(definitions);
    if (id && helper) nextDefinitions.add(id);
    if (!expand && id && helper) {
      const arguments_: TypeExpression[] = [];
      for (const arg of args) arguments_.push(await expression(arg));
      return {
        kind: 'Application',
        definition: { target: id, at: type.at ?? at },
        arguments: arguments_,
        resolved: await data(type, visited, true, nextDefinitions),
      };
    }
    const c = await view.classify(type);
    if (c.kind === 'Parameter')
      return {
        kind: 'Parameter',
        name: c.name,
        constraint: c.constraint ? await expression(c.constraint) : undefined,
      };
    if (c.kind === 'Scalar' || c.kind === 'StringLiteral')
      return { kind: 'Scalar', type: await expression(type) };
    const t = await tag(type);
    const description = await doc(type);
    switch (t) {
      case 'Value':
        return {
          kind: 'Value',
          doc: description,
          value: await data(await prop(type, 'type'), next, false, nextDefinitions),
        };
      case 'Opaque':
        return { kind: 'Opaque', doc: description, key: await text(type, 'key') };
      case 'Struct':
        return {
          kind: 'Struct',
          doc: description,
          fields: await fields(await prop(type, 'fields'), next, nextDefinitions),
        };
      case 'Tuple': {
        const items: DataExpression[] = [];
        for (const item of await list(type, 'items'))
          items.push(await data(item, next, false, nextDefinitions));
        return { kind: 'Tuple', doc: description, items };
      }
      case 'Apply':
        return {
          kind: 'Apply',
          doc: description,
          lambda: await expression(await prop(type, 'lambda')),
          argument: await data(await prop(type, 'argument'), next, false, nextDefinitions),
        };
      case 'Choice':
        return {
          kind: 'Choice',
          doc: description,
          cases: await cases(await prop(type, 'cases'), next, nextDefinitions),
        };
      case 'Outcome': {
        const variants = [];
        for (const m of await view.members(await prop(type, 'variants'))) {
          if ((await tag(m.type)) !== 'Variant') fail('InvalidDescriptor', 'Outcome requires Variant');
          variants.push({
            name: m.name,
            doc: await doc(m.type),
            at: m.at,
            fields: await fields(await prop(m.type, 'fields'), next, nextDefinitions),
            follow: await follow(await prop(m.type, 'follow')),
          });
        }
        return { kind: 'Outcome', doc: description, variants };
      }
      default:
        return fail('InvalidDescriptor', `Expected Data, received ${t}`);
    }
  };
  const operation = async (type: TypeHandle, name: string, location: Location): Promise<Operation> => {
    if ((await tag(type)) !== 'Op') fail('InvalidDescriptor', 'Expected Op');
    return {
      name,
      at: location,
      doc: await doc(type),
      params: await fields(await prop(type, 'params'), new Set()),
      result: await data(await prop(type, 'result')),
    };
  };
  const carriers = async (type: TypeHandle, owner: string): Promise<readonly CarrierUse[]> => {
    const result: CarrierUse[] = [];
    for (const c of await list(type, 'carriers')) {
      const id = await view.canonical(c);
      if (id && declarations.has(id)) result.push({ kind: 'Reference', carrier: await use(c) });
      else {
        if ((await tag(c)) !== 'Carrier') fail('InvalidDescriptor', 'Expected Carrier', c.at);
        const key = await text(c, 'key');
        result.push({
          kind: 'Inline',
          id: `${owner}/carrier/${encodeURIComponent(key)}`,
          at: c.at ?? at,
          key,
          doc: await doc(c),
          lambda: await expression(await prop(c, 'lambda')),
          laws: await strings(c, 'laws'),
        });
      }
    }
    if (!result.length) fail('InvalidDescriptor', 'Connection requires at least one carrier', type.at);
    return result;
  };
  const binding = async (type: TypeHandle): Promise<Binding> => {
    if ((await tag(type)) !== 'Binding') fail('InvalidDescriptor', 'Expected Binding', type.at);
    return {
      doc: await doc(type),
      at: type.at ?? at,
      consumer: await use(await prop(type, 'consumer')),
      connection: await use(await prop(type, 'connection')),
      provider: await use(await prop(type, 'provider')),
    };
  };
  const elements: Element[] = [];
  try {
    for (const declaration of view.declarations) {
      at = declaration.at;
      const type = declaration.type;
      const named: Named = {
        id: declaration.id,
        name: declaration.name,
        at,
        place: declaration.place,
        exported: declaration.exported,
        doc: '',
      };
      const canonical = await view.canonical(type);
      // Transparent aliases have no new definition, even when the target is described.
      if (declaration.generic || (declaration.form === 'Interface' && !declaration.exported)) {
        elements.push({
          ...named,
          kind: 'Auxiliary',
          expression: await expression(type),
          generic: declaration.generic,
        });
        continue;
      }
      if (canonical && canonical !== declaration.id) {
        elements.push({
          ...named,
          kind: 'Auxiliary',
          expression: await expression(type),
          generic: declaration.generic,
        });
        continue;
      }
      if (!(await view.isDescriptor(type))) {
        elements.push({
          ...named,
          kind: 'Auxiliary',
          expression: await expression(type),
          generic: declaration.generic,
        });
        continue;
      }
      const t = await tag(type);
      if (
        ['OpRef', 'Returned', 'Occurred', 'Step', 'EventStep', 'End', 'Uncomposed', 'Complete'].includes(t)
      ) {
        elements.push({ ...named, kind: 'Auxiliary', expression: await expression(type), generic: false });
        continue;
      }
      const base = { ...named, doc: await doc(type) };
      switch (t) {
        case 'Value':
        case 'Opaque':
        case 'Struct':
        case 'Tuple':
        case 'Apply':
        case 'Choice':
        case 'Outcome': {
          const resolved = await data(
            type,
            new Set(),
            true,
            new Set(declaration.application ? [declaration.application.definition] : []),
          );
          if (declaration.application) {
            const arguments_: TypeExpression[] = [];
            for (const argument of declaration.application.arguments)
              arguments_.push(await expression(argument));
            elements.push({
              ...base,
              kind: 'Data',
              expression: {
                kind: 'Application',
                definition: { target: declaration.application.definition, at },
                arguments: arguments_,
                resolved,
              },
            });
          } else elements.push({ ...base, kind: 'Data', expression: resolved });
          break;
        }
        case 'Family':
          elements.push({ ...base, kind: 'Family', lambda: await expression(await view.familyLambda(type)) });
          break;
        case 'Carrier':
          elements.push({
            ...base,
            kind: 'Carrier',
            key: await text(type, 'key'),
            lambda: await expression(await prop(type, 'lambda')),
            laws: await strings(type, 'laws'),
          });
          break;
        case 'Point':
        case 'Face': {
          const common = { carriers: await carriers(type, base.id), laws: await strings(type, 'laws') };
          if (t === 'Point')
            elements.push({
              ...base,
              kind: 'Connection',
              port: {
                ...common,
                kind: 'Point',
                operation: await operation(await prop(type, 'op'), 'op', at),
              },
            });
          else {
            const operations: Operation[] = [];
            for (const m of await view.members(await prop(type, 'ops')))
              operations.push(await operation(m.type, m.name, m.at));
            elements.push({
              ...base,
              kind: 'Connection',
              port: { ...common, kind: 'Face', invariant: await text(type, 'invariant'), operations },
            });
          }
          break;
        }
        case 'Module': {
          const spec = await prop(type, 'spec');
          await exact(spec, ['core', 'ports', 'provides', 'requires', 'public', 'parts', 'reexports']);
          const reexports: Exposure[] = [];
          for (const e of await list(spec, 'reexports')) {
            if ((await tag(e)) !== 'Expose') fail('InvalidDescriptor', 'Expected Expose', e.at);
            reexports.push({
              doc: await doc(e),
              at: e.at ?? at,
              by: { target: base.id, at: e.at ?? at },
              connection: await use(await prop(e, 'connection')),
              from: await use(await prop(e, 'from')),
            });
          }
          elements.push({
            ...base,
            kind: 'Module',
            core: await uses(spec, 'core'),
            ports: await uses(spec, 'ports'),
            provides: await uses(spec, 'provides'),
            requires: await uses(spec, 'requires'),
            public: await uses(spec, 'public'),
            parts: await uses(spec, 'parts'),
            reexports,
          });
          break;
        }
        case 'Unit': {
          const spec = await prop(type, 'spec');
          await exact(spec, ['types', 'ports', 'provides', 'plugsInto']);
          if (!(await view.property(spec, 'plugsInto'))) fail('InvalidDescriptor', 'Unit requires plugsInto');
          elements.push({
            ...base,
            kind: 'Unit',
            types: await uses(spec, 'types'),
            ports: await uses(spec, 'ports'),
            provides: await uses(spec, 'provides'),
            plugsInto: await uses(spec, 'plugsInto'),
          });
          break;
        }
        case 'External': {
          const spec = await prop(type, 'spec');
          await exact(spec, ['provides', 'uses']);
          elements.push({
            ...base,
            kind: 'External',
            provides: await uses(spec, 'provides'),
            uses: await uses(spec, 'uses'),
          });
          break;
        }
        case 'Event':
          elements.push({
            ...base,
            kind: 'Event',
            confirms: await use(await prop(type, 'confirms')),
            payload: await data(await prop(type, 'payload')),
          });
          break;
        case 'Lifecycle': {
          const spec = await prop(type, 'spec');
          await exact(spec, ['key', 'starts', 'ends', 'within']);
          const within = await view.property(spec, 'within');
          elements.push({
            ...base,
            kind: 'Lifecycle',
            key: await use(await prop(spec, 'key')),
            starts: await fact(await prop(spec, 'starts')),
            ends: await fact(await prop(spec, 'ends')),
            within: within ? await use(within) : undefined,
          });
          break;
        }
        case 'Scope': {
          const scopeKind = await text(type, 'kind');
          if (
            scopeKind !== 'process' &&
            scopeKind !== 'lifecycle' &&
            scopeKind !== 'trust' &&
            scopeKind !== 'deploy'
          )
            return fail('InvalidDescriptor', 'Unknown Scope kind');
          elements.push({ ...base, kind: 'Scope', scopeKind, contains: await uses(type, 'contains') });
          break;
        }
        case 'Composition': {
          const bindings: Binding[] = [];
          for (const b of await list(type, 'bindings')) bindings.push(await binding(b));
          elements.push({ ...base, kind: 'Composition', bindings });
          break;
        }
        case 'Scenario': {
          const steps: Step[] = [];
          for (const s of await list(type, 'steps')) {
            const st = await tag(s);
            const f = await fact(await prop(s, 'fact'));
            if (st === 'Step' && f.kind === 'Returned')
              steps.push({ kind: 'Call', at: s.at ?? at, actor: await use(await prop(s, 'actor')), fact: f });
            else if (st === 'EventStep' && f.kind === 'Occurred')
              steps.push({ kind: 'Event', at: s.at ?? at, fact: f });
            else fail('InvalidDescriptor', 'Step fact does not match its kind', s.at);
          }
          const ending = await prop(type, 'ends');
          const et = await tag(ending);
          let ends: Completion;
          if (et === 'Complete') ends = { kind: 'Complete' };
          else if (et === 'Interrupted') {
            if (!steps.length) fail('InvalidDescriptor', 'Interrupted scenario requires a final fact');
            ends = {
              kind: 'Interrupted',
              doc: await doc(ending),
              responsible: await use(await prop(ending, 'responsible')),
            };
          } else return fail('InvalidDescriptor', 'Unknown scenario ending');
          const assembly = await prop(type, 'assembly');
          const context: ScenarioContext =
            (await tag(assembly)) === 'Uncomposed'
              ? { kind: 'Contracts' }
              : { kind: 'Composition', composition: await use(assembly) };
          elements.push({ ...base, kind: 'Scenario', steps, ends, context });
          break;
        }
        // Named helper descriptors remain helpers; inline members do not require exports.
        case 'Op':
        case 'Case':
        case 'Variant':
        case 'Duty':
        case 'Next':
        case 'Later':
        case 'Expose':
        case 'Binding':
        case 'Interrupted':
          elements.push({
            ...base,
            kind: 'Auxiliary',
            expression: await expression(type),
            generic: declaration.generic,
          });
          break;
        default:
          fail('InvalidDescriptor', `Unsupported named descriptor ${t}`);
      }
    }
    return {
      kind: 'Accepted',
      value: {
        root: source.root,
        elements,
        references: view.declarations.flatMap((d) => d.references),
        directories: source.directories,
      },
    };
  } catch (error) {
    if (isParseFailure(error)) return reject([error[parseFailure]]);
    throw error;
  }
}
