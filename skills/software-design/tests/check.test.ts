/** 用真实 VDMJ 跑 CLI：每个用例在自有 /tmp 工作区里改一处，看 check 是否接受或在正确位置拒绝。 */
import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const CLI = resolve(import.meta.dir, '..', 'scripts', 'design.ts');
const roots: string[] = [];
// 每个用例都要启动几次 JVM 跑 VDMJ，默认的 5 秒不够。
setDefaultTimeout(60_000);

const FENCE = '```';

const SHARED = `# 共用材料

${FENCE}vdm
module Jobs
exports types JobId; struct Spec
definitions
types
  -- 作业身份；使用方不读结构
  JobId = token;

  -- 提交的作业
  Spec ::
    command : seq1 of char;  -- 要执行的命令行
end Jobs
${FENCE}
`;

const QUEUE = `# 队列连接

${FENCE}vdm
module Queue
imports from Jobs types JobId renamed JobId; Spec renamed Spec
exports
  operations Submit: Spec ==> JobId; Complete: JobId ==> ()
definitions
  -- 队列状态
state Queues of
  held : set of JobId  -- 已被领取、尚未完成的作业
  init q == q = mk_Queues({})
end

operations
  -- 提交一项作业
  Submit(s: Spec) r: JobId
  ext rd held
  post r not in set held;

  -- 报告完成
  Complete(j: JobId)
  ext wr held
  pre j in set held
  post held = held~ \\ {j};
end Queue
${FENCE}
`;

const BILLING = `# 出账接入

${FENCE}vdm
module Billing
imports from Jobs types Spec renamed Spec, from Queue operations Submit renamed Submit
exports all
definitions
operations
  -- 月末提交一次出账作业
  Bill: Spec ==> ()
  Bill(s) == let - = Submit(s) in skip;
end Billing
${FENCE}
`;

function cli(...args: string[]): { readonly code: number; readonly out: string } {
  const run = Bun.spawnSync(['bun', CLI, ...args]);
  return { code: run.exitCode ?? 1, out: `${run.stdout.toString()}${run.stderr.toString()}` };
}

/** 一份通过检查的最小设计：根模块、一个子模块、一个业务单元。 */
function fixture(): string {
  const root = mkdtempSync('/tmp/software-design-check-');
  roots.push(root);
  const design = join(root, 'design');
  expect(cli('init', root).code).toBe(0);
  expect(cli('module', design, 'queue').code).toBe(0);
  expect(cli('unit', design, 'billing').code).toBe(0);
  write(design, 'architecture/README.md', '# 作业系统\n\n负责接受作业；不负责执行命令。\n\n## 语义\n\n完成之前作业由 ``Queue`Queues.held`` 记录。\n');
  write(design, 'architecture/jobs.md', SHARED);
  write(design, 'architecture/queue/README.md', '# 队列\n\n负责持有作业；不负责执行。\n');
  write(design, 'architecture/queue/queue.md', QUEUE);
  write(design, 'business/billing/README.md', '# 出账\n\n负责月末出账。\n\n## 需求\n\n每月提交一次，经 ``Queue`Submit`` 接入。\n');
  write(design, 'business/billing/billing.md', BILLING);
  const main = readFileSync(join(design, 'README.md'), 'utf8')
    .replace('- [architecture/README.md](architecture/README.md)\n', '- [architecture/README.md](architecture/README.md)\n- [architecture/jobs.md](architecture/jobs.md)\n')
    .replace('- [architecture/queue/README.md](architecture/queue/README.md)\n', '- [architecture/queue/README.md](architecture/queue/README.md)\n- [architecture/queue/queue.md](architecture/queue/queue.md)\n')
    .replace('- [business/billing/README.md](business/billing/README.md)\n', '- [business/billing/README.md](business/billing/README.md)\n- [business/billing/billing.md](business/billing/billing.md)\n');
  writeFileSync(join(design, 'README.md'), main);
  return design;
}

function write(design: string, path: string, text: string): void {
  writeFileSync(join(design, path), text);
}

function edit(design: string, path: string, from: string, to: string): void {
  const text = readFileSync(join(design, path), 'utf8');
  expect(text).toContain(from);
  writeFileSync(join(design, path), text.replace(from, to));
}

