import type { GraphContext, GraphNode, QueryError } from './graph-model.ts';

type Common = { readonly root: string; readonly composition: string | undefined };
type Command = Common &
  (
    | { readonly kind: 'view'; readonly json: boolean }
    | { readonly kind: 'search'; readonly text: string; readonly nodeKind: GraphNode['kind'] | undefined }
    | {
        readonly kind: 'neighbors';
        readonly selector: string;
        readonly direction: 'out' | 'in' | 'both';
        readonly depth: number;
      }
    | { readonly kind: 'path'; readonly from: string; readonly to: string }
  );
type ArgumentsResult =
  | { readonly kind: 'Accepted'; readonly command: Command }
  | { readonly kind: 'InvalidArguments'; readonly message: string };
type ExitCode = 0 | 1 | 2;
type Output =
  | { readonly kind: 'Success'; readonly text: string }
  | { readonly kind: 'Failure'; readonly code: 1 | 2; readonly text: string };

const nodeKinds = {
  Data: 'Data',
  Family: 'Family',
  Carrier: 'Carrier',
  Connection: 'Connection',
  Module: 'Module',
  Unit: 'Unit',
  External: 'External',
  Event: 'Event',
  Lifecycle: 'Lifecycle',
  Scope: 'Scope',
  Scenario: 'Scenario',
  Composition: 'Composition',
  Auxiliary: 'Auxiliary',
  Operation: 'Operation',
  Field: 'Field',
  Case: 'Case',
  Variant: 'Variant',
  Duty: 'Duty',
  Fact: 'Fact',
  Step: 'Step',
  Application: 'Application',
  Expose: 'Expose',
  Binding: 'Binding',
  Role: 'Role',
  Completion: 'Completion',
  CarrierMember: 'CarrierMember',
} satisfies { readonly [K in GraphNode['kind']]: K };

const usage = `Usage:
  bun graph.ts view <design> [--json] [--composition <selector>]
  bun graph.ts search <design> <text> [--kind <kind>] [--composition <selector>]
  bun graph.ts neighbors <design> <selector> [--direction out|in|both] [--depth <positive-int>] [--composition <selector>]
  bun graph.ts path <design> <from> <to> [--composition <selector>]
Kinds: ${Object.values(nodeKinds).join(', ')}`;

function parseArguments(argv: readonly string[]): ArgumentsResult {
  const [name, ...tokens] = argv;
  if (name !== 'view' && name !== 'search' && name !== 'neighbors' && name !== 'path') {
    return {
      kind: 'InvalidArguments',
      message: name === undefined ? 'A command is required.' : `Unknown command: ${name}`,
    };
  }
  const positionals: string[] = [];
  const seen = new Set<string>();
  let composition: string | undefined;
  let json = false;
  let nodeKind: GraphNode['kind'] | undefined;
  let direction: 'out' | 'in' | 'both' = 'out';
  let depth = 1;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (!token.startsWith('-')) {
      positionals.push(token);
      continue;
    }
    const allowed =
      token === '--composition' ||
      (name === 'view' && token === '--json') ||
      (name === 'search' && token === '--kind') ||
      (name === 'neighbors' && (token === '--direction' || token === '--depth'));
    if (!allowed) return { kind: 'InvalidArguments', message: `Unknown option for ${name}: ${token}` };
    if (seen.has(token)) return { kind: 'InvalidArguments', message: `Repeated option: ${token}` };
    seen.add(token);
    if (token === '--json') {
      json = true;
      continue;
    }
    const value = tokens[++index];
    if (value === undefined || value.length === 0 || value.startsWith('-')) {
      return { kind: 'InvalidArguments', message: `Option ${token} requires a value.` };
    }
    switch (token) {
      case '--composition':
        composition = value;
        break;
      case '--kind': {
        nodeKind = Object.values(nodeKinds).find((kind) => kind === value);
        if (nodeKind === undefined)
          return { kind: 'InvalidArguments', message: `Unknown node kind: ${value}` };
        break;
      }
      case '--direction': {
        if (value !== 'out' && value !== 'in' && value !== 'both')
          return { kind: 'InvalidArguments', message: `Invalid direction: ${value}` };
        direction = value;
        break;
      }
      case '--depth': {
        depth = Number(value);
        if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(depth) || depth <= 0) {
          return { kind: 'InvalidArguments', message: `Depth must be a positive safe integer: ${value}` };
        }
        break;
      }
    }
  }
  const expected = name === 'view' ? 1 : name === 'path' ? 3 : 2;
  if (positionals.length !== expected)
    return {
      kind: 'InvalidArguments',
      message: `${name} requires ${expected} positional argument${expected === 1 ? '' : 's'}; received ${positionals.length}.`,
    };
  const root = positionals[0]!;
  if (root.length === 0) return { kind: 'InvalidArguments', message: 'The design path must not be empty.' };
  const common: Common = { root, composition };
  switch (name) {
    case 'view':
      return { kind: 'Accepted', command: { ...common, kind: 'view', json } };
    case 'search':
      return { kind: 'Accepted', command: { ...common, kind: 'search', text: positionals[1]!, nodeKind } };
    case 'neighbors':
      return {
        kind: 'Accepted',
        command: { ...common, kind: 'neighbors', selector: positionals[1]!, direction, depth },
      };
    case 'path':
      return {
        kind: 'Accepted',
        command: { ...common, kind: 'path', from: positionals[1]!, to: positionals[2]! },
      };
  }
}

