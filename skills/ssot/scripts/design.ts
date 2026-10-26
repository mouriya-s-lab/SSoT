#!/usr/bin/env bun
/**
 * 设计目录的生成、检查与查看。设计写成 Markdown：规格在 ```vdm 代码块里，其余是文字、图与文法。
 * 规格语义只由 VDMJ 解释；本脚本只管目录、方向、说明、文字引用、形式与 AST 反模式，并为模型审查准备材料。
 * 没有编译步骤：设计的消费者是 VDMJ 与读 Markdown 的人。
 */
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, relative, resolve } from 'node:path';
import { judge } from './judge.ts';

const SKILL = resolve(import.meta.dir, '..');
/** setup 把命令装进这个目录；它必须在 PATH 上，命令才能直接调用。 */
const BIN = join(homedir(), '.local', 'bin');
/** VDMJ 与 QuickCheck 的 jar：setup 写入，本脚本的 Java 调用与 PATH 上的 vdmj 都从这里读。不放在 skill 目录里，更新 skill 时不会被冲掉。 */
const LIB = join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'vdmj');
/** setup 装进 BIN 的命令：本脚本，以及连同 QuickCheck 插件的 VDMJ。 */
const COMMANDS = ['ssot', 'vdmj'] as const;
const OUTLINE = join(SKILL, 'scripts', 'Outline.java');
const TEMPLATE = join(SKILL, 'templates', 'README.md');
const MAVEN = 'https://repo1.maven.org/maven2/dk/au/ece/vdmj';
const ARTIFACTS = ['vdmj', 'quickcheck'] as const;
export const NAME = /^[a-z0-9][a-z0-9-]*$/;
export const SECTIONS = {
  architecture: ['依据', '为什么', '语义'],
  business: ['依据', '需求', '为什么', '语义'],
} as const;

type Layer = keyof typeof SECTIONS;
type Stage = 'layout' | 'parse' | 'structure' | 'antipattern' | 'form' | 'prose' | 'typecheck' | 'quickcheck';
export type Diagnostic = { readonly stage: Stage; readonly path: string; readonly line: number; readonly message: string };
export type Place = { readonly path: string; readonly layer: Layer; readonly dir: string; readonly readme: boolean };
type Field = { readonly name: string; readonly line: number };
/** AST 反模式（findings）与交给模型审查的候选（candidates）共用的形状。 */
type Hit = { readonly rule: string; readonly line: number; readonly detail: string };
/** 隐式操作的一句 ext：模式与它列出的状态分量。 */
type External = { readonly mode: string; readonly names: readonly string[] };
/** 场景显式体里的一个节点：调用、分支、先后或挑选。path 由语句结构写成，不含行号。 */
export type ScenarioNode = { readonly kind: 'call' | 'branch' | 'sequence' | 'choice'; readonly path: string; readonly line: number; readonly text: string };
/** 显式体里的一处调用：被调的操作或函数、实参原文与行号。 */
export type CallSite = { readonly callee: string; readonly line: number; readonly text: string; readonly args: readonly string[] };
export type Definition = {
  readonly name: string;
  readonly kind: string;
  readonly line: number;
  readonly commented: boolean;
  readonly commentLine: number;
  readonly comment: string;
  readonly explicit: boolean;
  readonly hasPre: boolean;
  readonly hasPost: boolean;
  readonly hasInv: boolean;
  /** `T = token` 或体为 `is not yet specified`：不展开的定义。 */
  readonly unspecified: boolean;
  readonly ext: readonly External[];
  readonly fields: readonly Field[];
  readonly scenario: readonly ScenarioNode[];
  /** 显式函数与显式操作体里的每处调用（操作与函数），按源码次序。 */
  readonly calls: readonly CallSite[];
  readonly findings: readonly Hit[];
  readonly candidates: readonly Hit[];
  /** 本定义读到的本模块状态分量；一条更新式只把分量改成新值时不算读（见 Outline.java 的 reads）。 */
  readonly reads: readonly string[];
  /** 本定义里用 `x.f` 选出的字段名。 */
  readonly selects: readonly string[];
  /** 本定义里用 `mk_T(…)` 模式按位置拆开的记录类型名。 */
  readonly patterns: readonly string[];
};
type ImportItem = { readonly kind: 'all' | 'type' | 'value' | 'function' | 'operation'; readonly name: string | null; readonly renamed: string | null };
type Import = { readonly module: string; readonly line: number; readonly items: readonly ImportItem[] };
type ExportItem = { readonly kind: 'type' | 'struct' | 'value' | 'function' | 'operation'; readonly name: string; readonly line: number };
type Module = {
  readonly name: string;
  readonly line: number;
  readonly flat: boolean;
  readonly imports: readonly Import[];
  readonly exports: { readonly all: boolean; readonly items: readonly ExportItem[] };
  readonly definitions: readonly Definition[];
};
type ParsedFile = {
  readonly path: string;
  readonly modules: readonly Module[];
  readonly errors: readonly { readonly line: number; readonly message: string }[];
};
export type Located = Module & { readonly place: Place };
type Obligations = {
  readonly total: number;
  readonly provable: number;
  readonly maybe: readonly string[];
  readonly unchecked: readonly string[];
};
/** VDMJ 生成的一条证明义务，以及 QuickCheck 对它的结论；UNCHECKED 是 QuickCheck 没有评估。 */
export type ProofObligation = {
  readonly number: number;
  readonly module: string;
  readonly owner: string;
  readonly kind: string;
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly predicate: string;
  readonly status: 'PROVABLE' | 'COUNTEREXAMPLE' | 'ERROR' | 'MAYBE' | 'UNCHECKED';
};
/** 设计正文里各种形式的行数：规格、规格里的说明注释、文字、图与文法。 */
type Forms = { readonly spec: number; readonly comment: number; readonly figure: number; readonly prose: number };
export type Report =
  | { readonly kind: 'Accepted'; readonly modules: number; readonly warnings: readonly string[]; readonly obligations: Obligations; readonly forms: Forms }
  | { readonly kind: 'Rejected'; readonly diagnostics: readonly Diagnostic[]; readonly warnings: readonly string[]; readonly forms: Forms };
type Command =
  | { readonly kind: 'Setup' }
  | { readonly kind: 'Init'; readonly repo: string }
  | { readonly kind: 'Module'; readonly design: string; readonly path: string }
  | { readonly kind: 'Unit'; readonly design: string; readonly name: string }
  | { readonly kind: 'Check'; readonly design: string; readonly json: boolean }
  | { readonly kind: 'Graph'; readonly design: string; readonly json: boolean }
  | { readonly kind: 'Vdmj'; readonly design: string; readonly args: readonly string[] }
  | { readonly kind: 'Review'; readonly design: string }
  | { readonly kind: 'Ledger'; readonly stage: 'draft' | 'design' | 'verify'; readonly args: readonly string[] };

export class UsageError extends Error {}
/** 缺少 Java 或 VDMJ：报告缺什么、怎样装，不附用法。 */
class MissingDependency extends Error {}
/** 缺依赖时让读者去看的安装说明。 */
const SETUP_GUIDE = join(SKILL, 'references', 'setup.md');

const USAGE = `用法：
  ssot setup                     检查 Java，取最新 VDMJ 与 QuickCheck，把 ssot 与 vdmj 装进 ~/.local/bin
  ssot init <仓库根>              生成 <仓库根>/design
  ssot module <design> <a/b>      建立架构子模块目录
  ssot unit <design> <名字>       建立业务单元目录
  ssot check <design> [--json]    检查目录、说明、方向、文字引用、形式、类型与反例
  ssot graph <design> [--json]    输出模块与 import 关系
  ssot vdmj <design> [VDMJ 参数]  用全部规格运行 VDMJ，例如 -e 或 -i
  ssot review <design>            输出模型审查的材料（JSON），由 scripts/review.py 在 omp eval 里交给 jev 判断

逐项判断（工具枚举义务，核对台账里每一项都判了、证据找得到；不替你判断）：
  ssot draft  <子命令> <仓库根>                    requirements | objects | constraints | owner | excluded | tradeoffs | status
  ssot design <子命令> <design> [--stamp …]        check | elements | constraints | status
  ssot verify <子命令> <design> --as <验证方> [--dir <目录>]… [--constraint <编号>]… [--stamp …]
                                                 check | expect | gaps | overview | attack | elements | scenarios | flows | prose | modules | owner | po | review | verdict | status | report
  --stamp        核对无误的新记录与改过的记录盖章；--stamp <键> 逐条确认过期的记录仍然成立`;

