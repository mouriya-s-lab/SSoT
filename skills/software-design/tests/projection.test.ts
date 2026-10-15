import { describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Diagnostic, Result, StageCodes } from '../scripts/diagnostics.ts';
import type { DataExpression, Element, ResolvedDesign, RelationFacts } from '../scripts/model.ts';
import type { SourceSet } from '../scripts/workspace-model.ts';

const skill = fileURLToPath(new URL('..', import.meta.url));
const childDeadline = 45_000;
const testDeadline = 55_000;
type Mode = 'resolve' | 'relations';
type Fixture = { readonly root: string; readonly source: SourceSet };
type NativeResult = { readonly resolved: Result<ResolvedDesign>; readonly relations?: Result<RelationFacts> };

function fixture(files: Readonly<Record<string, string>>): Fixture {
  const root = mkdtempSync('/tmp/software-design-accept-');
  try {
    mkdirSync(join(root, 'dsl'));
    mkdirSync(join(root, 'architecture'));
    copyFileSync(join(skill, 'templates/dsl.ts'), join(root, 'dsl/dsl.ts'));
    // The gate uses an actual analysis project, not a mocked compiler or a build/emitter.
    writeFileSync(
      join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: 'ESNext',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          allowImportingTsExtensions: true,
        },
        include: ['dsl/dsl.ts', 'architecture/**/*.ts'],
      }),
    );
    const types = Object.entries(files).map(([path, content]) => {
      const file = join(root, 'architecture', path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
      return file;
    });
    return {
      root,
      source: {
        root,
        files: [join(root, 'dsl/dsl.ts'), ...types],
        types,
        documents: [],
        projects: [join(root, 'tsconfig.json')],
        directories: [{ path: 'architecture', place: { layer: 'architecture', module: [] } }],
      },
    };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function signalGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
    throw error;
  }
}

