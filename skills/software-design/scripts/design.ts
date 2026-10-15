#!/usr/bin/env bun
/** 设计目录的生成、检查与查看。规格语义只由 VDMJ 解释；本脚本只管目录、方向、说明、文字引用、AST 反模式，并为模型审查准备材料。 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, relative, resolve } from 'node:path';

const SKILL = resolve(import.meta.dir, '..');
const VENDOR = join(SKILL, 'scripts', '.vdmj');
const OUTLINE = join(SKILL, 'scripts', 'Outline.java');
const TEMPLATE = join(SKILL, 'templates', 'design.tex');
const MAVEN = 'https://repo1.maven.org/maven2/dk/au/ece/vdmj';
const ARTIFACTS = ['vdmj', 'quickcheck'] as const;
const NAME = /^[a-z0-9][a-z0-9-]*$/;
const SECTIONS = {
  architecture: ['依据', '为什么', '语义'],
  business: ['依据', '需求', '为什么', '语义'],
} as const;

type Layer = keyof typeof SECTIONS;
type Stage = 'layout' | 'parse' | 'structure' | 'antipattern' | 'prose' | 'typecheck' | 'quickcheck';
type Diagnostic = { readonly stage: Stage; readonly path: string; readonly line: number; readonly message: string };
type Place = { readonly path: string; readonly layer: Layer; readonly dir: string; readonly readme: boolean };
type Field = { readonly name: string; readonly line: number };
/** AST 反模式（findings）与交给模型审查的候选（candidates）共用的形状。 */
type Hit = { readonly rule: string; readonly line: number; readonly detail: string };
type Definition = {
  readonly name: string;
  readonly kind: string;
  readonly line: number;
  readonly commented: boolean;
  readonly commentLine: number;
  readonly comment: string;
  readonly explicit: boolean;
  readonly fields: readonly Field[];
  readonly findings: readonly Hit[];
  readonly candidates: readonly Hit[];
};
type Import = { readonly module: string; readonly line: number };
type Module = {
  readonly name: string;
  readonly line: number;
  readonly flat: boolean;
  readonly imports: readonly Import[];
  readonly definitions: readonly Definition[];
};
type ParsedFile = {
  readonly path: string;
  readonly modules: readonly Module[];
  readonly errors: readonly { readonly line: number; readonly message: string }[];
};
type Located = Module & { readonly place: Place };
type Obligations = {
  readonly total: number;
  readonly provable: number;
  readonly maybe: readonly string[];
  readonly unchecked: readonly string[];
};
type Report =
  | { readonly kind: 'Accepted'; readonly modules: number; readonly warnings: readonly string[]; readonly obligations: Obligations }
  | { readonly kind: 'Rejected'; readonly diagnostics: readonly Diagnostic[]; readonly warnings: readonly string[] };
type Command =
  | { readonly kind: 'Setup' }
  | { readonly kind: 'Init'; readonly repo: string }
  | { readonly kind: 'Module'; readonly design: string; readonly path: string }
  | { readonly kind: 'Unit'; readonly design: string; readonly name: string }
  | { readonly kind: 'Check'; readonly design: string; readonly json: boolean }
  | { readonly kind: 'Graph'; readonly design: string; readonly json: boolean }
  | { readonly kind: 'Vdmj'; readonly design: string; readonly args: readonly string[] }
  | { readonly kind: 'Review'; readonly design: string };

class UsageError extends Error {}

const USAGE = `用法（相对本 skill 目录）：
  bun scripts/design.ts setup                     获取最新 VDMJ 与 QuickCheck
  bun scripts/design.ts init <仓库根>              生成 <仓库根>/design
  bun scripts/design.ts module <design> <a/b>      建立架构子模块目录
  bun scripts/design.ts unit <design> <名字>       建立业务单元目录
  bun scripts/design.ts check <design> [--json]    检查目录、说明、方向、文字引用、类型与反例
  bun scripts/design.ts graph <design> [--json]    输出模块与 import 关系
  bun scripts/design.ts vdmj <design> [VDMJ 参数]  用全部规格文件运行 VDMJ，例如 -e 或 -i
  bun scripts/design.ts review <design>            输出模型审查的材料（JSON），由 scripts/review.py 在 omp eval 里交给 jev 判断`;

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