function assertNever(value: never): never {
  throw new Error(`程序错误：未处理的 variant ${String(value)}`);
}

function parseArguments(args: readonly string[]): Command {
  const [command, target, ...rest] = args;
  const flag = (option: string) => {
    if (rest.length > 1 || (rest.length === 1 && rest[0] !== option)) throw new UsageError(`${command} 只接受设计目录和可选的 ${option}。`);
    return rest.length === 1;
  };
  if (command === 'setup' && target === undefined) return { kind: 'Setup' };
  if (command === 'draft' || command === 'design' || command === 'verify') return { kind: 'Ledger', stage: command, args: args.slice(1) };
  if (!command || !target) throw new UsageError('缺少命令或目录。');
  switch (command) {
    case 'init':
      if (rest.length > 0) throw new UsageError('init 只接受仓库根目录。');
      return { kind: 'Init', repo: resolve(target) };
    case 'module':
    case 'unit': {
      const [name] = rest;
      if (rest.length !== 1 || !name) throw new UsageError(`${command} 需要设计目录和名字。`);
      return command === 'module'
        ? { kind: 'Module', design: resolve(target), path: name }
        : { kind: 'Unit', design: resolve(target), name };
    }
    case 'check':
      return { kind: 'Check', design: resolve(target), json: flag('--json') };
    case 'graph':
      return { kind: 'Graph', design: resolve(target), json: flag('--json') };
    case 'vdmj':
      return { kind: 'Vdmj', design: resolve(target), args: rest };
    case 'review':
      if (rest.length > 0) throw new UsageError('review 只接受设计目录。');
      return { kind: 'Review', design: resolve(target) };
    default:
      throw new UsageError(`未知命令 ${command}。`);
  }
}

// ---------------------------------------------------------------- 工具链

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** 检查 Java，下载 jar，把 COMMANDS 装进 BIN，再确认 PATH 上的这两个名字解析到刚装的文件。 */
async function setup(): Promise<number> {
  requireJava();
  mkdirSync(LIB, { recursive: true });
  for (const artifact of ARTIFACTS) {
    const metadata = await fetchText(`${MAVEN}/${artifact}/maven-metadata.xml`);
    const versions = [...metadata.matchAll(/<version>([0-9.]+)<\/version>/g)].map((m) => m[1]!);
    const latest = versions.sort(compareVersions).at(-1);
    if (!latest) throw new Error(`Maven 上没有 ${artifact} 的正式版本。`);
    const response = await fetch(`${MAVEN}/${artifact}/${latest}/${artifact}-${latest}.jar`);
    if (!response.ok) throw new Error(`下载 ${artifact} ${latest} 失败：HTTP ${response.status}`);
    writeFileSync(join(LIB, `${artifact}.jar`), new Uint8Array(await response.arrayBuffer()));
    console.log(`${artifact} ${latest} -> ${join(LIB, `${artifact}.jar`)}`);
  }
  mkdirSync(BIN, { recursive: true });
  const design = join(BIN, 'ssot');
  rmSync(design, { force: true });
  symlinkSync(import.meta.path, design);
  const vdmj = join(BIN, 'vdmj');
  const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
  writeFileSync(vdmj, `#!/bin/sh\n# 由 ssot setup 生成：VDMJ 连同 QuickCheck 插件。\nexec java -cp ${quote(classpath())} com.fujitsu.vdmj.plugins.VDMJ "$@"\n`);
  chmodSync(vdmj, 0o755);
  const wrong = COMMANDS.filter((name) => Bun.which(name) !== join(BIN, name));
  if (wrong.length > 0) {
    for (const name of wrong) console.error(`${name}：PATH 上解析到 ${Bun.which(name) ?? '（找不到）'}，应为 ${join(BIN, name)}。`);
    console.error(`把 ${BIN} 放到 PATH 里其他同名命令之前，例如在 shell 启动文件里加入：export PATH="${BIN}:$PATH"`);
    return 1;
  }
  console.log(`${COMMANDS.join('、')} 已在 PATH 上：${BIN}`);
  return 0;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`读取 ${url} 失败：HTTP ${response.status}`);
  return response.text();
}

/** PATH 上的 java 必须是 11 或更高版本；`java -version` 的版本号在旧版是 "1.8.0_…"，新版是 "11"、"27" 这样的主版本号。 */
export function requireJava(): void {
  const found = Bun.which('java');
  if (!found) throw new MissingDependency(`PATH 上没有 java：需要 Java 11 或更高版本，安装方法见 ${SETUP_GUIDE}。`);
  const run = Bun.spawnSync([found, '-version']);
  const version = /version "(\d+)(?:\.(\d+))?/.exec(`${run.stderr.toString()}${run.stdout.toString()}`);
  const major = version ? Number(version[1] === '1' ? version[2] : version[1]) : 0;
  if (run.exitCode !== 0 || major < 11) {
    throw new MissingDependency(`PATH 上的 java（${found}）${version ? `是 Java ${major}` : '报不出版本'}：需要 Java 11 或更高版本，安装方法见 ${SETUP_GUIDE}。`);
  }
}

export function classpath(): string {
  const jars = ARTIFACTS.map((artifact) => join(LIB, `${artifact}.jar`));
  if (!jars.every(existsSync)) throw new MissingDependency(`VDMJ 尚未安装到 ${LIB}：先运行 ssot setup，见 ${SETUP_GUIDE}。`);
  return jars.join(delimiter);
}

export function java(args: readonly string[], cwd: string, stdin?: string): { readonly code: number; readonly lines: string[] } {
  const run = Bun.spawnSync(['java', ...args], { cwd, stdin: stdin === undefined ? 'ignore' : Buffer.from(stdin) });
  const text = `${run.stdout.toString()}${run.stderr.toString()}`;
  // 新版 JDK 对 VDMJ 内部反射的提示与设计无关。
  return { code: run.exitCode ?? 1, lines: text.split('\n').filter((line) => !line.startsWith('WARNING: ')) };
}

// ---------------------------------------------------------------- 生成

function init(repo: string): void {
  const design = join(repo, 'design');
  if (existsSync(design)) throw new UsageError(`${design} 已存在；init 不覆盖。`);
  mkdirSync(join(design, 'architecture'), { recursive: true });
  writeFileSync(join(design, 'README.md'), readFileSync(TEMPLATE, 'utf8'));
  writeFileSync(join(design, 'architecture', 'README.md'), readme('架构'));
  for (const kind of ['examples', 'evidence', 'reference']) {
    mkdirSync(join(design, 'appendix', kind), { recursive: true });
    writeFileSync(join(design, 'appendix', kind, '.gitkeep'), '');
  }
  console.log(`已生成 ${design}`);
}

function readme(title: string): string {
  return `# ${title}\n\n<!-- 先写一段：本模块负责什么、不负责什么。 -->\n`;
}

function addModule(design: string, path: string): void {
  const segments = path.split('/');
  if (!segments.every((s) => NAME.test(s))) throw new UsageError('模块路径每段只用小写字母、数字与连字符。');
  const parent = join(design, 'architecture', ...segments.slice(0, -1));
  if (!existsSync(join(parent, 'README.md'))) throw new UsageError(`父模块 ${relative(design, parent)} 不存在。`);
  create(design, ['architecture', ...segments], segments.at(-1)!);
}

function addUnit(design: string, name: string): void {
  if (!NAME.test(name)) throw new UsageError('业务单元名只用小写字母、数字与连字符。');
  create(design, ['business', name], name);
}