function rejected(design: string, location: string, message: string): void {
  const run = cli('check', design);
  expect(run.code).toBe(1);
  expect(run.out).toMatch(new RegExp(`${location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\d+: \\[[a-z]+\\] .*${message}`));
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('check', () => {
  test('SKILL.md 引用的示例设计通过检查', () => {
    const run = cli('check', resolve(import.meta.dir, '..', 'references', 'example', 'design'));
    expect(run.code).toBe(0);
  });

  test('完整设计通过，并报告证明义务', () => {
    const run = cli('check', fixture());
    expect(run.code).toBe(0);
    expect(run.out).toContain('通过：3 个模块');
    expect(run.out).toMatch(/证明义务 \d+ 条/);
  });

  test('类型错误由 VDMJ 定位到 Markdown 文件的行', () => {
    const design = fixture();
    edit(design, 'architecture/queue/queue.md', 'post r not in set held;', 'post r not in set held and r + 1 = 2;');
    // 这一行在 queue.md 的第 19 行：VDMJ 的行号就是 Markdown 的行号。
    const run = cli('check', design);
    expect(run.code).toBe(1);
    expect(run.out).toContain('architecture/queue/queue.md:19: [typecheck] Error');
  });

  test('架构模块不得引用业务模块', () => {
    const design = fixture();
    edit(design, 'architecture/queue/queue.md', 'imports from Jobs types JobId renamed JobId; Spec renamed Spec', 'imports from Jobs types JobId renamed JobId; Spec renamed Spec, from Billing operations Bill renamed Bill');
    rejected(design, 'architecture/queue/queue.md', '不得引用业务模块 Billing');
  });

  test('父模块不得依赖子模块', () => {
    const design = fixture();
    edit(design, 'architecture/jobs.md', 'module Jobs\n', 'module Jobs\nimports from Queue operations Complete renamed Complete\n');
    rejected(design, 'architecture/jobs.md', '父模块 Jobs 不得依赖子模块 Queue');
  });

  test('业务单元之间的依赖不成环', () => {
    const design = fixture();
    expect(cli('unit', design, 'ledger').code).toBe(0);
    write(design, 'business/ledger/README.md', '# 账本\n\n负责记账。\n');
    write(design, 'business/ledger/ledger.md', `# 账本

${FENCE}vdm
module Ledger
imports from Billing operations Bill renamed Bill
exports all
definitions
values
  -- 账本的版本
  Version : nat = 1;
end Ledger
${FENCE}
`);
    edit(design, 'README.md', '- [business/ledger/README.md](business/ledger/README.md)\n', '- [business/ledger/README.md](business/ledger/README.md)\n- [business/ledger/ledger.md](business/ledger/ledger.md)\n');
    edit(design, 'business/billing/billing.md', 'from Queue operations Submit renamed Submit', 'from Queue operations Submit renamed Submit, from Ledger values Version renamed Version');
    rejected(design, 'business/billing/billing.md', '依赖成环');
  });

  test('每个定义都要有说明注释', () => {
    const design = fixture();
    edit(design, 'architecture/queue/queue.md', '  -- 报告完成\n', '');
    rejected(design, 'architecture/queue/queue.md', 'Queue`Complete 前面缺少说明');
  });

  test('记录与状态的每个字段都要有说明注释', () => {
    const design = fixture();
    edit(design, 'architecture/jobs.md', 'command : seq1 of char;  -- 要执行的命令行', 'command : seq1 of char;');
    rejected(design, 'architecture/jobs.md', 'Jobs`Spec.command 缺少说明');
  });

  test('文字只能引用规格里存在的名字', () => {
    const design = fixture();
    edit(design, 'business/billing/README.md', '``Queue`Submit``', '``Queue`Enqueue``');
    rejected(design, 'business/billing/README.md', 'Queue`Enqueue`` 指向的规格元素不存在');
  });

  test('README 标题后先写负责范围', () => {
    const design = fixture();
    write(design, 'architecture/queue/README.md', '# 队列\n\n## 依据\n\n来源：示例。\n');
    rejected(design, 'architecture/queue/README.md', '先写一段');
  });

  test('README 的二级标题按固定次序且不另起', () => {
    const design = fixture();
    write(design, 'architecture/queue/README.md', '# 队列\n\n负责持有作业。\n\n## 语义\n\n一句。\n\n## 依据\n\n来源。\n\n## 实现\n\n一句。\n');
    const run = cli('check', design);
    expect(run.code).toBe(1);
    expect(run.out).toContain('二级标题按 依据、为什么、语义 的次序排列');
    expect(run.out).toContain('其余内容放进按内容命名的主题文件');
  });

  test('每个文件都在 README.md 的阅读次序里', () => {
    const design = fixture();
    edit(design, 'README.md', '- [architecture/jobs.md](architecture/jobs.md)\n', '');
    rejected(design, 'README.md', 'architecture/jobs.md 不在阅读次序里');
  });

  test('规格必须写在具名模块里，一个文件一个模块', () => {
    const design = fixture();
    write(design, 'architecture/flat.md', `# 散落\n\n${FENCE}vdm\nvalues\n  -- 一个值\n  X : nat = 1;\n${FENCE}\n`);
    edit(design, 'README.md', '- [architecture/jobs.md](architecture/jobs.md)\n', '- [architecture/jobs.md](architecture/jobs.md)\n- [architecture/flat.md](architecture/flat.md)\n');
    rejected(design, 'architecture/flat.md', '具名的 module');
  });

  test('QuickCheck 的反例使检查失败', () => {
    const design = fixture();
    edit(design, 'business/billing/billing.md', 'operations\n', 'functions\n  -- 前一个数\n  Prev: nat -> nat\n  Prev(x) == x - 1;\n\noperations\n');
    rejected(design, 'business/billing/billing.md', '证明义务有反例');
  });

  test('目录只放约定的文件', () => {
    const design = fixture();
    write(design, 'architecture/Notes.txt', '随手笔记');
    rejected(design, 'architecture/Notes.txt', '只放 README.md');
  });

  test('规格里比较字符串内容是反模式', () => {
    const design = fixture();
    edit(design, 'business/billing/billing.md', 'operations\n', 'functions\n  -- 是不是日报\n  IsDaily: seq of char -> bool\n  IsDaily(k) == k = "daily";\n\noperations\n');
    rejected(design, 'business/billing/billing.md', 'Billing`IsDaily：规格里出现了字符串字面量');
  });

  test('显式体里改状态是实现，不是设计', () => {
    const design = fixture();
    edit(design, 'architecture/queue/queue.md', 'exports\n  operations ', 'exports\n  operations Reset: () ==> (); ');
    edit(design, 'architecture/queue/queue.md', 'end Queue', '  -- 清空持有的作业\n  Reset: () ==> ()\n  Reset() == held := {};\nend Queue');
    rejected(design, 'architecture/queue/queue.md', 'Queue`Reset：显式体里有赋值语句');
  });

  test('post 恒为 true 的隐式定义不承诺任何东西', () => {
    const design = fixture();
    edit(design, 'business/billing/billing.md', 'end Billing', '  -- 看一眼\n  Peek(n: nat)\n  post true;\nend Billing');
    rejected(design, 'business/billing/billing.md', 'Billing`Peek：隐式定义的 post 恒为 true');
  });

  test('同一个类型在两个模块里各展开一次，它就有两种解释', () => {
    const design = fixture();
    edit(design, 'architecture/jobs.md', 'command : seq1 of char;  -- 要执行的命令行\n', 'command : seq1 of char;  -- 要执行的命令行\n\n  -- 作业的优先级\n  Priority = <High> | <Low>;\n');
    edit(design, 'architecture/queue/queue.md', 'definitions\n', 'definitions\ntypes\n  -- 作业的优先级\n  Priority = <Urgent> | <Normal> | <Idle>;\n\n');
    rejected(design, 'architecture/queue/queue.md', '类型 Priority 在 Jobs、Queue 里各展开了一次');
  });

  test('规格里没人用的定义只是一个名字', () => {
    const design = fixture();
    edit(design, 'architecture/queue/queue.md', '  -- 队列状态', '  -- 一个没人用的类型\n  Orphan = token;\n\n  -- 队列状态');
    edit(design, 'architecture/queue/queue.md', 'definitions\n', 'definitions\ntypes\n');
    rejected(design, 'architecture/queue/queue.md', 'Queue`Orphan：规格里没有任何地方用到它');
  });

  test('字段的行尾注释不算下一个定义的说明', () => {
    const design = fixture();
    edit(design, 'architecture/jobs.md', 'command : seq1 of char;  -- 要执行的命令行\n', 'command : seq1 of char;  -- 要执行的命令行\n  Other = token;\n');
    edit(design, 'architecture/jobs.md', 'struct Spec', 'struct Spec; Other');
    rejected(design, 'architecture/jobs.md', 'Jobs`Other 前面缺少说明');
  });

  test('正文里的代码块只用 vdm 与图、文法', () => {
    const design = fixture();
    edit(design, 'architecture/queue/README.md', '负责持有作业；不负责执行。\n', `负责持有作业；不负责执行。\n\n${FENCE}ts\nconst queue = 1;\n${FENCE}\n`);
    rejected(design, 'architecture/queue/README.md', '代码块只用 vdm、mermaid、ebnf、text，这里是「ts」');
  });

  test('图与文法块里的 TypeScript 声明要写成规格', () => {
    const design = fixture();
    edit(design, 'architecture/queue/README.md', '负责持有作业；不负责执行。\n', `负责持有作业；不负责执行。\n\n${FENCE}text\nexport type Held = { readonly id: JobId };\n${FENCE}\n`);
    rejected(design, 'architecture/queue/README.md', 'text 块里是 TypeScript 声明');
  });

  test('文字段落里的 TypeScript 声明要写成规格', () => {
    const design = fixture();
    edit(design, 'architecture/queue/README.md', '负责持有作业；不负责执行。\n', '负责持有作业；不负责执行。\n\ninterface Holder { hold(id: JobId): void }\n');
    rejected(design, 'architecture/queue/README.md', '这段文字是 TypeScript 声明');
  });

  test('Mermaid 图可以通过，并计入形式统计', () => {
    const design = fixture();
    edit(design, 'architecture/queue/README.md', '负责持有作业；不负责执行。\n', `负责持有作业；不负责执行。\n\n${FENCE}mermaid\nflowchart TB\n  Submit --> Held\n  Held --> Done\n${FENCE}\n`);
    const run = cli('check', design);
    expect(run.code).toBe(0);
    expect(run.out).toContain('图与文法 3 行');
  });
});