async function setup(): Promise<void> {
  requireJava();
  mkdirSync(VENDOR, { recursive: true });
  for (const artifact of ARTIFACTS) {
    const metadata = await fetchText(`${MAVEN}/${artifact}/maven-metadata.xml`);
    const versions = [...metadata.matchAll(/<version>([0-9.]+)<\/version>/g)].map((m) => m[1]!);
    const latest = versions.sort(compareVersions).at(-1);
    if (!latest) throw new Error(`Maven 上没有 ${artifact} 的正式版本。`);
    const response = await fetch(`${MAVEN}/${artifact}/${latest}/${artifact}-${latest}.jar`);
    if (!response.ok) throw new Error(`下载 ${artifact} ${latest} 失败：HTTP ${response.status}`);
    writeFileSync(join(VENDOR, `${artifact}.jar`), new Uint8Array(await response.arrayBuffer()));
    console.log(`${artifact} ${latest} -> ${relative(SKILL, join(VENDOR, `${artifact}.jar`))}`);
  }
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`读取 ${url} 失败：HTTP ${response.status}`);
  return response.text();
}

function requireJava(): void {
  if (Bun.spawnSync(['java', '-version']).exitCode !== 0) throw new UsageError('需要 Java 11 或更高版本的 java 命令。');
}

function classpath(): string {
  const jars = ARTIFACTS.map((artifact) => join(VENDOR, `${artifact}.jar`));
  if (!jars.every(existsSync)) throw new UsageError('VDMJ 尚未就绪：先运行 bun scripts/design.ts setup。');
  return jars.join(delimiter);
}

function java(args: readonly string[], cwd: string, stdin?: string): { readonly code: number; readonly lines: string[] } {
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
  writeFileSync(join(design, 'design.tex'), readFileSync(TEMPLATE, 'utf8'));
  writeFileSync(join(design, 'architecture', 'README.tex'), readme('架构'));
  for (const kind of ['examples', 'evidence', 'reference']) {
    mkdirSync(join(design, 'appendix', kind), { recursive: true });
    writeFileSync(join(design, 'appendix', kind, '.gitkeep'), '');
  }
  console.log(`已生成 ${design}`);
}

function readme(title: string): string {
  return `\\section{${title}}\n\n% 先写一段：本模块负责什么、不负责什么。\n`;
}

function addModule(design: string, path: string): void {
  const segments = path.split('/');
  if (!segments.every((s) => NAME.test(s))) throw new UsageError('模块路径每段只用小写字母、数字与连字符。');
  const parent = join(design, 'architecture', ...segments.slice(0, -1));
  if (!existsSync(join(parent, 'README.tex'))) throw new UsageError(`父模块 ${relative(design, parent)} 不存在。`);
  create(design, ['architecture', ...segments], segments.at(-1)!);
}

function addUnit(design: string, name: string): void {
  if (!NAME.test(name)) throw new UsageError('业务单元名只用小写字母、数字与连字符。');
  create(design, ['business', name], name);
}

function create(design: string, segments: readonly string[], title: string): void {
  const main = join(design, 'design.tex');
  if (!existsSync(main)) throw new UsageError(`${main} 不存在；先运行 init。`);
  const dir = join(design, ...segments);
  if (existsSync(dir)) throw new UsageError(`${relative(design, dir)} 已存在。`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'README.tex'), readme(title));
  const input = `\\input{${[...segments, 'README'].join('/')}}`;
  const lines = readFileSync(main, 'utf8').split('\n');
  const last = lines.findLastIndex((line) => line.trim().startsWith('\\input{'));
  const at = last >= 0 ? last + 1 : lines.findIndex((line) => line.trim() === '\\end{document}');
  if (at < 0) throw new UsageError('design.tex 缺少 \\end{document}。');
  lines.splice(at, 0, input);
  writeFileSync(main, lines.join('\n'));
  console.log(`已生成 ${relative(design, join(dir, 'README.tex'))}，并在 design.tex 加入 ${input}`);
}