function create(design: string, segments: readonly string[], title: string): void {
  const main = join(design, 'README.md');
  if (!existsSync(main)) throw new UsageError(`${main} 不存在；先运行 init。`);
  const dir = join(design, ...segments);
  if (existsSync(dir)) throw new UsageError(`${relative(design, dir)} 已存在。`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'README.md'), readme(title));
  const path = [...segments, 'README.md'].join('/');
  const entry = `- [${path}](${path})`;
  const text = readFileSync(main, 'utf8');
  writeFileSync(main, `${text.endsWith('\n') ? text : `${text}\n`}${entry}\n`);
  console.log(`已生成 ${path}，并在 README.md 的阅读次序里加入 ${entry}`);
}

// ---------------------------------------------------------------- Markdown

/** 代码块的种类：```vdm 是规格，```mermaid、```ebnf、```text 是图与文法，其余都不允许出现在正文里。 */
type FenceKind = 'Spec' | 'Figure' | 'Other';
type Fence = { readonly kind: FenceKind; readonly info: string; readonly line: number; readonly body: readonly string[] };
/** Markdown 的一行在哪里：文字、某个代码块的围栏或内容。 */
type MarkdownLine = { readonly line: number; readonly raw: string; readonly in: 'Prose' | 'Fence' };
type MarkdownFile = { readonly lines: readonly MarkdownLine[]; readonly fences: readonly Fence[] };

const FIGURES = ['mermaid', 'ebnf', 'text'];

function fenceKind(info: string): FenceKind {
  if (info === 'vdm') return 'Spec';
  return FIGURES.includes(info) ? 'Figure' : 'Other';
}

export function markdown(text: string): MarkdownFile {
  const lines: MarkdownLine[] = [];
  const fences: Fence[] = [];
  let open: { marker: string; info: string; line: number; body: string[] } | null = null;
  text.split('\n').forEach((raw, i) => {
    const line = i + 1;
    if (open) {
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(raw);
      if (close && close[1]![0] === open.marker[0] && close[1]!.length >= open.marker.length) {
        fences.push({ kind: fenceKind(open.info), info: open.info, line: open.line, body: open.body });
        open = null;
      } else open.body.push(raw);
      lines.push({ line, raw, in: 'Fence' });
      return;
    }
    const start = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/.exec(raw);
    if (start) {
      open = { marker: start[1]!, info: start[2]!, line, body: [] };
      lines.push({ line, raw, in: 'Fence' });
    } else lines.push({ line, raw, in: 'Prose' });
  });
  if (open) fences.push({ kind: fenceKind(open.info), info: open.info, line: open.line, body: open.body });
  return { lines, fences };
}

export function readMarkdown(design: string, path: string): MarkdownFile {
  return markdown(readFileSync(join(design, path), 'utf8'));
}

/** 整行都是 HTML 注释的行，例如 init 留下的提示。它不是正文。 */
export function htmlComment(raw: string): boolean {
  return /^\s*<!--.*-->\s*$/.test(raw);
}

/** 一行里的行内代码（Markdown 的 code span）：成对的同样长度的反引号串之间的内容。 */
function codeSpans(raw: string): string[] {
  const spans: string[] = [];
  let i = 0;
  while (i < raw.length) {
    if (raw[i] !== '`') {
      i++;
      continue;
    }
    let n = 0;
    while (raw[i + n] === '`') n++;
    const ticks = '`'.repeat(n);
    let j = raw.indexOf(ticks, i + n);
    while (j >= 0 && (raw[j - 1] === '`' || raw[j + n] === '`')) j = raw.indexOf(ticks, j + 1);
    if (j < 0) {
      i += n;
      continue;
    }
    const content = raw.slice(i + n, j);
    spans.push(content.length > 1 && content.startsWith(' ') && content.endsWith(' ') ? content.slice(1, -1) : content);
    i = j + n;
  }
  return spans;
}

/**
 * VDMJ 自带的 Markdown 读取器的行号会偏，所以给每个文件生成一份同样行数的 .vdmsl：```vdm 块里的行原样保留，
 * 其余行留空。VDMJ 报的行号就是 Markdown 里的行号；路径把 .vdmsl 换回 .md。
 */
let shadowRoot: string | null = null;

