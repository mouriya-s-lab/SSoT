#!/usr/bin/env bun
/**
 * software-design 设计目录的初始化与检查。
 *
 *   bun design.ts init <仓库根>                 在 <仓库根>/design 建立模板
 *   bun design.ts module <design 目录> <a/b>   在 architecture/a/b 建立子架构模块
 *   bun design.ts unit <design 目录> <名字>     在 business/<名字> 建立业务单元
 *   bun design.ts check <design 目录>          检查结构、README 小节、import、注释与 tsc
 *
 * 首次使用前在本目录运行 `bun install --no-save`。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { parse as Parse } from '@babel/parser';

/** 检查发现的一处违规。 */
type Violation = {
  /** 违规所在的文件，相对 design 目录的父目录。 */
  readonly file: string;
  /** 违规所在的行；针对整个文件或目录的违规为 0。 */
  readonly line: number;
  /** 违规的说明。 */
  readonly message: string;
};

/** 架构模块在模块树中的位置：`architecture/` 之下的目录名序列，根架构模块为空序列。 */
type ModulePath = readonly string[];

/** design 中一个类型文件的角色，决定它可以 import 哪些文件。 */
type FileRole =
  | {
      /** 架构模块的核心代码 `core.ts`。 */
      readonly kind: 'Core';
      /** 所属架构模块。 */
      readonly module: ModulePath;
    }
  | {
      /** 架构模块的外部连接 `connections.ts`。 */
      readonly kind: 'Connections';
      /** 所属架构模块。 */
      readonly module: ModulePath;
    }
  | {
      /** 业务单元的 `business.ts`。 */
      readonly kind: 'Business';
      /** 业务单元的目录名。 */
      readonly unit: string;
    };

/** Babel 语法树中的一个节点；只读取检查用到的字段。 */
type AstNode = {
  /** 节点种类。 */
  readonly type: string;
  /** 节点在源文件中的位置。 */
  readonly loc?: { readonly start: { readonly line: number } };
  /** 紧贴在节点之前的注释。 */
  readonly leadingComments?: readonly AstComment[];
  /** 节点的其余字段。 */
  readonly [field: string]: unknown;
};

/** Babel 语法树中的一条注释。 */
type AstComment = {
  /** 注释种类：块注释或行注释。 */
  readonly type: 'CommentBlock' | 'CommentLine';
  /** 去掉 `/*`、`*\/` 或 `//` 之后的注释正文。 */
  readonly value: string;
};

const ARCHITECTURE_SECTIONS = ['依据', '组成', '范围', '材料', '为什么', '语义'] as const;
const UNIT_SECTIONS = ['依据', '需求', '接入', '为什么', '语义'] as const;
const APPENDIX_DIRS = ['examples', 'evidence', 'reference'] as const;
const NAME = /^[a-z][a-z0-9-]*$/;
const TYPE_REFERENCE = /^[A-Z][A-Za-z0-9]*(?:\.([A-Za-z_$][\w$]*))?$/;
const FILE_EXTENSIONS: Record<string, true> = { md: true, ts: true, json: true, js: true, mjs: true };
const SCRIPT_DIR = import.meta.dir;

const TSCONFIG = `{
  "compilerOptions": {
    "strict": true,
    "noEmit": true,
    "target": "ES2022",
    "lib": ["ES2022"],
    "types": [],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true
  },
  "include": ["**/*.ts"]
}
`;

/** 节点种类中，作为一条声明需要自己注释的种类。 */
const DECLARATIONS: Record<string, true> = {
  TSInterfaceDeclaration: true,
  TSTypeAliasDeclaration: true,
  TSEnumDeclaration: true,
  TSDeclareFunction: true,
  FunctionDeclaration: true,
  VariableDeclaration: true,
  ClassDeclaration: true,
  TSModuleDeclaration: true,
};

/** 节点种类中，作为类型成员需要自己注释的种类。 */
const MEMBERS: Record<string, true> = {
  TSPropertySignature: true,
  TSMethodSignature: true,
  TSEnumMember: true,
  TSIndexSignature: true,
  TSCallSignatureDeclaration: true,
  TSConstructSignatureDeclaration: true,
};

