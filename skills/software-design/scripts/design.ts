#!/usr/bin/env bun
/** Filesystem generation stays independent of the optional checking environment. */
import { resolve } from 'node:path';
import type { CheckReport, Failure, Result } from './diagnostics.ts';
import type { WorkspaceChange } from './workspace-model.ts';

type Command =
  | { readonly kind: 'Init'; readonly repo: string }
  | { readonly kind: 'Module'; readonly design: string; readonly name: string }
  | { readonly kind: 'Unit'; readonly design: string; readonly name: string }
  | { readonly kind: 'Upgrade'; readonly design: string; readonly check: boolean }
  | { readonly kind: 'Check'; readonly design: string; readonly json: boolean };

type Arguments =
  | { readonly kind: 'Command'; readonly command: Command }
  | { readonly kind: 'Usage'; readonly message: string };

type CheckContext = 'Check' | 'Updated' | 'UpToDate';

const USAGE = `用法：
  bun design.ts init <仓库根>
  bun design.ts module <design> <a/b>
  bun design.ts unit <design> <名字>
  bun design.ts upgrade <design> [--check]
  bun design.ts check <design> [--json]`;

function assertNever(value: never): never {
  throw new Error(`程序错误：未处理的 variant ${String(value)}`);
}

function parseArguments(args: readonly string[]): Arguments {
  const [command, target, option] = args;
  if (!command || !target || target.startsWith('-')) {
    return { kind: 'Usage', message: '需要命令和目录参数；目录不能是选项。' };
  }
  switch (command) {
    case 'init':
      return args.length === 2
        ? { kind: 'Command', command: { kind: 'Init', repo: resolve(target) } }
        : { kind: 'Usage', message: 'init 只接受一个仓库根目录。' };
    case 'module':
    case 'unit':
      return args.length === 3 && option !== undefined && option.length > 0 && !option.startsWith('-')
        ? {
            kind: 'Command',
            command: {
              kind: command === 'module' ? 'Module' : 'Unit',
              design: resolve(target),
              name: option,
            },
          }
        : { kind: 'Usage', message: `${command} 需要设计目录和名字，不接受其他参数。` };
    case 'upgrade':
      return args.length === 2 || (args.length === 3 && option === '--check')
        ? {
            kind: 'Command',
            command: { kind: 'Upgrade', design: resolve(target), check: option === '--check' },
          }
        : { kind: 'Usage', message: 'upgrade 只接受设计目录和可选的 --check。' };
    case 'check':
      return args.length === 2 || (args.length === 3 && option === '--json')
        ? { kind: 'Command', command: { kind: 'Check', design: resolve(target), json: option === '--json' } }
        : { kind: 'Usage', message: 'check 只接受设计目录和可选的 --json。' };
    default:
      return { kind: 'Usage', message: `未知命令：${command}` };
  }
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function rejection(result: Failure, context: CheckContext = 'Check'): number {
  const message =
    context === 'Updated'
      ? '生成文件已更新；设计尚未通过自动结构检查。'
      : context === 'UpToDate'
        ? '生成文件已是当前契约；设计尚未通过自动结构检查。'
        : undefined;
  console.error(JSON.stringify(message === undefined ? result : { ...result, message }, null, 2));
  return result.diagnostics.some(
    (diagnostic) => diagnostic.code === 'CompilerUnavailable' || diagnostic.code === 'MissingDependency',
  )
    ? 2
    : 1;
}

function generated(result: Result<WorkspaceChange>): number {
  if (result.kind === 'Rejected') return rejection(result);
  printJson(result.value);
  return 0;
}

function printReport(report: CheckReport): void {
  console.log('自动结构检查通过；设计语义尚需人工审查（ManualReviewRequired）。');
  for (const evidence of report.evidence) {
    switch (evidence.stage) {
      case 'source':
        console.log(`source: ${evidence.files} 个文件`);
        break;
      case 'typescript':
        console.log(`typescript: ${evidence.projects} 个项目`);
        break;
      case 'resolve':
        console.log(`resolve: ${evidence.declarations} 个声明`);
        break;
      case 'relations':
        console.log(`relations: ${evidence.elements} 个元素`);
        break;
      case 'markdown':
        console.log(`markdown: ${evidence.documents} 份文档`);
        break;
      default:
        assertNever(evidence);
    }
  }
  console.log(`ManualReviewRequired: ${report.review.items.length} 项人工语义审查`);
}

function environmentError(error: unknown, context: CheckContext = 'Check'): number {
  const message = error instanceof Error ? error.message : String(error);
  const outcome =
    context === 'Updated'
      ? '生成文件已更新；检查环境不可用，设计尚未完成自动结构检查。'
      : context === 'UpToDate'
        ? '生成文件已是当前契约；检查环境不可用，设计尚未完成自动结构检查。'
        : '命令环境不可用。';
  console.error(JSON.stringify({ kind: 'EnvironmentError', message, outcome }, null, 2));
  return 2;
}

async function checkDesign(root: string, json: boolean, context: CheckContext = 'Check'): Promise<number> {
  try {
    // A static service import also loads compiler/parser dependencies before argv parsing;
    // keeping this boundary lazy lets init/module/unit and upgrade --check run without them.
    const { loadValidated } = await import('./service.ts');
    const result = await loadValidated(root);
    if (result.kind === 'Rejected') return rejection(result, context);
    if (json) printJson(result.value.report);
    else printReport(result.value.report);
    return 0;
  } catch (error) {
    return environmentError(error, context);
  }
}

async function main(args: readonly string[]): Promise<number> {
  const parsed = parseArguments(args);
  if (parsed.kind === 'Usage') {
    console.error(`${parsed.message}\n${USAGE}`);
    return 2;
  }
  const command = parsed.command;
  if (command.kind === 'Check') return checkDesign(command.design, command.json);

  const workspace = await import('./workspace.ts');
  switch (command.kind) {
    case 'Init':
      return generated(workspace.initialize(command.repo));
    case 'Module':
      return generated(workspace.addModule(command.design, command.name));
    case 'Unit':
      return generated(workspace.addUnit(command.design, command.name));
    case 'Upgrade': {
      const plan = workspace.planUpgrade(command.design);
      if (plan.kind === 'Rejected') return rejection(plan);
      if (command.check) {
        switch (plan.value.kind) {
          case 'UpToDate':
            printJson(plan.value);
            break;
          case 'UpgradeAvailable':
            printJson({ kind: plan.value.kind, writes: plan.value.writes.map((file) => file.path) });
            break;
          default:
            assertNever(plan.value);
        }
        return 0;
      }
      if (plan.value.kind === 'UpToDate') {
        printJson(plan.value);
        return checkDesign(command.design, false, 'UpToDate');
      }
      const updated = workspace.upgrade(command.design);
      if (updated.kind === 'Rejected') return rejection(updated);
      printJson(updated.value);
      return checkDesign(command.design, false, 'Updated');
    }
    default:
      return assertNever(command);
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  process.exitCode = environmentError(error);
}