export function shadow(design: string, places: readonly Place[]): string {
  if (shadowRoot) rmSync(shadowRoot, { recursive: true, force: true });
  const root = mkdtempSync('/tmp/ssot-');
  shadowRoot = root;
  for (const place of places) {
    const file = readMarkdown(design, place.path);
    const spec = new Set<number>();
    for (const fence of file.fences) if (fence.kind === 'Spec') fence.body.forEach((_, k) => spec.add(fence.line + 1 + k));
    const text = file.lines.map((l) => (spec.has(l.line) ? l.raw : '')).join('\n');
    const target = join(root, toShadow(place.path));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
  return root;
}

process.on('exit', () => {
  if (shadowRoot) rmSync(shadowRoot, { recursive: true, force: true });
});

export function toShadow(path: string): string {
  return path.replace(/\.md$/, '.vdmsl');
}

function fromShadow(path: string): string {
  return path.replace(/\.vdmsl$/, '.md');
}

// ---------------------------------------------------------------- 布局

function layout(design: string): { readonly places: readonly Place[]; readonly diagnostics: readonly Diagnostic[] } {
  if (!existsSync(design) || !lstatSync(design).isDirectory()) throw new UsageError(`${design} 不是设计目录。`);
  const places: Place[] = [];
  const diagnostics: Diagnostic[] = [];
  const fail = (path: string, message: string) => diagnostics.push({ stage: 'layout', path, line: 1, message });
  const entries = (dir: string) => readdirSync(join(design, dir)).filter((name) => !name.startsWith('.')).sort();
  const kind = (path: string) => lstatSync(join(design, path));

  if (!existsSync(join(design, 'README.md'))) fail('README.md', '缺少 README.md（阅读次序）；先运行 init。');
  if (!existsSync(join(design, 'architecture', 'README.md'))) fail('architecture/README.md', '缺少根模块 README.md。');
  for (const name of entries('.')) {
    if (!['README.md', 'architecture', 'business', 'appendix'].includes(name)) fail(name, '设计目录只放 README.md、architecture、business、appendix。');
    else if (kind(name).isSymbolicLink()) fail(name, '不接受符号链接。');
  }

  const walk = (dir: string, layer: Layer, nested: boolean) => {
    if (!existsSync(join(design, dir, 'README.md'))) fail(dir, '每个模块或业务单元目录都要有 README.md。');
    for (const name of entries(dir)) {
      const path = `${dir}/${name}`;
      const stat = kind(path);
      if (stat.isSymbolicLink()) fail(path, '不接受符号链接。');
      else if (stat.isDirectory()) {
        if (!nested) fail(path, '业务单元不嵌套。');
        else if (!NAME.test(name)) fail(path, '目录名只用小写字母、数字与连字符。');
        else walk(path, layer, nested);
      } else if (name === 'README.md' || (name.endsWith('.md') && NAME.test(name.slice(0, -3)))) {
        places.push({ path, layer, dir, readme: name === 'README.md' });
      } else fail(path, '只放 README.md 与按内容命名的 <小写名>.md。');
    }
  };
  if (existsSync(join(design, 'architecture'))) walk('architecture', 'architecture', true);
  if (existsSync(join(design, 'business'))) {
    for (const name of entries('business')) {
      const path = `business/${name}`;
      if (!kind(path).isDirectory() || !NAME.test(name)) fail(path, 'business 下只放以小写名命名的业务单元目录。');
      else walk(path, 'business', false);
    }
  }
  if (existsSync(join(design, 'appendix'))) {
    for (const name of entries('appendix')) {
      if (!['examples', 'evidence', 'reference'].includes(name)) fail(`appendix/${name}`, 'appendix 下只有 examples、evidence、reference。');
    }
  }
  return { places, diagnostics };
}

// ---------------------------------------------------------------- 解析

function outline(design: string, places: readonly Place[]): readonly ParsedFile[] {
  if (places.length === 0) return [];
  const root = shadow(design, places);
  const run = java(['-cp', classpath(), OUTLINE, ...places.map((p) => toShadow(p.path))], root);
  const json = run.lines.find((line) => line.startsWith('['));
  if (run.code !== 0 || !json) throw new Error(`VDMJ 解析器没有给出结果：\n${run.lines.join('\n')}`);
  type Raw = Omit<Definition, 'commented' | 'commentLine' | 'comment'>;
  type RawFile = Omit<ParsedFile, 'modules'> & { readonly modules: readonly (Omit<Module, 'definitions'> & { readonly definitions: readonly Raw[] })[] };
  return (JSON.parse(json) as RawFile[]).map((file) => {
    const path = fromShadow(file.path);
    const lines = readFileSync(join(design, path), 'utf8').split('\n');
    return {
      ...file,
      path,
      modules: file.modules.map((module) => ({ ...module, definitions: module.definitions.map((d) => ({ ...d, ...leadingComment(lines, d.line) })) })),
    };
  });
}

/**
 * 定义的说明是紧挨在定义之前、独占整行的 -- 注释。VDMJ 会把上一个记录字段的行尾注释也算给下一个定义，
 * 所以说明按源码的行来认，不用 VDMJ 的注释归属。
 */
function leadingComment(lines: readonly string[], line: number): Pick<Definition, 'commented' | 'commentLine' | 'comment'> {
  let first = line;
  while (first - 2 >= 0 && lines[first - 2]!.trim().startsWith('--')) first--;
  const comment = lines
    .slice(first - 1, line - 1)
    .map((text) => text.trim().replace(/^--\s?/, ''))
    .join(' ')
    .trim();
  return { commented: comment !== '', commentLine: first, comment };
}

// ---------------------------------------------------------------- 结构与方向

function structure(design: string, places: readonly Place[], files: readonly ParsedFile[]): { readonly modules: readonly Located[]; readonly diagnostics: readonly Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const fail = (path: string, line: number, message: string) => diagnostics.push({ stage: 'structure', path, line, message });
  const placeOf = new Map(places.map((p) => [p.path, p]));
  const modules: Located[] = [];

  for (const file of files) {
    const place = placeOf.get(file.path)!;
    if (file.modules.length > 1) fail(file.path, file.modules[1]!.line, '一个文件只写一个 VDM-SL 模块；按内容拆成多个文件。');
    const lines = readFileSync(join(design, file.path), 'utf8').split('\n');
    for (const module of file.modules) {
      if (module.flat) {
        fail(file.path, module.line, '规格必须写在具名的 module … end 里。');
        continue;
      }
      modules.push({ ...module, place });
      for (const definition of module.definitions) {
        if (!definition.commented) fail(file.path, definition.line, `${module.name}\`${definition.name} 前面缺少说明它是什么的 -- 注释（只有草稿约束要求的承诺才写进说明）。`);
        for (const field of definition.fields) {
          if (!fieldCommented(lines, field.line, definition.line)) {
            fail(file.path, field.line, `${module.name}\`${definition.name}.${field.name} 缺少说明：在同一行末尾或上一行写 -- 注释。`);
          }
        }
      }
    }
  }

  // 一样东西只展开一次：同名类型在两个模块里各定义一遍，它就有两种解释。
  const expansions = new Map<string, { readonly module: string; readonly path: string; readonly line: number }[]>();
  for (const module of modules) {
    for (const definition of module.definitions) {
      if (definition.kind !== 'type') continue;
      const seen = expansions.get(definition.name) ?? [];
      seen.push({ module: module.name, path: module.place.path, line: definition.line });
      expansions.set(definition.name, seen);
    }
  }
  for (const [name, seen] of expansions) {
    if (seen.length < 2) continue;
    const owners = seen.map((s) => s.module).join('、');
    for (const s of seen.slice(1)) {
      fail(s.path, s.line, `类型 ${name} 在 ${owners} 里各展开了一次：一样东西只在持有它的模块展开一次，其余模块 import 它。`);
    }
  }

  const byName = new Map(modules.map((m) => [m.name, m]));
  const edges = new Map<string, Map<string, { readonly path: string; readonly line: number }>>();
  for (const module of modules) {
    for (const imported of module.imports) {
      const target = byName.get(imported.module);
      if (!target) continue; // 不存在的模块由 VDMJ 报告。
      const from = module.place;
      const to = target.place;
      if (from.layer === 'architecture' && to.layer === 'business') {
        fail(from.path, imported.line, `架构模块 ${module.name} 不得引用业务模块 ${target.name}。`);
      } else if (from.layer === 'architecture' && to.dir.startsWith(`${from.dir}/`)) {
        fail(from.path, imported.line, `父模块 ${module.name} 不得依赖子模块 ${target.name}；共用的材料放到共同的父模块。`);
      }
      if (from.dir !== to.dir) {
        const out = edges.get(from.dir) ?? new Map();
        if (!out.has(to.dir)) out.set(to.dir, { path: from.path, line: imported.line });
        edges.set(from.dir, out);
      }
    }
  }
  for (const cycle of cycles(edges)) {
    const first = edges.get(cycle[0]!)!.get(cycle[1 % cycle.length]!) ?? { path: cycle[0]!, line: 1 };
    fail(first.path, first.line, `模块目录之间的依赖成环：${[...cycle, cycle[0]].join(' -> ')}。`);
  }
  return { modules, diagnostics };
}

function fieldCommented(lines: readonly string[], line: number, definitionLine: number): boolean {
  const own = lines[line - 1] ?? '';
  if (own.includes('--')) return true;
  if (line === definitionLine) return false;
  for (let i = line - 2; i >= 0; i--) {
    const text = lines[i]!.trim();
    if (text === '') continue;
    return text.startsWith('--');
  }
  return false;
}

/** 返回强连通分量中长度大于一的环（Tarjan）。 */
function cycles(edges: ReadonlyMap<string, ReadonlyMap<string, unknown>>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const result: string[][] = [];
  let counter = 0;
  const visit = (node: string) => {
    index.set(node, counter);
    low.set(node, counter++);
    stack.push(node);
    onStack.add(node);
    for (const next of edges.get(node)?.keys() ?? []) {
      if (!index.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node)!, low.get(next)!));
      } else if (onStack.has(next)) low.set(node, Math.min(low.get(node)!, index.get(next)!));
    }
    if (low.get(node) === index.get(node)) {
      const component: string[] = [];
      let member: string;
      do {
        member = stack.pop()!;
        onStack.delete(member);
        component.push(member);
      } while (member !== node);
      if (component.length > 1) result.push(component.reverse());
    }
  };
  for (const node of [...edges.keys()].sort()) if (!index.has(node)) visit(node);
  return result;
}

// ---------------------------------------------------------------- 文字