/** 联合中需要自己注释的分支种类；具名类型在它自己的声明处注释。 */
const INLINE_VARIANTS: Record<string, true> = { TSTypeLiteral: true, TSLiteralType: true };

/** design 目录下的模板条目。 */
const TOP_ENTRIES: Record<string, true> = {
  'README.md': true,
  'tsconfig.json': true,
  architecture: true,
  business: true,
  appendix: true,
};

/** 遍历语法树时跳过的字段：位置与注释不是子节点。 */
const SKIPPED_FIELDS: Record<string, true> = {
  loc: true,
  start: true,
  end: true,
  range: true,
  leadingComments: true,
  trailingComments: true,
  innerComments: true,
  extra: true,
};

function assertNever(value: never): never {
  throw new Error(`unexpected value: ${JSON.stringify(value)}`);
}

function stop(message: string, code: 1 | 2): never {
  console.error(message);
  process.exit(code);
}

function writeNew(path: string, content: string): void {
  if (existsSync(path)) stop(`已存在：${path}`, 2);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/** 只跳过占位用的普通 .gitkeep 文件；隐藏条目不属于模板。 */
function templateEntries(dir: string, report: Report): readonly string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => {
      if (entry.name === '.gitkeep' && entry.isFile()) return false;
      if (!entry.name.startsWith('.')) return true;
      report(join(dir, entry.name), 0, '模板之外的文件或目录');
      return false;
    })
    .map((entry) => entry.name)
    .sort();
}

function isDir(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

// ---------------------------------------------------------------------------
// 初始化

function createModule(dir: string, title: string): void {
  writeNew(join(dir, 'README.md'), `# ${title}\n`);
  writeNew(join(dir, 'core.ts'), 'export {};\n');
  writeNew(join(dir, 'connections.ts'), 'export {};\n');
}

function init(root: string): void {
  const design = join(resolve(root), 'design');
  if (isDir(design) && readdirSync(design).length > 0) stop(`${design} 已存在且不为空`, 2);
  writeNew(join(design, 'README.md'), '# 设计\n\n1. [architecture](architecture/README.md)\n');
  writeNew(join(design, 'tsconfig.json'), TSCONFIG);
  createModule(join(design, 'architecture'), 'architecture');
  writeNew(join(design, 'business', '.gitkeep'), '');
  for (const name of APPENDIX_DIRS) writeNew(join(design, 'appendix', name, '.gitkeep'), '');
  console.log(`已建立 ${design}`);
}

function addModule(design: string, path: string): void {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0 || !segments.every((segment) => NAME.test(segment))) {
    stop(`模块路径的每一段只用英文小写字母、数字与连字符，且以字母开头：${path}`, 2);
  }
  const dir = join(resolve(design), 'architecture', ...segments);
  if (!isFile(join(dirname(dir), 'core.ts'))) stop(`父模块不存在：${dirname(dir)}`, 2);
  createModule(dir, segments.join('/'));
  console.log(`已建立 ${dir}`);
}

function addUnit(design: string, name: string): void {
  if (!NAME.test(name)) stop(`业务单元名只用英文小写字母、数字与连字符，且以字母开头：${name}`, 2);
  const dir = join(resolve(design), 'business', name);
  writeNew(join(dir, 'README.md'), `# ${name}\n`);
  writeNew(join(dir, 'business.ts'), 'export {};\n');
  console.log(`已建立 ${dir}`);
}

// ---------------------------------------------------------------------------
// 检查：目录结构与 README 小节

type Report = (file: string, line: number, message: string) => void;

/** 结构遍历发现的 README；类型文件全部解析后再解析其中的类型名。 */
type ReadmeTarget = {
  /** README 的路径。 */
  readonly file: string;
  /** README 所属位置：架构模块记为该模块的 core.ts 角色，业务单元记为其 business.ts 角色；决定哪些导出可见。 */
  readonly role: FileRole;
  /** 所属架构模块有子模块，「组成」中必须有 mermaid 图。 */
  readonly needsComposition: boolean;
};