async function runNative(input: Fixture, mode: Mode = 'resolve'): Promise<NativeResult> {
  const runner = join(input.root, 'native-runner.mts');
  writeFileSync(
    runner,
    `import {withCompiler} from ${JSON.stringify(join(skill, 'scripts/compiler.ts'))};
import {resolve} from ${JSON.stringify(join(skill, 'scripts/resolve.ts'))};
import {validateRelations} from ${JSON.stringify(join(skill, 'scripts/validate.ts'))};
const source=${JSON.stringify(input.source)};
const resolved=await withCompiler(source,view=>resolve(source,view));
const result={resolved,...(${JSON.stringify(mode)}==='relations'&&resolved.kind==='Accepted'?{relations:validateRelations(resolved.value)}:{})};
console.log(JSON.stringify(result));
`,
  );
  const argv = [process.execPath, runner];
  console.log(JSON.stringify({ argv, mode, root: input.root }));
  const child = spawn(argv[0]!, argv.slice(1), { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  child.stdout!.setEncoding('utf8');
  child.stderr!.setEncoding('utf8');
  child.stdout!.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr!.on('data', (chunk) => {
    stderr += chunk;
  });
  let escalation: NodeJS.Timeout | undefined;
  const deadline = setTimeout(() => {
    timedOut = true;
    if (child.pid && signalGroup(child.pid, 'SIGTERM'))
      escalation = setTimeout(() => {
        if (child.pid) signalGroup(child.pid, 'SIGKILL');
      }, 250);
  }, childDeadline);
  try {
    const exit = await new Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>(
      (accept, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => accept({ code, signal }));
      },
    );
    if (timedOut || exit.code !== 0)
      throw new Error(JSON.stringify({ argv, timedOut, ...exit, stdout, stderr }));
    const result: NativeResult = JSON.parse(stdout);
    console.log(
      JSON.stringify({
        argv,
        exitCode: exit.code,
        result:
          result.resolved.kind === 'Accepted'
            ? {
                kind: 'Accepted',
                declarations: result.resolved.value.elements.length,
                relations: result.relations?.kind,
              }
            : result.resolved,
      }),
    );
    expect(stderr).toBe('');
    return result;
  } finally {
    clearTimeout(deadline);
    clearTimeout(escalation);
    if (child.pid && signalGroup(child.pid, 'SIGTERM')) {
      await new Promise((accept) => setTimeout(accept, 250));
      signalGroup(child.pid, 'SIGKILL');
    }
  }
}

async function usingFixture<T>(
  files: Readonly<Record<string, string>>,
  consume: (input: Fixture) => Promise<T>,
): Promise<T> {
  const input = fixture(files);
  try {
    return await consume(input);
  } finally {
    rmSync(input.root, { recursive: true, force: true });
  }
}
function accepted<T>(result: Result<T>): T {
  if (result.kind !== 'Accepted') throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result.value;
}
function rejected<S extends keyof StageCodes>(
  result: Result<unknown>,
  stage: S,
  code: StageCodes[S],
): readonly Diagnostic[] {
  expect(result.kind).toBe('Rejected');
  if (result.kind !== 'Rejected') throw new Error('Expected rejection; no partial success is permitted');
  expect(result.diagnostics.length).toBeGreaterThan(0);
  expect(result.diagnostics.some((d) => d.stage === stage && d.code === code)).toBe(true);
  for (const diagnostic of result.diagnostics) {
    expect(diagnostic.at.path.length).toBeGreaterThan(0);
    expect(diagnostic.at.path.startsWith('/')).toBe(false);
    expect(diagnostic.at.line).toBeGreaterThan(0);
    expect(diagnostic.at.column).toBeGreaterThan(0);
  }
  return result.diagnostics;
}
function element(design: ResolvedDesign, name: string): Element {
  const found = design.elements.filter((e) => e.name === name);
  expect(found).toHaveLength(1);
  return found[0]!;
}
function data(design: ResolvedDesign, name: string): DataExpression {
  const found = element(design, name);
  if (found.kind !== 'Data') throw new Error(`${name} was ${found.kind}, not Data`);
  return found.expression;
}
const imports = `import type { Value, Opaque, Struct, Tuple, Choice, Case, Outcome, Variant, Apply, TypeLambda, Family, Shape, Carrier, Sync, Async, Face, Point, Op, OpRef, Returned, Later, Duty, Next, Module, Event, Implementation, Unit, External, Lifecycle } from '../dsl/dsl.ts';\n`;
const equal = `type Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;type Assert<T extends true>=T;\n`;
const base =
  imports +
  `export type Atom=Value<'text',string>;export type Mode=Carrier<'direct','sync',Sync,[]>;export type Port=Face<'port','one boundary',{read:Op<'read',{},Atom>},[Mode]>;\n`;

describe('native projection and semantic resolution', () => {
  test(
    'scalar leaves, explicit structures and case/kind fields project without losing a branch',
    async () => {
      const source =
        imports +
        equal +
        `
export type Text=Value<'text',string>;
export type NumberValue=Value<'number',number>;
export type BooleanValue=Value<'boolean',boolean>;
export type BigValue=Value<'bigint',bigint>;
export type SymbolValue=Value<'symbol',symbol>;
export type NullValue=Value<'null',null>;
export type UndefinedValue=Value<'undefined',undefined>;
export type VoidValue=Value<'void',void>;
export type Literal=Value<'literal','ready'|42|true>;
export type Template=Value<'template',\`run-\${number}\`>;
export type Branded=Value<'branded',string & {readonly brand:'request'}>;
export type RecordValue=Struct<'record',{case:Text;kind:NumberValue}>;
export type State=Choice<'state',{Ready:Case<'ready',{case:Text;kind:NumberValue}>;Empty:Case<'empty'>}>;
export type ResultValue=Outcome<'result',{Ok:Variant<'ok',{case:Text;kind:NumberValue}>;Failed:Variant<'failed',{kind:Text}>}>;
type Scalars=Assert<Equal<[Shape<Text>,Shape<NumberValue>,Shape<BooleanValue>,Shape<BigValue>,Shape<SymbolValue>,Shape<NullValue>,Shape<UndefinedValue>,Shape<VoidValue>],[string,number,boolean,bigint,symbol,null,undefined,void]>>;
type LiteralProjection=Assert<Equal<Shape<Literal>,'ready'|42|true>>;
type TemplateProjection=Assert<Equal<Shape<Template>,\`run-\${number}\`>>;
type BrandProjection=Assert<Equal<Shape<Branded>,string & {readonly brand:'request'}>>;
type RecordProjection=Assert<Equal<Shape<RecordValue>,{readonly case:string;readonly kind:number}>>;
type ChoiceProjection=Assert<Equal<Shape<State>,{readonly case:'Ready';readonly fields:{readonly case:string;readonly kind:number}}|{readonly case:'Empty';readonly fields:{}}>>;
type OutcomeProjection=Assert<Equal<Shape<ResultValue>,{readonly case:'Ok';readonly fields:{readonly case:string;readonly kind:number}}|{readonly case:'Failed';readonly fields:{readonly kind:string}}>>;
`;
      await usingFixture({ 'values.ts': source }, async (input) => {
        const design = accepted((await runNative(input)).resolved);
        for (const name of [
          'Text',
          'NumberValue',
          'BooleanValue',
          'BigValue',
          'SymbolValue',
          'NullValue',
          'UndefinedValue',
          'VoidValue',
          'Literal',
          'Template',
          'Branded',
        ]) {
          const value = data(design, name);
          expect(value.kind).toBe('Value');
          if (value.kind === 'Value') expect(value.value.kind).toBe('Scalar');
        }
        const record = data(design, 'RecordValue');
        expect(record.kind).toBe('Struct');
        if (record.kind === 'Struct')
          expect(record.fields.map((f) => [f.name, f.doc])).toEqual([
            ['case', 'text'],
            ['kind', 'number'],
          ]);
        const state = data(design, 'State');
        const outcome = data(design, 'ResultValue');
        expect(state.kind).toBe('Choice');
        expect(outcome.kind).toBe('Outcome');
        if (state.kind === 'Choice')
          expect(state.cases.map((c) => [c.name, c.fields.map((f) => f.name)])).toEqual([
            ['Ready', ['case', 'kind']],
            ['Empty', []],
          ]);
        if (outcome.kind === 'Outcome')
          expect(outcome.variants.map((v) => [v.name, v.fields.map((f) => f.name), v.follow.kind])).toEqual([
            ['Ok', ['case', 'kind'], 'End'],
            ['Failed', ['kind'], 'End'],
          ]);
      });
    },
    testDeadline,
  );

  test(
    'nested Apply, Tuple multiple arguments, Family, generic substitution and barrel aliases retain semantics',
    async () => {
      const definitions =
        imports +
        `
interface ListF extends TypeLambda {readonly type:readonly this['A'][]}
interface PairF extends TypeLambda {readonly type:this['A'] extends readonly [infer K,infer V]?ReadonlyMap<K,V>:never}
type NativeBox<A>={readonly payload:A;readonly untouched:{readonly design:'Value';readonly type:Date}};
interface NativeF extends TypeLambda {readonly type:NativeBox<this['A']>}
export type ListFamily=Family<'list constructor',ListF>;
export type Atom=Value<'text',string>;
export type RecordValue=Struct<'record',{value:Atom}>;
export type Nested=Apply<'outer',ListFamily,Apply<'inner',ListF,RecordValue>>;
export type Keyed<K extends string>=Apply<'keyed',PairF,Tuple<'arguments',[Value<'key',K>,RecordValue]>>;
export type NativeOutput=Apply<'native output is not DSL',NativeF,Atom>;
`;
      const use =
        `import type {Keyed as ViaBarrel,RecordValue as Reexported,Nested,NativeOutput} from './barrel.ts';import type {Shape,Face,Op,Carrier,Sync} from '../dsl/dsl.ts';\n` +
        equal +
        `
export type Actual=ViaBarrel<'request'>;
export type Alias=Reexported;
export type Mode=Carrier<'direct','sync',Sync,[]>;
export type GenericPort=Face<'generic result','one boundary',{read:Op<'read',{},ViaBarrel<'request'>>},[Mode]>;
type NestedProjection=Assert<Equal<Shape<Nested>,readonly (readonly {readonly value:string}[])[]>>;
type AppliedProjection=Assert<Equal<Shape<Actual>,ReadonlyMap<'request',{readonly value:string}>>>;
type AliasProjection=Assert<Equal<Shape<Alias>,{readonly value:string}>>;
type NativeProjection=Assert<Equal<Shape<NativeOutput>,{readonly payload:string;readonly untouched:{readonly design:'Value';readonly type:Date}}>>;
`;
      await usingFixture(
        {
          'definitions.ts': definitions,
          'barrel.ts': `export type {Keyed,RecordValue,Nested,NativeOutput} from './definitions.ts';`,
          'use.ts': use,
        },
        async (input) => {
          const design = accepted((await runNative(input)).resolved);
          expect(element(design, 'ListFamily').kind).toBe('Family');
          expect(element(design, 'Keyed').kind).toBe('Auxiliary');
          const actual = data(design, 'Actual');
          expect(actual.kind).toBe('Application');
          if (actual.kind === 'Application') {
            expect(actual.definition.target).toBe('architecture/definitions.ts#Keyed');
            expect(actual.arguments).toHaveLength(1);
            expect(actual.arguments[0]!.text).toContain('request');
            expect(actual.resolved.kind).toBe('Apply');
            if (actual.resolved.kind === 'Apply') {
              expect(actual.resolved.argument.kind).toBe('Tuple');
              if (actual.resolved.argument.kind === 'Tuple') {
                expect(actual.resolved.argument.items).toHaveLength(2);
                const key = actual.resolved.argument.items[0]!;
                expect(key.kind).toBe('Value');
                if (key.kind === 'Value' && key.value.kind === 'Scalar')
                  expect(key.value.type.text).toContain('request');
                expect(actual.resolved.argument.items[1]).toMatchObject({
                  kind: 'Reference',
                  target: 'architecture/definitions.ts#RecordValue',
                });
              }
            }
          }
          expect(element(design, 'Alias').kind).toBe('Auxiliary');
          expect(design.references).toContainEqual(
            expect.objectContaining({
              from: 'architecture/use.ts#Alias',
              to: 'architecture/definitions.ts#RecordValue',
            }),
          );
          const nested = data(design, 'Nested');
          expect(nested.kind).toBe('Apply');
          if (nested.kind === 'Apply') expect(nested.argument.kind).toBe('Apply');
          const port = element(design, 'GenericPort');
          if (port.kind !== 'Connection' || port.port.kind !== 'Face')
            throw new Error('GenericPort did not resolve as Face');
          expect(port.port.operations[0]!.result.kind).toBe('Application');
        },
      );
    },
    testDeadline,
  );

  test(
    'same-parameter connections have independent canonical identities, transparent aliases do not',
    async () => {
      await usingFixture(
        {
          'identity.ts':
            base +
            `
export type First=Point<'identical',Op<'read',{},Atom>,[Mode]>;
export type Second=Point<'identical',Op<'read',{},Atom>,[Mode]>;
export type Alias=First;
export type Host=Module<'host',{ports:[First,Second];provides:[First,Second]}>;
`,
        },
        async (input) => {
          const design = accepted((await runNative(input)).resolved);
          expect(element(design, 'First')).toMatchObject({
            id: 'architecture/identity.ts#First',
            kind: 'Connection',
          });
          expect(element(design, 'Second')).toMatchObject({
            id: 'architecture/identity.ts#Second',
            kind: 'Connection',
          });
          expect(element(design, 'Alias').kind).toBe('Auxiliary');
          const host = element(design, 'Host');
          if (host.kind !== 'Module') throw new Error('Host did not resolve');
          expect(host.ports.map((p) => p.target)).toEqual([
            'architecture/identity.ts#First',
            'architecture/identity.ts#Second',
          ]);
          expect(design.references).toContainEqual(
            expect.objectContaining({
              from: 'architecture/identity.ts#Alias',
              to: 'architecture/identity.ts#First',
            }),
          );
        },
      );
    },
    testDeadline,
  );

  test(
    'recursive Returned duty, Module/Event and mutually Next faces compile and resolve as canonical references',
    async () => {
      await usingFixture(
        {
          'recursive.ts':
            imports +
            `
export type Mode=Carrier<'direct','sync',Sync,[]>;
export type Handle=Opaque<'handle','run-handle'>;
export type Started=Outcome<'start result',{Started:Variant<'started',{handle:Handle},Later<'finish later',[Duty<'finish','caller',Returned<OpRef<RunFace,'finish'>,'done'>>]>>}>;
export type RunFace=Face<'run','one lifetime',{start:Op<'start',{},Started>;finish:Op<'finish',{handle:Handle},Value<'finished',void>>},[Mode]>;
export type Host=Module<'host',{core:[Handle,Started,Mode,Stopped];ports:[RunFace];provides:[RunFace]}>;
export type Stopped=Event<'stopped',Host,Value<'payload',void>>;
export type ADone=Outcome<'A result',{Ready:Variant<'ready',{},Next<'B next',[OpRef<BFace,'read'>]>>}>;
export type AFace=Face<'A','A invariant',{read:Op<'read',{},ADone>},[Mode]>;
export type BDone=Outcome<'B result',{Ready:Variant<'ready',{},Next<'A next',[OpRef<AFace,'read'>]>>}>;
export type BFace=Face<'B','B invariant',{read:Op<'read',{},BDone>},[Mode]>;
`,
        },
        async (input) => {
          const design = accepted((await runNative(input)).resolved);
          const started = data(design, 'Started');
          if (started.kind !== 'Outcome' || started.variants[0]?.follow.kind !== 'Later')
            throw new Error('Recursive duty was lost');
          expect(started.variants[0].follow.duties[0]!.complete).toMatchObject({
            kind: 'Returned',
            branch: 'done',
            via: { connection: { target: 'architecture/recursive.ts#RunFace' }, operation: 'finish' },
          });
          expect(element(design, 'Stopped')).toMatchObject({
            kind: 'Event',
            confirms: { target: 'architecture/recursive.ts#Host' },
          });
          const host = element(design, 'Host');
          if (host.kind !== 'Module') throw new Error('Host did not resolve');
          expect(host.core.map((c) => c.target)).toContain('architecture/recursive.ts#Stopped');
          for (const [name, target] of [
            ['ADone', 'BFace'],
            ['BDone', 'AFace'],
          ] as const) {
            const result = data(design, name);
            if (result.kind !== 'Outcome' || result.variants[0]?.follow.kind !== 'Next')
              throw new Error(`${name} lost Next`);
            expect(result.variants[0].follow.targets[0]!.connection.target).toBe(
              `architecture/recursive.ts#${target}`,
            );
          }
        },
      );
    },
    testDeadline,
  );

  test(
    'design source is not executed, even with a top-level throw and a file-write witness',
    async () => {
      await usingFixture({ 'never-execute.ts': base }, async (input) => {
        const marker = join(input.root, 'EXECUTED');
        writeFileSync(
          join(input.root, 'architecture/never-execute.ts'),
          base +
            `\ndeclare const require:(name:string)=>{writeFileSync:(path:string,text:string)=>void};require('node:fs').writeFileSync(${JSON.stringify(marker)},'executed');throw new Error('DESIGN_SOURCE_MUST_NOT_EXECUTE');\n`,
        );
        const design = accepted((await runNative(input)).resolved);
        expect(element(design, 'Port').kind).toBe('Connection');
        expect(existsSync(marker)).toBe(false);
      });
    },
    testDeadline,
  );
});

const compilerNegatives = [
  ['bare domain object', `export type Bad=Value<'bad',{field:string}>;`],
  ['native Map hides described data', `export type Bad=Value<'bad',ReadonlyMap<string,Atom>>;`],
  ['unknown is not a scalar leaf', `export type Bad=Value<'bad',unknown>;`],
  ['non-TypeLambda application', `export type Bad=Apply<'bad',string,Atom>;`],
  ['missing description type argument', `export type Bad=Value;`],
  ['missing Apply argument', `export type Bad=Apply<'bad',Sync>;`],
  ['invalid operation name', `export type Bad=OpRef<Port,'missing'>;`],
  ['invalid returned branch', `export type Bad=Returned<OpRef<Port,'read'>,'missing'>;`],
  ['direct unknown Module key', `export type Bad=Module<'bad',{requirs:[]}>;`],
  ['aliased unknown Module key', `type Spec={requirs:[]};export type Bad=Module<'bad',Spec>;`],
  ['aliased unknown Unit key', `type Spec={plugsInto:[];public:[]};export type Bad=Unit<'bad',Spec>;`],
  ['aliased unknown External key', `type Spec={provides:[];extra:[]};export type Bad=External<'bad',Spec>;`],
  [
    'aliased unknown Lifecycle key',
    `type Spec={key:Atom;starts:Returned<OpRef<Port,'read'>,'done'>;ends:Returned<OpRef<Port,'read'>,'done'>;confirms:[]};export type Bad=Lifecycle<'bad',Spec>;`,
  ],
  [
    'unlisted carrier',
    `type Other=Carrier<'async','async',Async,[]>;export type Bad=Implementation<Other,Port>;`,
  ],
  [
    'native semantic boundary: duplicate declarations',
    `export type Duplicate=Value<'first',string>;export type Duplicate=Value<'second',number>;`,
  ],
] as const;
describe('native TypeScript rejection, without expected-error suppression', () => {
  for (const [name, invalid] of compilerNegatives)
    test(
      name,
      async () => {
        await usingFixture({ 'invalid.ts': base + invalid }, async (input) => {
          const diagnostics = rejected((await runNative(input)).resolved, 'typescript', 'CompilerDiagnostic');
          expect(diagnostics.some((d) => d.at.path === 'architecture/invalid.ts')).toBe(true);
          expect(
            diagnostics.some((d) => d.details?.kind === 'Compiler' && Number.isInteger(d.details.code)),
          ).toBe(true);
        });
      },
      testDeadline,
    );
});

const resolverNegatives = [
  ['empty description', `export type Bad=Value<'',string>;`, 'EmptyDescription'],
  ['whitespace description', `export type Bad=Value<'  ',string>;`, 'EmptyDescription'],
  ['any Value leaf', `export type Bad=Value<'bad',any>;`, 'InvalidDescriptor'],
  ['never Value leaf', `export type Bad=Value<'bad',never>;`, 'InvalidDescriptor'],
  ['any field record', `export type Bad=Struct<'bad',any>;`, 'InvalidDescriptor'],
  ['never field record', `export type Bad=Struct<'bad',never>;`, 'InvalidDescriptor'],
  ['index signature fields', `export type Bad=Struct<'bad',Record<string,Atom>>;`, 'InvalidDescriptor'],
  [
    'index signature operations',
    `export type Bad=Face<'bad','invariant',Record<string,Op<'read',{},Atom>>,[Mode]>;`,
    'InvalidDescriptor',
  ],
  [
    'index signature cases',
    `export type Bad=Choice<'bad',Record<string,Case<'case'>>>;`,
    'InvalidDescriptor',
  ],
  [
    'index signature variants',
    `export type Bad=Outcome<'bad',Record<string,Variant<'variant'>>>;`,
    'InvalidDescriptor',
  ],
  ['array topology', `export type Bad=Module<'bad',{core:Atom[]}>;`, 'InvalidDescriptor'],
  ['variadic topology', `export type Bad=Module<'bad',{core:[Atom,...Atom[]]}>;`, 'InvalidDescriptor'],
  ['any topology', `export type Bad=Module<'bad',{core:any}>;`, 'InvalidDescriptor'],
  [
    'variadic carrier options',
    `export type Bad=Point<'bad',Op<'read',{},Atom>,[Mode,...Mode[]]>;`,
    'InvalidDescriptor',
  ],
  [
    'never-valued unknown specification key',
    `type Spec={key:Atom;starts:Returned<OpRef<Port,'read'>,'done'>;ends:Returned<OpRef<Port,'read'>,'done'>;confirms:never};export type Bad=Lifecycle<'bad',Spec>;`,
    'UnknownMember',
  ],
  [
    'native semantic boundary: unknown outer Struct intersection field',
    `export type Bad=Struct<'record',{value:Atom}>&{readonly extra:Atom};`,
    'UnknownMember',
  ],
  [
    'native semantic boundary: unknown outer Point intersection field',
    `export type Bad=Point<'point',Op<'read',{},Atom>,[Mode]>&{readonly extra:Atom};`,
    'UnknownMember',
  ],
] as const;
describe('semantic resolution rejects non-finite or damaged descriptors', () => {
  for (const [name, invalid, code] of resolverNegatives)
    test(
      name,
      async () => {
        await usingFixture({ 'invalid.ts': base + invalid }, async (input) => {
          rejected((await runNative(input)).resolved, 'resolve', code);
        });
      },
      testDeadline,
    );
});

describe('Opaque projection identity and relation identity are separate facts', () => {
  test(
    'same key ignores prose for Shape, distinct keys are not interchangeable',
    async () => {
      await usingFixture(
        {
          'opaque.ts':
            imports +
            equal +
            `
export type First=Opaque<'first description','handle'>;
export type Reworded=Opaque<'different description','handle'>;
export type Other=Opaque<'other identity','other'>;
type SameKey=Assert<Equal<Shape<First>,Shape<Reworded>>>;
type DifferentKey=Assert<Equal<Shape<First> extends Shape<Other>?true:false,false>>;
type ReverseDifferentKey=Assert<Equal<Shape<Other> extends Shape<First>?true:false,false>>;
`,
        },
        async (input) => {
          const design = accepted((await runNative(input)).resolved);
          expect(data(design, 'First')).toMatchObject({ kind: 'Opaque', key: 'handle' });
          expect(data(design, 'Reworded')).toMatchObject({ kind: 'Opaque', key: 'handle' });
          expect(data(design, 'Other')).toMatchObject({ kind: 'Opaque', key: 'other' });
        },
      );
    },
    testDeadline,
  );

  test(
    'independent duplicate keys reject in relations, with both source positions',
    async () => {
      await usingFixture(
        {
          'opaque.ts':
            imports +
            `
export type First=Opaque<'first','handle'>;
export type Duplicate=Opaque<'second','handle'>;
export type Host=Module<'host',{core:[First,Duplicate]}>;
`,
        },
        async (input) => {
          const result = await runNative(input, 'relations');
          accepted(result.resolved);
          if (!result.relations) throw new Error('Relations did not run');
          const diagnostics = rejected(result.relations, 'relations', 'DuplicateKey');
          const duplicate = diagnostics.find((d) => d.code === 'DuplicateKey');
          expect(duplicate?.at.path).toBe('architecture/opaque.ts');
          expect(duplicate?.related.some((at) => at.path === 'architecture/opaque.ts')).toBe(true);
        },
      );
    },
    testDeadline,
  );

  test(
    'generic applications cannot hide independently repeated opaque keys',
    async () => {
      await usingFixture(
        {
          'opaque.ts':
            imports +
            `
type Handle<D extends string>=Opaque<D,'handle'>;
export type First=Handle<'first'>;
export type Duplicate=Handle<'second'>;
export type Host=Module<'host',{core:[First,Duplicate]}>;
`,
        },
        async (input) => {
          const result = await runNative(input, 'relations');
          accepted(result.resolved);
          if (!result.relations) throw new Error('Relations did not run');
          rejected(result.relations, 'relations', 'DuplicateKey');
        },
      );
    },
    testDeadline,
  );

  test(
    'transparent aliases do not create duplicate opaque definitions',
    async () => {
      await usingFixture(
        {
          'opaque.ts':
            imports +
            `
export type Handle=Opaque<'handle','handle'>;
export type Alias=Handle;
export type Other=Opaque<'other','other'>;
export type Host=Module<'host',{core:[Handle,Other]}>;
`,
        },
        async (input) => {
          const result = await runNative(input, 'relations');
          const design = accepted(result.resolved);
          expect(element(design, 'Alias').kind).toBe('Auxiliary');
          if (!result.relations) throw new Error('Relations did not run');
          accepted(result.relations);
        },
      );
    },
    testDeadline,
  );
});

describe('source occurrences survive canonical normalization', () => {
  test(
    'duplicate aliases retain distinct use and related positions',
    async () => {
      await usingFixture(
        {
          'occurrences.ts':
            imports +
            `
export type Atom=Value<'atom',string>;
export type Alias=Atom;
export type Host=Module<'host',{core:[Atom,Alias]}>;
`,
        },
        async (input) => {
          const result = await runNative(input, 'relations');
          const design = accepted(result.resolved);
          const host = element(design, 'Host');
          if (host.kind !== 'Module') throw new Error('Expected Module');
          expect(host.core[0]!.target).toBe(host.core[1]!.target);
          expect(host.core[0]!.at).not.toEqual(host.core[1]!.at);
          if (!result.relations) throw new Error('Relations did not run');
          const diagnostics = rejected(result.relations, 'relations', 'DuplicateKey');
          const duplicate = diagnostics.find((d) => d.code === 'DuplicateKey')!;
          expect(duplicate.at).not.toEqual(duplicate.related[0]);
        },
      );
    },
    testDeadline,
  );

  test(
    'repeated scenario facts and actors retain their own tuple positions',
    async () => {
      await usingFixture(
        {
          'occurrences.ts':
            base +
            `
import type {Scenario,Step} from '../dsl/dsl.ts';
export type Host=Module<'host',{core:[Atom,Mode];ports:[Port];requires:[Port]}>;
export type Walk=Scenario<'two independent calls',[
  Step<Host,OpRef<Port,'read'>,'done'>,
  Step<Host,OpRef<Port,'read'>,'done'>
]>;
`,
        },
        async (input) => {
          const design = accepted((await runNative(input)).resolved);
          const scenario = element(design, 'Walk');
          if (scenario.kind !== 'Scenario') throw new Error('Expected Scenario');
          const [first, second] = scenario.steps;
          if (first?.kind !== 'Call' || second?.kind !== 'Call') throw new Error('Expected calls');
          expect(second.at.line).toBe(first.at.line + 1);
          expect(second.actor.at.line).toBe(first.actor.at.line + 1);
          expect(second.fact.via.connection.at.line).toBe(first.fact.via.connection.at.line + 1);
        },
      );
    },
    testDeadline,
  );
});

describe('native semantic boundary', () => {
  test(
    'Family lambda references its ordinary HKT helper, not the Family itself',
    async () => {
      await usingFixture(
        {
          'family.ts':
            imports +
            `
interface ListF extends TypeLambda {readonly type:readonly this['A'][]}
export type ListFamily=Family<'list constructor',ListF>;
`,
        },
        async (input) => {
          const design = accepted((await runNative(input)).resolved);
          expect(element(design, 'ListF').kind).toBe('Auxiliary');
          const family = element(design, 'ListFamily');
          if (family.kind !== 'Family') throw new Error('ListFamily did not resolve as Family');
          expect(family.lambda.references.map((reference) => reference.target)).toEqual([
            'architecture/family.ts#ListF',
          ]);
          expect(family.lambda.references.some((reference) => reference.target === family.id)).toBe(false);
        },
      );
    },
    testDeadline,
  );

  test(
    'Family lambda references its concrete generic HKT helper with its actual argument',
    async () => {
      await usingFixture(
        {
          'family.ts':
            imports +
            equal +
            `
interface KeyedF<K extends string> extends TypeLambda {readonly type:ReadonlyMap<K,this['A']>}
export type KeyedFamily=Family<'keyed constructor',KeyedF<'request'>>;
export type Concrete=Apply<'concrete map',KeyedFamily,Value<'payload',number>>;
type Projection=Assert<Equal<Shape<Concrete>,ReadonlyMap<'request',number>>>;
`,
        },
        async (input) => {
          const design = accepted((await runNative(input)).resolved);
          expect(element(design, 'KeyedF')).toMatchObject({ kind: 'Auxiliary', generic: true });
          const family = element(design, 'KeyedFamily');
          if (family.kind !== 'Family') throw new Error('KeyedFamily did not resolve as Family');
          expect(family.lambda.references.map((reference) => reference.target)).toEqual([
            'architecture/family.ts#KeyedF',
          ]);
          expect(family.lambda.references.some((reference) => reference.target === family.id)).toBe(false);
          expect(family.lambda.text).toContain('request');
          const concrete = data(design, 'Concrete');
          if (concrete.kind !== 'Apply') throw new Error('Concrete did not resolve as Apply');
          expect(concrete.lambda.references.map((reference) => reference.target)).toEqual([family.id]);
          expect(concrete.argument).toMatchObject({ kind: 'Value', value: { kind: 'Scalar' } });
        },
      );
    },
    testDeadline,
  );

  test(
    'regular recursive Tree<T> resolves finitely and retains concrete fields across described branches',
    async () => {
      await usingFixture(
        {
          'tree.ts':
            imports +
            equal +
            `
export type Tree<T extends string>=Choice<'tree',{
  Leaf:Case<'leaf',{value:Value<'leaf value',T>}>;
  Branch:Case<'branch',{value:Value<'branch value',T>;children:Tuple<'children',[Tree<T>,Tree<T>]>}>;
}>;
export type RequestTree=Tree<'request'>;
export type OtherTree=Tree<'other'>;
type LeafProjection=Assert<Equal<Extract<Shape<RequestTree>,{case:'Leaf'}>['fields']['value'],'request'>>;
type BranchProjection=Assert<Equal<Extract<Shape<RequestTree>,{case:'Branch'}>['fields']['value'],'request'>>;
`,
        },
        async (input) => {
          const design = accepted((await runNative(input)).resolved);
          expect(element(design, 'Tree')).toMatchObject({ kind: 'Auxiliary', generic: true });
          for (const [name, argument] of [
            ['RequestTree', 'request'],
            ['OtherTree', 'other'],
          ] as const) {
            const tree = data(design, name);
            if (tree.kind !== 'Application') throw new Error(`${name} lost its generic application`);
            expect(tree.definition.target).toBe('architecture/tree.ts#Tree');
            expect(tree.arguments).toHaveLength(1);
            expect(tree.arguments[0]!.text).toContain(argument);
            const resolved = tree.resolved;
            if (resolved.kind !== 'Choice') throw new Error(`${name} lost its described branches`);
            expect(resolved.cases.map((branch) => branch.name)).toEqual(['Leaf', 'Branch']);
            for (const branch of resolved.cases) {
              const value = branch.fields.find((field) => field.name === 'value')?.value;
              if (value?.kind !== 'Value' || value.value.kind !== 'Scalar')
                throw new Error(`${name}.${branch.name} lost its concrete value`);
              expect(value.value.type.text).toContain(argument);
            }
            const children = resolved.cases
              .find((branch) => branch.name === 'Branch')
              ?.fields.find((field) => field.name === 'children')?.value;
            if (children?.kind !== 'Tuple') throw new Error(`${name}.Branch lost its recursive children`);
            expect(children.items).toHaveLength(2);
            for (const child of children.items)
              expect(child).toMatchObject({ kind: 'Reference', target: 'architecture/tree.ts#Tree' });
          }
        },
      );
    },
    testDeadline,
  );
});