function prose(design: string, places: readonly Place[], modules: readonly Located[]): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const fail = (path: string, line: number, message: string) => diagnostics.push({ stage: 'prose', path, line, message });
  const known = new Set<string>();
  for (const module of modules) {
    known.add(module.name);
    for (const definition of module.definitions) {
      known.add(`${module.name}\`${definition.name}`);
      for (const field of definition.fields) known.add(`${module.name}\`${definition.name}.${field.name}`);
    }
  }

  // 不写进 VDM 的东西在原处留“索引：路径:行号”，路径相对仓库根（设计目录的上一级）；只核对能找到，不核对内容。
  const repo = dirname(design);
  const lineCounts = new Map<string, number | null>();
  for (const place of places) {
    const file = readMarkdown(design, place.path);
    for (const { line, raw, in: where } of file.lines) {
      for (const match of raw.matchAll(/索引[:：]\s*([^\s:：]+):(\d+)(?:-(\d+))?/g)) {
        const [address, target, from, to] = [match[0]!, match[1]!, Number(match[2]), Number(match[3] ?? match[2])];
        if (!lineCounts.has(target)) {
          const path = resolve(repo, target);
          const text = existsSync(path) && lstatSync(path).isFile() ? readFileSync(path, 'utf8') : null;
          lineCounts.set(target, text === null ? null : text.split('\n').length - (text.endsWith('\n') ? 1 : 0));
        }
        const count = lineCounts.get(target)!;
        if (count === null) fail(place.path, line, `${address} 指向的文件不存在；路径从仓库根（设计目录的上一级）算起。`);
        else if (from < 1 || to < from || to > count) fail(place.path, line, `${address} 的行号不在 ${target} 的 1–${count} 行之内。`);
      }
      if (where !== 'Prose') continue;
      // 文字里用双反引号写的限定名（``Run`Start``）指认规格元素，它必须存在。
      for (const name of codeSpans(raw)) {
        if (name.includes('`') && !known.has(name)) fail(place.path, line, `\`\`${name}\`\` 指向的规格元素不存在；只引用规格里已有的模块、定义或字段，不造新词。`);
      }
    }
    if (place.readme) diagnostics.push(...readmeShape(place, file));
    // 业务单元的需求要指出兑现它的规格元素：每条需求（一个段落或一个列表项）至少引用一个规格元素。
    if (place.layer === 'business' && place.readme) {
      let section = '';
      let block: { readonly line: number; readonly text: string } | null = null;
      const flush = () => {
        if (block !== null && !codeSpans(block.text).some((name) => name.includes('`'))) {
          fail(place.path, block.line, '这条需求没有指出兑现它的规格元素：用双反引号写出已有的、兑现它的类型、谓词所在的操作或场景（不展开的连接也可以，例如 ``Report`Daily``）。规格里没有任何元素兑现它，说明它不属于本系统的承诺或草稿漏了约束，回到 ssot-draft；不为了让这里有引用而新造元素。');
        }
        block = null;
      };
      for (const { line, raw, in: where } of file.lines) {
        if (where !== 'Prose') continue;
        const heading = /^##\s+(.*)$/.exec(raw.trim());
        if (heading) {
          flush();
          section = heading[1]!.trim();
        } else if (section !== '需求') continue;
        else if (raw.trim() === '') flush();
        else {
          if (/^\s*[-*]\s+/.test(raw)) flush();
          block = { line: block?.line ?? line, text: `${block?.text ?? ''}${raw}\n` };
        }
      }
      flush();
    }
  }

  const main = join(design, 'README.md');
  if (existsSync(main)) {
    const listed = new Map<string, number>();
    for (const { line, raw, in: where } of markdown(readFileSync(main, 'utf8')).lines) {
      if (where !== 'Prose') continue;
      for (const match of raw.matchAll(/\]\(([^)\s]+)\)/g)) {
        const path = match[1]!.replace(/^\.\//, '');
        if (listed.has(path)) fail('README.md', line, `${path} 在阅读次序里出现了两次。`);
        else if (!existsSync(join(design, path))) fail('README.md', line, `阅读次序里的 ${path} 不存在。`);
        listed.set(path, line);
      }
    }
    for (const place of places) {
      if (!listed.has(place.path)) fail('README.md', 1, `${place.path} 不在阅读次序里；在 README.md 的列表里加入 - [${place.path}](${place.path})。`);
    }
  }
  return diagnostics;
}

// ---------------------------------------------------------------- 形式

const TYPESCRIPT = new Bun.Transpiler({ loader: 'ts' });
const JAVASCRIPT = new Bun.Transpiler({ loader: 'js' });

/** 用 Bun 的转译器判断：TypeScript 解析得了、JavaScript 解析不了，就是带 TypeScript 专有语法（类型、接口）的代码。 */
function typescriptOnly(code: string): boolean {
  const parses = (transpiler: Bun.Transpiler) => {
    try {
      transpiler.transformSync(code);
      return true;
    } catch {
      return false;
    }
  };
  return code.trim() !== '' && parses(TYPESCRIPT) && !parses(JAVASCRIPT);
}

/**
 * 规格写成 VDM-SL，文字写规格说不清的语义。正文里的代码块只有 ```vdm（规格）与 ```mermaid、```ebnf、```text（图与文法）；
 * 图与文法块、文字段落里都不能出现 TypeScript 声明，否则设计就退化成了换了格式的旧文档。
 */
export function form(design: string, places: readonly Place[]): { readonly diagnostics: readonly Diagnostic[]; readonly forms: Forms } {
  const diagnostics: Diagnostic[] = [];
  const fail = (path: string, line: number, message: string) => diagnostics.push({ stage: 'form', path, line, message });
  const counts = { spec: 0, comment: 0, figure: 0, prose: 0 };
  for (const place of places) {
    const file = readMarkdown(design, place.path);
    for (const fence of file.fences) {
      switch (fence.kind) {
        case 'Spec':
          for (const raw of fence.body) {
            if (raw.trim().startsWith('--')) counts.comment++;
            else if (raw.trim() !== '') counts.spec++;
          }
          break;
        case 'Figure':
          counts.figure += fence.body.filter((raw) => raw.trim() !== '').length;
          if (typescriptOnly(fence.body.join('\n'))) {
            fail(place.path, fence.line, `${fence.info} 块里是 TypeScript 声明：图与文法块只放图与文法；类型、接口与签名写成 \`\`\`vdm 规格。`);
          }
          break;
        case 'Other':
          fail(place.path, fence.line, `正文里的代码块只用 vdm、${FIGURES.join('、')}，这里是「${fence.info === '' ? '没有标注' : fence.info}」：规格写成 \`\`\`vdm，图与文法用 ${FIGURES.join('、')}，其余写成文字。`);
          break;
        default:
          assertNever(fence.kind);
      }
    }
    let paragraph: { line: number; body: string[] } | null = null;
    const endParagraph = () => {
      if (paragraph && typescriptOnly(paragraph.body.join('\n'))) {
        fail(place.path, paragraph.line, '这段文字是 TypeScript 声明：类型、接口与签名写成 ```vdm 规格，不放进文字。');
      }
      paragraph = null;
    };
    for (const { line, raw, in: where } of file.lines) {
      if (where === 'Fence' || raw.trim() === '' || /^#{1,6}\s/.test(raw.trim()) || htmlComment(raw)) {
        endParagraph();
        continue;
      }
      counts.prose++;
      if (paragraph) paragraph.body.push(raw);
      else paragraph = { line, body: [raw] };
    }
    endParagraph();
  }
  return { diagnostics, forms: counts };
}

function readmeShape(place: Place, file: MarkdownFile): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const fail = (line: number, message: string) => diagnostics.push({ stage: 'prose', path: place.path, line, message });
  const allowed: readonly string[] = SECTIONS[place.layer];
  const content = file.lines.filter((l) => l.raw.trim() !== '' && !htmlComment(l.raw));
  const head = content[0];
  if (!head || head.in !== 'Prose' || !/^#\s/.test(head.raw)) {
    fail(head?.line ?? 1, 'README.md 以「# 模块名」开头。');
    return diagnostics;
  }
  let order = -1;
  let current: { readonly title: string; readonly line: number; body: boolean } = { title: '', line: head.line, body: false };
  const close = () => {
    if (!current.body) {
      fail(current.line, current.title === '' ? '标题后先写一段：负责什么、不负责什么。' : `小节「${current.title}」没有正文；没有内容的小节不写。`);
    }
  };
  for (const entry of content.slice(1)) {
    const section = entry.in === 'Prose' ? /^##\s+(.*)$/.exec(entry.raw.trim()) : null;
    if (entry.in === 'Prose' && /^#\s/.test(entry.raw)) fail(entry.line, 'README.md 只有一个一级标题。');
    else if (section) {
      close();
      const title = section[1]!.trim();
      const at = allowed.indexOf(title);
      if (at < 0) fail(entry.line, `README.md 的二级标题只用 ${allowed.join('、')}；其余内容放进按内容命名的主题文件。`);
      else if (at <= order) fail(entry.line, `二级标题按 ${allowed.join('、')} 的次序排列。`);
      order = Math.max(order, at);
      current = { title, line: entry.line, body: false };
    } else if (current.title === '' && entry.in === 'Fence') {
      close();
      current = { title: '规格', line: entry.line, body: true };
    } else current.body = true;
  }
  close();
  return diagnostics;
}

// ---------------------------------------------------------------- 模型审查材料

/** 一条交给 jev 判断的材料：问题编号、位置与判断对象。问题的措辞与阈值只在 scripts/review.py 里。 */
export type ReviewItem = {
  readonly question: ReviewQuestion;
  readonly path: string;
  readonly line: number;
  readonly state: Readonly<Record<string, string | readonly string[]>>;
};
type ReviewQuestion =
  | 'stringly'
  | 'bool_stack'
  | 'reasons'
  | 'comment_shape'
  | 'impl_body'
  | 'registry'
  | 'simulation'
  | 'business_in_arch'
  | 'prose_restates'
  | 'coined'
  | 'basis'
  | 'figure_code';