function checkConfig(file: string, report: Report): void {
  let config: unknown;
  try {
    config = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    report(file, 0, `无法解析 tsconfig.json JSON：${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const object = typeof config === 'object' && config !== null && !Array.isArray(config) ? config : undefined;
  const options = object !== undefined && 'compilerOptions' in object ? object.compilerOptions : undefined;
  if (typeof options !== 'object' || options === null || !('strict' in options) || options.strict !== true) {
    report(file, 0, 'tsconfig.json 的 compilerOptions.strict 必须为 true');
  }
  if (typeof options !== 'object' || options === null || !('noEmit' in options) || options.noEmit !== true) {
    report(file, 0, 'tsconfig.json 的 compilerOptions.noEmit 必须为 true');
  }
  const include = object !== undefined && 'include' in object ? object.include : undefined;
  if (!Array.isArray(include) || include.length !== 1 || include[0] !== '**/*.ts') {
    report(file, 0, 'tsconfig.json 的 include 必须恰好为 ["**/*.ts"]');
  }
  for (const key of ['files', 'exclude', 'extends', 'references']) {
    if (object !== undefined && Object.hasOwn(object, key)) report(file, 0, `tsconfig.json 不得设置 ${key}`);
  }
}

function visibleExports(target: ReadmeTarget, sources: readonly SourceFile[]): ReadonlySet<string> {
  const names = new Set<string>();
  for (const source of sources) {
    const directChild =
      target.role.kind !== 'Business' &&
      source.role.kind === 'Connections' &&
      source.role.module.length === target.role.module.length + 1 &&
      isAncestorOrSelf(target.role.module, source.role.module);
    if (importRule(target.role, source.role) === undefined || directChild) {
      for (const name of source.exports) names.add(name);
    }
  }
  return names;
}

function checkTypeReference(file: string, line: number, name: string, names: ReadonlySet<string>, report: Report): void {
  if (!TYPE_REFERENCE.test(name) || !names.has(name.split('.')[0] ?? '')) {
    report(file, line, `类型名 ${name} 没有对应的可见导出声明`);
  }
}

function checkReadme(target: ReadmeTarget, names: ReadonlySet<string>, report: Report): void {
  const { file, role, needsComposition } = target;
  const allowed: readonly string[] = role.kind === 'Business' ? UNIT_SECTIONS : ARCHITECTURE_SECTIONS;
  const lines = readFileSync(file, 'utf8').split('\n');
  let fence: { marker: string; length: number; mermaid: boolean; stage: 'Start' | 'Frontmatter' | 'Body' } | undefined;
  let lastIndex = -1;
  const sections: { name: string; line: number; body: string[] }[] = [];
  lines.forEach((text, index) => {
    if (fence !== undefined) {
      sections.at(-1)?.body.push(text);
      const closing = /^\s*(`{3,}|~{3,})\s*$/.exec(text)?.[1];
      if (closing !== undefined && closing[0] === fence.marker && closing.length >= fence.length) {
        fence = undefined;
      } else if (fence.mermaid) {
        const trimmed = text.trim();
        if (trimmed === '' || trimmed.startsWith('%%')) return;
        if (fence.stage === 'Start' && trimmed === '---') {
          fence.stage = 'Frontmatter';
          return;
        }
        if (fence.stage === 'Frontmatter') {
          if (trimmed === '---') fence.stage = 'Body';
          return;
        }
        fence.stage = 'Body';
        if (trimmed === '---') return;
        for (const edge of text.matchAll(/(-->|-\.->|==>|---)(?:[ \t]*\|([^|]*)\|)?/g)) {
          if (sections.at(-1)?.name === '范围') {
            report(file, index + 1, '范围图只画包含，不画连线');
            break;
          }
          if (sections.at(-1)?.name !== '组成') continue;
          if (edge[2] === undefined) {
            report(file, index + 1, '组成图的每条连线要标连接的类型名');
          } else {
            const label = edge[2].trim().replace(/^"(.*)"$/, '$1');
            checkTypeReference(file, index + 1, label, names, report);
          }
        }
      }
      return;
    }
    const opening = /^\s*(`{3,}|~{3,})(.*)$/.exec(text);
    if (opening?.[1] !== undefined) {
      fence = {
        marker: opening[1][0] ?? '`',
        length: opening[1].length,
        mermaid: opening[2]?.trim() === 'mermaid',
        stage: 'Start',
      };
      sections.at(-1)?.body.push(text);
      return;
    }
    for (const span of text.matchAll(/(?<!`)(`+)(?!`)(.*?)\1(?!`)/g)) {
      const name = span[2] ?? '';
      const reference = TYPE_REFERENCE.exec(name);
      if (reference !== null && FILE_EXTENSIONS[reference[1] ?? ''] !== true) {
        checkTypeReference(file, index + 1, name, names, report);
      }
    }
    const heading = /^(#{1,2}) (.+)$/.exec(text);
    if (heading?.[1] === '##') {
      const name = (heading[2] ?? '').trim();
      const position = allowed.indexOf(name);
      if (position < 0) {
        report(file, index + 1, `小节「${name}」不在模板中；只允许 ${allowed.map((s) => `「${s}」`).join('')}`);
      } else if (position <= lastIndex) {
        report(file, index + 1, `小节「${name}」重复或次序不对；次序是 ${allowed.map((s) => `「${s}」`).join('')}`);
      } else {
        lastIndex = position;
      }
      sections.push({ name, line: index + 1, body: [] });
    } else if (heading?.[1] === '#') {
      sections.push({ name: '', line: index + 1, body: [] });
    } else {
      sections.at(-1)?.body.push(text);
    }
  });
  for (const section of sections) {
    if (section.name !== '' && section.body.every((text) => text.trim() === '')) {
      report(file, section.line, `小节「${section.name}」是空的；没有内容的小节不写`);
    }
  }
  if (needsComposition) {
    const composition = sections.find((section) => section.name === '组成');
    if (composition === undefined || !composition.body.some((text) => /^\s*(?:`{3,}|~{3,})mermaid\s*$/.test(text))) {
      report(file, 0, '有子模块的架构模块要在「组成」中附一张 mermaid 组成图');
    }
  }
}

function checkModule(dir: string, module: ModulePath, roles: Map<string, FileRole>, readmes: ReadmeTarget[], report: Report): void {
  for (const required of ['README.md', 'core.ts', 'connections.ts']) {
    if (!isFile(join(dir, required))) report(dir, 0, `架构模块缺少 ${required}`);
  }
  roles.set(join(dir, 'core.ts'), { kind: 'Core', module });
  roles.set(join(dir, 'connections.ts'), { kind: 'Connections', module });
  const children: string[] = [];
  for (const name of templateEntries(dir, report)) {
    if (name === 'README.md' || name === 'core.ts' || name === 'connections.ts') continue;
    const path = join(dir, name);
    if (!isDir(path)) {
      report(path, 0, '模板之外的文件；架构模块只有 README.md、core.ts、connections.ts 与子模块目录');
    } else if (!NAME.test(name)) {
      report(path, 0, '目录名只用英文小写字母、数字与连字符，且以字母开头');
    } else {
      children.push(name);
      checkModule(path, [...module, name], roles, readmes, report);
    }
  }
  if (isFile(join(dir, 'README.md'))) {
    readmes.push({ file: join(dir, 'README.md'), role: { kind: 'Core', module }, needsComposition: children.length > 0 });
  }
}

function checkStructure(design: string, roles: Map<string, FileRole>, readmes: ReadmeTarget[], report: Report): void {
  for (const name of Object.keys(TOP_ENTRIES)) {
    if (!existsSync(join(design, name))) report(design, 0, `缺少 ${name}`);
  }
  for (const name of templateEntries(design, report)) {
    if (TOP_ENTRIES[name] !== true) report(join(design, name), 0, '模板之外的文件');
  }
  if (isDir(join(design, 'architecture'))) checkModule(join(design, 'architecture'), [], roles, readmes, report);

  const business = join(design, 'business');
  if (isDir(business)) {
    for (const unit of templateEntries(business, report)) {
      const dir = join(business, unit);
      if (!isDir(dir)) {
        report(dir, 0, '模板之外的文件；business/ 下只有业务单元目录');
        continue;
      }
      if (!NAME.test(unit)) report(dir, 0, '目录名只用英文小写字母、数字与连字符，且以字母开头');
      for (const required of ['README.md', 'business.ts']) {
        if (!isFile(join(dir, required))) report(dir, 0, `业务单元缺少 ${required}`);
      }
      for (const name of templateEntries(dir, report)) {
        if (name !== 'README.md' && name !== 'business.ts') {
          report(join(dir, name), 0, '模板之外的文件；业务单元只有 README.md 与 business.ts');
        }
      }
      roles.set(join(dir, 'business.ts'), { kind: 'Business', unit });
      if (isFile(join(dir, 'README.md'))) {
        readmes.push({ file: join(dir, 'README.md'), role: { kind: 'Business', unit }, needsComposition: false });
      }
    }
  }

  const appendix = join(design, 'appendix');
  if (isDir(appendix)) {
    for (const name of templateEntries(appendix, report)) {
      if (!(APPENDIX_DIRS as readonly string[]).includes(name) || !isDir(join(appendix, name))) {
        report(join(appendix, name), 0, `模板之外的文件；appendix/ 下只有 ${APPENDIX_DIRS.join('、')} 三个目录`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 检查：import 方向

function isAncestorOrSelf(ancestor: ModulePath, module: ModulePath): boolean {
  return ancestor.length <= module.length && ancestor.every((segment, index) => module[index] === segment);
}

function isStrictDescendant(module: ModulePath, of: ModulePath): boolean {
  return module.length > of.length && isAncestorOrSelf(of, module);
}

/** 返回 `from` import `to` 违反的规则；允许时返回 undefined。 */
function importRule(from: FileRole, to: FileRole): string | undefined {
  switch (from.kind) {
    case 'Business':
      return undefined;
    case 'Core':
    case 'Connections':
      switch (to.kind) {
        case 'Business':
          return '架构类型不得 import 业务类型';
        case 'Core':
          if (isAncestorOrSelf(to.module, from.module)) return undefined;
          return isStrictDescendant(to.module, from.module)
            ? '架构模块不得 import 后代模块的文件'
            : '除本模块与祖先模块外，不得 import 其他模块的 core.ts';
        case 'Connections': {
          if (isAncestorOrSelf(to.module, from.module)) return undefined;
          if (isStrictDescendant(to.module, from.module)) return '架构模块不得 import 后代模块的文件';
          const parent = to.module.slice(0, -1);
          return isAncestorOrSelf(parent, from.module)
            ? undefined
            : '只能 import 祖先、兄弟与祖先兄弟模块的 connections.ts';
        }
        default:
          return assertNever(to);
      }
    default:
      return assertNever(from);
  }
}

// ---------------------------------------------------------------------------
// 检查：语法树遍历、注释、import

function isAstNode(value: unknown): value is AstNode {
  return typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string';
}

function children(node: AstNode): readonly AstNode[] {
  const result: AstNode[] = [];
  for (const [field, value] of Object.entries(node)) {
    if (SKIPPED_FIELDS[field] === true) continue;
    if (Array.isArray(value)) {
      for (const item of value) if (isAstNode(item)) result.push(item);
    } else if (isAstNode(value)) {
      result.push(value);
    }
  }
  return result;
}

function walk(node: AstNode, visit: (node: AstNode) => void): void {
  visit(node);
  for (const child of children(node)) walk(child, visit);
}

function lineOf(node: AstNode): number {
  return node.loc?.start.line ?? 0;
}

/** 紧贴节点的文档注释正文，没有时为 undefined。 */
function docOf(node: AstNode): string | undefined {
  const last = node.leadingComments?.at(-1);
  return last?.type === 'CommentBlock' && last.value.startsWith('*') ? last.value : undefined;
}

function docLines(doc: string): readonly string[] {
  return doc
    .slice(1)
    .split('\n')
    .map((text) => text.replace(/^\s*\*\s?/, '').trim());
}

function hasDescription(doc: string): boolean {
  const lines = docLines(doc);
  const firstTag = lines.findIndex((text) => text.startsWith('@'));
  return (firstTag < 0 ? lines : lines.slice(0, firstTag)).some((text) => text.length > 0);
}

function documentedParams(doc: string): ReadonlySet<string> {
  const names = new Set<string>();
  for (const text of docLines(doc)) {
    const match = /^@param\s+(?:\{[^}]*\}\s+)?([A-Za-z_$][\w$]*)\s+\S/.exec(text);
    if (match?.[1] !== undefined) names.add(match[1]);
  }
  return names;
}

function paramNames(fn: AstNode): readonly string[] {
  const params = fn.params ?? fn.parameters;
  if (!Array.isArray(params)) return [];
  return params.flatMap((param: unknown) => {
    if (!isAstNode(param)) return [];
    const target = param.type === 'RestElement' && isAstNode(param.argument) ? param.argument : param;
    return target.type === 'Identifier' && typeof target.name === 'string' ? [target.name] : [];
  });
}

/** 节点直接描述的函数：自身是函数，或类型直接是函数类型。 */
function functionOf(node: AstNode): AstNode | undefined {
  if (['TSDeclareFunction', 'FunctionDeclaration', 'TSMethodSignature', 'TSCallSignatureDeclaration'].includes(node.type)) {
    return node;
  }
  let type: unknown = node.typeAnnotation;
  if (isAstNode(type) && type.type === 'TSTypeAnnotation') type = type.typeAnnotation;
  return isAstNode(type) && type.type === 'TSFunctionType' ? type : undefined;
}

function requireDoc(file: string, target: AstNode, subject: AstNode, what: string, report: Report): void {
  const doc = docOf(target);
  if (doc === undefined) {
    report(file, lineOf(target), `${what}缺少自己的文档注释（/** … */）`);
    return;
  }
  if (!hasDescription(doc)) report(file, lineOf(target), `${what}的文档注释没有说明文字`);
  const fn = functionOf(subject);
  if (fn !== undefined) {
    const documented = documentedParams(doc);
    for (const name of paramNames(fn)) {
      if (!documented.has(name)) report(file, lineOf(target), `${what}的参数 ${name} 缺少 @param 说明`);
    }
  }
}

type SourceFile = {
  readonly file: string;
  readonly role: FileRole;
  readonly imports: readonly { readonly target: string; readonly line: number }[];
  readonly exports: ReadonlySet<string>;
};

function checkSource(
  design: string,
  file: string,
  role: FileRole,
  roles: ReadonlyMap<string, FileRole>,
  parse: typeof Parse,
  report: Report,
): SourceFile {
  const imports: { target: string; line: number }[] = [];
  const exports = new Set<string>();
  let program: AstNode;
  try {
    const ast: unknown = parse(readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['typescript'] });
    if (!isAstNode(ast) || !isAstNode(ast.program)) throw new Error('无法读取语法树');
    program = ast.program;
  } catch (error) {
    report(file, 0, `无法解析：${error instanceof Error ? error.message : String(error)}`);
    return { file, role, imports, exports };
  }

  const body = Array.isArray(program.body) ? program.body.filter(isAstNode) : [];
  for (const statement of body) {
    if (statement.type === 'ExportNamedDeclaration') {
      if (isAstNode(statement.declaration)) {
        const declaration = statement.declaration;
        if (declaration.type === 'VariableDeclaration' && Array.isArray(declaration.declarations)) {
          for (const item of declaration.declarations.filter(isAstNode)) {
            if (isAstNode(item.id) && item.id.type === 'Identifier' && typeof item.id.name === 'string') {
              exports.add(item.id.name);
            }
          }
        } else if (DECLARATIONS[declaration.type] === true && declaration.type !== 'TSModuleDeclaration') {
          if (isAstNode(declaration.id) && declaration.id.type === 'Identifier' && typeof declaration.id.name === 'string') {
            exports.add(declaration.id.name);
          }
        }
      }
      if (Array.isArray(statement.specifiers)) {
        for (const specifier of statement.specifiers.filter(isAstNode)) {
          if (specifier.type !== 'ExportSpecifier' || !isAstNode(specifier.exported)) continue;
          const name = specifier.exported.type === 'Identifier' ? specifier.exported.name : specifier.exported.value;
          if (typeof name === 'string') exports.add(name);
        }
      }
    }
    const declaration =
      (statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration') &&
      isAstNode(statement.declaration)
        ? statement.declaration
        : statement;
    if (DECLARATIONS[declaration.type] === true) requireDoc(file, statement, declaration, '声明', report);
  }

  walk(program, (node) => {
    if (MEMBERS[node.type] === true) requireDoc(file, node, node, '成员', report);
    if (node.type === 'TSUnionType' && Array.isArray(node.types)) {
      for (const variant of node.types.filter(isAstNode)) {
        if (INLINE_VARIANTS[variant.type] !== true) continue;
        const doc = docOf(variant);
        if (doc === undefined) {
          report(file, lineOf(variant), '联合的这一支缺少文档注释；注释写在 `|` 之后、这一支之前');
        } else if (!hasDescription(doc)) {
          report(file, lineOf(variant), '联合的这一支的文档注释没有说明文字');
        }
      }
    }
    if (node.type === 'TSImportType') report(file, lineOf(node), '不用 import("…") 类型；在文件开头用 import type 声明依赖');
    if (node.type === 'ImportExpression' || (node.type === 'CallExpression' && isAstNode(node.callee) && node.callee.type === 'Import')) {
      report(file, lineOf(node), '不用动态 import');
    }

    const source = isAstNode(node.source) && typeof node.source.value === 'string' ? node.source.value : undefined;
    if (source === undefined) return;
    if (node.type === 'ImportDeclaration') {
      const specifiers = Array.isArray(node.specifiers) ? node.specifiers.filter(isAstNode) : [];
      const typeOnly = node.importKind === 'type' || (specifiers.length > 0 && specifiers.every((s) => s.importKind === 'type'));
      if (!typeOnly) report(file, lineOf(node), 'design 文件只用 import type');
    } else if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') {
      const specifiers = Array.isArray(node.specifiers) ? node.specifiers.filter(isAstNode) : [];
      const typeOnly = node.exportKind === 'type' || (specifiers.length > 0 && specifiers.every((s) => s.exportKind === 'type'));
      if (!typeOnly) report(file, lineOf(node), 'design 文件只用 export type 转出类型');
    } else {
      return;
    }

    if (!source.startsWith('.')) {
      report(file, lineOf(node), `design 只 import design 内的类型文件，不依赖外部包或 src：${source}`);
      return;
    }
    const target = resolve(dirname(file), source);
    if (!target.startsWith(design + sep)) {
      report(file, lineOf(node), `design 不得 import design 之外的文件：${source}`);
      return;
    }
    const targetRole = roles.get(target);
    if (targetRole === undefined) {
      report(file, lineOf(node), `只能 import core.ts、connections.ts 或 business.ts，并写出 .ts 后缀：${source}`);
      return;
    }
    const broken = importRule(role, targetRole);
    if (broken !== undefined) report(file, lineOf(node), `${broken}：${source}`);
    imports.push({ target, line: lineOf(node) });
  });

  return { file, role, imports, exports };
}

function checkCycles(design: string, sources: readonly SourceFile[], report: Report): void {
  const edges = new Map(sources.map((source) => [source.file, source.imports.map((edge) => edge.target)]));
  const state = new Map<string, 'Visiting' | 'Done'>();
  const stack: string[] = [];
  const seen = new Set<string>();
  const visit = (file: string): void => {
    state.set(file, 'Visiting');
    stack.push(file);
    for (const next of edges.get(file) ?? []) {
      const nextState = state.get(next);
      if (nextState === 'Visiting') {
        const cycle = stack.slice(stack.indexOf(next));
        const key = [...cycle].sort().join('\n');
        if (!seen.has(key)) {
          seen.add(key);
          report(next, 0, `import 成环：${[...cycle, next].map((path) => relative(design, path)).join(' → ')}`);
        }
      } else if (nextState === undefined) {
        visit(next);
      }
    }
    stack.pop();
    state.set(file, 'Done');
  };
  for (const source of sources) if (!state.has(source.file)) visit(source.file);
}

// ---------------------------------------------------------------------------
// 检查：tsc

async function checkTypes(design: string, report: Report): Promise<void> {
  const tsc = join(SCRIPT_DIR, 'node_modules', '.bin', 'tsc');
  const run = Bun.spawn([tsc, '-p', join(design, 'tsconfig.json'), '--pretty', 'false'], {
    cwd: dirname(design),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const output = (await new Response(run.stdout).text()) + (await new Response(run.stderr).text());
  const code = await run.exited;
  if (code === 0) return;
  const lines = output.split('\n').filter((text) => text.trim().length > 0);
  for (const text of lines) {
    const match = /^(.+?)\((\d+),\d+\): (.*)$/.exec(text);
    if (match?.[1] !== undefined && match[2] !== undefined && match[3] !== undefined) {
      report(resolve(dirname(design), match[1]), Number(match[2]), `tsc：${match[3]}`);
    } else {
      report(design, 0, `tsc：${text}`);
    }
  }
  if (lines.length === 0) report(design, 0, `tsc 退出码 ${code}`);
}

async function check(designArg: string): Promise<void> {
  if (!existsSync(join(SCRIPT_DIR, 'node_modules', '@babel', 'parser')) || !existsSync(join(SCRIPT_DIR, 'node_modules', '.bin', 'tsc'))) {
    stop(`缺少依赖；先运行：bun install --no-save --cwd ${SCRIPT_DIR}`, 2);
  }
  const design = resolve(designArg);
  if (!isDir(design)) stop(`不是目录：${design}`, 2);
  const base = dirname(design);
  const violations: Violation[] = [];
  const report: Report = (file, line, message) => violations.push({ file: relative(base, file), line, message });

  // 依赖在本目录用 bun install 安装；静态 import 会在缺依赖时先于上面的提示失败，所以在检查依赖之后动态加载。
  const { parse } = await import('@babel/parser');
  const roles = new Map<string, FileRole>();
  const readmes: ReadmeTarget[] = [];
  checkStructure(design, roles, readmes, report);
  if (isFile(join(design, 'tsconfig.json'))) checkConfig(join(design, 'tsconfig.json'), report);
  const sources: SourceFile[] = [];
  for (const [file, role] of roles) {
    if (isFile(file)) sources.push(checkSource(design, file, role, roles, parse, report));
  }
  for (const target of readmes) checkReadme(target, visibleExports(target, sources), report);
  checkCycles(design, sources, report);
  await checkTypes(design, report);

  violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  for (const violation of violations) console.log(`${violation.file}:${violation.line}: ${violation.message}`);
  if (violations.length > 0) stop(`${violations.length} 处违规`, 1);
  console.log('检查通过');
}

// ---------------------------------------------------------------------------

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case 'init':
    if (args.length !== 1 || args[0] === undefined) stop('用法：bun design.ts init <仓库根>', 2);
    init(args[0]);
    break;
  case 'module':
    if (args.length !== 2 || args[0] === undefined || args[1] === undefined) stop('用法：bun design.ts module <design 目录> <a/b>', 2);
    addModule(args[0], args[1]);
    break;
  case 'unit':
    if (args.length !== 2 || args[0] === undefined || args[1] === undefined) stop('用法：bun design.ts unit <design 目录> <名字>', 2);
    addUnit(args[0], args[1]);
    break;
  case 'check':
    if (args.length !== 1 || args[0] === undefined) stop('用法：bun design.ts check <design 目录>', 2);
    await check(args[0]);
    break;
  default:
    stop('用法：bun design.ts init|module|unit|check …', 2);
}
