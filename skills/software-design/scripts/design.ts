#!/usr/bin/env bun
/**
 * 设计 DSL 的目录生成、检查与图导出入口。
 * 声明和增量构建信息输出到仓库根的 .design-build/<project>，不写进 design/。
 * 首次使用：bun install --no-save --cwd <本脚本所在目录>。
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import type { parse as Parse } from '@babel/parser';
import type { DesignGraph, Layer, Violation } from './graph-model.ts';
import type { Viewpoint } from './graph-checks.ts';
import { extractGraph } from './extract.ts';
import { checkGraph, reachable } from './graph-checks.ts';
import { renderMarkdown, renderJson } from './render.ts';

const SCRIPT_DIR = import.meta.dir;
const TEMPLATE = join(SCRIPT_DIR, '../templates/dsl.ts');
const NAME = /^[a-z][a-z0-9-]*$/;
const FILE_NAME = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*$/;
const TYPE_REFERENCE = /^[A-Z][A-Za-z0-9]*(?:\.[A-Za-z_$][\w$]*)?$/;
const FILE_EXTENSIONS: Record<string, true> = { md: true, ts: true, json: true, js: true, mjs: true };
const ARCHITECTURE_SECTIONS = ['依据', '为什么', '语义'];
const BUSINESS_SECTIONS = ['依据', '需求', '为什么', '语义'];
const APPENDIX_DIRS = ['examples', 'evidence', 'reference'];

/** 命令行支持的操作。 */
type Command =
  | { readonly kind: 'Init'; readonly repo: string }
  | { readonly kind: 'Module'; readonly design: string; readonly name: string }
  | { readonly kind: 'Unit'; readonly design: string; readonly name: string }
  | { readonly kind: 'Check'; readonly design: string }
  | { readonly kind: 'Graph'; readonly design: string; readonly json: boolean };

/** 使用错误与正常命令分开处理。 */
type Arguments = { readonly kind: 'Command'; readonly command: Command } | { readonly kind: 'Usage'; readonly message: string };

/** 检查使用的依赖，只从本脚本的 node_modules 取得。 */
type Dependencies = { readonly parse: typeof Parse; readonly tsc: string };

/** 一个需要检查的模块文档。 */
type Document = {
  readonly file: string;
  readonly layer: Layer;
  readonly place: readonly string[];
  readonly kind: 'Readme' | 'Topic';
};

/** 去掉围栏代码之后仍保留原行号的一行文字。 */
type MarkdownLine = { readonly text: string; readonly line: number };

function assertNever(value: never): never {
  throw new Error(`未处理的命令：${String(value)}`);
}