type Paragraph = { readonly path: string; readonly line: number; readonly section: string; readonly text: string };
type Figure = { readonly path: string; readonly line: number; readonly text: string };

/** 把文字里的行内代码还原成读者看到的名字：``Run`Start`` 读作 Run`Start。 */
function plain(text: string): string {
  return text.replace(/(`+)\s?(.*?)\s?\1/g, '$2');
}

/** 文字段落与图、文法块分开取：图与文法不按文字审查。段落所在的二级标题记为它的小节。 */
export function paragraphs(design: string, place: Place): { readonly paragraphs: readonly Paragraph[]; readonly figures: readonly Figure[] } {
  const file = readMarkdown(design, place.path);
  const result: Paragraph[] = [];
  let section = '';
  let current: { line: number; lines: string[] } | null = null;
  const flush = () => {
    if (current) result.push({ path: place.path, line: current.line, section, text: plain(current.lines.join(' ')) });
    current = null;
  };
  for (const { line, raw, in: where } of file.lines) {
    const heading = where === 'Prose' ? /^(#{1,6})\s+(.*)$/.exec(raw.trim()) : null;
    if (where === 'Fence' || raw.trim() === '' || htmlComment(raw) || heading) {
      flush();
      if (heading && heading[1]!.length <= 2) section = heading[1]!.length === 2 ? heading[2]!.trim() : '';
      continue;
    }
    if (current) current.lines.push(raw.trim());
    else current = { line, lines: [raw.trim()] };
  }
  flush();
  const figures = file.fences.filter((f) => f.kind === 'Figure').map((f) => ({ path: place.path, line: f.line, text: f.body.join('\n') }));
  return { paragraphs: result, figures };
}

/** 每个定义的源码：从它的说明注释开始，到下一个定义的说明之前。 */
export function sources(design: string, module: Located): { readonly module: string; readonly definitions: ReadonlyMap<Definition, { readonly full: string; readonly body: string }> } {
  const lines = readFileSync(join(design, module.place.path), 'utf8').split('\n');
  const end = lines.findIndex((text, i) => i >= module.line - 1 && new RegExp(`^\\s*end\\s+${module.name}\\b`).test(text));
  const last = end < 0 ? lines.length : end + 1;
  const sorted = [...module.definitions].sort((a, b) => a.commentLine - b.commentLine);
  const section = /^\s*(types|values|functions|operations|definitions)\s*$/;
  const definitions = new Map<Definition, { full: string; body: string }>();
  sorted.forEach((definition, i) => {
    const stop = i + 1 < sorted.length ? sorted[i + 1]!.commentLine - 1 : last - 1;
    const slice = (from: number) => {
      const span = lines.slice(from - 1, stop);
      while (span.length > 0 && (span.at(-1)!.trim() === '' || section.test(span.at(-1)!))) span.pop();
      return span.join('\n');
    };
    definitions.set(definition, { full: slice(definition.commentLine), body: slice(definition.line) });
  });
  return { module: lines.slice(module.line - 1, last).join('\n'), definitions };
}

export function review(design: string): readonly ReviewItem[] {
  const loaded = load(design);
  const blocking = loaded.diagnostics.filter((d) => d.stage === 'layout' || d.stage === 'parse');
  if (blocking.length > 0) {
    printDiagnostics(blocking);
    throw new UsageError('先让 check 通过 layout 与 parse 两个阶段，再做模型审查。');
  }
  const items: ReviewItem[] = [];
  const names = loaded.modules.flatMap((m) => [
    m.name,
    ...m.definitions.flatMap((d) => [`${m.name}\`${d.name}`, ...d.fields.map((f) => `${m.name}\`${d.name}.${f.name}`)]),
  ]);
  const readmes = loaded.places.filter((p) => p.readme);
  const units = readmes
    .filter((p) => p.layer === 'business')
    .map((p) => `${p.dir.slice('business/'.length)}: ${paragraphs(design, p).paragraphs.find((para) => para.section === '')?.text ?? ''}`);
  const specsByDir = new Map<string, string[]>();

  for (const module of loaded.modules) {
    const src = sources(design, module);
    const path = module.place.path;
    specsByDir.set(module.place.dir, [...(specsByDir.get(module.place.dir) ?? []), src.module]);
    items.push({ question: 'registry', path, line: module.line, state: { spec: src.module } });
    items.push({ question: 'simulation', path, line: module.line, state: { spec: src.module } });
    const fileLines = readFileSync(join(design, path), 'utf8').split('\n');
    for (const definition of module.definitions) {
      const text = src.definitions.get(definition)!;
      const owner = `${module.name}\`${definition.name}`;
      if (definition.commented) items.push({ question: 'comment_shape', path, line: definition.line, state: { comment: definition.comment, definition: text.body } });
      if (definition.explicit) items.push({ question: 'impl_body', path, line: definition.line, state: { definition: text.full } });
      if (module.place.layer === 'architecture' && units.length > 0) {
        items.push({ question: 'business_in_arch', path, line: definition.line, state: { definition: text.full, business_units: units } });
      }
      for (const hit of definition.candidates) {
        switch (hit.rule) {
          case 'string-type':
            items.push({ question: 'stringly', path, line: hit.line, state: { element: fileLines[hit.line - 1]!.trim(), comment: definition.comment, owner } });
            break;
          case 'bool-fields':
            items.push({ question: 'bool_stack', path, line: hit.line, state: { definition: text.full } });
            break;
          case 'quote-union':
            items.push({ question: 'reasons', path, line: hit.line, state: { definition: text.full } });
            break;
          default:
            throw new Error(`程序错误：Outline.java 给出了未知的候选 ${hit.rule}`);
        }
      }
    }
  }

  for (const place of loaded.places) {
    const spec = (specsByDir.get(place.dir) ?? []).join('\n\n');
    const text = paragraphs(design, place);
    for (const para of text.paragraphs) {
      items.push({ question: 'coined', path: para.path, line: para.line, state: { spec_names: names, paragraph: para.text } });
      // README 首段写负责范围，不与规格比较；其余正文（含主题文件、规格文件里的文字）都看是否复述了规格。
      if (spec !== '' && !(place.readme && para.section === '')) items.push({ question: 'prose_restates', path: para.path, line: para.line, state: { spec, paragraph: para.text } });
      if (para.section === '依据') items.push({ question: 'basis', path: para.path, line: para.line, state: { paragraph: para.text } });
    }
    for (const figure of text.figures) items.push({ question: 'figure_code', path: figure.path, line: figure.line, state: { block: figure.text } });
  }
  return items;
}

// ---------------------------------------------------------------- VDMJ

const LOCATION = /in '[^']*' \(([^)]+)\) at line (\d+):\d+/;