// ---------------------------------------------------------------- 布局

function layout(design: string): { readonly places: readonly Place[]; readonly diagnostics: readonly Diagnostic[] } {
  if (!existsSync(design) || !lstatSync(design).isDirectory()) throw new UsageError(`${design} 不是设计目录。`);
  const places: Place[] = [];
  const diagnostics: Diagnostic[] = [];
  const fail = (path: string, message: string) => diagnostics.push({ stage: 'layout', path, line: 1, message });
  const entries = (dir: string) => readdirSync(join(design, dir)).filter((name) => !name.startsWith('.')).sort();
  const kind = (path: string) => lstatSync(join(design, path));

  if (!existsSync(join(design, 'design.tex'))) fail('design.tex', '缺少 design.tex；先运行 init。');
  if (!existsSync(join(design, 'architecture', 'README.tex'))) fail('architecture/README.tex', '缺少根模块 README.tex。');
  for (const name of entries('.')) {
    // 编译 design.tex 的产物是派生视图，不是设计内容。
    if (/^design\.(pdf|aux|log|toc|out|synctex\.gz)$/.test(name)) continue;
    if (!['design.tex', 'architecture', 'business', 'appendix'].includes(name)) fail(name, '设计目录只放 design.tex、architecture、business、appendix。');
    else if (kind(name).isSymbolicLink()) fail(name, '不接受符号链接。');
  }

  const walk = (dir: string, layer: Layer, nested: boolean) => {
    if (!existsSync(join(design, dir, 'README.tex'))) fail(dir, '每个模块或业务单元目录都要有 README.tex。');
    for (const name of entries(dir)) {
      const path = `${dir}/${name}`;
      const stat = kind(path);
      if (stat.isSymbolicLink()) fail(path, '不接受符号链接。');
      else if (stat.isDirectory()) {
        if (!nested) fail(path, '业务单元不嵌套。');
        else if (!NAME.test(name)) fail(path, '目录名只用小写字母、数字与连字符。');
        else walk(path, layer, nested);
      } else if (name === 'README.tex' || (name.endsWith('.tex') && NAME.test(name.slice(0, -4)))) {
        places.push({ path, layer, dir, readme: name === 'README.tex' });
      } else fail(path, '只放 README.tex 与按内容命名的 <小写名>.tex。');
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
  const run = java(['-cp', classpath(), OUTLINE, ...places.map((p) => p.path)], design);
  const json = run.lines.find((line) => line.startsWith('['));
  if (run.code !== 0 || !json) throw new Error(`VDMJ 解析器没有给出结果：\n${run.lines.join('\n')}`);
  type Raw = Omit<Definition, 'commented' | 'commentLine' | 'comment'>;
  type RawFile = Omit<ParsedFile, 'modules'> & { readonly modules: readonly (Omit<Module, 'definitions'> & { readonly definitions: readonly Raw[] })[] };
  return (JSON.parse(json) as RawFile[]).map((file) => {
    const lines = readFileSync(join(design, file.path), 'utf8').split('\n');
    return {
      ...file,
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
        if (!definition.commented) fail(file.path, definition.line, `${module.name}\`${definition.name} 前面缺少说明它是什么、承诺什么的 -- 注释。`);
        for (const field of definition.fields) {
          if (!fieldCommented(lines, field.line, definition.line)) {
            fail(file.path, field.line, `${module.name}\`${definition.name}.${field.name} 缺少说明：在同一行末尾或上一行写 -- 注释。`);
          }
        }
      }
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

type ProseLine = { readonly line: number; readonly text: string; readonly inSpec: boolean };

function proseLines(text: string): ProseLine[] {
  let inSpec = false;
  return text.split('\n').map((raw, i) => {
    const trimmed = raw.trim();
    if (trimmed.startsWith('\\begin{vdm_al}')) {
      inSpec = true;
      return { line: i + 1, text: '', inSpec: true };
    }
    if (trimmed.startsWith('\\end{vdm_al}')) {
      inSpec = false;
      return { line: i + 1, text: '', inSpec: true };
    }
    return { line: i + 1, text: inSpec ? raw : raw.replace(/(^|[^\\])%.*$/, '$1').trim(), inSpec };
  });
}

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

  for (const place of places) {
    const lines = proseLines(readFileSync(join(design, place.path), 'utf8'));
    for (const { line, text, inSpec } of lines) {
      if (inSpec) continue;
      for (const match of text.matchAll(/\\vdmref\{([^}]*)\}/g)) {
        if (!known.has(match[1]!)) fail(place.path, line, `\\vdmref{${match[1]}} 指向的规格元素不存在；只引用规格里已有的模块、定义或字段，不造新词。`);
      }
    }
    if (place.readme) diagnostics.push(...readmeShape(place, lines));
  }

  const main = join(design, 'design.tex');
  if (existsSync(main)) {
    const inputs = new Map<string, number>();
    for (const { line, text } of proseLines(readFileSync(main, 'utf8'))) {
      for (const match of text.matchAll(/\\input\{([^}]*)\}/g)) {
        const path = match[1]!.endsWith('.tex') ? match[1]! : `${match[1]}.tex`;
        if (inputs.has(path)) fail('design.tex', line, `${path} 重复 \\input。`);
        else if (!existsSync(join(design, path))) fail('design.tex', line, `\\input 的 ${path} 不存在。`);
        inputs.set(path, line);
      }
    }
    for (const place of places) {
      if (!inputs.has(place.path)) fail('design.tex', 1, `${place.path} 不在阅读次序里；在 design.tex 加入 \\input{${place.path.slice(0, -4)}}。`);
    }
  }
  return diagnostics;
}

function readmeShape(place: Place, lines: readonly ProseLine[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const fail = (line: number, message: string) => diagnostics.push({ stage: 'prose', path: place.path, line, message });
  const allowed: readonly string[] = SECTIONS[place.layer];
  const content = lines.filter((l) => l.inSpec || l.text !== '');
  const head = content[0];
  if (!head || !/^\\section\{/.test(head.text)) {
    fail(head?.line ?? 1, 'README.tex 以 \\section{模块名} 开头。');
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
    const subsection = /^\\subsection\{([^}]*)\}/.exec(entry.text);
    if (/^\\section\{/.test(entry.text)) fail(entry.line, 'README.tex 只有一个 \\section。');
    else if (subsection) {
      close();
      const title = subsection[1]!.trim();
      const at = allowed.indexOf(title);
      if (at < 0) fail(entry.line, `README.tex 的小节只用 ${allowed.join('、')}；其余内容放进按内容命名的主题文件。`);
      else if (at <= order) fail(entry.line, `小节按 ${allowed.join('、')} 的次序排列。`);
      order = Math.max(order, at);
      current = { title, line: entry.line, body: false };
    } else if (current.title === '' && entry.inSpec) {
      close();
      current = { title: '规格', line: entry.line, body: true };
    } else current.body = true;
  }
  close();
  return diagnostics;
}

// ---------------------------------------------------------------- 模型审查材料

/** 一条交给 jev 判断的材料：问题编号、位置与判断对象。问题的措辞与阈值只在 scripts/review.py 里。 */
type ReviewItem = {
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
  | 'basis';
type Paragraph = { readonly path: string; readonly line: number; readonly section: string; readonly text: string };

/** 把文字里的 LaTeX 引用写法还原成读者看到的名字。 */
function plain(text: string): string {
  return text.replace(/\\(?:vdmref|texttt)\{([^}]*)\}/g, '$1');
}

function paragraphs(design: string, place: Place): Paragraph[] {
  const result: Paragraph[] = [];
  let section = '';
  let current: { line: number; lines: string[] } | null = null;
  const flush = () => {
    if (current) result.push({ path: place.path, line: current.line, section, text: plain(current.lines.join('')) });
    current = null;
  };
  for (const { line, text, inSpec } of proseLines(readFileSync(join(design, place.path), 'utf8'))) {
    const heading = /^\\(sub)?section\{([^}]*)\}/.exec(text);
    if (inSpec || text === '' || heading) {
      flush();
      if (heading) section = heading[1] ? heading[2]!.trim() : '';
      continue;
    }
    if (current) current.lines.push(text);
    else current = { line, lines: [text] };
  }
  flush();
  return result;
}

/** 每个定义的源码：从它的说明注释开始，到下一个定义的说明之前。 */
function sources(design: string, module: Located): { readonly module: string; readonly definitions: ReadonlyMap<Definition, { readonly full: string; readonly body: string }> } {
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

function review(design: string): readonly ReviewItem[] {
  const loaded = load(design);
  const blocking = loaded.diagnostics.filter((d) => d.stage === 'layout' || d.stage === 'parse');
  if (blocking.length > 0) {
    printReport({ kind: 'Rejected', diagnostics: blocking, warnings: [] });
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
    .map((p) => `${p.dir.slice('business/'.length)}: ${paragraphs(design, p).find((para) => para.section === '')?.text ?? ''}`);
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
    for (const para of paragraphs(design, place)) {
      items.push({ question: 'coined', path: para.path, line: para.line, state: { spec_names: names, paragraph: para.text } });
      if (spec !== '' && para.section !== '') items.push({ question: 'prose_restates', path: para.path, line: para.line, state: { spec, paragraph: para.text } });
      if (para.section === '依据') items.push({ question: 'basis', path: para.path, line: para.line, state: { paragraph: para.text } });
    }
  }
  return items;
}

// ---------------------------------------------------------------- VDMJ

const LOCATION = /in '[^']*' \(([^)]+)\) at line (\d+):\d+/;

function vdmj(design: string, modules: readonly Located[]): { readonly diagnostics: readonly Diagnostic[]; readonly warnings: readonly string[]; readonly obligations: Obligations } {
  const files = [...new Set(modules.map((m) => m.place.path))].sort();
  // qc 默认只看当前模块；模式 .* 覆盖全部模块。
  const run = java(['-cp', classpath(), 'com.fujitsu.vdmj.plugins.VDMJ', '-vdmsl', '-q', '-i', ...files], design, 'pog\nqc .*\nquit\n');
  const lines = run.lines.map((line) => line.replace(/^(> )+/, ''));
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
      diagnostics.push({ stage: 'typecheck', path: at?.[1] ?? 'design.tex', line: Number(at?.[2] ?? 1), message });
    } else if (/^Warning \d+:/.test(line)) warnings.push(line);
  }
  if (diagnostics.length > 0 || run.code !== 0) {
    if (diagnostics.length === 0) diagnostics.push({ stage: 'typecheck', path: 'design.tex', line: 1, message: lines.join('\n').trim() });
    return { diagnostics, warnings, obligations: { total: 0, provable: 0, maybe: [], unchecked: [] } };
  }

  const titles = new Map<number, string>();
  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    const generated = /^Generated (\d+) proof obligations/.exec(lines[i]!);
    if (generated) total = Number(generated[1]);
    const po = /^Proof Obligation (\d+):/.exec(lines[i]!);
    if (po) titles.set(Number(po[1]), lines[i + 1]!.trim());
  }
  // FAILED 只在求值返回 false 时才是反例；求值中途报错（例如生成了违反不变式的状态）只说明 QuickCheck 没能判断。
  const status = new Map<number, 'PROVABLE' | 'COUNTEREXAMPLE' | 'ERROR' | 'MAYBE'>();
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
      const where = block.find((l) => LOCATION.test(l)) ?? titles.get(number) ?? '';
      const at = LOCATION.exec(where);
      const witness = block.filter((l) => l.includes('-->')).map((l) => l.trim()).join(' ');
      diagnostics.push({ stage: 'quickcheck', path: at?.[1] ?? 'design.tex', line: Number(at?.[2] ?? 1), message: `证明义务有反例：${where.trim()} ${witness}`.trim() });
    }
  }
  const pick = (predicate: (s: string | undefined) => boolean) =>
    [...titles.entries()].filter(([n]) => predicate(status.get(n))).map(([, title]) => title);
  return {
    diagnostics,
    warnings,
    obligations: {
      total,
      provable: [...status.values()].filter((s) => s === 'PROVABLE').length,
      maybe: pick((s) => s === 'MAYBE' || s === 'ERROR'),
      unchecked: pick((s) => s === undefined),
    },
  };
}

