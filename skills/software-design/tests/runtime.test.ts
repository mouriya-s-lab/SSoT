import { afterAll, beforeAll, describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import {
  array,
  createWorkspace,
  outputJson,
  record,
  sameTree,
  snapshot,
  succeeds,
  type AcceptanceWorkspace,
  type JsonRecord,
} from './support.ts';

const SYSTEM = `import type { Apply, Carrier, Case, Choice, Event, Expose, Family, Module, Opaque, Op, Point, Sync, Tuple, TypeLambda, Value } from '../dsl/dsl.ts';
import type { Worker, RunFace } from './worker/run.ts';
export interface ListF extends TypeLambda { readonly type: readonly this['A'][] }
export type ListFamily = Family<'A public list constructor', ListF>;
export type SyncCarrier = Carrier<'Immediate acceptance and completion', 'sync', Sync, ['Return confirms the declared fact']>;
export type RunHandle = Opaque<'Identity of one run', 'acceptance.run'>;
export type RunBatch = Apply<'Outer run batch', ListFamily, Apply<'Inner run batch', ListFamily, Tuple<'Handle and label', [RunHandle, Value<'A batch label', string>]>>>;
export type Envelope = Choice<'A tagged request envelope', { ready: Case<'Ready to run', { case: Value<'Business case text', string>; kind: Value<'Business kind text', string> }> }>;
export type Clock = Point<'Read the shared clock', Op<'Read one timestamp', {}, Value<'A timestamp', number>>, [SyncCarrier]>;
export type StorePort = Point<'Persist run batches', Op<'Store a batch', { handle: RunHandle; batch: RunBatch }, Value<'Store accepted the batch', void>>, [SyncCarrier]>;
export type DormantPort = Point<'An unused contract has no provider requirement', Op<'No consumer yet', {}, Value<'No result', void>>, [SyncCarrier]>;
export type Work = Point<'Perform unrelated legal work', Op<'One work item', { request: Envelope }, Value<'Work completed', void>>, [SyncCarrier]>;
export type Tick = Event<'A clock tick was confirmed', System, RunHandle>;
export type System = Module<'Own the root contracts, clock and work', {
  core: [RunHandle, ListFamily, SyncCarrier, RunBatch, Envelope, Tick];
  ports: [Clock, StorePort, DormantPort, Work];
  provides: [Clock, Work]; requires: [StorePort];
  public: [RunHandle, Tick]; parts: [Worker];
  reexports: [Expose<'Expose the worker run contract', RunFace, Worker>];
}>;
`;
const WORKER = `import type { Duty, Face, Later, Lifecycle, Module, Next, Op, OpRef, Outcome, Returned, Value, Variant } from '../../dsl/dsl.ts';
import type { Clock, RunHandle, StorePort, SyncCarrier } from '../system.ts';
export type Started = Outcome<'Start returns a confirmed outcome', {
  Started: Variant<'A run has really started', { handle: RunHandle; case: Value<'Business case payload', string>; kind: Value<'Business kind payload', string> }, Later<'Finish after arbitrary legal intermediate work', [Duty<'Caller closes its run', 'caller', Returned<OpRef<RunFace, 'finish'>, 'done'>>]>>;
  Unknown: Variant<'The caller must resolve the uncertainty', {}, Next<'The same caller must query status next', [OpRef<RunFace, 'status'>]>>;
}>;
export type StatusResult = Outcome<'Status confirms whether the run exists', {
  Running: Variant<'The run is still open', { handle: RunHandle }, Later<'Caller must eventually finish', [Duty<'Close the observed run', 'caller', Returned<OpRef<RunFace, 'finish'>, 'done'>>]>>;
  Absent: Variant<'No run exists'>;
}>;
export type RunFace = Face<'Manage one run', 'All operations preserve run identity', {
  start: Op<'Start and confirm a run', { handle: RunHandle }, Started>;
  status: Op<'Resolve a start with unknown result', { handle: RunHandle }, StatusResult>;
  finish: Op<'Confirm the run has ended', { handle: RunHandle }, Value<'The run is closed', RunHandle>>;
}, [SyncCarrier], ['Finishing the same handle twice is idempotent']>;
export type RunLifecycle = Lifecycle<'A run from confirmed start to confirmed finish', {
  key: RunHandle; starts: Returned<OpRef<RunFace, 'start'>, 'Started'>; ends: Returned<OpRef<RunFace, 'finish'>, 'done'>;
}>;
export type Worker = Module<'Provide run operations and consume shared contracts', {
  core: [Started, StatusResult, RunLifecycle]; ports: [RunFace]; provides: [RunFace]; requires: [Clock, StorePort];
}>;
`;
const LAUNCH = `import type { Unit, Value } from '../../dsl/dsl.ts';
import type { Work } from '../../architecture/system.ts';
import type { RunFace } from '../../architecture/worker/run.ts';
export type Status = Value<'Launch-local status', string>;
export type Launch = Unit<'Start runs without choosing their implementation', { types: [Status]; plugsInto: [RunFace, Work] }>;
`;
const OBSERVE = `import type { Unit, Value } from '../../dsl/dsl.ts';
import type { Work } from '../../architecture/system.ts';
export type Status = Value<'Observer-local status', string>;
export type Observe = Unit<'Perform independent legal work', { types: [Status]; plugsInto: [Work] }>;
`;
const ASSEMBLY = `import type { Binding, Composition, External } from '../dsl/dsl.ts';
import type { Clock, StorePort, System } from '../architecture/system.ts';
import type { Worker } from '../architecture/worker/run.ts';
export type StoreOne = External<'The first declared store', { provides: [StorePort] }>;
export type StoreTwo = External<'The second declared store', { provides: [StorePort] }>;
export type Local = Composition<'Choose StoreOne locally, leave other roles open', [
  Binding<'System stores locally', System, StorePort, StoreOne>,
  Binding<'Worker stores locally', Worker, StorePort, StoreOne>,
]>;
export type Remote = Composition<'Choose StoreTwo remotely, leave other roles open', [
  Binding<'System stores remotely', System, StorePort, StoreTwo>,
  Binding<'Worker stores remotely', Worker, StorePort, StoreTwo>,
]>;
export type ClockBinding = Composition<'Worker uses its parent clock', [Binding<'Use the parent clock', Worker, Clock, System>]>;
`;
const SCENARIOS = `import type { Complete, EventStep, OpRef, Scenario, Step } from '../dsl/dsl.ts';
import type { Tick, Work } from '../architecture/system.ts';
import type { RunFace } from '../architecture/worker/run.ts';
import type { Launch } from '../business/launch/launch.ts';
import type { Observe } from '../business/observe/observe.ts';
import type { Local } from './assembly.ts';
export type LaunchLater = Scenario<'A Later obligation permits unrelated same-actor work', [
  Step<Launch, OpRef<RunFace, 'start'>, 'Started'>,
  Step<Launch, OpRef<Work>, 'done'>,
  Step<Launch, OpRef<RunFace, 'finish'>, 'done'>,
]>;
export type LaunchNext = Scenario<'Other actors and events do not consume the caller Next', [
  Step<Launch, OpRef<RunFace, 'start'>, 'Unknown'>,
  Step<Observe, OpRef<Work>, 'done'>,
  EventStep<Tick>,
  Step<Launch, OpRef<RunFace, 'status'>, 'Running'>,
  Step<Launch, OpRef<RunFace, 'finish'>, 'done'>,
]>;
export type ComposedLater = Scenario<'A partial composition does not bind unrelated run roles', [
  Step<Launch, OpRef<RunFace, 'start'>, 'Started'>,
  Step<Launch, OpRef<RunFace, 'finish'>, 'done'>,
], Complete, Local>;
`;
function readme(name: string, business = false): string {
  return `# ${name}\n\n${name} owns its declared responsibility; it does not select runtime implementations.\n\n## 依据\n\nThe acceptance domain needs explicit contracts and independently owned materials.\n\n${business ? '## 需求\n\nUsers can perform the declared operation without bypassing its contract.\n\n' : ''}## 为什么\n\nKeeping capabilities separate from selections preserves replaceability.\n\n## 语义\n\nDeclared return facts are confirmed by their stated participant.\n`;
}

let w: AcceptanceWorkspace;
let baselineCheck: JsonRecord;
async function check(): Promise<JsonRecord> {
  return w.readOnly(async () => outputJson(succeeds(await w.parent('check', w.design, '--json'))));
}
async function view(...args: string[]): Promise<JsonRecord> {
  return w.readOnly(async () => outputJson(succeeds(await w.graph('view', w.design, '--json', ...args))));
}
function nodes(graph: JsonRecord): readonly JsonRecord[] {
  return array(graph.nodes).map(record);
}
function edges(graph: JsonRecord): readonly JsonRecord[] {
  return array(graph.edges).map(record);
}
function node(graph: JsonRecord, name: string): JsonRecord {
  const found = nodes(graph).filter((item) => item.name === name);
  assert.equal(found.length, 1, `expected one graph node named ${name}`);
  return found[0]!;
}
function hasEdge(graph: JsonRecord, from: string, to: string, relation: string): boolean {
  return edges(graph).some((edge) => edge.from === from && edge.to === to && edge.relation === relation);
}
function roles(report: JsonRecord): readonly JsonRecord[] {
  return array(record(report.combination).roles).map(record);
}
function roleFor(graph: JsonRecord, consumer: string, connection: string): JsonRecord {
  const found = nodes(graph).filter((item) => {
    if (item.kind !== 'Role') return false;
    const details = record(item.details);
    return record(details.consumer).target === consumer && record(details.connection).target === connection;
  });
  assert.equal(found.length, 1, `missing/duplicate role ${consumer}/${connection}`);
  return found[0]!;
}
function assertLocation(diagnostic: JsonRecord): void {
  const at = record(diagnostic.at);
  assert.equal(typeof at.path, 'string');
  assert((at.path as string).length > 0 && !(at.path as string).startsWith('/'), JSON.stringify(at));
  assert(Number.isInteger(at.line) && Number(at.line) > 0, JSON.stringify(at));
  assert(Number.isInteger(at.column) && Number(at.column) > 0, JSON.stringify(at));
}
async function rejected(stage: string, codes: readonly string[], path?: string): Promise<void> {
  await w.readOnly(async () => {
    const result = await w.parent('check', w.design, '--json');
    assert.equal(result.exitCode, 1, JSON.stringify(result));
    assert.equal(result.stdout, '', 'rejected check must put diagnostics on stderr only');
    const failure = record(JSON.parse(result.stderr) as unknown);
    assert.equal(failure.kind, 'Rejected');
    const diagnostics = array(failure.diagnostics).map(record);
    assert(diagnostics.length > 0);
    assert(
      diagnostics.every((item) => item.stage === stage),
      JSON.stringify(diagnostics),
    );
    const relevant = diagnostics.filter((item) => codes.includes(String(item.code)));
    assert(relevant.length > 0, JSON.stringify(diagnostics));
    for (const diagnostic of diagnostics) assertLocation(diagnostic);
    if (path !== undefined)
      assert(
        relevant.some((item) => String(record(item.at).path).includes(path)),
        JSON.stringify(diagnostics),
      );
    const graph = await w.graph('view', w.design, '--json');
    assert.equal(graph.exitCode, 1, JSON.stringify(graph));
    assert.equal(graph.stdout, '', 'rejected graph must never emit a partial graph/JSON');
    const graphFailure = record(JSON.parse(graph.stderr) as unknown);
    assert.equal(graphFailure.kind, 'Rejected');
    const graphDiagnostics = array(graphFailure.diagnostics).map(record);
    assert(
      graphDiagnostics.every((item) => item.stage === stage),
      JSON.stringify(graphDiagnostics),
    );
    const graphRelevant = graphDiagnostics.filter((item) => codes.includes(String(item.code)));
    assert(graphRelevant.length > 0, JSON.stringify(graphFailure));
    for (const diagnostic of graphDiagnostics) assertLocation(diagnostic);
    if (path !== undefined)
      assert(
        graphRelevant.some((item) => String(record(item.at).path).includes(path)),
        JSON.stringify(graphDiagnostics),
      );
  });
}

beforeAll(async () => {
  w = createWorkspace();
  succeeds(await w.parent('init', w.repo));
  succeeds(await w.parent('module', w.design, 'worker'));
  succeeds(await w.parent('unit', w.design, 'launch'));
  succeeds(await w.parent('unit', w.design, 'observe'));
  w.write('architecture/system.ts', SYSTEM);
  w.write('architecture/worker/run.ts', WORKER);
  w.write('business/launch/launch.ts', LAUNCH);
  w.write('business/observe/observe.ts', OBSERVE);
  w.write('relations/assembly.ts', ASSEMBLY);
  w.write('relations/scenarios.ts', SCENARIOS);
  w.write(
    'architecture/README.md',
    `${readme('System')}\nRead [the time rules][time rules].\n\n[time rules]: time.md\n\n<!-- ## 需求 [not a link](missing.md) -->\n\n\`\`\`md\n## 需求\n[fake](missing.md)\n\`\`\`\n\nJSON and HTTP are ordinary text: \`JSON\` and \`HTTP\`.\n`,
  );
  w.write(
    'architecture/time.md',
    '# Time rules\n\nThis topic expands the System semantics section and explains confirmation time.\n\nA return confirms only the fact declared by its contract.\n',
  );
  w.write('architecture/worker/README.md', readme('Worker'));
  w.write('business/launch/README.md', readme('Launch', true));
  w.write('business/observe/README.md', readme('Observe', true));
  w.write(
    'relations/README.md',
    '# Relations\n\nThis directory names optional combinations and finite scenario walks, not extra domain rules.\n',
  );
  baselineCheck = await check();
}, 120_000);
afterAll(() => {
  if (w !== undefined) w.close();
});

describe('B: actual CLI input, ephemeral graphs and contextual queries', () => {
  test('five automatic stages and manual review remain distinct from runtime assembly', async () => {
    assert.equal(baselineCheck.kind, 'AutomaticallyChecked');
    assert.deepEqual(
      array(baselineCheck.evidence).map((item) => record(item).stage),
      ['source', 'typescript', 'resolve', 'relations', 'markdown'],
    );
    const review = record(baselineCheck.review);
    assert.equal(review.kind, 'ManualReviewRequired');
    const topics = array(review.items).map((item) => record(item).topic);
    for (const topic of [
      'grounds-and-rationale',
      'description-meaning',
      'connection-laws',
      'timing-and-concurrency',
      'lifecycle-responsibility',
      'requirements-and-scenario-coverage',
      'unbound-composition-choices',
    ])
      assert(topics.includes(topic), String(topic));
    const storeRoles = roles(baselineCheck).filter((item) =>
      String(record(item.connection).target).endsWith('#StorePort'),
    );
    assert.equal(storeRoles.length, 2);
    for (const role of storeRoles) {
      assert.equal(role.kind, 'Role');
      assert.deepEqual(
        array(role.candidates)
          .map((item) => record(item).target)
          .sort(),
        ['relations/assembly.ts#StoreOne', 'relations/assembly.ts#StoreTwo'],
      );
    }
    assert(
      !roles(baselineCheck).some((item) => String(record(item.connection).target).endsWith('#DormantPort')),
    );
  });
  test('default and selected compositions retain correct roles without leaking prior calls', async () => {
    const contracts = await view();
    assert.equal(record(contracts.context).kind, 'Contracts');
    const worker = String(node(contracts, 'Worker').id);
    const system = String(node(contracts, 'System').id);
    const store = String(node(contracts, 'StorePort').id);
    const one = String(node(contracts, 'StoreOne').id);
    const two = String(node(contracts, 'StoreTwo').id);
    for (const consumer of [worker, system]) {
      const role = roleFor(contracts, consumer, store);
      assert.equal(record(role.details).kind, 'Role');
      assert(hasEdge(contracts, String(role.id), one, 'candidate'));
      assert(hasEdge(contracts, String(role.id), two, 'candidate'));
      assert(!edges(contracts).some((edge) => edge.from === role.id && edge.relation === 'bound-to'));
    }
    for (const [composition, expected, forbidden] of [
      ['Local', one, two],
      ['Remote', two, one],
    ] as const) {
      const selected = await view('--composition', composition);
      assert.deepEqual(selected.context, {
        kind: 'Composition',
        composition: `relations/assembly.ts#${composition}`,
      });
      for (const consumer of [worker, system]) {
        const role = roleFor(selected, consumer, store);
        assert.equal(record(role.details).kind, 'Bound');
        assert(hasEdge(selected, String(role.id), expected, 'bound-to'));
        assert(!hasEdge(selected, String(role.id), forbidden, 'bound-to'));
      }
      const launch = String(node(selected, 'Launch').id);
      assert.equal(
        record(roleFor(selected, launch, String(node(selected, 'RunFace').id)).details).kind,
        'Role',
      );
    }
    assert.deepEqual(
      await view(),
      contracts,
      'a second call must rebuild Contracts rather than retain Remote',
    );
    const clockGraph = await view('--composition', 'ClockBinding');
    const clock = String(node(clockGraph, 'Clock').id);
    assert(hasEdge(clockGraph, system, clock, 'can-provide'));
    const clockRole = roleFor(clockGraph, worker, clock);
    assert(hasEdge(clockGraph, worker, String(clockRole.id), 'uses'));
    assert(hasEdge(clockGraph, String(clockRole.id), system, 'bound-to'));
  }, 120_000);
  test('all domain details and structural relations are graph-visible', async () => {
    const graph = await view();
    for (const kind of [
      'Operation',
      'Field',
      'Case',
      'Variant',
      'Duty',
      'Fact',
      'Step',
      'Application',
      'Expose',
      'Binding',
      'Role',
      'Lifecycle',
      'Family',
      'Carrier',
    ])
      assert(
        nodes(graph).some((item) => item.kind === kind),
        `missing ${kind}`,
      );
    for (const relation of [
      'owns',
      'can-provide',
      'uses',
      'contract',
      'candidate',
      'exposes',
      'forwarded-from',
      'part',
      'field',
      'parameter',
      'result',
      'case',
      'carrier',
      'applies',
      'type-argument',
      'reference',
      'next',
      'duty',
      'completes',
      'starts',
      'ends',
      'key',
      'confirms',
      'step',
      'takes',
      'composition',
      'binding',
    ])
      assert(
        edges(graph).some((item) => item.relation === relation),
        `missing ${relation}`,
      );
    assert(nodes(graph).some((item) => item.doc === 'Business case payload'));
    assert(nodes(graph).some((item) => item.doc === 'Business kind payload'));
    assert(nodes(graph).some((item) => item.doc === 'Outer run batch'));
    assert(nodes(graph).some((item) => item.doc === 'Inner run batch'));
    const text = JSON.stringify(graph);
    assert(text.includes('Finish after arbitrary legal intermediate work'));
    assert(text.includes('Return confirms the declared fact'));
    assert(text.includes('Same') || text.includes('same handle'));
    assert(!text.includes('TypeHandle') && !text.includes('"kind":"Type"'));
    assert.equal(record(record(graph.report).review).kind, 'ManualReviewRequired');
  });
  test('search, neighbors, paths, NoPath and selector failures use the actual CLI', async () => {
    await w.readOnly(async () => {
      const search = outputJson(succeeds(await w.graph('search', w.design, 'Store')));
      for (const name of ['StoreOne', 'StoreTwo', 'StorePort'])
        assert(nodes(search).some((item) => item.name === name));
      assert.equal(record(node(search, 'StoreOne').at).path, 'relations/assembly.ts');
      const insensitive = outputJson(
        succeeds(await w.graph('search', w.design, 'sToRe', '--kind', 'External')),
      );
      assert.deepEqual(
        nodes(insensitive)
          .map((item) => item.name)
          .sort(),
        ['StoreOne', 'StoreTwo'],
      );
      const near = outputJson(succeeds(await w.graph('neighbors', w.design, 'Worker', '--depth', '2')));
      for (const name of ['Worker', 'Clock', 'StorePort', 'RunFace', 'StoreOne', 'StoreTwo'])
        assert(
          nodes(near).some((item) => item.name === name),
          `missing two-hop neighbor ${name}`,
        );
      const nearIds = new Set(nodes(near).map((item) => item.id));
      for (const edge of edges(near))
        assert(nearIds.has(edge.from) && nearIds.has(edge.to), JSON.stringify(edge));
      const incoming = outputJson(
        succeeds(await w.graph('neighbors', w.design, 'Clock', '--direction', 'in', '--depth', '1')),
      );
      assert(nodes(incoming).some((item) => item.name === 'System'));
      assert(
        !nodes(incoming).some((item) => item.kind === 'Operation'),
        'in-only depth-one query must not expand Clock operation children',
      );
      const both = outputJson(
        succeeds(await w.graph('neighbors', w.design, 'Worker', '--direction', 'both', '--depth', '2')),
      );
      assert(nodes(both).some((item) => item.name === 'System'));
      const path = outputJson(
        succeeds(await w.graph('path', w.design, 'Worker', 'StoreOne', '--composition', 'Local')),
      );
      assert.equal(path.kind, 'StructuralPath');
      assert.deepEqual(path.context, { kind: 'Composition', composition: 'relations/assembly.ts#Local' });
      assert.deepEqual(
        edges(path).map((item) => item.relation),
        ['uses', 'bound-to'],
      );
      assert.equal(edges(path)[0]!.from, 'architecture/worker/run.ts#Worker');
      assert.equal(edges(path).at(-1)!.to, 'relations/assembly.ts#StoreOne');
      assert.deepEqual(
        array(path.roles).map((item) => record(item).kind),
        ['Bound'],
      );
      const noPath = outputJson(succeeds(await w.graph('path', w.design, 'DormantPort', 'StoreOne')));
      assert.equal(noPath.kind, 'NoPath');
      assert.deepEqual(noPath.context, { kind: 'Contracts' });
      for (const args of [
        ['neighbors', w.design, 'NotDeclared'],
        ['neighbors', w.design, 'Status'],
        ['path', w.design, 'Status', 'StoreOne'],
        ['view', w.design, '--composition', 'NotDeclared'],
      ]) {
        const result = await w.graph(...args);
        assert.equal(result.exitCode, 1, JSON.stringify(result));
        assert.equal(result.stdout, '');
        const error = record(JSON.parse(result.stderr) as unknown);
        if (args.includes('Status')) {
          assert.equal(error.kind, 'Ambiguous');
          assert.deepEqual(array(error.candidates).slice().sort(), [
            'business/launch/launch.ts#Status',
            'business/observe/observe.ts#Status',
          ]);
        } else assert.equal(error.kind, 'Missing');
      }
      succeeds(await w.graph('neighbors', w.design, 'business/launch/launch.ts#Status'));
      const markdown = succeeds(await w.graph('view', w.design));
      for (const text of [
        '```mermaid',
        'System',
        'Worker',
        'Clock',
        'RunLifecycle',
        'finish',
        'handle',
        'Later',
        'Next',
        'StoreOne',
        'StoreTwo',
      ])
        assert(markdown.stdout.includes(text), `Markdown missing ${text}`);
      assert(/Role|角色|未绑定/.test(markdown.stdout));
      assert(/ManualReviewRequired|人工/.test(markdown.stdout));
      assert(/can-provide|提供/.test(markdown.stdout));
      for (const depth of ['0', '-1', '1.5', 'not-a-number']) {
        const result = await w.graph('neighbors', '/does/not/exist', 'Worker', '--depth', depth);
        assert.equal(result.exitCode, 2, JSON.stringify(result));
        assert.equal(result.stdout, '');
        assert(
          !result.stderr.includes('CompilerUnavailable'),
          'invalid argv must be rejected before compiler opens',
        );
      }
    });
  }, 180_000);
  test('source edits are visible on the very next graph without persisted graph/index/build files', async () => {
    await w.isolated(async () => {
      const before = await view();
      w.replace('architecture/system.ts', 'Read the shared clock', 'Read the freshly edited clock');
      const after = await view();
      assert.notEqual(node(before, 'Clock').doc, node(after, 'Clock').doc);
      assert.equal(node(after, 'Clock').doc, 'Read the freshly edited clock');
      w.replace(
        'relations/assembly.ts',
        "Binding<'System stores locally', System, StorePort, StoreOne>",
        "Binding<'System stores locally', System, StorePort, StoreTwo>",
      );
      const rebound = await view('--composition', 'Local');
      const role = roleFor(
        rebound,
        String(node(rebound, 'System').id),
        String(node(rebound, 'StorePort').id),
      );
      assert.equal(record(record(role.details).provider).target, node(rebound, 'StoreTwo').id);
    });
  }, 120_000);
});

type RejectionCase = {
  readonly name: string;
  readonly stage: string;
  readonly codes: readonly string[];
  readonly path?: string;
  readonly mutate: () => void;
};
const rejectionCases: readonly RejectionCase[] = [
  {
    name: 'syntax errors are TypeScript failures',
    stage: 'typescript',
    codes: ['CompilerDiagnostic'],
    path: 'broken.ts',
    mutate: () => w.write('architecture/broken.ts', 'export type Broken =\n'),
  },
  {
    name: 'direct unknown specification keys are rejected',
    stage: 'typescript',
    codes: ['CompilerDiagnostic'],
    path: 'broken.ts',
    mutate: () =>
      w.write(
        'architecture/broken.ts',
        "import type { Module } from '../dsl/dsl.ts';\nexport type Broken = Module<'Bad spelling', { requirs: [] }>;\n",
      ),
  },
  {
    name: 'unknown keys supplied through an alias are rejected',
    stage: 'typescript',
    codes: ['CompilerDiagnostic'],
    path: 'broken.ts',
    mutate: () =>
      w.write(
        'architecture/broken.ts',
        "import type { Module } from '../dsl/dsl.ts';\ntype Misspelled = { requirs: [] };\nexport type Broken = Module<'Bad alias spelling', Misspelled>;\n",
      ),
  },
  {
    name: 'empty explanations fail resolution rather than disappearing',
    stage: 'resolve',
    codes: ['EmptyDescription'],
    path: 'system.ts',
    mutate: () => w.replace('architecture/system.ts', "Point<'Read the shared clock'", "Point<''"),
  },
  {
    name: 'duplicate local bindings do not choose the first provider',
    stage: 'relations',
    codes: ['InvalidBinding'],
    path: 'assembly.ts',
    mutate: () =>
      w.replace(
        'relations/assembly.ts',
        "Binding<'System stores locally', System, StorePort, StoreOne>,",
        "Binding<'System stores locally', System, StorePort, StoreOne>,\n  Binding<'Duplicate System store', System, StorePort, StoreTwo>,",
      ),
  },
  {
    name: 'a same-actor Next violation is not confused with other-actor interleaving',
    stage: 'relations',
    codes: ['InvalidScenario'],
    path: 'scenarios.ts',
    mutate: () =>
      w.replace(
        'relations/scenarios.ts',
        "Step<Observe, OpRef<Work>, 'done'>",
        "Step<Launch, OpRef<Work>, 'done'>",
      ),
  },
  {
    name: 'Complete cannot drop a Later obligation',
    stage: 'relations',
    codes: ['UnfulfilledDuty'],
    path: 'scenarios.ts',
    mutate: () =>
      w.replace(
        'relations/scenarios.ts',
        "  Step<Launch, OpRef<Work>, 'done'>,\n  Step<Launch, OpRef<RunFace, 'finish'>, 'done'>,",
        "  Step<Launch, OpRef<Work>, 'done'>,",
      ),
  },
  {
    name: 'invalid operation branches fail at the compiler boundary',
    stage: 'typescript',
    codes: ['CompilerDiagnostic'],
    path: 'scenarios.ts',
    mutate: () =>
      w.replace(
        'relations/scenarios.ts',
        "Step<Launch, OpRef<RunFace, 'start'>, 'Unknown'>",
        "Step<Launch, OpRef<RunFace, 'start'>, 'NotABranch'>",
      ),
  },
  {
    name: 'empty Interrupted is not a valid scenario',
    stage: 'typescript',
    codes: ['CompilerDiagnostic'],
    path: 'broken.ts',
    mutate: () =>
      w.write(
        'relations/broken.ts',
        "import type { Interrupted, Scenario } from '../dsl/dsl.ts';\nimport type { StoreOne } from './assembly.ts';\nexport type Broken = Scenario<'No interruption fact', [], Interrupted<'Handoff without a fact', StoreOne>>;\n",
      ),
  },
  {
    name: 'missing lifecycle key references are rejected on the actual facts',
    stage: 'relations',
    codes: ['InvalidLifecycle'],
    path: 'run.ts',
    mutate: () => {
      w.write(
        'architecture/worker/key.ts',
        "import type { Opaque } from '../../dsl/dsl.ts';\nexport type UnrelatedKey = Opaque<'A different identity', 'acceptance.unrelated'>;\n",
      );
      w.write(
        'architecture/worker/run.ts',
        "import type { UnrelatedKey } from './key.ts';\n" +
          WORKER.replace('key: RunHandle;', 'key: UnrelatedKey;').replace(
            'core: [Started, StatusResult, RunLifecycle]',
            'core: [Started, StatusResult, RunLifecycle, UnrelatedKey]',
          ),
      );
    },
  },
  {
    name: 'lifecycle within cycles are not runtime simulations',
    stage: 'relations',
    codes: ['InvalidLifecycle'],
    path: 'run.ts',
    mutate: () =>
      w.replace(
        'architecture/worker/run.ts',
        "ends: Returned<OpRef<RunFace, 'finish'>, 'done'>;",
        "ends: Returned<OpRef<RunFace, 'finish'>, 'done'>; within: RunLifecycle;",
      ),
  },
  {
    name: 'README without responsibility introduction is rejected',
    stage: 'markdown',
    codes: ['InvalidMarkdown'],
    path: 'README.md',
    mutate: () =>
      w.write('architecture/worker/README.md', '# Worker\n\n## 语义\n\nThe run is confirmed on return.\n'),
  },
  {
    name: 'a code-span fake topic link is not a real link',
    stage: 'markdown',
    codes: ['InvalidMarkdown'],
    path: 'time.md',
    mutate: () =>
      w.replace('architecture/README.md', '[the time rules][time rules]', '`[the time rules][time rules]`'),
  },
  {
    name: 'an explicit missing symbol id is rejected',
    stage: 'markdown',
    codes: ['InvalidMarkdown'],
    path: 'README.md',
    mutate: () =>
      w.write(
        'architecture/worker/README.md',
        readme('Worker') + '\nThe declared reference is `architecture/worker/run.ts#Missing`.\n',
      ),
  },
  {
    name: 'recognized member names are not treated as file extensions',
    stage: 'markdown',
    codes: ['InvalidMarkdown'],
    path: 'README.md',
    mutate: () =>
      w.write(
        'architecture/worker/README.md',
        readme('Worker') + '\nThe declared member is `RunFace.json`.\n',
      ),
  },
  {
    name: 'a symlink to a micro sibling is rejected before compiler opens',
    stage: 'source',
    codes: ['UnsafeInput'],
    path: 'linked',
    mutate: () => {
      const sibling = join(w.root, 'owned-sibling');
      mkdirSync(sibling);
      symlinkSync(sibling, join(w.design, 'architecture/linked'));
    },
  },
];
describe('C: every rejecting real input fails at its authoritative stage without partial graph', () => {
  for (const scenario of rejectionCases)
    test(
      scenario.name,
      async () => {
        await w.isolated(async () => {
          scenario.mutate();
          await rejected(scenario.stage, scenario.codes, scenario.path);
        });
      },
      120_000,
    );

  test('deleting only one Binding leaves that consumer Role and preserves all other selections', async () => {
    await w.isolated(async () => {
      w.replace(
        'relations/assembly.ts',
        "  Binding<'System stores locally', System, StorePort, StoreOne>,\n",
        '',
      );
      await check();
      const graph = await view('--composition', 'Local');
      const store = String(node(graph, 'StorePort').id);
      assert.equal(record(roleFor(graph, String(node(graph, 'System').id), store).details).kind, 'Role');
      assert.equal(record(roleFor(graph, String(node(graph, 'Worker').id), store).details).kind, 'Bound');
    });
  }, 120_000);

  test('a nonempty Interrupted preserves handoff and pending obligations rather than claiming completion', async () => {
    await w.isolated(async () => {
      w.write(
        'relations/interrupted.ts',
        `import type { Interrupted, OpRef, Scenario, Step } from '../dsl/dsl.ts';
import type { Launch } from '../business/launch/launch.ts';
import type { RunFace } from '../architecture/worker/run.ts';
import type { StoreOne } from './assembly.ts';
export type Stopped = Scenario<'The run was interrupted after confirmed start', [Step<Launch, OpRef<RunFace, 'start'>, 'Started'>], Interrupted<'StoreOne takes responsibility for the unfinished run', StoreOne>>;
export type StoppedNext = Scenario<'Interruption preserves the original caller next constraint', [Step<Launch, OpRef<RunFace, 'start'>, 'Unknown'>], Interrupted<'StoreOne receives the pending next responsibility', StoreOne>>;
`,
      );
      await check();
      const graph = await view();
      assert(
        nodes(graph).some(
          (item) => item.kind === 'Completion' && record(item.details).kind === 'Interrupted',
        ),
      );
      assert(
        edges(graph).some(
          (item) => item.relation === 'handoff' && item.to === 'relations/assembly.ts#StoreOne',
        ),
      );
      const markdown = await w.readOnly(async () => succeeds(await w.graph('view', w.design)));
      assert(/unmatched|unfulfilled|未匹配义务|未履行|未完成/i.test(markdown.stdout), markdown.stdout);
      assert(
        markdown.stdout.includes('StoppedNext') && markdown.stdout.includes('from step 0'),
        markdown.stdout,
      );
    });
  }, 120_000);

  test('resolver accepts generic results through direct and barrel re-exports without duplicate ownership', async () => {
    await w.isolated(async () => {
      w.write(
        'architecture/generic.ts',
        `import type { Apply, Data, Struct, Value } from '../dsl/dsl.ts';
import type { ListFamily } from './system.ts';
export type Keyed<T extends Data> = Struct<'A keyed described value', { key: Value<'Request identity', string>; values: Apply<'Values by request', ListFamily, T> }>;
`,
      );
      w.write('architecture/barrel.ts', "export type { Keyed } from './generic.ts';\n");
      w.write(
        'architecture/system.ts',
        "import type { Keyed } from './barrel.ts';\n" +
          SYSTEM.replace("Value<'A timestamp', number>", "Keyed<Value<'Timestamp payload', number>>"),
      );
      await check();
      const graph = await view();
      assert(nodes(graph).some((item) => item.name === 'Keyed' && item.kind === 'Auxiliary'));
      assert(nodes(graph).some((item) => item.kind === 'Application'));
      w.replace('architecture/system.ts', "from './barrel.ts'", "from './generic.ts'");
      await check();
      await view();
    });
  }, 120_000);
});

describe('C: visibility, provider eligibility and lifecycle controls', () => {
  test('Binding cannot claim a capability absent from the declared provider', async () => {
    await w.isolated(async () => {
      w.write(
        'relations/invalid-binding.ts',
        `import type { Binding, Composition, External } from '../dsl/dsl.ts';
import type { StorePort, System } from '../architecture/system.ts';
import type { StoreOne } from './assembly.ts';
export type NoStore = External<'Does not provide StorePort', {}>;
type ForgedBinding = Omit<Binding<'A structurally described binding', System, StorePort, StoreOne>, 'provider'> & { readonly provider: NoStore };
export type Invalid = Composition<'A widened descriptor cannot bypass provider validation', [ForgedBinding]>;
`,
      );
      await rejected('relations', ['InvalidBinding'], 'invalid-binding.ts');
    });
  }, 120_000);
  test('a declared but hidden provider is not interchangeable with an exposed provider', async () => {
    await w.isolated(async () => {
      succeeds(await w.parent('module', w.design, 'worker/engine'));
      w.write('architecture/worker/engine/README.md', readme('Engine'));
      w.write(
        'architecture/worker/engine/engine.ts',
        `import type { Module } from '../../../dsl/dsl.ts';
import type { Clock } from '../../system.ts';
export type Engine = Module<'A hidden nested clock capability', { provides: [Clock] }>;
`,
      );
      w.write(
        'architecture/worker/run.ts',
        "import type { Engine } from './engine/engine.ts';\n" +
          WORKER.replace('requires: [Clock, StorePort];', 'requires: [Clock, StorePort]; parts: [Engine];'),
      );
      w.replace('business/launch/launch.ts', 'import type { Work }', 'import type { Clock, Work }');
      w.replace(
        'business/launch/launch.ts',
        'plugsInto: [RunFace, Work]',
        'plugsInto: [RunFace, Work, Clock]',
      );
      await check();
      w.write(
        'relations/hidden-binding.ts',
        `import type { Binding, Composition } from '../dsl/dsl.ts';
import type { Clock } from '../architecture/system.ts';
import type { Engine } from '../architecture/worker/engine/engine.ts';
import type { Launch } from '../business/launch/launch.ts';
export type Hidden = Composition<'The nested capability has no outward path', [Binding<'Do not bypass Worker', Launch, Clock, Engine>]>;
`,
      );
      await rejected('relations', ['PrivateReference'], 'hidden-binding.ts');
    });
  }, 180_000);
  test('local auxiliary interfaces cannot launder another Unit private data; public contract exposure is the control', async () => {
    await w.isolated(async () => {
      w.write(
        'business/observe/observe.ts',
        `import type { Op, Point, Struct, Unit, Value } from '../../dsl/dsl.ts';
import type { SyncCarrier, Work } from '../../architecture/system.ts';
export type Status = Value<'Observer-local status', string>;
export type PrivateData = Struct<'Producer-owned private material', { value: Value<'Private value', string> }>;
export type DataPort = Point<'Publish material only through this contract', Op<'Read producer data', {}, PrivateData>, [SyncCarrier]>;
export type Observe = Unit<'Producer and observer', { types: [Status, PrivateData]; ports: [DataPort]; provides: [DataPort]; plugsInto: [Work] }>;
`,
      );
      w.write(
        'business/launch/capture.ts',
        `import type { Struct, Value } from '../../dsl/dsl.ts';
import type { PrivateData } from '../observe/observe.ts';
interface HiddenCapture extends Struct<'An auxiliary interface captures private material', { secret: PrivateData }> {}
export type Captured = Value<'Wrapped captured material', HiddenCapture>;
`,
      );
      w.replace('business/launch/launch.ts', 'types: [Status]', 'types: [Status, Captured]');
      w.write(
        'business/launch/launch.ts',
        "import type { Captured } from './capture.ts';\n" + w.read('business/launch/launch.ts'),
      );
      await rejected('relations', ['PrivateReference'], 'capture.ts');
      w.write(
        'business/launch/launch.ts',
        "import type { Captured } from './capture.ts';\nimport type { DataPort } from '../observe/observe.ts';\n" +
          LAUNCH.replace('types: [Status]', 'types: [Status, Captured]').replace(
            'plugsInto: [RunFace, Work]',
            'plugsInto: [RunFace, Work, DataPort]',
          ),
      );
      await check();
      await view();
    });
  }, 180_000);
  test('public Event carries its local data closure but not its confirmer private spec', async () => {
    await w.isolated(async () => {
      w.write(
        'architecture/system.ts',
        SYSTEM.replace(
          "export type Tick = Event<'A clock tick was confirmed', System, RunHandle>;",
          "export type EventKey = Opaque<'Private event payload identity', 'acceptance.event-key'>;\nexport type Tick = Event<'A clock tick was confirmed', System, EventKey>;",
        ).replace('Envelope, Tick]', 'Envelope, Tick, EventKey]'),
      );
      w.write(
        'business/launch/event-key.ts',
        `import type { Value } from '../../dsl/dsl.ts';
import type { EventKey } from '../../architecture/system.ts';
export type SeenEvent = Value<'A public event payload can be named', EventKey>;
`,
      );
      w.write(
        'business/launch/launch.ts',
        "import type { SeenEvent } from './event-key.ts';\n" +
          LAUNCH.replace('types: [Status]', 'types: [Status, SeenEvent]'),
      );
      await check();
      const graph = await view();
      assert(hasEdge(graph, String(node(graph, 'Tick').id), String(node(graph, 'System').id), 'confirms'));
      w.write(
        'business/launch/event-key.ts',
        `import type { Value } from '../../dsl/dsl.ts';
import type { RunBatch } from '../../architecture/system.ts';
export type SeenEvent = Value<'Participant identity must not disclose unrelated private core', RunBatch>;
`,
      );
      await rejected('relations', ['PrivateReference'], 'event-key.ts');
    });
  }, 180_000);
  test('public Lifecycle cannot publish a private Returned anchor; independent contract publication fixes it', async () => {
    await w.isolated(async () => {
      const extra = `\nexport type SecretFace = Face<'Private lifecycle anchors', 'One handle', {
  open: Op<'Open the secret lifecycle', { handle: RunHandle }, Value<'Opened handle', RunHandle>>;
  close: Op<'Close the secret lifecycle', { handle: RunHandle }, Value<'Closed handle', RunHandle>>;
}, [SyncCarrier]>;
export type SecretLife = Lifecycle<'Public lifecycle does not itself publish anchors', { key: RunHandle; starts: Returned<OpRef<SecretFace, 'open'>, 'done'>; ends: Returned<OpRef<SecretFace, 'close'>, 'done'> }>;
`;
      w.write(
        'architecture/system.ts',
        "import type { Face, Lifecycle, OpRef, Returned } from '../dsl/dsl.ts';\n" +
          SYSTEM.replace('Envelope, Tick]', 'Envelope, Tick, SecretLife]')
            .replace('DormantPort, Work]', 'DormantPort, Work, SecretFace]')
            .replace('public: [RunHandle, Tick]', 'public: [RunHandle, Tick, SecretLife]') +
          extra,
      );
      await rejected('relations', ['PrivateReference'], 'system.ts');
      w.replace('architecture/system.ts', 'provides: [Clock, Work]', 'provides: [Clock, Work, SecretFace]');
      await check();
      await view();
    });
  }, 180_000);
  test('public Lifecycle cannot launder private within; independently public nesting fixes it', async () => {
    await w.isolated(async () => {
      const extra = `\nexport type ParentLife = Lifecycle<'Private parent lifecycle', { key: RunHandle; starts: Returned<OpRef<RunFace, 'start'>, 'Started'>; ends: Returned<OpRef<RunFace, 'finish'>, 'done'> }>;
`;
      w.write(
        'architecture/worker/run.ts',
        WORKER.replace(
          'core: [Started, StatusResult, RunLifecycle]',
          'core: [Started, StatusResult, RunLifecycle, ParentLife]',
        )
          .replace('ports: [RunFace];', 'ports: [RunFace]; public: [RunLifecycle];')
          .replace(
            "ends: Returned<OpRef<RunFace, 'finish'>, 'done'>;",
            "ends: Returned<OpRef<RunFace, 'finish'>, 'done'>; within: ParentLife;",
          ) + extra,
      );
      await rejected('relations', ['PrivateReference'], 'run.ts');
      w.replace('architecture/worker/run.ts', 'public: [RunLifecycle]', 'public: [RunLifecycle, ParentLife]');
      await check();
      const graph = await view();
      assert(
        hasEdge(
          graph,
          String(node(graph, 'RunLifecycle').id),
          String(node(graph, 'ParentLife').id),
          'within',
        ),
      );
    });
  }, 180_000);
  test('wide Fact bounds cannot bypass lifecycle branch validation', async () => {
    await w.isolated(async () => {
      w.write(
        'architecture/worker/run.ts',
        WORKER.replace("starts: Returned<OpRef<RunFace, 'start'>, 'Started'>", 'starts: WidenedFact') +
          "\ntype WidenedFact = Omit<Returned<OpRef<RunFace, 'start'>, 'Started'>, 'branch'> & { readonly branch: 'MissingBranch' };\n",
      );
      await rejected('relations', ['InvalidLifecycle'], 'run.ts');
    });
  }, 120_000);
});

function seedMatching(): void {
  w.write(
    'architecture/matching.ts',
    `import type { Duty, Face, Later, Op, OpRef, Outcome, Returned, Value, Variant } from '../dsl/dsl.ts';
import type { SyncCarrier } from './system.ts';
export type MatchingPort = Face<'Provider obligations require maximum matching', 'Each completion satisfies at most one created duty', {
  open: Op<'Create a provider duty', {}, Outcome<'Provider must complete later', { Opened: Variant<'One obligation is created', {}, Later<'The selected or eligible provider completes', [Duty<'Provider finishes one occurrence', 'provider', Returned<OpRef<MatchingPort, 'finish'>, 'done'>>]>> }>>;
  finish: Op<'One independent completion fact', {}, Value<'Completion was confirmed', void>>;
}, [SyncCarrier]>;
export type ZeroPort = Face<'No participant declares this capability', 'Missing candidates are not invented', {
  open: Op<'Create an obligation with no eligible provider', {}, Outcome<'Provider duty remains pending', { Opened: Variant<'An obligation is outstanding', {}, Later<'A real provider would have to complete', [Duty<'No invented provider may finish this', 'provider', Returned<OpRef<ZeroPort, 'finish'>, 'done'>>]>> }>>;
  finish: Op<'A caller cannot impersonate a missing provider', {}, Value<'A declared call completion', void>>;
}, [SyncCarrier]>;
`,
  );
  w.write(
    'architecture/system.ts',
    "import type { MatchingPort, ZeroPort } from './matching.ts';\n" +
      SYSTEM.replace('DormantPort, Work]', 'DormantPort, Work, MatchingPort, ZeroPort]').replace(
        'requires: [StorePort]',
        'requires: [StorePort, MatchingPort, ZeroPort]',
      ),
  );
  w.write(
    'business/launch/launch.ts',
    "import type { MatchingPort, ZeroPort } from '../../architecture/matching.ts';\n" +
      LAUNCH.replace('plugsInto: [RunFace, Work]', 'plugsInto: [RunFace, Work, MatchingPort, ZeroPort]'),
  );
  w.write(
    'business/observe/observe.ts',
    "import type { MatchingPort } from '../../architecture/matching.ts';\n" +
      OBSERVE.replace('plugsInto: [Work]', 'plugsInto: [Work, MatchingPort]'),
  );
  w.write(
    'relations/matching.ts',
    `import type { Binding, Composition, External } from '../dsl/dsl.ts';
import type { MatchingPort } from '../architecture/matching.ts';
import type { Observe } from '../business/observe/observe.ts';
export type ProviderA = External<'Provider A can also perform completion calls', { provides: [MatchingPort]; uses: [MatchingPort] }>;
export type ProviderB = External<'Provider B can also perform completion calls', { provides: [MatchingPort]; uses: [MatchingPort] }>;
export type MatchAssembly = Composition<'Only Observe is bound; Launch retains candidates A and B', [Binding<'Observe chooses A', Observe, MatchingPort, ProviderA>]>;
`,
  );
}
const MATCH_IMPORTS = `import type { Complete, Interrupted, OpRef, Scenario, Step } from '../dsl/dsl.ts';
import type { MatchingPort, ZeroPort } from '../architecture/matching.ts';
import type { Launch } from '../business/launch/launch.ts';
import type { Observe } from '../business/observe/observe.ts';
import type { MatchAssembly, ProviderA, ProviderB } from './matching.ts';
`;
describe('C: occurrence matching, empty roles and carrier identity', () => {
  test('Role A/B followed by Bound A is fulfilled by A then B using augmenting paths', async () => {
    await w.isolated(async () => {
      seedMatching();
      w.write(
        'relations/matching-scenario.ts',
        MATCH_IMPORTS +
          `export type MaximumMatching = Scenario<'Greedy A consumption would incorrectly reject this path', [
  Step<Launch, OpRef<MatchingPort, 'open'>, 'Opened'>,
  Step<Observe, OpRef<MatchingPort, 'open'>, 'Opened'>,
  Step<ProviderA, OpRef<MatchingPort, 'finish'>, 'done'>,
  Step<ProviderB, OpRef<MatchingPort, 'finish'>, 'done'>,
], Complete, MatchAssembly>;
`,
      );
      const report = await check();
      const launchRole = roles(report).find(
        (item) =>
          record(item.consumer).target === 'business/launch/launch.ts#Launch' &&
          record(item.connection).target === 'architecture/matching.ts#MatchingPort',
      );
      assert(launchRole);
      assert.equal(launchRole.kind, 'Role');
      assert.deepEqual(
        array(launchRole.candidates)
          .map((item) => record(item).target)
          .sort(),
        ['relations/matching.ts#ProviderA', 'relations/matching.ts#ProviderB'],
      );
      const graph = await view('--composition', 'MatchAssembly');
      const port = String(node(graph, 'MatchingPort').id);
      assert.equal(record(roleFor(graph, String(node(graph, 'Launch').id), port).details).kind, 'Role');
      assert.equal(record(roleFor(graph, String(node(graph, 'Observe').id), port).details).kind, 'Bound');
      const markdown = await w.readOnly(async () =>
        succeeds(await w.graph('view', w.design, '--composition', 'MatchAssembly')),
      );
      assert(markdown.stdout.includes('RoleWitness'), markdown.stdout);
      assert(markdown.stdout.includes('SelectedBinding'), markdown.stdout);
    });
  }, 180_000);
  test('two equal duty occurrences need two distinct strictly subsequent completion steps', async () => {
    await w.isolated(async () => {
      seedMatching();
      const oneCompletion =
        MATCH_IMPORTS +
        `export type Occurrences = Scenario<'Two obligations are independent occurrences', [
  Step<Launch, OpRef<MatchingPort, 'open'>, 'Opened'>,
  Step<Launch, OpRef<MatchingPort, 'open'>, 'Opened'>,
  Step<ProviderA, OpRef<MatchingPort, 'finish'>, 'done'>,
]>;
`;
      w.write('relations/matching-scenario.ts', oneCompletion);
      await rejected('relations', ['UnfulfilledDuty'], 'matching-scenario.ts');
      w.write(
        'relations/matching-scenario.ts',
        oneCompletion.replace(
          "  Step<ProviderA, OpRef<MatchingPort, 'finish'>, 'done'>,",
          "  Step<ProviderA, OpRef<MatchingPort, 'finish'>, 'done'>,\n  Step<ProviderB, OpRef<MatchingPort, 'finish'>, 'done'>,",
        ),
      );
      await check();
      await view();
      w.write(
        'relations/matching-scenario.ts',
        MATCH_IMPORTS +
          `export type NotEarlier = Scenario<'An earlier completion never covers a later obligation', [
  Step<ProviderA, OpRef<MatchingPort, 'finish'>, 'done'>,
  Step<Launch, OpRef<MatchingPort, 'open'>, 'Opened'>,
]>;
`,
      );
      await rejected('relations', ['UnfulfilledDuty'], 'matching-scenario.ts');
    });
  }, 240_000);
  test('zero provider candidates fail Complete but Interrupted retains the duty and handoff', async () => {
    await w.isolated(async () => {
      seedMatching();
      const scenario =
        MATCH_IMPORTS +
        `export type NoProvider = Scenario<'The caller cannot satisfy a provider duty itself', [
  Step<Launch, OpRef<ZeroPort, 'open'>, 'Opened'>,
  Step<Launch, OpRef<ZeroPort, 'finish'>, 'done'>,
]>;
`;
      w.write('relations/matching-scenario.ts', scenario);
      await rejected('relations', ['UnfulfilledDuty'], 'matching-scenario.ts');
      w.write(
        'relations/matching-scenario.ts',
        scenario.replace(
          ']>;',
          "], Interrupted<'ProviderA accepts responsibility without fabricating prior completion', ProviderA>>;",
        ),
      );
      const report = await check();
      const zero = roles(report).filter(
        (item) => record(item.connection).target === 'architecture/matching.ts#ZeroPort',
      );
      assert(zero.length > 0);
      for (const role of zero) {
        assert.equal(role.kind, 'Role');
        assert.deepEqual(role.candidates, []);
      }
      const graph = await view();
      const launchRole = roleFor(graph, String(node(graph, 'Launch').id), String(node(graph, 'ZeroPort').id));
      assert(
        !edges(graph).some(
          (item) =>
            item.from === launchRole.id && (item.relation === 'candidate' || item.relation === 'bound-to'),
        ),
      );
      const markdown = await w.readOnly(async () => succeeds(await w.graph('view', w.design)));
      assert(/unmatched|unfulfilled|未匹配义务|未履行|未完成/i.test(markdown.stdout), markdown.stdout);
      assert(markdown.stdout.includes('ProviderA'));
    });
  }, 180_000);
  test('carrier keys are unique within one connection, not globally; inline ids ignore description and order', async () => {
    await w.isolated(async () => {
      w.replace(
        'architecture/system.ts',
        "Value<'A timestamp', number>>, [SyncCarrier]>",
        "Value<'A timestamp', number>>, [SyncCarrier, Carrier<'Duplicate inline sync', 'sync', Sync, ['A different law']>]>",
      );
      await rejected('relations', ['DuplicateKey'], 'system.ts');
      w.write(
        'architecture/system.ts',
        SYSTEM.replace(
          "Value<'A timestamp', number>>, [SyncCarrier]>",
          "Value<'A timestamp', number>>, [Carrier<'Clock inline sync', 'sync', Sync, ['Clock sync law']>, Carrier<'Clock alternative', 'alternative', Sync, ['Alternative law']>]>",
        ).replace(
          "Value<'Work completed', void>>, [SyncCarrier]>",
          "Value<'Work completed', void>>, [Carrier<'Work inline sync', 'sync', Sync, ['Work sync law']>]>",
        ),
      );
      await check();
      const first = await view();
      const inline = nodes(first).filter((item) => item.kind === 'CarrierMember');
      const ids = inline.map((item) => String(item.id)).sort();
      assert(ids.includes('architecture/system.ts#Clock/carrier/sync'));
      assert(ids.includes('architecture/system.ts#Work/carrier/sync'));
      assert.equal(
        record(inline.find((item) => item.id === 'architecture/system.ts#Clock/carrier/sync')!.details).doc,
        'Clock inline sync',
      );
      w.replace(
        'architecture/system.ts',
        "Carrier<'Clock inline sync', 'sync', Sync, ['Clock sync law']>, Carrier<'Clock alternative', 'alternative', Sync, ['Alternative law']>",
        "Carrier<'Clock alternative', 'alternative', Sync, ['Alternative law']>, Carrier<'Clock renamed without identity change', 'sync', Sync, ['Clock sync law']>",
      );
      const second = await view();
      assert.deepEqual(
        nodes(second)
          .filter((item) => item.kind === 'CarrierMember')
          .map((item) => String(item.id))
          .sort(),
        ids,
      );
      assert.equal(
        record(nodes(second).find((item) => item.id === 'architecture/system.ts#Clock/carrier/sync')!.details)
          .doc,
        'Clock renamed without identity change',
      );
    });
  }, 240_000);
});

describe('D: managed-only upgrade, explicit migration and the identical entrypoint path', () => {
  test('upgrade check is read-only, upgrade preserves author files, migration is explicit and second upgrade is current', async () => {
    await w.isolated(async () => {
      const originalDsl = w.read('dsl/dsl.ts');
      const originalConfig = w.read('tsconfig.json');
      w.replace(
        'architecture/system.ts',
        "Opaque<'Identity of one run', 'acceptance.run'>",
        "Opaque<'Identity of one run'>",
      );
      const canonicalWithLegacyDomain = snapshot(w.root);
      w.write(
        'dsl/dsl.ts',
        "/** Previous managed DSL contract, intentionally replaced by upgrade. */\nexport type Opaque<D extends string> = { readonly design: 'Opaque'; readonly doc: D };\n",
      );
      w.write('tsconfig.json', '{\n  "compilerOptions": { "strict": false },\n  "files": []\n}\n');
      const availability = await w.readOnly(async () =>
        outputJson(succeeds(await w.parent('upgrade', w.design, '--check'))),
      );
      assert.equal(availability.kind, 'UpgradeAvailable');
      assert.deepEqual(array(availability.writes).slice().sort(), ['dsl/dsl.ts', 'tsconfig.json']);
      const migrated = await w.parent('upgrade', w.design);
      assert.equal(migrated.exitCode, 1, JSON.stringify(migrated));
      assert(/"kind"\s*:\s*"Generated"/.test(migrated.stdout), migrated.stdout);
      const failure = record(JSON.parse(migrated.stderr) as unknown);
      assert.equal(failure.kind, 'Rejected');
      assert(
        /生成文件已更新|generated files.*updated/i.test(String(failure.message)),
        JSON.stringify(failure),
      );
      assert(/设计尚未通过|design.*not.*pass/i.test(String(failure.message)), JSON.stringify(failure));
      const diagnostics = array(failure.diagnostics).map(record);
      assert(
        diagnostics.some(
          (item) =>
            item.stage === 'typescript' &&
            item.code === 'CompilerDiagnostic' &&
            record(item.at).path === 'architecture/system.ts',
        ),
      );
      for (const diagnostic of diagnostics) assertLocation(diagnostic);
      assert.equal(w.read('dsl/dsl.ts'), originalDsl);
      assert.equal(w.read('tsconfig.json'), originalConfig);
      sameTree(canonicalWithLegacyDomain, snapshot(w.root));
      await rejected('typescript', ['CompilerDiagnostic'], 'system.ts');
      w.write('architecture/system.ts', SYSTEM);

      // Re-run B's actual public commands after migration, not a private service shortcut.
      const commands: readonly { readonly parent: boolean; readonly args: readonly string[] }[] = [
        { parent: true, args: ['check', w.design, '--json'] },
        { parent: false, args: ['view', w.design, '--json'] },
        { parent: false, args: ['search', w.design, 'Store'] },
        { parent: false, args: ['neighbors', w.design, 'Worker', '--depth', '2'] },
        { parent: false, args: ['view', w.design, '--composition', 'Local', '--json'] },
        { parent: false, args: ['view', w.design, '--composition', 'Remote', '--json'] },
        { parent: false, args: ['path', w.design, 'Worker', 'StoreOne', '--composition', 'Local'] },
        { parent: false, args: ['view', w.design] },
      ];
      for (const command of commands)
        await w.readOnly(async () => {
          const result = succeeds(
            await (command.parent ? w.parent(...command.args) : w.graph(...command.args)),
          );
          if (command.parent) {
            assert.equal(outputJson(result).kind, 'AutomaticallyChecked');
            assert.equal(record(outputJson(result).review).kind, 'ManualReviewRequired');
          } else if (command.args[0] === 'view' && command.args.includes('--json')) {
            const graph = outputJson(result);
            assert(nodes(graph).length > 0 && edges(graph).length > 0);
            assert.equal(record(record(graph.report).review).kind, 'ManualReviewRequired');
            const composition = command.args.indexOf('--composition');
            assert.equal(record(graph.context).kind, composition < 0 ? 'Contracts' : 'Composition');
            if (composition >= 0) {
              const role = roleFor(
                graph,
                String(node(graph, 'System').id),
                String(node(graph, 'StorePort').id),
              );
              assert.equal(
                record(record(role.details).provider).target,
                command.args[composition + 1] === 'Local'
                  ? 'relations/assembly.ts#StoreOne'
                  : 'relations/assembly.ts#StoreTwo',
              );
            }
          } else if (command.args[0] === 'path') assert.equal(outputJson(result).kind, 'StructuralPath');
          else if (command.args[0] === 'search')
            assert(result.stdout.includes('StoreOne') && result.stdout.includes('StoreTwo'));
          else if (command.args[0] === 'neighbors') assert(result.stdout.includes('Clock'));
          else assert(result.stdout.includes('```mermaid') && result.stdout.includes('RunLifecycle'));
        });
      const current = await w.readOnly(async () =>
        outputJson(succeeds(await w.parent('upgrade', w.design, '--check'))),
      );
      assert.equal(current.kind, 'UpToDate');
      const idempotent = await w.readOnly(async () => succeeds(await w.parent('upgrade', w.design)));
      assert(/"kind"\s*:\s*"UpToDate"/.test(idempotent.stdout), idempotent.stdout);
      assert(idempotent.stdout.includes('ManualReviewRequired'));
    });
  }, 300_000);
});

describe('public-boundary Graph regressions', () => {
  test('a parent forwards the same explicit child public root, not merely its transitive dependency', async () => {
    await w.isolated(async () => {
      w.write(
        'architecture/worker/public.ts',
        `import type { Opaque, Struct } from '../../dsl/dsl.ts';
export type PublicLeaf = Opaque<'A dependency of the published envelope', 'acceptance.public-leaf'>;
export type PublicEnvelope = Struct<'The explicit child public root', { leaf: PublicLeaf }>;
`,
      );
      w.write(
        'architecture/worker/run.ts',
        "import type { PublicEnvelope, PublicLeaf } from './public.ts';\n" +
          WORKER.replace(
            'core: [Started, StatusResult, RunLifecycle]',
            'core: [Started, StatusResult, RunLifecycle, PublicEnvelope, PublicLeaf]',
          ).replace('ports: [RunFace];', 'ports: [RunFace]; public: [PublicEnvelope];'),
      );
      w.write(
        'architecture/system.ts',
        "import type { PublicEnvelope, PublicLeaf } from './worker/public.ts';\n" +
          SYSTEM.replace('public: [RunHandle, Tick]', 'public: [RunHandle, Tick, PublicEnvelope]'),
      );
      await check();
      const forwarded = await view();
      const system = String(node(forwarded, 'System').id);
      const worker = String(node(forwarded, 'Worker').id);
      const envelope = String(node(forwarded, 'PublicEnvelope').id);
      const leaf = String(node(forwarded, 'PublicLeaf').id);
      for (const boundary of [worker, system]) {
        assert(hasEdge(forwarded, boundary, envelope, 'public-material'));
        assert(
          hasEdge(forwarded, boundary, leaf, 'public-material'),
          'forwarding the root includes its data closure',
        );
      }

      w.replace(
        'architecture/system.ts',
        'public: [RunHandle, Tick, PublicEnvelope]',
        'public: [RunHandle, Tick, PublicLeaf]',
      );
      await rejected('relations', ['PrivateReference'], 'system.ts');
      // No reference, owner, or dependency changes: only the child now explicitly publishes this root.
      w.replace(
        'architecture/worker/run.ts',
        'public: [PublicEnvelope]',
        'public: [PublicEnvelope, PublicLeaf]',
      );
      await check();
      const explicit = await view();
      assert(hasEdge(explicit, system, leaf, 'public-material'));
      assert(
        !hasEdge(explicit, system, envelope, 'public-material'),
        'publishing a leaf does not publish its containing envelope',
      );
    });
  }, 180_000);

  test('outside Binding follows the declared Expose source at both inner and outer module boundaries', async () => {
    await w.isolated(async () => {
      for (const name of ['x', 'x/p', 'x/q']) {
        succeeds(await w.parent('module', w.design, name));
        w.write(`architecture/${name}/README.md`, readme(name));
      }
      w.write(
        'architecture/x/x.ts',
        `import type { Expose, Module } from '../../dsl/dsl.ts';
import type { BoundaryPort } from '../system.ts';
import type { P } from './p/p.ts';
import type { Q } from './q/q.ts';
export type X = Module<'Only Q is an outward source', {
  parts: [P, Q]; reexports: [Expose<'Publish Q, not its sibling P', BoundaryPort, Q>];
}>;
`,
      );
      for (const name of ['P', 'Q'])
        w.write(
          `architecture/x/${name.toLowerCase()}/${name.toLowerCase()}.ts`,
          `import type { Module } from '../../../dsl/dsl.ts';
import type { BoundaryPort } from '../../system.ts';
export type ${name} = Module<'${name} independently declares the same capability', { provides: [BoundaryPort] }>;
`,
        );
      w.write(
        'architecture/system.ts',
        "import type { X } from './x/x.ts';\n" +
          SYSTEM.replace('DormantPort, Work]', 'DormantPort, Work, BoundaryPort]')
            .replace('parts: [Worker]', 'parts: [Worker, X]')
            .replace(
              "reexports: [Expose<'Expose the worker run contract', RunFace, Worker>]",
              "reexports: [Expose<'Expose the worker run contract', RunFace, Worker>, Expose<'Publish the X source', BoundaryPort, X>]",
            ) +
          "\nexport type BoundaryPort = Point<'A contract with source-specific outward paths', Op<'One boundary operation', {}, Value<'Boundary result', void>>, [SyncCarrier]>;\n",
      );
      w.write(
        'business/launch/launch.ts',
        LAUNCH.replace('{ Work }', '{ BoundaryPort, Work }').replace(
          'plugsInto: [RunFace, Work]',
          'plugsInto: [RunFace, Work, BoundaryPort]',
        ),
      );
      const binding = `import type { Binding, Composition } from '../dsl/dsl.ts';
import type { BoundaryPort } from '../architecture/system.ts';
import type { Worker } from '../architecture/worker/run.ts';
import type { P } from '../architecture/x/p/p.ts';
import type { Q } from '../architecture/x/q/q.ts';
import type { Launch } from '../business/launch/launch.ts';
export type BoundaryAssembly = Composition<'Select only a source actually forwarded at every boundary', [
  Binding<'Use the declared outward source', Launch, BoundaryPort, Q>,
]>;
`;
      w.write('relations/boundary.ts', binding);
      await check();
      const inner = await view('--composition', 'BoundaryAssembly');
      const launch = String(node(inner, 'Launch').id);
      const port = String(node(inner, 'BoundaryPort').id);
      const p = String(node(inner, 'P').id);
      const q = String(node(inner, 'Q').id);
      const worker = String(node(inner, 'Worker').id);
      const x = String(node(inner, 'X').id);
      const system = String(node(inner, 'System').id);
      assert(hasEdge(inner, p, port, 'can-provide'));
      assert(hasEdge(inner, q, port, 'can-provide'));
      assert(hasEdge(inner, x, q, 'forwarded-from'));
      assert(!hasEdge(inner, x, p, 'forwarded-from'));
      assert(hasEdge(inner, system, x, 'forwarded-from'));
      assert(hasEdge(inner, String(roleFor(inner, launch, port).id), q, 'bound-to'));
      const innerRoles = await view();
      assert.deepEqual(
        array(record(roleFor(innerRoles, launch, port).details).candidates).map(
          (item) => record(item).target,
        ),
        [q],
      );

      w.replace('relations/boundary.ts', 'Launch, BoundaryPort, Q>', 'Launch, BoundaryPort, P>');
      await rejected('relations', ['PrivateReference'], 'boundary.ts');
      w.write('relations/boundary.ts', binding);
      // X still forwards Q, but the next crossed boundary now forwards Worker instead of X.
      w.write(
        'architecture/worker/run.ts',
        WORKER.replace(
          '{ Clock, RunHandle, StorePort, SyncCarrier }',
          '{ BoundaryPort, Clock, RunHandle, StorePort, SyncCarrier }',
        ).replace('provides: [RunFace]', 'provides: [RunFace, BoundaryPort]'),
      );
      w.replace(
        'architecture/system.ts',
        "Expose<'Publish the X source', BoundaryPort, X>",
        "Expose<'Publish the Worker source', BoundaryPort, Worker>",
      );
      await rejected('relations', ['PrivateReference'], 'boundary.ts');
      w.replace('relations/boundary.ts', 'Launch, BoundaryPort, Q>', 'Launch, BoundaryPort, Worker>');
      await check();
      const outer = await view('--composition', 'BoundaryAssembly');
      assert(hasEdge(outer, system, worker, 'forwarded-from'));
      assert(!hasEdge(outer, system, x, 'forwarded-from'));
      assert(hasEdge(outer, String(roleFor(outer, launch, port).id), worker, 'bound-to'));
      const outerRoles = await view();
      assert.deepEqual(
        array(record(roleFor(outerRoles, launch, port).details).candidates).map(
          (item) => record(item).target,
        ),
        [worker],
      );
    });
  }, 300_000);

  test('operation result Variants have one stable member identity and Returned facts target that member', async () => {
    await w.isolated(async () => {
      w.write(
        'architecture/variant.ts',
        `import type { Face, Lifecycle, Op, OpRef, Outcome, Returned, Value, Variant } from '../dsl/dsl.ts';
import type { RunHandle, SyncCarrier } from './system.ts';
export type VariantFace = Face<'Inline outcome member identity', 'One run identity', {
  open: Op<'Open a run', { handle: RunHandle }, Outcome<'Inline operation outcome', {
    Ready: Variant<'The unique operation result branch', { handle: RunHandle }>;
  }>>;
  close: Op<'Close a run', { handle: RunHandle }, Value<'Closed identity', RunHandle>>;
}, [SyncCarrier]>;
export type VariantLife = Lifecycle<'Facts address actual result members', {
  key: RunHandle; starts: Returned<OpRef<VariantFace, 'open'>, 'Ready'>; ends: Returned<OpRef<VariantFace, 'close'>, 'done'>;
}>;
`,
      );
      w.write(
        'architecture/system.ts',
        "import type { VariantFace, VariantLife } from './variant.ts';\n" +
          SYSTEM.replace('Envelope, Tick]', 'Envelope, Tick, VariantLife]').replace(
            'DormantPort, Work]',
            'DormantPort, Work, VariantFace]',
          ),
      );
      await check();
      const first = await view();
      const operation = 'architecture/variant.ts#VariantFace/Operation/open';
      const result = `${operation}/Application/result`;
      const branch = `${result}/Variant/Ready`;
      const branchIds = (graph: JsonRecord): readonly unknown[] =>
        nodes(graph)
          .filter((item) => item.kind === 'Variant' && String(item.id).startsWith(`${operation}/`))
          .map((item) => item.id);
      assert.deepEqual(
        branchIds(first),
        [branch],
        'the operation and its result must not each clone the same Variant',
      );
      assert(hasEdge(first, operation, result, 'result'));
      assert(hasEdge(first, result, branch, 'case'));
      const fact = 'architecture/variant.ts#VariantLife/Fact/starts';
      assert(
        hasEdge(first, fact, branch, 'reference'),
        'Returned points to the result Variant, not a fabricated operation/Variant sibling',
      );
      assert(
        nodes(first).some((item) => item.id === 'architecture/worker/run.ts#Started/Variant/Started'),
        'a named Outcome keeps its legitimate independent data context',
      );

      w.replace(
        'architecture/variant.ts',
        'The unique operation result branch',
        'The edited operation result branch',
      );
      const second = await view();
      assert.deepEqual(branchIds(second), [branch], 'description edits do not change the member identity');
      assert.equal(
        nodes(second).find((item) => item.id === branch)!.doc,
        'The edited operation result branch',
      );
      assert(hasEdge(second, fact, branch, 'reference'));
      const queried = await w.readOnly(async () =>
        outputJson(succeeds(await w.graph('neighbors', w.design, fact, '--depth', '1'))),
      );
      assert(nodes(queried).some((item) => item.id === branch && item.kind === 'Variant'));
      assert(hasEdge(queried, fact, branch, 'reference'));
    });
  }, 180_000);

  test('contract public-material edges and the Family HKT helper are queryable without globally publishing private core', async () => {
    const graph = await view();
    const store = String(node(graph, 'StorePort').id);
    const batch = String(node(graph, 'RunBatch').id);
    const family = 'architecture/system.ts#ListFamily';
    const helper = 'architecture/system.ts#ListF';
    const system = String(node(graph, 'System').id);
    assert(nodes(graph).some((item) => item.id === family && item.kind === 'Family'));
    assert(nodes(graph).some((item) => item.id === helper && item.kind === 'Auxiliary'));
    for (const material of [batch, family, helper])
      assert(
        hasEdge(graph, store, material, 'public-material'),
        `StorePort contract closure omits ${material}`,
      );
    assert(
      !hasEdge(graph, system, batch, 'public-material'),
      'contract material is not an independent explicit public root',
    );
    assert(hasEdge(graph, family, helper, 'reference'), 'Family retains its actual HKT definition reference');
    const nearby = await w.readOnly(async () =>
      outputJson(succeeds(await w.graph('neighbors', w.design, family, '--depth', '1'))),
    );
    assert(nodes(nearby).some((item) => item.id === helper && item.kind === 'Auxiliary'));
    assert(hasEdge(nearby, family, helper, 'reference'));
    const found = await w.readOnly(async () =>
      outputJson(succeeds(await w.graph('search', w.design, 'ListF', '--kind', 'Auxiliary'))),
    );
    assert.deepEqual(
      nodes(found).map((item) => item.id),
      [helper],
    );
  }, 120_000);
});

describe('finite topology invariants', () => {
  test('Scope containment stays separate from module parts and rejects duplicate direct containment', async () => {
    await w.isolated(async () => {
      const source = `import type {Scope} from '../dsl/dsl.ts';
import type {Launch} from '../business/launch/launch.ts';
import type {Observe} from '../business/observe/observe.ts';
export type Workers=Scope<'One process group','process',[Launch,Observe]>;
export type HostProcess=Scope<'An outer process group','process',[Workers]>;
`;
      w.write('relations/scopes.ts', source);
      await check();
      const graph = await view();
      assert(hasEdge(graph, 'relations/scopes.ts#HostProcess', 'relations/scopes.ts#Workers', 'contains'));
      assert(hasEdge(graph, 'relations/scopes.ts#Workers', 'business/launch/launch.ts#Launch', 'contains'));
      assert(!hasEdge(graph, 'relations/scopes.ts#HostProcess', 'relations/scopes.ts#Workers', 'part'));
      w.write(
        'relations/scopes.ts',
        source + "export type Duplicate=Scope<'Another direct process group','process',[Launch]>;\n",
      );
      await rejected('relations', ['InvalidScope'], 'scopes.ts');
      w.write(
        'relations/scopes.ts',
        source.replace(
          "Scope<'One process group','process',[Launch,Observe]>",
          "Scope<'One process group','process',[HostProcess]>",
        ),
      );
      await rejected('relations', ['InvalidScope'], 'scopes.ts');
    });
  }, 180_000);

  test('same-level bound dependencies are checked per Composition, not from unbound candidate edges', async () => {
    await w.isolated(async () => {
      w.write(
        'business/launch/launch.ts',
        LAUNCH.replace('types: [Status];', 'types: [Status]; provides: [Work];'),
      );
      w.write(
        'business/observe/observe.ts',
        OBSERVE.replace('types: [Status];', 'types: [Status]; provides: [Work];'),
      );
      const first = "Binding<'Launch uses Observe work',Launch,Work,Observe>";
      const second = "Binding<'Observe uses Launch work',Observe,Work,Launch>";
      const source = `import type {Binding,Composition} from '../dsl/dsl.ts';
import type {Work} from '../architecture/system.ts';
import type {Launch} from '../business/launch/launch.ts';
import type {Observe} from '../business/observe/observe.ts';
export type OneWay=Composition<'A partial acyclic selection',[${first}]>;
`;
      w.write('relations/dependencies.ts', source);
      await check();
      await view('--composition', 'OneWay');
      w.write(
        'relations/dependencies.ts',
        source +
          `export type Cycle=Composition<'Two selected dependencies form a cycle',[${first},${second}]>;\n`,
      );
      await rejected('relations', ['DependencyCycle'], 'dependencies.ts');
    });
  }, 180_000);
});