export function vdmj(
  design: string,
  modules: readonly Located[],
): { readonly diagnostics: readonly Diagnostic[]; readonly warnings: readonly string[]; readonly obligations: Obligations; readonly proofs: readonly ProofObligation[] } {
  const files = [...new Set(modules.map((m) => toShadow(m.place.path)))].sort();
  // qc 默认只看当前模块；模式 .* 覆盖全部模块。VDMJ 读的是与 Markdown 同行号的 .vdmsl 影子文件。
  const run = java(['-cp', classpath(), 'com.fujitsu.vdmj.plugins.VDMJ', '-vdmsl', '-q', '-i', ...files], shadow(design, modules.map((m) => m.place)), 'pog\nqc .*\nquit\n');
  const lines = run.lines.map((line) => line.replace(/^(> )+/, '').replaceAll('.vdmsl)', '.md)').replaceAll(".vdmsl'", ".md'"));
  const diagnostics: Diagnostic[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    // 解释器初始化失败时，VDMJ 会把同一条错误重复打印，并在消息里再套一层编号。
    const line = lines[i]!.replace(/^(Error \d+: )(?:Error \d+: )+/, '$1');
    if (/^Error \d+:/.test(line)) {
      const detail = [line];
      while (i + 1 < lines.length && /^(Expected|Actual|\s)/.test(lines[i + 1]!) && lines[i + 1]!.trim() !== '') detail.push(lines[++i]!.trim());
      const at = LOCATION.exec(line);
      const message = /^Error 4144:/.test(line)
        ? `${detail.join('；')}；init 要写成 s = mk_<状态>(...) 的形式，VDMJ 才能初始化模块、生成并检验证明义务`
        : detail.join('；');
      const key = `${at?.[1]}:${at?.[2]}:${/^Error (\d+)/.exec(line)![1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      diagnostics.push({ stage: 'typecheck', path: at?.[1] ?? 'README.md', line: Number(at?.[2] ?? 1), message });
    } else if (/^Warning \d+:/.test(line)) warnings.push(line);
  }
  if (diagnostics.length > 0 || run.code !== 0) {
    if (diagnostics.length === 0) diagnostics.push({ stage: 'typecheck', path: 'README.md', line: 1, message: lines.join('\n').trim() });
    return { diagnostics, warnings, obligations: { total: 0, provable: 0, maybe: [], unchecked: [] }, proofs: [] };
  }

  // 每条义务：「Proof Obligation N:」一行，接「属主: 种类 obligation in '模块' (文件) at line L:C」一行，再接谓词，到空行为止。
  const generated = new Map<number, Omit<ProofObligation, 'status'>>();
  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    const count = /^Generated (\d+) proof obligations/.exec(lines[i]!);
    if (count) total = Number(count[1]);
    const po = /^Proof Obligation (\d+):/.exec(lines[i]!);
    if (!po) continue;
    const header = /^(.*?): (.+?) obligation in '([^']+)' \(([^)]+)\) at line (\d+):(\d+)/.exec(lines[i + 1]!.trim());
    const predicate: string[] = [];
    for (let j = i + 2; j < lines.length && lines[j]!.trim() !== ''; j++) predicate.push(lines[j]!);
    generated.set(Number(po[1]), {
      number: Number(po[1]),
      owner: header?.[1] ?? lines[i + 1]!.trim(),
      kind: header?.[2] ?? '',
      module: header?.[3] ?? '',
      path: header?.[4] ?? 'README.md',
      line: Number(header?.[5] ?? 1),
      column: Number(header?.[6] ?? 1),
      predicate: predicate.join('\n'),
    });
  }
  // FAILED 只在求值返回 false 时才是反例；求值中途报错（例如生成了违反不变式的状态）只说明 QuickCheck 没能判断。
  const status = new Map<number, ProofObligation['status']>();
  for (let i = 0; i < lines.length; i++) {
    const result = /^PO #(\d+), (\w+)/.exec(lines[i]!);
    if (!result) continue;
    const number = Number(result[1]);
    const end = lines.findIndex((l, j) => j > i && /^PO #\d+, /.test(l));
    const block = lines.slice(i + 1, end < 0 ? lines.length : end);
    if (result[2] === 'PROVABLE') status.set(number, 'PROVABLE');
    else if (result[2] !== 'FAILED') status.set(number, 'MAYBE');
    else if (!block.some((l) => l.includes('--> returns false'))) status.set(number, 'ERROR');
    else {
      status.set(number, 'COUNTEREXAMPLE');
      const po = generated.get(number);
      const where = block.find((l) => LOCATION.test(l)) ?? '';
      const at = LOCATION.exec(where);
      const witness = block.filter((l) => l.includes('-->')).map((l) => l.trim()).join(' ');
      diagnostics.push({ stage: 'quickcheck', path: at?.[1] ?? po?.path ?? 'README.md', line: Number(at?.[2] ?? po?.line ?? 1), message: `证明义务有反例：${where.trim()} ${witness}`.trim() });
    }
  }
  const proofs = [...generated.values()].map((po): ProofObligation => ({ ...po, status: status.get(po.number) ?? 'UNCHECKED' }));
  const title = (po: ProofObligation) => `${po.owner}: ${po.kind} obligation in '${po.module}' (${po.path}) at line ${po.line}:${po.column}`;
  return {
    diagnostics,
    warnings,
    obligations: {
      total,
      provable: proofs.filter((po) => po.status === 'PROVABLE').length,
      maybe: proofs.filter((po) => po.status === 'MAYBE' || po.status === 'ERROR').map(title),
      unchecked: proofs.filter((po) => po.status === 'UNCHECKED').map(title),
    },
    proofs,
  };
}

/** VDMJ 对一个表达式求值的结果：打印出的值，或求值、类型检查报的错。 */
export type Evaluation = { readonly kind: 'Value'; readonly text: string } | { readonly kind: 'Failed'; readonly text: string };

/** 以 module 为默认模块，用设计里的全部规格求一个表达式的值。每次一个 JVM：解释器报过一次运行时错误后会停在调试状态，不能接着求下一个。 */
export function evaluate(design: string, modules: readonly Located[], module: string, expression: string): Evaluation {
  const files = [...new Set(modules.map((m) => toShadow(m.place.path)))].sort();
  const run = java(['-cp', classpath(), 'com.fujitsu.vdmj.plugins.VDMJ', '-vdmsl', '-q', '-default', module, '-e', expression, ...files], shadow(design, modules.map((m) => m.place)));
  // 只留值或错误本身：「Execution:」标题、Java 栈帧与计时都不是结论。
  const lines = run.lines
    .map((l) => l.trim().replace(/^EXCEPTION: VDMErrorsException |^Execution: /, ''))
    .filter((l) => l !== '' && l !== 'Execution:' && !/^(Wall time|com\.fujitsu\.|\d+ more frames available)/.test(l));
  const failed = run.code !== 0 || lines.some((l) => /^(Execution: )?Error \d+:|^Runtime: Error/.test(l));
  return failed ? { kind: 'Failed', text: lines.join('\n') } : { kind: 'Value', text: lines.join('\n') };
}

// ---------------------------------------------------------------- 编排

export function load(design: string): { readonly places: readonly Place[]; readonly modules: readonly Located[]; readonly diagnostics: readonly Diagnostic[] } {
  const found = layout(design);
  if (found.diagnostics.length > 0) return { places: found.places, modules: [], diagnostics: found.diagnostics };
  const files = outline(design, found.places);
  const parse = files.flatMap((file) => file.errors.map((e): Diagnostic => ({ stage: 'parse', path: file.path, line: e.line, message: e.message })));
  if (parse.length > 0) return { places: found.places, modules: [], diagnostics: parse };
  const checked = structure(design, found.places, files);
  return { places: found.places, modules: checked.modules, diagnostics: [...checked.diagnostics, ...antipatterns(checked.modules)] };
}

/** AST 反模式：每一条都让规格变成设计以外的东西，所以是错误，不是提示。 */
function antipatterns(modules: readonly Located[]): Diagnostic[] {
  const message = (rule: string, details: string): string => {
    switch (rule) {
      case 'string-literal':
        return '规格里出现了字符串字面量：设计靠类型与谓词表达含义，不比较字符串内容。先问规格要不要观察它：是实现值、自由文本或展示内容，移出 VDM；规格只需要知道有这么个值，写 token；只有规格要按它分支时才写 quote 并类型，要读多个字段时才写记录。';
      case 'implementation':
        return `显式体里有${details}：这是实现。没有约束要求它就删掉这个体，写成 is not yet specified；有约束时写成隐式定义的 post；显式体只用于场景与判定，不改状态、不写循环。`;
      case 'no-promise':
        return `隐式定义的 ${details}，不承诺任何东西。还没定的，改成显式的 is not yet specified；写在代码或文字里的，同样改成 is not yet specified 并在说明里留“索引：路径:行号”；只有草稿约束定下了它做到什么，才写 post。不为消掉这条诊断编一个 post。`;
      case 'tautology':
        return `${details}，恒真，等于什么也没说。删掉这条（合取项）；整条约束都是这样，就把定义退回 is not yet specified 或 token。只有草稿约束定下了它要排除的情形，才写出排除它的谓词；不为消掉这条诊断编一个条件。`;
      case 'contradiction':
        return `${details}，恒不可满足，什么也不允许。删掉这条（合取项）；整条约束都是这样，就把定义退回 is not yet specified 或 token。只有草稿约束定下了它允许什么，才写出那个谓词。`;
      default:
        throw new Error(`程序错误：Outline.java 给出了未知的反模式 ${rule}`);
    }
  };
  // 同一个定义里同一条规则只报一次，报在第一次出现的行。
  return modules.flatMap((module) =>
    module.definitions.flatMap((definition) =>
      [...Map.groupBy(definition.findings, (hit) => hit.rule)].map(([rule, hits]): Diagnostic => ({
        stage: 'antipattern',
        path: module.place.path,
        line: Math.min(...hits.map((hit) => hit.line)),
        message: `${module.name}\`${definition.name}：${message(rule, [...new Set(hits.map((hit) => hit.detail))].join('、'))}`,
      })),
    ),
  );
}

