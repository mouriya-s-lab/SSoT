/** 用真实 VDMJ 跑 CLI：每个用例在自有 /tmp 工作区里改一处，看 check 是否接受或在正确位置拒绝。 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLI = resolve(import.meta.dir, '..', 'scripts', 'design.ts');
const roots: string[] = [];

// 不用 String.raw：Bun 会把模板里的非 ASCII 字符转写成 \u 转义，raw 文本因此不再是原文。
const SHARED = `\\subsection{共用材料}

\\begin{vdm_al}
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
\\end{vdm_al}
`;

const QUEUE = `\\subsection{队列连接}

\\begin{vdm_al}
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
\\end{vdm_al}
`;

const BILLING = `\\subsection{出账接入}

\\begin{vdm_al}
module Billing
imports from Jobs types Spec renamed Spec, from Queue operations Submit renamed Submit
exports all
definitions
operations
  -- 月末提交一次出账作业
  Bill: Spec ==> ()
  Bill(s) == let - = Submit(s) in skip;
end Billing
\\end{vdm_al}
`;

function cli(...args: string[]): { readonly code: number; readonly out: string } {
  const run = Bun.spawnSync(['bun', CLI, ...args]);
  return { code: run.exitCode ?? 1, out: `${run.stdout.toString()}${run.stderr.toString()}` };
}

/** 一份通过检查的最小设计：根模块、一个子模块、一个业务单元。 */
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'software-design-check-'));
  roots.push(root);
  const design = join(root, 'design');
  expect(cli('init', root).code).toBe(0);
  expect(cli('module', design, 'queue').code).toBe(0);
  expect(cli('unit', design, 'billing').code).toBe(0);
  write(design, 'architecture/README.tex', '\\section{作业系统}\n\n负责接受作业；不负责执行命令。\n\n\\subsection{语义}\n\n完成之前作业由 \\vdmref{Queue`Queues.held} 记录。\n');
  write(design, 'architecture/jobs.tex', SHARED);
  write(design, 'architecture/queue/README.tex', '\\section{队列}\n\n负责持有作业；不负责执行。\n');
  write(design, 'architecture/queue/queue.tex', QUEUE);
  write(design, 'business/billing/README.tex', '\\section{出账}\n\n负责月末出账。\n\n\\subsection{需求}\n\n每月提交一次，经 \\vdmref{Queue`Submit} 接入。\n');
  write(design, 'business/billing/billing.tex', BILLING);
  const main = readFileSync(join(design, 'design.tex'), 'utf8')
    .replace('\\input{architecture/README}', '\\input{architecture/README}\n\\input{architecture/jobs}')
    .replace('\\input{architecture/queue/README}', '\\input{architecture/queue/README}\n\\input{architecture/queue/queue}')
    .replace('\\input{business/billing/README}', '\\input{business/billing/README}\n\\input{business/billing/billing}');
  writeFileSync(join(design, 'design.tex'), main);
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
  test('完整设计通过，并报告证明义务', () => {
    const run = cli('check', fixture());
    expect(run.code).toBe(0);
    expect(run.out).toContain('通过：3 个模块');
    expect(run.out).toMatch(/证明义务 \d+ 条/);
  });

  test('类型错误由 VDMJ 定位到文学式文件的行', () => {
    const design = fixture();
    edit(design, 'architecture/queue/queue.tex', 'post r not in set held;', 'post r not in set held and r + 1 = 2;');
    rejected(design, 'architecture/queue/queue.tex', 'Error');
  });

  test('架构模块不得引用业务模块', () => {
    const design = fixture();
    edit(design, 'architecture/queue/queue.tex', 'imports from Jobs types JobId renamed JobId; Spec renamed Spec', 'imports from Jobs types JobId renamed JobId; Spec renamed Spec, from Billing operations Bill renamed Bill');
    rejected(design, 'architecture/queue/queue.tex', '不得引用业务模块 Billing');
  });

  test('父模块不得依赖子模块', () => {
    const design = fixture();
    edit(design, 'architecture/jobs.tex', 'module Jobs\n', 'module Jobs\nimports from Queue operations Complete renamed Complete\n');
    rejected(design, 'architecture/jobs.tex', '父模块 Jobs 不得依赖子模块 Queue');
  });

  test('业务单元之间的依赖不成环', () => {
    const design = fixture();
    expect(cli('unit', design, 'ledger').code).toBe(0);
    write(design, 'business/ledger/README.tex', '\\section{账本}\n\n负责记账。\n');
    write(design, 'business/ledger/ledger.tex', `\\subsection{账本}

\\begin{vdm_al}
module Ledger
imports from Billing operations Bill renamed Bill
exports all
definitions
values
  -- 账本的版本
  Version : nat = 1;
end Ledger
\\end{vdm_al}
`);
    edit(design, 'design.tex', '\\input{business/ledger/README}', '\\input{business/ledger/README}\n\\input{business/ledger/ledger}');
    edit(design, 'business/billing/billing.tex', 'from Queue operations Submit renamed Submit', 'from Queue operations Submit renamed Submit, from Ledger values Version renamed Version');
    rejected(design, 'business/billing/billing.tex', '依赖成环');
  });

  test('每个定义都要有说明注释', () => {
    const design = fixture();
    edit(design, 'architecture/queue/queue.tex', '  -- 报告完成\n', '');
    rejected(design, 'architecture/queue/queue.tex', 'Queue`Complete 前面缺少说明');
  });

  test('记录与状态的每个字段都要有说明注释', () => {
    const design = fixture();
    edit(design, 'architecture/jobs.tex', 'command : seq1 of char;  -- 要执行的命令行', 'command : seq1 of char;');
    rejected(design, 'architecture/jobs.tex', 'Jobs`Spec.command 缺少说明');
  });

  test('文字只能引用规格里存在的名字', () => {
    const design = fixture();
    edit(design, 'business/billing/README.tex', '\\vdmref{Queue`Submit}', '\\vdmref{Queue`Enqueue}');
    rejected(design, 'business/billing/README.tex', 'Queue`Enqueue\\} 指向的规格元素不存在');
  });

  test('README 标题后先写负责范围', () => {
    const design = fixture();
    write(design, 'architecture/queue/README.tex', '\\section{队列}\n\n\\subsection{依据}\n\n来源：示例。\n');
    rejected(design, 'architecture/queue/README.tex', '先写一段');
  });

  test('README 小节按固定次序且不另起小节', () => {
    const design = fixture();
    write(design, 'architecture/queue/README.tex', '\\section{队列}\n\n负责持有作业。\n\n\\subsection{语义}\n\n一句。\n\n\\subsection{依据}\n\n来源。\n\n\\subsection{实现}\n\n一句。\n');
    const run = cli('check', design);
    expect(run.code).toBe(1);
    expect(run.out).toContain('小节按 依据、为什么、语义 的次序排列');
    expect(run.out).toContain('其余内容放进按内容命名的主题文件');
  });

  test('每个文件都在 design.tex 的阅读次序里', () => {
    const design = fixture();
    edit(design, 'design.tex', '\\input{architecture/jobs}\n', '');
    rejected(design, 'design.tex', 'architecture/jobs.tex 不在阅读次序里');
  });

  test('规格必须写在具名模块里，一个文件一个模块', () => {
    const design = fixture();
    write(design, 'architecture/flat.tex', '\\subsection{散落}\n\n\\begin{vdm_al}\nvalues\n  -- 一个值\n  X : nat = 1;\n\\end{vdm_al}\n');
    edit(design, 'design.tex', '\\input{architecture/jobs}', '\\input{architecture/jobs}\n\\input{architecture/flat}');
    rejected(design, 'architecture/flat.tex', '具名的 module');
  });

  test('QuickCheck 的反例使检查失败', () => {
    const design = fixture();
    edit(design, 'business/billing/billing.tex', 'operations\n', 'functions\n  -- 前一个数\n  Prev: nat -> nat\n  Prev(x) == x - 1;\n\noperations\n');
    rejected(design, 'business/billing/billing.tex', '证明义务有反例');
  });

  test('目录只放约定的文件', () => {
    const design = fixture();
    write(design, 'architecture/Notes.md', '随手笔记');
    rejected(design, 'architecture/Notes.md', '只放 README.tex');
  });
});