// ---------------------------------------------------------------- 编排

function load(design: string): { readonly places: readonly Place[]; readonly modules: readonly Located[]; readonly diagnostics: readonly Diagnostic[] } {
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
        return '规格里出现了字符串字面量：设计靠类型与谓词表达含义，不比较字符串内容；改用 quote、token 或记录。';
      case 'implementation':
        return `显式体里有${details}：这是实现。连接写成隐式定义的 post；显式体只用于场景与判定，不改状态、不写循环。`;
      case 'unspecified':
        return 'is not yet specified 不承诺任何东西：写出 pre 与 post；还没想清楚就不写这个定义。';
      case 'no-promise':
        return `隐式定义的 ${details}，不承诺任何东西：写出它做到什么。`;
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

function check(design: string): Report {
  const loaded = load(design);
  if (loaded.diagnostics.some((d) => d.stage === 'layout' || d.stage === 'parse')) return { kind: 'Rejected', diagnostics: loaded.diagnostics, warnings: [] };
  const written = prose(design, loaded.places, loaded.modules);
  const spec = loaded.modules.length > 0 ? vdmj(design, loaded.modules) : { diagnostics: [], warnings: [], obligations: { total: 0, provable: 0, maybe: [], unchecked: [] } };
  const unused = unusedDefinitions(loaded.modules, spec.warnings);
  const diagnostics = [...loaded.diagnostics, ...written, ...spec.diagnostics, ...unused.diagnostics];
  return diagnostics.length > 0
    ? { kind: 'Rejected', diagnostics, warnings: unused.warnings }
    : { kind: 'Accepted', modules: loaded.modules.length, warnings: unused.warnings, obligations: spec.obligations };
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
        message: `${owner.name}\`${unused[1]}：规格里没有任何地方用到它，它只是一个名字。导出它给别的模块用，或在本模块里用它；只为文字引用而存在的名字不是设计。`,
      });
    } else rest.push(warning);
  }
  return { diagnostics, warnings: rest };
}