function slash(path: string): string {
  return path.split(sep).join('/');
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function solutionConfig(business: boolean): string {
  return json({ files: [], references: [{ path: './dsl' }, { path: './architecture' }, ...(business ? [{ path: './business' }] : [])] });
}

function projectConfig(project: 'dsl' | Layer): string {
  const compilerOptions = {
    strict: true,
    composite: true,
    declaration: true,
    emitDeclarationOnly: true,
    target: 'ESNext',
    module: 'ESNext',
    moduleResolution: 'Bundler',
    allowImportingTsExtensions: true,
    rootDir: '.',
    outDir: `../../.design-build/${project}`,
    tsBuildInfoFile: `../../.design-build/${project}/tsconfig.tsbuildinfo`,
  };
  // 显式的空 files 与非空 references 使尚无设计类型的项目也可以构建。
  return project === 'dsl'
    ? json({ compilerOptions, files: ['dsl.ts'] })
    : json({
        compilerOptions,
        files: [],
        include: ['./**/*.ts'],
        references: project === 'architecture' ? [{ path: '../dsl' }] : [{ path: '../architecture' }, { path: '../dsl' }],
      });
}

function write(path: string, content: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function isDirectory(path: string): boolean {
  return existsSync(path) && lstatSync(path).isDirectory();
}

function isFile(path: string): boolean {
  return existsSync(path) && lstatSync(path).isFile();
}

function usage(message: string): number {
  console.error(message);
  console.error('用法：bun design.ts init <仓库根> | module <design> <a/b> | unit <design> <名字> | check <design> | graph <design> [--json]');
  return 2;
}

function parseArguments(args: readonly string[]): Arguments {
  const [command, target, name] = args;
  if (!target) return { kind: 'Usage', message: '缺少命令或目录参数。' };
  switch (command) {
    case 'init':
      return args.length === 2 ? { kind: 'Command', command: { kind: 'Init', repo: resolve(target) } } : { kind: 'Usage', message: 'init 只接受仓库根目录。' };
    case 'module':
    case 'unit':
      if (args.length !== 3 || !name) return { kind: 'Usage', message: `${command} 需要目录和名字。` };
      return { kind: 'Command', command: { kind: command === 'module' ? 'Module' : 'Unit', design: resolve(target), name } };
    case 'check':
      return args.length === 2 ? { kind: 'Command', command: { kind: 'Check', design: resolve(target) } } : { kind: 'Usage', message: 'check 只接受设计目录。' };
    case 'graph':
      return args.length === 2 || (args.length === 3 && name === '--json')
        ? { kind: 'Command', command: { kind: 'Graph', design: resolve(target), json: name === '--json' } }
        : { kind: 'Usage', message: 'graph 只接受设计目录和可选的 --json。' };
    default:
      return { kind: 'Usage', message: `未知命令：${command ?? ''}` };
  }
}

function loadDependencies(): Dependencies | undefined {
  const tsc = join(SCRIPT_DIR, 'node_modules/typescript/bin/tsc');
  if (!isDirectory(join(SCRIPT_DIR, 'node_modules/@babel/parser')) || !isFile(tsc)) {
    console.error('缺少 @babel/parser 或 TypeScript，请先运行：');
    console.error(`bun install --no-save --cwd ${JSON.stringify(SCRIPT_DIR)}`);
    return undefined;
  }
  try {
    const require = createRequire(import.meta.url);
    const parser: { readonly parse: typeof Parse } = require(join(SCRIPT_DIR, 'node_modules/@babel/parser'));
    return { parse: parser.parse, tsc };
  } catch (error) {
    console.error(`无法加载检查依赖：${error instanceof Error ? error.message : String(error)}`);
    console.error(`bun install --no-save --cwd ${JSON.stringify(SCRIPT_DIR)}`);
    return undefined;
  }
}

function initialize(repo: string): number {
  if (!isDirectory(repo)) return usage('仓库根目录不存在或不是普通目录。');
  const design = join(repo, 'design');
  if (existsSync(design) && (!isDirectory(design) || readdirSync(design).length > 0)) return usage('design 已存在且不是空目录，拒绝覆盖。');
  write(join(design, 'README.md'), '# 设计\n\n- [架构](architecture/README.md)\n- [示例](appendix/examples/)\n- [证据](appendix/evidence/)\n- [实现参考](appendix/reference/)\n');
  write(join(design, 'tsconfig.json'), solutionConfig(false));
  write(join(design, 'dsl/dsl.ts'), readFileSync(TEMPLATE));
  write(join(design, 'dsl/tsconfig.json'), projectConfig('dsl'));
  write(join(design, 'architecture/tsconfig.json'), projectConfig('architecture'));
  write(join(design, 'architecture/README.md'), '# 架构\n');
  for (const directory of APPENDIX_DIRS) write(join(design, 'appendix', directory, '.gitkeep'), '');
  console.log(`已建立 ${design}`);
  return 0;
}

function addModule(design: string, name: string): number {
  const parts = name.split('/');
  if (!parts.every((part) => NAME.test(part))) return usage('模块路径的每一段必须只含小写字母、数字、连字符，并以字母开头。');
  if (!isFile(join(design, 'tsconfig.json'))) return usage('设计目录不存在或缺少 tsconfig.json。');
  const parent = join(design, 'architecture', ...parts.slice(0, -1));
  if (!isDirectory(parent) || !isFile(join(parent, 'README.md'))) return usage('父模块必须已经存在且含有 README.md。');
  const directory = join(parent, parts[parts.length - 1]!);
  if (existsSync(directory)) return usage('模块目录已存在，拒绝覆盖。');
  write(join(directory, 'README.md'), `# ${parts[parts.length - 1]}\n`);
  console.log(`已建立 ${directory}`);
  return 0;
}

function addUnit(design: string, name: string): number {
  if (!NAME.test(name)) return usage('业务单元名必须只含小写字母、数字、连字符，并以字母开头。');
  if (!isFile(join(design, 'tsconfig.json')) || !isDirectory(join(design, 'architecture'))) return usage('设计目录不存在或缺少架构。');
  const business = join(design, 'business');
  if (existsSync(business) && !isDirectory(business)) return usage('business 不是普通目录。');
  const directory = join(business, name);
  if (existsSync(directory)) return usage('业务单元目录已存在，拒绝覆盖。');
  const first = !existsSync(business) || !readdirSync(business).some((entry) => isDirectory(join(business, entry)));
  write(join(directory, 'README.md'), `# ${name}\n`);
  if (first) {
    write(join(business, 'tsconfig.json'), projectConfig('business'));
    write(join(design, 'tsconfig.json'), solutionConfig(true));
  }
  console.log(`已建立 ${directory}`);
  return 0;
}

function addViolation(violations: Violation[], file: string, message: string, line = 0): void {
  violations.push({ at: { file: slash(file), line }, message });
}

function checkStructure(design: string, violations: Violation[]): readonly Document[] {
  const documents: Document[] = [];
  const regular = (file: string): boolean => isFile(join(design, file));
  const requiredFile = (file: string): void => {
    if (!regular(file)) addViolation(violations, file, '缺少必需的普通文件。');
  };
  const requiredDirectory = (directory: string): void => {
    if (!isDirectory(join(design, directory))) addViolation(violations, directory, '缺少必需的普通目录。');
  };
  const compare = (file: string, expected: string | Uint8Array): void => {
    if (regular(file) && !readFileSync(join(design, file)).equals(Buffer.from(expected))) addViolation(violations, file, '内容必须与工具生成的模板逐字节一致。');
  };
  const entries = (directory: string): readonly string[] => isDirectory(join(design, directory)) ? readdirSync(join(design, directory)).sort() : [];
  const validEntry = (file: string, name: string): boolean => {
    const stat = lstatSync(join(design, file));
    if (name === '.gitkeep' && stat.isFile()) return true;
    if (name.startsWith('.')) {
      addViolation(violations, file, '不允许隐藏条目；只允许普通文件 .gitkeep。');
      return false;
    }
    if (!stat.isDirectory() && !stat.isFile()) {
      addViolation(violations, file, '只允许普通目录和普通文件，不允许符号链接或特殊文件。');
      return false;
    }
    const validName = stat.isDirectory() ? NAME.test(name) : name === 'README.md' || name === 'tsconfig.json' || FILE_NAME.test(name);
    if (!validName) {
      addViolation(violations, file, '名字必须以小写字母开头，只含小写字母、数字、连字符和文件扩展名。');
      return false;
    }
    return true;
  };
  const scanFree = (directory: string): void => {
    for (const name of entries(directory)) {
      const file = join(directory, name);
      if (validEntry(file, name) && isDirectory(join(design, file))) scanFree(file);
    }
  };
  const scanModule = (directory: string, layer: Layer, place: readonly string[]): void => {
    requiredFile(join(directory, 'README.md'));
    for (const name of entries(directory)) {
      const file = join(directory, name);
      if (!validEntry(file, name) || name === '.gitkeep') continue;
      if (isDirectory(join(design, file))) {
        if (layer === 'business') addViolation(violations, file, '业务单元内不允许子目录。');
        else scanModule(file, layer, [...place, name]);
      } else if (name === 'README.md') documents.push({ file, layer, place, kind: 'Readme' });
      else if (name === 'tsconfig.json' && layer === 'architecture' && place.length === 0) continue;
      else if (/^[a-z][a-z0-9-]*\.md$/.test(name)) documents.push({ file, layer, place, kind: 'Topic' });
      else if (!/^[a-z][a-z0-9-]*\.ts$/.test(name)) addViolation(violations, file, '模块中只允许 README.md、主题 .md、类型 .ts 和子架构模块。');
    }
  };
  for (const file of ['README.md', 'tsconfig.json', 'dsl/dsl.ts', 'dsl/tsconfig.json', 'architecture/tsconfig.json']) requiredFile(file);
  for (const directory of ['dsl', 'architecture', 'appendix', ...APPENDIX_DIRS.map((name) => `appendix/${name}`)]) requiredDirectory(directory);
  for (const name of entries('')) {
    if (!validEntry(name, name) || name === '.gitkeep') continue;
    const expectedDirectory = ['dsl', 'architecture', 'business', 'appendix'].includes(name);
    if (expectedDirectory ? !isDirectory(join(design, name)) : !['README.md', 'tsconfig.json'].includes(name) || !regular(name)) addViolation(violations, name, '设计根目录只允许 README.md、tsconfig.json、dsl、architecture、business 与 appendix。');
  }
  for (const name of entries('dsl')) {
    const file = join('dsl', name);
    if (validEntry(file, name) && name !== '.gitkeep' && !['dsl.ts', 'tsconfig.json'].includes(name)) addViolation(violations, file, 'dsl 只允许工具生成的 dsl.ts 与 tsconfig.json。');
  }
  scanModule('architecture', 'architecture', []);
  let units = 0;
  if (existsSync(join(design, 'business'))) {
    requiredDirectory('business');
    requiredFile('business/tsconfig.json');
    for (const name of entries('business')) {
      const file = join('business', name);
      if (!validEntry(file, name) || name === '.gitkeep') continue;
      if (isDirectory(join(design, file))) {
        units += 1;
        scanModule(file, 'business', [name]);
      } else if (name !== 'tsconfig.json') addViolation(violations, file, 'business 根目录只允许业务单元目录与 tsconfig.json。');
    }
    if (units === 0) addViolation(violations, 'business', 'business 只在存在业务单元时建立。');
  }
  for (const name of entries('appendix')) {
    const file = join('appendix', name);
    if (!validEntry(file, name) || name === '.gitkeep') continue;
    if (!APPENDIX_DIRS.includes(name) || !isDirectory(join(design, file))) addViolation(violations, file, '附录只允许 examples、evidence、reference 三个目录。');
    else scanFree(file);
  }
  compare('dsl/dsl.ts', readFileSync(TEMPLATE));
  compare('tsconfig.json', solutionConfig(units > 0));
  compare('dsl/tsconfig.json', projectConfig('dsl'));
  compare('architecture/tsconfig.json', projectConfig('architecture'));
  if (existsSync(join(design, 'business'))) compare('business/tsconfig.json', projectConfig('business'));
  return documents;
}

function markdownLines(text: string): readonly MarkdownLine[] {
  let fence: { readonly mark: string; readonly length: number } | undefined;
  return text.split(/\r?\n/).map((text, index) => {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text);
    if (fence) {
      if (marker && marker[1]![0] === fence.mark && marker[1]!.length >= fence.length && marker[2]!.trim() === '') fence = undefined;
      return { text: '', line: index + 1 };
    }
    if (marker) {
      fence = { mark: marker[1]![0]!, length: marker[1]!.length };
      return { text: '', line: index + 1 };
    }
    return { text, line: index + 1 };
  });
}

function checkDocuments(design: string, documents: readonly Document[], graph: DesignGraph, reachable: (graph: DesignGraph, from: Viewpoint, name: string) => string | undefined, violations: Violation[]): void {
  for (const document of documents) {
    const text = readFileSync(join(design, document.file), 'utf8');
    const lines = markdownLines(text);
    if (document.kind === 'Readme') {
      const allowed = document.layer === 'architecture' ? ARCHITECTURE_SECTIONS : BUSINESS_SECTIONS;
      const sections = lines.flatMap((line, index) => {
        const heading = /^ {0,3}##(?:[ \t]+(.*?)[ \t]*#*[ \t]*|[ \t]*)$/.exec(line.text);
        return heading ? [{ title: heading[1]?.trim() ?? '', line: line.line, index }] : [];
      });
      let previous = -1;
      for (let index = 0; index < sections.length; index += 1) {
        const section = sections[index]!;
        const order = allowed.indexOf(section.title);
        if (order < 0) addViolation(violations, document.file, `不允许的小节：${section.title}；只允许 ${allowed.join('、')}。`, section.line);
        else if (order <= previous) addViolation(violations, document.file, '小节必须按模板顺序出现且不得重复。', section.line);
        if (order >= 0) previous = Math.max(previous, order);
        const body = text.split(/\r?\n/).slice(section.index + 1, sections[index + 1]?.index ?? lines.length).join('\n').replace(/<!--[\s\S]*?-->/g, '');
        if (!body.split('\n').some((line) => line.trim() !== '' && !/^\s*#/.test(line))) addViolation(violations, document.file, `小节「${section.title}」不能为空。`, section.line);
      }
    } else {
      const readme = join(dirname(document.file), 'README.md');
      const readmeLines = isFile(join(design, readme)) ? markdownLines(readFileSync(join(design, readme), 'utf8')) : [];
      const name = document.file.split(sep).at(-1)!;
      const linked = readmeLines.some((line) => [...line.text.matchAll(/!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+[^)]*)?\)/g)].some((match) => {
        if (match[0].startsWith('!')) return false;
        const target = (match[1] ?? match[2] ?? '').split('#')[0];
        return target === name || target === `./${name}`;
      }));
      if (!linked) addViolation(violations, document.file, '主题文件必须由同目录 README.md 的 Markdown 链接引用。');
      const firstSection = lines.findIndex((line) => /^ {0,3}##(?:\s|$)/.test(line.text));
      const intro = lines.slice(0, firstSection < 0 ? lines.length : firstSection).some((line) => {
        const content = line.text.trim();
        return content !== '' && !/^(?:#|>|[-+*]\s|\d+[.)]\s|\||<!--|\[[^\]]+\]:)/.test(content) && !/^(?:[-*_]\s*){3,}$/.test(content);
      });
      if (!intro) addViolation(violations, document.file, '主题文件必须在第一个二级标题前写介绍段落。', 1);
    }
    for (const line of lines) {
      for (const match of line.text.matchAll(/(`+)([^`]*?)\1(?!`)/g)) {
        const reference = match[2]!.trim();
        if (!TYPE_REFERENCE.test(reference)) continue;
        const [name, member] = reference.split('.');
        if (member && FILE_EXTENSIONS[member]) continue;
        const reason = reachable(graph, { kind: 'Document', layer: document.layer, place: document.place }, name!);
        if (reason !== undefined) {
          addViolation(violations, document.file, `类型引用 ${reference} 不可见：${reason}`, line.line);
          continue;
        }
        if (!member) continue;
        const node = graph.nodes.find((node) => node.name === name);
        const members = node?.kind === 'Point' || node?.kind === 'Face'
          ? graph.connections.find((connection) => connection.name === name)?.ops.map((op) => op.name) ?? []
          : node?.kind === 'Outcome'
            ? graph.outcomes.find((outcome) => outcome.name === name)?.branches ?? []
            : [];
        if (!members.includes(member)) addViolation(violations, document.file, `类型引用 ${reference} 的成员不存在；只可引用连接的操作或结局的分支。`, line.line);
      }
    }
  }
}

function checkTypeScript(design: string, tsc: string, violations: Violation[]): void {
  const result = spawnSync(process.execPath, [tsc, '-b', '--pretty', 'false'], { cwd: design, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status === 0) return;
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
  let found = false;
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const diagnostic = /^(.*?)\((\d+),\d+\): (.*)$/.exec(line);
    if (diagnostic) {
      const file = slash(relative(design, isAbsolute(diagnostic[1]!) ? diagnostic[1]! : resolve(design, diagnostic[1]!)));
      // 构建输出（.design-build 下的声明文件）里的错误是源文件错误的副本，只报源文件。
      if (file.startsWith('../')) continue;
      addViolation(violations, file, diagnostic[3]!, Number(diagnostic[2]));
    } else addViolation(violations, 'tsconfig.json', line);
    found = true;
  }
  if (!found) addViolation(violations, 'tsconfig.json', `TypeScript 构建失败（退出码 ${result.status ?? '未知'}）。`);
}

/** 每个子模块目录与业务单元目录都要声明自己的 Module 或 Unit；根模块缺失与声明多个由图检查报告。 */
function checkDeclarations(documents: readonly Document[], graph: DesignGraph, violations: Violation[]): void {
  for (const document of documents) {
    if (document.kind !== 'Readme' || (document.layer === 'architecture' && document.place.length === 0)) continue;
    const kind = document.layer === 'architecture' ? 'Module' : 'Unit';
    const declared = graph.nodes.some(node =>
      node.kind === kind && node.layer === document.layer && node.place.join('/') === document.place.join('/'));
    if (!declared) addViolation(violations, document.file, `这个目录没有声明 ${kind}`);
  }
}

function reportViolations(violations: Violation[]): number {
  violations.sort((left, right) => left.at.file < right.at.file ? -1 : left.at.file > right.at.file ? 1 : left.at.line - right.at.line || left.message.localeCompare(right.message, 'zh-CN'));
  for (const violation of violations) console.log(`${violation.at.file}:${violation.at.line}: ${violation.message}`);
  if (violations.length > 0) return 1;
  console.log('检查通过');
  return 0;
}

function check(design: string, dependencies: Dependencies): number {
  const violations: Violation[] = [];
  const documents = checkStructure(design, violations);
  // 后续阶段只处理合法的目录；尤其不能让编译器沿非法符号链接读到设计之外。
  if (violations.length > 0) return reportViolations(violations);
  checkTypeScript(design, dependencies.tsc, violations);
  const graph = extractGraph(design, dependencies.parse);
  violations.push(...checkGraph(graph));
  checkDeclarations(documents, graph, violations);
  checkDocuments(design, documents, graph, reachable, violations);
  return reportViolations(violations);
}

async function main(): Promise<number> {
  const parsed = parseArguments(process.argv.slice(2));
  if (parsed.kind === 'Usage') return usage(parsed.message);
  const dependencies = loadDependencies();
  if (!dependencies) return 2;
  const command = parsed.command;
  switch (command.kind) {
    case 'Init': return initialize(command.repo);
    case 'Module': return addModule(command.design, command.name);
    case 'Unit': return addUnit(command.design, command.name);
    case 'Check':
      if (!isDirectory(command.design)) return usage('设计目录不存在或不是普通目录。');
      return await check(command.design, dependencies);
    case 'Graph': {
      if (!isDirectory(command.design)) return usage('设计目录不存在或不是普通目录。');
      const graph = extractGraph(command.design, dependencies.parse);
      const output = command.json ? renderJson(graph) : renderMarkdown(graph);
      process.stdout.write(output.endsWith('\n') ? output : `${output}\n`);
      return 0;
    }
    default: return assertNever(command);
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`命令失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}