export function check(design: string): Report {
  const loaded = load(design);
  const shape = form(design, loaded.places);
  if (loaded.diagnostics.some((d) => d.stage === 'layout' || d.stage === 'parse')) {
    return { kind: 'Rejected', diagnostics: loaded.diagnostics, warnings: [], forms: shape.forms };
  }
  const written = prose(design, loaded.places, loaded.modules);
  const spec = loaded.modules.length > 0 ? vdmj(design, loaded.modules) : { diagnostics: [], warnings: [], obligations: { total: 0, provable: 0, maybe: [], unchecked: [] } };
  const unused = unusedDefinitions(loaded.modules, spec.warnings);
  const diagnostics = [...loaded.diagnostics, ...shape.diagnostics, ...written, ...spec.diagnostics, ...unused.diagnostics];
  return diagnostics.length > 0
    ? { kind: 'Rejected', diagnostics, warnings: unused.warnings, forms: shape.forms }
    : { kind: 'Accepted', modules: loaded.modules.length, warnings: unused.warnings, obligations: spec.obligations, forms: shape.forms };
}

/**
 * VDMJ 的 Warning 5000 报告没被用到的名字。落在模块顶层定义上时，这个名字在规格里没有任何用处，
 * 只能被文字引用，规格就成了名字的登记表，所以算反模式；落在参数等局部名字上时仍是提示。
 */
function unusedDefinitions(modules: readonly Located[], warnings: readonly string[]): { readonly diagnostics: readonly Diagnostic[]; readonly warnings: readonly string[] } {
  const diagnostics: Diagnostic[] = [];
  const rest: string[] = [];
  for (const warning of warnings) {
    const unused = /^Warning 5000: Definition '([^']+)' not used in '([^']+)' \(([^)]+)\) at line (\d+):\d+/.exec(warning);
    const owner = unused && modules.find((m) => m.name === unused[2] && m.definitions.some((d) => d.name === unused[1] && d.line === Number(unused[4])));
    if (unused && owner) {
      diagnostics.push({
        stage: 'antipattern',
        path: owner.place.path,
        line: Number(unused[4]),
        message: `${owner.name}\`${unused[1]}：规格里没有任何地方用到它，它只是一个名字。删掉它；只有草稿里有约束要求某个连接用到它时，才写出那个连接。不为消掉这条诊断新增导出、导入、调用或场景。`,
      });
    } else rest.push(warning);
  }
  return { diagnostics, warnings: rest };
}

export function printDiagnostics(diagnostics: readonly Diagnostic[]): void {
  for (const d of diagnostics) console.error(`${d.path}:${d.line}: [${d.stage}] ${d.message}`);
  console.error(`未通过：${diagnostics.length} 处。`);
}

function printReport(report: Report): void {
  for (const warning of report.warnings) console.log(`提示：${warning}`);
  const f = report.forms;
  const form = `正文：规格 ${f.spec} 行，说明注释 ${f.comment} 行，文字 ${f.prose} 行，图与文法 ${f.figure} 行。`;
  switch (report.kind) {
    case 'Rejected':
      printDiagnostics(report.diagnostics);
      console.error(form);
      return;
    case 'Accepted': {
      const o = report.obligations;
      console.log(`通过：${report.modules} 个模块；类型检查无错误；QuickCheck 没有找到反例。`);
      console.log(form);
      console.log(`证明义务 ${o.total} 条：可证 ${o.provable}，未定 ${o.maybe.length}，未评估 ${o.unchecked.length}。`);
      for (const title of o.maybe) console.log(`  未定：${title}`);
      for (const title of o.unchecked) console.log(`  未评估：${title}`);
      console.log('未定与未评估的义务要逐条到 pre、inv 与分支条件里找守卫；ssot verify po 逐条记录这些判断。');
      return;
    }
    default:
      assertNever(report);
  }
}

function graph(design: string, json: boolean): number {
  const loaded = load(design);
  const blocking = loaded.diagnostics.filter((d) => d.stage === 'layout' || d.stage === 'parse');
  if (blocking.length > 0) {
    printDiagnostics(blocking);
    return 1;
  }
  const modules = loaded.modules.map((m) => ({ name: m.name, path: m.place.path, dir: m.place.dir, layer: m.place.layer, imports: m.imports.map((i) => i.module) }));
  if (json) {
    console.log(JSON.stringify({ modules }, null, 2));
    return 0;
  }
  // 目录与模块各用前缀分开命名空间；目录名只含小写、数字、连字符与斜杠，模块名是 VDM 标识符。
  const dirId = (dir: string) => `d_${dir.replaceAll('/', '__').replaceAll('-', '_')}`;
  const moduleId = (name: string) => `m_${name.replace(/[^A-Za-z0-9_]/g, '_')}`;
  const dirs = [...new Set(loaded.places.map((p) => p.dir))].sort();
  const out = ['flowchart TB'];
  const emit = (dir: string, depth: number) => {
    const pad = '  '.repeat(depth);
    out.push(`${pad}subgraph ${dirId(dir)}["${dir}"]`);
    for (const m of modules.filter((m) => m.dir === dir)) out.push(`${pad}  ${moduleId(m.name)}["${m.name}"]`);
    for (const child of dirs.filter((d) => dirname(d) === dir && d !== dir)) emit(child, depth + 1);
    out.push(`${pad}end`);
  };
  for (const root of dirs.filter((d) => !dirs.includes(dirname(d)))) emit(root, 1);
  const names = new Set(modules.map((m) => m.name));
  for (const m of modules) for (const target of m.imports) if (names.has(target)) out.push(`  ${moduleId(m.name)} -->|import| ${moduleId(target)}`);
  console.log(out.join('\n'));
  return 0;
}

function passthrough(design: string, args: readonly string[]): number {
  const loaded = load(design);
  const blocking = loaded.diagnostics.filter((d) => d.stage === 'layout' || d.stage === 'parse');
  if (blocking.length > 0) {
    printDiagnostics(blocking);
    return 1;
  }
  const places = [...new Map(loaded.modules.map((m) => [m.place.path, m.place])).values()];
  const files = places.map((p) => toShadow(p.path)).sort();
  const run = Bun.spawnSync(['java', '-cp', classpath(), 'com.fujitsu.vdmj.plugins.VDMJ', '-vdmsl', '-q', ...args, ...files], {
    cwd: shadow(design, places),
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return run.exitCode ?? 1;
}

async function main(): Promise<number> {
  const command = parseArguments(Bun.argv.slice(2));
  switch (command.kind) {
    case 'Setup':
      return setup();
    case 'Init':
      init(command.repo);
      return 0;
    case 'Module':
      addModule(command.design, command.path);
      return 0;
    case 'Unit':
      addUnit(command.design, command.name);
      return 0;
    case 'Check': {
      requireJava();
      const report = check(command.design);
      if (command.json) console.log(JSON.stringify(report, null, 2));
      else printReport(report);
      return report.kind === 'Accepted' ? 0 : 1;
    }
    case 'Graph':
      requireJava();
      return graph(command.design, command.json);
    case 'Vdmj':
      requireJava();
      return passthrough(command.design, command.args);
    case 'Review':
      requireJava();
      console.log(JSON.stringify({ design: command.design, items: review(command.design) }, null, 2));
      return 0;
    case 'Ledger':
      requireJava();
      return judge(command.stage, command.args);
    default:
      return assertNever(command);
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`${error.message}\n\n${USAGE}`);
      process.exitCode = 2;
    } else if (error instanceof MissingDependency) {
      console.error(error.message);
      process.exitCode = 2;
    } else throw error;
  }
}