function queryFailure(error: QueryError): Output {
  return { kind: 'Failure', code: 1, text: JSON.stringify(error, null, 2) };
}

// Runtime imports stay behind argv parsing: invalid arguments must never open
// compiler dependencies; the bounded parser smoke also runs without sibling modules.
async function execute(command: Command): Promise<Output> {
  const { loadValidated } = await import('../../software-design/scripts/service.ts');
  const loaded = await loadValidated(command.root);
  if (loaded.kind === 'Rejected') {
    const code = loaded.diagnostics.some(
      (diagnostic) => diagnostic.code === 'CompilerUnavailable' || diagnostic.code === 'MissingDependency',
    )
      ? 2
      : 1;
    return { kind: 'Failure', code, text: JSON.stringify(loaded, null, 2) };
  }
  const validated = loaded.value;
  let context: GraphContext = { kind: 'Contracts' };
  if (command.composition !== undefined) {
    const { lookup } = await import('../../software-design/scripts/model.ts');
    const found = lookup(
      validated.design.elements.filter((element) => element.kind === 'Composition'),
      command.composition,
    );
    switch (found.kind) {
      case 'Missing':
        return queryFailure({ kind: 'Missing', selector: command.composition });
      case 'Ambiguous':
        return queryFailure({
          kind: 'Ambiguous',
          selector: command.composition,
          candidates: found.candidates,
        });
      case 'Found':
        context = { kind: 'Composition', composition: found.id };
        break;
    }
  }
  const { buildGraph } = await import('./project.ts');
  const graph = buildGraph(validated, context);
  switch (command.kind) {
    case 'view': {
      const { renderJson, renderMarkdown } = await import('./render.ts');
      return {
        kind: 'Success',
        text: command.json ? renderJson(graph, validated) : renderMarkdown(graph, validated),
      };
    }
    case 'search': {
      const { search } = await import('./engine.ts');
      return {
        kind: 'Success',
        text: JSON.stringify(
          {
            context: graph.context,
            nodes: search(graph, command.text, command.nodeKind),
            report: validated.report,
          },
          null,
          2,
        ),
      };
    }
    case 'neighbors': {
      const { neighbors } = await import('./engine.ts');
      const result = neighbors(graph, command.selector, command.direction, command.depth);
      if (result.kind !== 'Found') return queryFailure(result);
      return {
        kind: 'Success',
        text: JSON.stringify({ ...result.value, report: validated.report }, null, 2),
      };
    }
    case 'path': {
      const { shortestPath } = await import('./engine.ts');
      const result = shortestPath(graph, command.from, command.to);
      if (result.kind !== 'Found') return queryFailure(result);
      return {
        kind: 'Success',
        text: JSON.stringify({ ...result.value, report: validated.report }, null, 2),
      };
    }
  }
}

async function main(argv: readonly string[]): Promise<ExitCode> {
  const parsed = parseArguments(argv);
  if (parsed.kind === 'InvalidArguments') {
    process.stderr.write(`${parsed.message}\n\n${usage}\n`);
    return 2;
  }
  let output: Output;
  try {
    output = await execute(parsed.command);
  } catch (error: unknown) {
    output = {
      kind: 'Failure',
      code: 2,
      text: JSON.stringify(
        { kind: 'EnvironmentUnavailable', message: error instanceof Error ? error.message : String(error) },
        null,
        2,
      ),
    };
  }
  const text = output.text.endsWith('\n') ? output.text : `${output.text}\n`;
  if (output.kind === 'Failure') {
    process.stderr.write(text);
    return output.code;
  }
  process.stdout.write(text);
  return 0;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
