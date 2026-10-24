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
    `requirements:
  - block: {path: request.md, heading: [需求], text: 调用方用同一个请求号重复开始运行，系统只产生一次运行。}
    constraints: [E1]
constraints:
  - {id: E1, object: 请求号, kind: index, varies: 调用次数, invariant: 同一请求号只对应一个运行, violation: 第二次开始换了运行, category: transition, owner: {dir: architecture}}
`,
  );
  return { root, design };
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('verify', () => {
  test('没有记录的义务报缺判，并给出可以照填的骨架', () => {
    const { design } = workspace();
    const run = cli('verify', 'elements', design, '--as', 'fable', '--dir', 'business/report');
    expect(run.code).toBe(1);
    expect(run.out).toContain('错误 [elements] Report`Daily：缺判');
    expect(run.out).toContain('element: "Report`Daily"');
    // 范围之外的元素不在这次的义务里。
    expect(run.out).not.toContain('Run`Start：缺判');
  });

  test('盖章后依据改了就过期，逐条确认后恢复', () => {
    const { root, design } = workspace();
    put(root, '.tmp/ssot-verify/fable/elements/report.yaml', 'elements:\n  - {element: "Report`Daily", verdict: guards, constraints: [E1], reason: 日报的先后}\n');
    const scope = ['verify', 'elements', design, '--as', 'fable', '--dir', 'business/report'];
    expect(cli(...scope).out).toContain('还没盖章');
    expect(cli(...scope, '--stamp').code).toBe(0);
    expect(cli(...scope).code).toBe(0);

    const spec = join(design, 'business/report/report.md');
    writeFileSync(spec, readFileSync(spec, 'utf8').replace('再结束它', '最后结束它'));
    const stale = cli(...scope);
    expect(stale.code).toBe(1);
    expect(stale.out).toContain('过期：主体');
    // 只写 --stamp 不会替判断者确认过期的记录。
    expect(cli(...scope, '--stamp').code).toBe(1);
    expect(cli(...scope, '--stamp', 'Report`Daily').code).toBe(0);
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
});