function printReport(report: Report): void {
  for (const warning of report.warnings) console.log(`提示：${warning}`);
  switch (report.kind) {
    case 'Rejected':
      for (const d of report.diagnostics) console.error(`${d.path}:${d.line}: [${d.stage}] ${d.message}`);
      console.error(`未通过：${report.diagnostics.length} 处。`);
      return;
    case 'Accepted': {
      const o = report.obligations;
      console.log(`通过：${report.modules} 个模块；类型检查无错误；QuickCheck 没有找到反例。`);
      console.log(`证明义务 ${o.total} 条：可证 ${o.provable}，未定 ${o.maybe.length}，未评估 ${o.unchecked.length}。`);
      for (const title of o.maybe) console.log(`  未定：${title}`);
      for (const title of o.unchecked) console.log(`  未评估：${title}`);
      console.log('未定与未评估的义务、说明、依据和理由仍按 SKILL.md 的审查清单人工判断。');
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
    printReport({ kind: 'Rejected', diagnostics: blocking, warnings: [] });
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
    printReport({ kind: 'Rejected', diagnostics: blocking, warnings: [] });
    return 1;
  }
  const files = [...new Set(loaded.modules.map((m) => m.place.path))].sort();
  const run = Bun.spawnSync(['java', '-cp', classpath(), 'com.fujitsu.vdmj.plugins.VDMJ', '-vdmsl', '-q', ...args, ...files], {
    cwd: design,
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
      await setup();
      return 0;
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
    default:
      return assertNever(command);
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`${error.message}\n\n${USAGE}`);
    process.exitCode = 2;
  } else throw error;
}
