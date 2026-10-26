/** 逐项判断：用真实 VDMJ 跑 CLI，每个用例在自有 /tmp 工作区里放示例设计与台账，看工具是否逐项要求判断。 */
import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const CLI = resolve(import.meta.dir, '..', 'scripts', 'design.ts');
const EXAMPLE = resolve(import.meta.dir, '..', 'references', 'example', 'design');
const roots: string[] = [];
setDefaultTimeout(120_000);

const REQUEST = '# 需求\n\n- 调用方用同一个请求号重复开始运行，系统只产生一次运行。\n';

function cli(...args: string[]): { readonly code: number; readonly out: string } {
  const run = Bun.spawnSync(['bun', CLI, ...args]);
  return { code: run.exitCode ?? 1, out: `${run.stdout.toString()}${run.stderr.toString()}` };
}

function put(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** 示例设计，加上一条需求与 fable 写下的一条应有约束。 */
function workspace(): { readonly root: string; readonly design: string } {
  const root = mkdtempSync('/tmp/ssot-judge-');
  roots.push(root);
  const design = join(root, 'design');
  cpSync(EXAMPLE, design, { recursive: true });
  put(root, 'request.md', REQUEST);
  put(root, '.tmp/ssot-verify/fable/materials.yaml', 'materials: [request.md]\n');
  put(
    root,
    '.tmp/ssot-verify/fable/expect/expect.yaml',
    `shape: {requirements: 重复开始只产生一次运行, perspectives: 调用方与运行表, modules: Run 持有运行表}
requirements:
  - block: {path: request.md, heading: [需求], text: 调用方用同一个请求号重复开始运行，系统只产生一次运行。}
    argument: {constraints: [E1], why: 同一请求号只对应一个运行，所以重复开始不会产生第二个运行}
constraints:
  - {id: E1, object: 请求号, kind: index, varies: 调用次数, invariant: 同一请求号只对应一个运行, violation: 第二次开始换了运行, category: transition, owner: {dir: architecture}}
`,
  );
  return { root, design };
}

/** 整体对照判完并盖章：细查之前的门槛。dir 为 null 时判整份设计（不带范围）。 */
function overview(root: string, design: string, dir: string | null): void {
  const dirs = dir ? [dir] : ['architecture', 'architecture/attempt', 'business/report'];
  const items = [...dirs.map((d) => `${d}#shape`), ...(dir ? [] : ['design#overall'])];
  put(root, `.tmp/ssot-verify/fable/overview/${dir ? dir.replaceAll('/', '-') : 'all'}.yaml`, `overview:\n${items.map((i) => `  - {item: "${i}", verdict: ok, reason: 看过}`).join('\n')}\n`);
  expect(cli('verify', 'overview', design, '--as', 'fable', ...(dir ? ['--dir', dir] : []), '--stamp').code).toBe(0);
}

/** 一份能通过 ssot draft status 的最小草稿：一条需求落到一条归日报单元的约束。 */
function draft(root: string): void {
  put(
    root,
    '.tmp/ssot-draft/draft.yaml',
    `materials: [request.md]
requirements:
  - block: {path: request.md, heading: [需求], text: 调用方用同一个请求号重复开始运行，系统只产生一次运行。}
    argument: {constraints: [C1], why: 结局交给调用方}
objects:
  - {id: O1, name: 日报运行, kind: execution, identity: 请求号, residue: 无}
constraints:
  - {id: C1, object: O1, varies: 调用次数, invariant: 结局交给调用方, violation: 吞掉结局, not_promised: 无, rerun: 不必改, scope: 对象正确, category: transition, owner: {layer: business, holder: report}}
`,
  );
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('verify', () => {
  test('没有记录的义务报缺判，并给出可以照填的骨架', () => {
    const { root, design } = workspace();
    overview(root, design, 'business/report');
    const run = cli('verify', 'elements', design, '--as', 'fable', '--dir', 'business/report');
    expect(run.code).toBe(1);
    expect(run.out).toContain('错误 [elements] Report`Daily：缺判');
    expect(run.out).toContain('element: "Report`Daily"');
    // 范围之外的元素不在这次的义务里。
    expect(run.out).not.toContain('Run`Start：缺判');
  });

  test('整体对照没判完，逐项细查拒绝往下核对', () => {
    const { design } = workspace();
    const run = cli('verify', 'elements', design, '--as', 'fable', '--dir', 'business/report');
    expect(run.code).toBe(1);
    expect(run.out).toContain('overview 还有错误');
    expect(run.out).not.toContain('Report`Daily：缺判');
  });

  test('盖章后依据改了就过期，逐条确认后恢复', () => {
    const { root, design } = workspace();
    overview(root, design, 'business/report');
    const slot = (name: string, verdict = 'ok') => `${name}: {verdict: ${verdict}, reason: 看过}`;
    const common = ['comment_meaning', 'signature', 'nonvacuous', 'wording', 'action_words', 'design_reason'].map((s) => slot(s));
    const reads = (name: string) => `${name}: {verdict: ok, reason: 看过, at: ["Report\`Daily"]}`;
    const daily = [...common, slot('predicate_promise', 'not_applicable'), reads('bias')].join(', ');
    const outcome = [...common, slot('predicate_promise', 'not_applicable'), reads('bias'), slot('struct_exposure'), slot('outcomes'), slot('recovery', 'not_applicable'), slot('consumption', 'not_applicable')].join(', ');
    put(
      root,
      '.tmp/ssot-verify/fable/elements/report.yaml',
      `elements:\n  - {element: "Report\`Daily", verdict: guards, constraints: [E1], reason: 日报的先后, ${daily}}\n  - {element: "Report\`DailyOutcome", verdict: guards, constraints: [E1], reason: 结局, ${outcome}}\n`,
    );
    const scope = ['verify', 'elements', design, '--as', 'fable', '--dir', 'business/report'];
    expect(cli(...scope).out).toContain('还没盖章');
    expect(cli(...scope, '--stamp').code).toBe(0);
    expect(cli(...scope).code).toBe(0);

    const spec = join(design, 'business/report/report.md');
    writeFileSync(spec, readFileSync(spec, 'utf8').replace('再结束它', '最后结束它'));
    // 目录的规格变了，整体对照先过期，细查等它重新确认。
    expect(cli(...scope).out).toContain('overview 还有错误');
    expect(cli('verify', 'overview', design, '--as', 'fable', '--dir', 'business/report', '--stamp', 'business/report#shape').code).toBe(0);
    const stale = cli(...scope);
    expect(stale.code).toBe(1);
    expect(stale.out).toContain('过期：主体');
    // 只写 --stamp 不会替判断者确认过期的记录。
    expect(cli(...scope, '--stamp').code).toBe(1);
    // DailyOutcome 的判断引用了 Daily 的原文，一起过期，一起确认。
    expect(cli(...scope, '--stamp', 'Report`Daily', '--stamp', 'Report`DailyOutcome').code).toBe(0);
  });

  test('判为有问题却没给位置与修法，不算判完', () => {
    const { root, design } = workspace();
    overview(root, design, 'business/report');
    put(root, '.tmp/ssot-verify/fable/modules/report.yaml', 'modules:\n  - {item: "business/report#composition", verdict: problem, reason: 日报持有了状态}\n');
    const run = cli('verify', 'modules', design, '--as', 'fable', '--dir', 'business/report');
    expect(run.out).toContain('business/report#composition.at：判为有问题，要指出设计里的位置');
    expect(run.out).toContain('business/report#composition.fix：判为有问题，要写出修法');
  });

  test('判 ok 等于断言某样东西存在时，没指出它在哪里不算判完', () => {
    const { root, design } = workspace();
    overview(root, design, 'business/report');
    put(root, '.tmp/ssot-verify/fable/elements/report.yaml', 'elements:\n  - {element: "Report`DailyOutcome", verdict: guards, constraints: [E1], reason: 结局, consumption: {verdict: ok, reason: 有人用}}\n');
    const run = cli('verify', 'elements', design, '--as', 'fable', '--dir', 'business/report');
    expect(run.out).toContain('consumption.at：判为 ok 要指出使用它的位置');
  });

  test('问题位置写成规格元素时，报告补上它在设计源文的文件与行号', () => {
    const { root, design } = workspace();
    overview(root, design, 'business/report');
    put(root, '.tmp/ssot-verify/fable/modules/report.yaml', 'modules:\n  - {item: "business/report#token_origin", verdict: problem, reason: 自造了运行号, at: ["Report`Daily"], fix: 运行号取自 Start 的结局}\n');
    const run = cli('verify', 'modules', design, '--as', 'fable', '--dir', 'business/report');
    expect(run.out).toMatch(/Report`Daily（business\/report\/report\.md:2[23]）/);
  });

  test('根 README.md 的行可以作为位置引用', () => {
    const { root, design } = workspace();
    overview(root, design, null);
    put(root, '.tmp/ssot-verify/fable/modules/design.yaml', 'modules:\n  - {item: "design#navigation", verdict: problem, reason: 写了规则, at: ["README.md:1"], fix: 只留阅读次序}\n');
    const run = cli('verify', 'modules', design, '--as', 'fable');
    expect(run.out).not.toContain('README.md:1 找不到');
    expect(run.out).toContain('navigation（design/README.md 只列阅读次序，不写规则）有问题');
  });

  test('应有的持有目录设计里还没有：报设计缺目录，归属不能判为一致', () => {
    const { root, design } = workspace();
    const expectFile = join(root, '.tmp/ssot-verify/fable/expect/expect.yaml');
    writeFileSync(expectFile, readFileSync(expectFile, 'utf8').replace('owner: {dir: architecture}', 'owner: {dir: business/nightly}'));
    const run = cli('verify', 'expect', design, '--as', 'fable');
    expect(run.code).toBe(0);
    expect(run.out).toContain('设计里没有目录 business/nightly');
    put(root, '.tmp/ssot-verify/fable/owner/owner.yaml', 'owners:\n  - {constraint: E1, actual: ["Run`Start"], verdict: match, reason: 写在运行表}\n');
    expect(cli('verify', 'owner', design, '--as', 'fable').out).toContain('在设计里不存在，归属不可能一致');
  });

  test('被调连接的结局多了一支，场景里这处调用的记录过期', () => {
    const { root, design } = workspace();
    overview(root, design, 'business/report');
    const skeleton = cli('verify', 'scenarios', design, '--as', 'fable', '--dir', 'business/report').out;
    const node = /node: "?(Report`Daily\/[^"\n]*call Start)"?/.exec(skeleton)?.[1];
    expect(node).toBeDefined();
    const assess = (verdict: string) => `{verdict: ${verdict}, reason: 看过, at: ["Report\`Daily"]}`;
    put(root, '.tmp/ssot-verify/fable/scenarios/report.yaml', `scenarios:\n  - {node: "${node}", verdict: constraint, constraints: [E1], reason: 开始, outcomes: ${assess('ok')}, admission: ${assess('ok')}}\n`);
    cli('verify', 'scenarios', design, '--as', 'fable', '--dir', 'business/report', '--stamp');
    expect(cli('verify', 'scenarios', design, '--as', 'fable', '--dir', 'business/report').out).not.toContain(`${node}：过期`);
    const run = join(design, 'architecture/run.md');
    writeFileSync(run, readFileSync(run, 'utf8').replace('StartOutcome = Started | <Rejected> | <Unknown>;', 'StartOutcome = Started | <Rejected> | <Unknown> | <Busy>;'));
    expect(cli('verify', 'scenarios', design, '--as', 'fable', '--dir', 'business/report').out).toContain('过期：主体');
  });

  test('规格允许、又违反关系的调用，求值成立就是反例', () => {
    const { root, design } = workspace();
    const slot = '{verdict: not_applicable, reason: 测试}';
    put(
      root,
      '.tmp/ssot-verify/fable/attack/attack.yaml',
      `attacks:
  - constraint: E1
    initial: ${slot}
    call:
      verdict: counterexample
      reason: Finish 之后运行不再活着
      witness:
        operation: "Run\`Finish"
        args: ["mk_token(1)"]
        before: "mk_Runs({1 |-> mk_token(1)}, {mk_token(1)})"
        after: "mk_Runs({1 |-> mk_token(1)}, {})"
        violates: "mk_token(1) not in set after.live"
    compose: ${slot}
    bypass: ${slot}
    import: ${slot}
`,
    );
    const run = cli('verify', 'attack', design, '--as', 'fable', '--stamp');
    expect(run.code).toBe(0);
    expect(run.out).toContain('call 有反例，约束不成立');
    expect(run.out).toContain('Run`Finish（architecture/run.md:');
  });

  test('反例改了没列进 ext wr 的分量，规格不允许，不算反例', () => {
    const { root, design } = workspace();
    const slot = '{verdict: not_applicable, reason: 测试}';
    put(
      root,
      '.tmp/ssot-verify/fable/attack/attack.yaml',
      `attacks:
  - constraint: E1
    initial: ${slot}
    call:
      verdict: counterexample
      reason: Finish 之后请求号指向了另一个运行
      witness:
        operation: "Run\`Finish"
        args: ["mk_token(1)"]
        before: "mk_Runs({1 |-> mk_token(1)}, {mk_token(1)})"
        after: "mk_Runs({1 |-> mk_token(2)}, {})"
        violates: "before.byRequest(1) <> after.byRequest(1)"
    compose: ${slot}
    bypass: ${slot}
    import: ${slot}
`,
    );
    const run = cli('verify', 'attack', design, '--as', 'fable');
    expect(run.code).toBe(1);
    expect(run.out).toContain('byRequest 没列进 Finish 的 ext wr');
  });
});

describe('draft', () => {
  test('需求材料改写后，旧记录成为孤儿，新的需求块缺判', () => {
    const root = mkdtempSync('/tmp/ssot-judge-');
    roots.push(root);
    put(root, 'request.md', REQUEST);
    put(
      root,
      '.tmp/ssot-draft/draft.yaml',
      `materials: [request.md]
requirements:
  - block: {path: request.md, heading: [需求], text: 调用方用同一个请求号重复开始运行，系统只产生一次运行。}
    excluded: [X1]
excluded:
  - {id: X1, text: 测试, unaffected: 测试}
`,
    );
    expect(cli('draft', 'requirements', root).code).toBe(0);
    put(root, 'request.md', REQUEST.replace('只产生一次', '至多产生一次'));
    const run = cli('draft', 'requirements', root);
    expect(run.code).toBe(1);
    expect(run.out).toContain('材料里已经没有这块需求');
    expect(run.out).toContain('缺判：「调用方用同一个请求号重复开始运行，系统至多产生一次运行。」');
  });

  test('约束不在任何需求的论证里，是多余的', () => {
    const root = mkdtempSync('/tmp/ssot-judge-');
    roots.push(root);
    put(root, 'request.md', REQUEST);
    draft(root);
    const file = join(root, '.tmp/ssot-draft/draft.yaml');
    writeFileSync(file, readFileSync(file, 'utf8').replace('argument: {constraints: [C1], why: 结局交给调用方}', 'excluded: [X1]\nexcluded:\n  - {id: X1, text: 测试, unaffected: 测试}'));
    const run = cli('draft', 'constraints', root);
    expect(run.code).toBe(1);
    expect(run.out).toContain('约束 C1 不在任何需求的论证里');
  });
});

describe('design', () => {
  test('设计端只要求本轮改动的元素对应本轮草稿，没动过的旧元素不在义务里', () => {
    const { root, design } = workspace();
    draft(root);
    expect(cli('draft', 'status', root).out).toContain('已记下本轮开始时的设计基线');
    const report = join(design, 'business/report/report.md');
    writeFileSync(report, readFileSync(report, 'utf8').replace('再结束它', '最后结束它'));
    const run = cli('design', 'elements', design);
    expect(run.out).toContain('错误 [elements] Report`Daily：缺判');
    expect(run.out).toContain('本轮改动（business/report/report.md:');
    expect(run.out).not.toContain('Run`Start：缺判');
    expect(run.out).not.toContain('Report`DailyOutcome：缺判');
  });

  test('没有草稿开始时的基线，设计端拒绝核对，也不在这时补记', () => {
    const { root, design } = workspace();
    draft(root);
    const run = cli('design', 'elements', design);
    expect(run.code).toBe(1);
    expect(run.out).toContain('没有本轮开始时的设计基线');
    expect(cli('design', 'elements', design).out).toContain('没有本轮开始时的设计基线');
  });

  test('本轮动过的模块里，没有任何定义读到的状态分量是实现偏差；记录字段不静态断言', () => {
    const { root, design } = workspace();
    draft(root);
    cli('draft', 'status', root);
    const run = join(design, 'architecture/run.md');
    const text = readFileSync(run, 'utf8')
      .replace('live : set of RunId  -- 已开始、尚未结束的运行', 'live : set of RunId  -- 已开始、尚未结束的运行\n  seen : set of RequestNo  -- 收到过的请求号')
      .replace('inv mk_Runs(b, l) == l subset rng b\n  init r == r = mk_Runs({|->}, {})', 'inv mk_Runs(b, l, -) == l subset rng b\n  init r == r = mk_Runs({|->}, {}, {})')
      .replace('Started ::\n    run : RunId;', 'Started ::\n    run : RunId\n    at : nat;  -- 开始的时刻');
    writeFileSync(run, text);
    const out = cli('design', 'elements', design).out;
    expect(out).toContain('Run`Runs.seen');
    expect(out).toContain('没有任何定义读到状态分量 seen');
    // 记录字段可以经整个记录的相等、集合成员被导出结果区分，不经字段选择也观察得到：工具不断言它不可观察。
    expect(out).not.toContain('Run`Started.at（');
  });

  test('违反情形的实例：post 拒绝它才算守住，接受它就报约束没有守住', () => {
    const { root, design } = workspace();
    draft(root);
    cli('draft', 'status', root);
    const ledger = (rejects: string) =>
      put(root, '.tmp/ssot-design/constraints/c.yaml', `constraints:\n  - constraint: C1\n    landing: [{kind: post, element: "Run\`Start"}]\n    rejects:\n${rejects}`);
    // 同一请求号已经对应运行 1，再开始却交回运行 2：post 不允许。
    ledger(`      - by: post
        operation: "Run\`Start"
        args: ["1"]
        result: "mk_Started(mk_token(2))"
        before: "mk_Runs({1 |-> mk_token(1)}, {mk_token(1)})"
        after: "mk_Runs({1 |-> mk_token(2)}, {mk_token(2)})"
        violates: "result.run <> before.byRequest(1)"
`);
    expect(cli('design', 'constraints', design).out).not.toContain('rejects[0]');
    // 结局为结果未知、运行表不变：post 允许，这个实例不是被拒绝的违反情形。
    ledger(`      - by: post
        operation: "Run\`Start"
        args: ["1"]
        result: "<Unknown>"
        before: "mk_Runs({|->}, {})"
        after: "mk_Runs({|->}, {})"
        violates: "result = <Unknown>"
`);
    expect(cli('design', 'constraints', design).out).toContain('post 接受了这次违反约束的变化');
    // 没给实例：落点有 post 就要有 by: post 的实例。
    put(root, '.tmp/ssot-design/constraints/c.yaml', 'constraints:\n  - constraint: C1\n    landing: [{kind: post, element: "Run`Start"}]\n');
    expect(cli('design', 'constraints', design).out).toContain('落点 post Run`Start 还没有经求值确认的违反实例');
    // 实例的操作不在落点里：别处的 post 拒绝它，不算这条约束守住了。
    ledger(`      - by: post
        operation: "Run\`Finish"
        args: ["mk_token(1)"]
        before: "mk_Runs({1 |-> mk_token(1)}, {mk_token(1)})"
        after: "mk_Runs({1 |-> mk_token(1)}, {mk_token(1)})"
        violates: "true"
`);
    expect(cli('design', 'constraints', design).out).toContain('不是这条约束 post 落点里的元素');
  });

  test('pre 里有不展开的判定：拒绝实例与反例都按准入成立求值', () => {
    const { root, design } = workspace();
    draft(root);
    cli('draft', 'status', root);
    const run = join(design, 'architecture/run.md');
    writeFileSync(
      run,
      readFileSync(run, 'utf8')
        .replace('\noperations\n', '\nfunctions\n  -- 请求是否可以开始；由调用方的规则决定，这里不展开\n  Eligible: RequestNo -> bool\n  Eligible(r) == is not yet specified;\n\noperations\n')
        .replace('  ext wr byRequest wr live\n  post (is_Started(r)', '  ext wr byRequest wr live\n  pre Eligible(request)\n  post (is_Started(r)'),
    );
    put(
      root,
      '.tmp/ssot-design/constraints/c.yaml',
      `constraints:\n  - constraint: C1\n    landing: [{kind: post, element: "Run\`Start"}]\n    rejects:\n      - by: post\n        operation: "Run\`Start"\n        args: ["1"]\n        result: "mk_Started(mk_token(2))"\n        before: "mk_Runs({1 |-> mk_token(1)}, {mk_token(1)})"\n        after: "mk_Runs({1 |-> mk_token(2)}, {mk_token(2)})"\n        violates: "result.run <> before.byRequest(1)"\n`,
    );
    const out = cli('design', 'constraints', design).out;
    expect(out).not.toContain('rejects[0]');
    expect(out).not.toContain('Error 4024');
    // 反例：规格允许结果未知且运行表不变；不展开的准入不归本规格定，不挡住反例。
    const slot = '{verdict: not_applicable, reason: 测试}';
    put(
      root,
      '.tmp/ssot-design/attack/attack.yaml',
      `attacks:\n  - constraint: C1\n    initial: ${slot}\n    call:\n      verdict: counterexample\n      reason: 测试\n      witness:\n        operation: "Run\`Start"\n        args: ["1"]\n        result: "<Unknown>"\n        before: "mk_Runs({|->}, {})"\n        after: "mk_Runs({|->}, {})"\n        violates: "result = <Unknown>"\n    compose: ${slot}\n    bypass: ${slot}\n    import: ${slot}\n`,
    );
    const attack = cli('design', 'attack', design).out;
    expect(attack).toContain('call 有反例，约束不成立');
    expect(attack).not.toContain('Error 4024');
  });

  test('不变式拒绝违反情形：构造时报错才算守住', () => {
    const { root, design } = workspace();
    draft(root);
    cli('draft', 'status', root);
    const ledger = (value: string) =>
      put(root, '.tmp/ssot-design/constraints/c.yaml', `constraints:\n  - constraint: C1\n    landing: [{kind: inv, element: "Run\`Runs"}]\n    rejects:\n      - {by: inv, element: "Run\`Runs", value: "${value}"}\n`);
    ledger('mk_Runs({|->}, {mk_token(1)})');
    expect(cli('design', 'constraints', design).out).not.toContain('rejects[0]');
    ledger('mk_Runs({1 |-> mk_token(1)}, {mk_token(1)})');
    expect(cli('design', 'constraints', design).out).toContain('inv 没有拒绝这个违反情形');
    // 报错的是请求号自己的不变式，不是落点 Runs 的：不算 Runs 守住了。
    ledger('(lambda x : RequestNo & x)(0)');
    expect(cli('design', 'constraints', design).out).toContain('不是 Run`Runs 的不变式拒绝了它');
  });

  test('改成占位的元素不是实现偏差，只要交代来由', () => {
    const { root, design } = workspace();
    draft(root);
    cli('draft', 'status', root);
    const report = join(design, 'business/report/report.md');
    const text = readFileSync(report, 'utf8');
    writeFileSync(report, text.replace(/Daily\(request\) ==[\s\S]*?end;/, 'Daily(request) == is not yet specified;'));
    const out = cli('design', 'elements', design).out;
    expect(out).toContain('Report`Daily：缺判');
    expect(out).not.toContain('实现偏差');
  });

  test('作者在设计时攻击草稿约束：反例由 VDMJ 求值，规格不允许的变化不算反例', () => {
    const { root, design } = workspace();
    draft(root);
    cli('draft', 'status', root);
    const slot = '{verdict: not_applicable, reason: 测试}';
    const attack = (before: string, after: string) =>
      put(
        root,
        '.tmp/ssot-design/attack/attack.yaml',
        `attacks:\n  - constraint: C1\n    initial: ${slot}\n    call:\n      verdict: counterexample\n      reason: 测试\n      witness:\n        operation: "Run\`Status"\n        args: ["1"]\n        result: "mk_token(1)"\n        before: "${before}"\n        after: "${after}"\n        violates: "before.byRequest(1) not in set before.live"\n    compose: ${slot}\n    bypass: ${slot}\n    import: ${slot}\n`,
      );
    // 运行 1 已经结束，Status 却交回它：示例的 post 不允许，不算反例。
    attack('mk_Runs({1 |-> mk_token(1)}, {})', 'mk_Runs({1 |-> mk_token(1)}, {})');
    expect(cli('design', 'attack', design).out).toContain('反例不成立');
    // 运行 1 仍活着时交回它是 post 允许的；violates 却不成立，同样不算反例。
    attack('mk_Runs({1 |-> mk_token(1)}, {mk_token(1)})', 'mk_Runs({1 |-> mk_token(1)}, {mk_token(1)})');
    expect(cli('design', 'attack', design).out).toContain('反例不成立');
  });

  test('作者自攻求值成立的反例是错误：设计不能交付', () => {
    const { root, design } = workspace();
    draft(root);
    cli('draft', 'status', root);
    const slot = '{verdict: not_applicable, reason: 测试}';
    put(
      root,
      '.tmp/ssot-design/attack/attack.yaml',
      `attacks:\n  - constraint: C1\n    initial: ${slot}\n    call:\n      verdict: counterexample\n      reason: Finish 之后运行不再活着\n      witness:\n        operation: "Run\`Finish"\n        args: ["mk_token(1)"]\n        before: "mk_Runs({1 |-> mk_token(1)}, {mk_token(1)})"\n        after: "mk_Runs({1 |-> mk_token(1)}, {})"\n        violates: "mk_token(1) not in set after.live"\n    compose: ${slot}\n    bypass: ${slot}\n    import: ${slot}\n`,
    );
    const run = cli('design', 'attack', design, '--stamp');
    expect(run.code).toBe(1);
    expect(run.out).toContain('改设计直到构造不出这个反例');
  });
});
