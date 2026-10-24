/**
 * 逐项判断：工具从需求材料、草稿、规格的语法树与 VDMJ 的输出里枚举判断义务，核对判断者写下的台账。
 * 工具不替判断者下结论；它保证每一项都判了、槽位填全了、引用的证据找得到、反例求值成立，并在依据变了之后要求重新确认。
 *
 * 台账只由判断者写。工具只写盖章文件（同名的 .stamp.yaml）：盖章时记下这条记录本身与它所依据的原文；
 * 之后原文变了，记录就过期，要判断者逐条确认（--stamp <键>）或改写。盖章记的是原文，不是摘要值，过期时能并排看到前后两版。
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import {
  NAME,
  UsageError,
  check,
  evaluate,
  htmlComment,
  load,
  markdown,
  readMarkdown,
  review,
  sources,
  vdmj,
  type Definition,
  type Diagnostic,
  type Located,
  type Place,
  type ProofObligation,
  type ReviewItem,
  type ScenarioNode,
} from './design.ts';

// ---------------------------------------------------------------- 结果

type Severity = 'Error' | 'Warning';
type Note = { readonly severity: Severity; readonly sub: string; readonly at: string; readonly message: string };
/** 一个子命令的结果：诊断、缺判义务的骨架（打印给判断者填写）与计数。 */
type Outcome = {
  readonly sub: string;
  readonly notes: readonly Note[];
  readonly missing: { readonly file: string; readonly list: string; readonly items: readonly { readonly hint: string; readonly skeleton: Obj }[] } | null;
  readonly total: number;
  readonly judged: number;
};

type Obj = Readonly<Record<string, unknown>>;

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 键排序后的 JSON：比较记录与快照时不受 YAML 书写次序影响。 */
function canonical(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sort) : isObj(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v;
  return JSON.stringify(sort(value));
}

/** 槽位核对：取值并记下缺什么、填错了什么。 */
class Slots {
  readonly errors: string[] = [];
  constructor(
    private readonly obj: Obj,
    private readonly where: string,
  ) {}

  private fail(field: string, message: string): void {
    this.errors.push(`${this.where}.${field}：${message}`);
  }

  text(field: string): string | null {
    const value = this.obj[field];
    if (typeof value === 'string' && value.trim() !== '') return value;
    this.fail(field, '没有填写');
    return null;
  }

  optionalText(field: string): string | null {
    const value = this.obj[field];
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'string') return value;
    this.fail(field, '应当是文字');
    return null;
  }

  list(field: string): string[] {
    const value = this.obj[field];
    if (value === undefined || value === null) return [];
    if (Array.isArray(value) && value.every((v) => typeof v === 'string' && v.trim() !== '')) return value as string[];
    this.fail(field, '应当是非空文字的列表');
    return [];
  }

  choice<T extends string>(field: string, values: readonly T[]): T | null {
    const value = this.obj[field];
    if (typeof value === 'string' && (values as readonly string[]).includes(value)) return value as T;
    this.fail(field, `只能是 ${values.join(' | ')}${value === undefined || value === '' ? '，现在没有填写' : `，现在是 ${JSON.stringify(value)}`}`);
    return null;
  }

  object(field: string): Obj | null {
    const value = this.obj[field];
    if (isObj(value)) return value;
    this.fail(field, '没有填写');
    return null;
  }

  bool(field: string): boolean | null {
    const value = this.obj[field];
    if (typeof value === 'boolean') return value;
    this.fail(field, '只能是 true 或 false');
    return null;
  }

  /** 台账里只认这些字段：拼错的字段会让判断者以为自己填了。 */
  only(fields: readonly string[]): void {
    for (const key of Object.keys(this.obj)) if (!fields.includes(key)) this.fail(key, `不认识的字段；只用 ${fields.join('、')}`);
  }

  nested(field: string): Slots | null {
    const value = this.object(field);
    return value ? new Slots(value, `${this.where}.${field}`) : null;
  }

  merge(other: Slots): void {
    this.errors.push(...other.errors);
  }
}

// ---------------------------------------------------------------- 需求材料

/** 需求材料里的一块：段落、列表项、表格行或代码块；标题不单独成块，作为它的上下文。同一上下文里重复的同一段文字按出现次序编号。 */
type Block = { readonly path: string; readonly heading: readonly string[]; readonly text: string; readonly occurrence: number };

function blockKey(block: Pick<Block, 'path' | 'heading' | 'text' | 'occurrence'>): string {
  return JSON.stringify([block.path, block.heading, block.text, block.occurrence]);
}

function blockOf(value: unknown): Block | null {
  if (!isObj(value)) return null;
  const { path, heading, text, occurrence } = value;
  if (typeof path !== 'string' || typeof text !== 'string' || !Array.isArray(heading) || !heading.every((h) => typeof h === 'string')) return null;
  return { path, heading: heading as string[], text: text.trim(), occurrence: typeof occurrence === 'number' ? occurrence : 1 };
}

/** 按 Markdown 结构切出需求块。路径相对仓库根。 */
function materialBlocks(repo: string, path: string): Block[] {
  const file = markdown(readFileSync(join(repo, path), 'utf8'));
  const raw: { heading: string[]; text: string }[] = [];
  const headings: string[] = [];
  let current: string[] | null = null;
  let table = false;
  const flush = () => {
    if (current) raw.push({ heading: [...headings], text: current.join('\n') });
    current = null;
  };
  const fenceStarts = new Map(file.fences.map((f) => [f.line, f]));
  for (const { line, raw: text, in: where } of file.lines) {
    if (where === 'Fence') {
      flush();
      const fence = fenceStarts.get(line);
      if (fence && fence.body.join('\n').trim() !== '') raw.push({ heading: [...headings], text: fence.body.join('\n').trim() });
      continue;
    }
    const trimmed = text.trim();
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flush();
      headings.splice(heading[1]!.length - 1);
      while (headings.length < heading[1]!.length - 1) headings.push('');
      headings.push(heading[2]!.trim());
      table = false;
      continue;
    }
    if (trimmed === '' || htmlComment(text)) {
      flush();
      table = false;
      continue;
    }
    if (trimmed.startsWith('|')) {
      flush();
      // 表头下面的分隔行说明上一行是表头，不是需求。
      if (/^\|?\s*:?-{3,}/.test(trimmed)) {
        if (!table) raw.pop();
        table = true;
        continue;
      }
      raw.push({ heading: [...headings], text: trimmed });
      continue;
    }
    table = false;
    const item = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(text);
    if (item) {
      flush();
      current = [item[1]!.trim()];
    } else if (current) current.push(trimmed);
    else current = [trimmed];
  }
  flush();
  const seen = new Map<string, number>();
  return raw.map((b) => {
    const id = JSON.stringify([path, b.heading, b.text]);
    const occurrence = (seen.get(id) ?? 0) + 1;
    seen.set(id, occurrence);
    return { path, heading: b.heading, text: b.text, occurrence };
  });
}

/** 读台账里登记的需求材料，切出全部需求块。 */
function requirementBlocks(repo: string, materials: readonly string[], sub: string, at: string): { readonly blocks: readonly Block[]; readonly notes: readonly Note[] } {
  const notes: Note[] = [];
  const blocks: Block[] = [];
  if (materials.length === 0) notes.push(error(sub, at, 'materials 没有登记需求材料：写出相对仓库根的路径。'));
  for (const path of materials) {
    const full = resolve(repo, path);
    if (!existsSync(full) || !lstatSync(full).isFile()) notes.push(error(sub, at, `需求材料 ${path} 不存在（路径相对仓库根 ${repo}）。`));
    else blocks.push(...materialBlocks(repo, path));
  }
  return { blocks, notes };
}

function error(sub: string, at: string, message: string): Note {
  return { severity: 'Error', sub, at, message };
}

function warning(sub: string, at: string, message: string): Note {
  return { severity: 'Warning', sub, at, message };
}

// ---------------------------------------------------------------- YAML 文件

function readYaml(path: string): { readonly value: Obj | null; readonly problem: string | null } {
  if (!existsSync(path)) return { value: null, problem: null };
  try {
    const value = Bun.YAML.parse(readFileSync(path, 'utf8'));
    if (value === null || value === undefined) return { value: {}, problem: null };
    return isObj(value) ? { value, problem: null } : { value: null, problem: '顶层应当是映射' };
  } catch (e) {
    return { value: null, problem: `YAML 解析失败：${(e as Error).message}` };
  }
}

function yamlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (lstatSync(path).isDirectory()) out.push(...yamlFiles(path));
    else if (name.endsWith('.yaml') && !name.endsWith('.stamp.yaml')) out.push(path);
  }
  return out;
}

function stampPath(file: string): string {
  return file.replace(/\.yaml$/, '.stamp.yaml');
}

type Stamp = { readonly record: string; readonly deps: Readonly<Record<string, string>> };

function readStamps(file: string): Map<string, Stamp> {
  const { value } = readYaml(stampPath(file));
  const stamps = new Map<string, Stamp>();
  const raw = value?.stamps;
  if (isObj(raw)) {
    for (const [key, stamp] of Object.entries(raw)) {
      if (isObj(stamp) && typeof stamp.record === 'string' && isObj(stamp.deps)) stamps.set(key, { record: stamp.record, deps: stamp.deps as Record<string, string> });
    }
  }
  return stamps;
}

function writeStamps(file: string, stamps: ReadonlyMap<string, Stamp>): void {
  const sorted = Object.fromEntries([...stamps.entries()].sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(stampPath(file), `# 由 ssot 写入：每条记录盖章时的内容与它依据的原文。判断者不改这个文件。\n${Bun.YAML.stringify({ stamps: sorted }, null, 2)}`);
}

/** 台账里的一条记录：属于哪个文件、键是什么。 */
type Entry = { readonly record: Obj; readonly file: string; readonly key: string };

function readEntries(files: readonly string[], list: string, keyField: string, sub: string, rel: (p: string) => string): { readonly entries: Map<string, Entry>; readonly notes: Note[] } {
  const entries = new Map<string, Entry>();
  const notes: Note[] = [];
  for (const file of files) {
    const { value, problem } = readYaml(file);
    if (problem) {
      notes.push(error(sub, rel(file), problem));
      continue;
    }
    const items = value?.[list];
    if (items === undefined) continue;
    if (!Array.isArray(items)) {
      notes.push(error(sub, rel(file), `${list} 应当是列表。`));
      continue;
    }
    items.forEach((record, i) => {
      const where = `${rel(file)} ${list}[${i}]`;
      if (!isObj(record) || typeof record[keyField] !== 'string' || record[keyField] === '') {
        notes.push(error(sub, where, `每条记录要有 ${keyField}。`));
        return;
      }
      const key = record[keyField] as string;
      const before = entries.get(key);
      if (before) notes.push(error(sub, where, `${keyField} ${key} 已经在 ${rel(before.file)} 里判过一次：一项义务只留一条记录。`));
      else entries.set(key, { record, file, key });
    });
  }
  return { entries, notes };
}

// ---------------------------------------------------------------- 规格

/** 规格里一个可被判断、可被引用的元素：定义或字段。 */
type Element = {
  readonly key: string;
  readonly module: Located;
  readonly definition: Definition;
  readonly field: string | null;
  readonly source: string;
};

type Spec = {
  readonly design: string;
  readonly places: readonly Place[];
  readonly modules: readonly Located[];
  readonly elements: ReadonlyMap<string, Element>;
  readonly dirs: ReadonlySet<string>;
};

function loadSpec(design: string): { readonly spec: Spec | null; readonly diagnostics: readonly Diagnostic[] } {
  const loaded = load(design);
  const blocking = loaded.diagnostics.filter((d) => d.stage === 'layout' || d.stage === 'parse');
  if (blocking.length > 0) return { spec: null, diagnostics: blocking };
  const elements = new Map<string, Element>();
  for (const module of loaded.modules) {
    const src = sources(design, module);
    const lines = readFileSync(join(design, module.place.path), 'utf8').split('\n');
    for (const definition of module.definitions) {
      const key = `${module.name}\`${definition.name}`;
      elements.set(key, { key, module, definition, field: null, source: src.definitions.get(definition)?.full ?? '' });
      for (const field of definition.fields) {
        elements.set(`${key}.${field.name}`, { key: `${key}.${field.name}`, module, definition, field: field.name, source: (lines[field.line - 1] ?? '').trim() });
      }
    }
  }
  return { spec: { design, places: loaded.places, modules: loaded.modules, elements, dirs: new Set(loaded.places.map((p) => p.dir)) }, diagnostics: [] };
}

/** 证据引用：规格元素 ``Mod`Def``、``Mod`Def.field``，或设计目录里的 `路径:行` / `路径:起-止`。返回它当前的原文与所在目录。 */
function resolveRef(spec: Spec, ref: string): { readonly text: string; readonly dir: string; readonly element: Element | null } | null {
  const element = spec.elements.get(ref);
  if (element) return { text: element.source, dir: element.module.place.dir, element };
  const lines = /^(.+\.md):(\d+)(?:-(\d+))?$/.exec(ref);
  if (!lines) return null;
  const place = spec.places.find((p) => p.path === lines[1]);
  if (!place) return null;
  const all = readFileSync(join(spec.design, place.path), 'utf8').split('\n');
  const from = Number(lines[2]);
  const to = Number(lines[3] ?? lines[2]);
  if (from < 1 || to < from || to > all.length) return null;
  return { text: all.slice(from - 1, to).join('\n'), dir: place.dir, element: null };
}

/** 一组引用：都要找得到；找到的原文记进依据。 */
function refs(spec: Spec, list: readonly string[], where: string, slots: Slots, deps: Record<string, string>): { readonly dir: string; readonly element: Element | null }[] {
  const found: { dir: string; element: Element | null }[] = [];
  for (const ref of list) {
    const target = resolveRef(spec, ref);
    if (!target) slots.errors.push(`${where}：${ref} 找不到；引用写成 Mod\`Def、Mod\`Def.field，或设计目录里的 路径.md:行 / 路径.md:起-止`);
    else {
      deps[ref] = target.text;
      found.push({ dir: target.dir, element: target.element });
    }
  }
  return found;
}

function inDir(dir: string, scope: string): boolean {
  return dir === scope || dir.startsWith(`${scope}/`);
}

// ---------------------------------------------------------------- 盖章的义务

/** 一项要判断的义务：键、范围、它依据的原文（主体），以及缺判时打印的骨架与候选提示。 */
type Obligation = {
  readonly key: string;
  readonly dir: string | null;
  readonly constraint: string | null;
  readonly subject: string;
  readonly skeleton: Obj;
  readonly hint: string;
};

type Judgment = { readonly errors: readonly string[]; readonly warnings: readonly string[]; readonly deps: Readonly<Record<string, string>> };

type Scope = { readonly dirs: readonly string[]; readonly constraints: readonly string[] };

type StampMode = { readonly stamp: boolean; readonly restamp: ReadonlySet<string> };

type Stamped = {
  readonly sub: string;
  readonly list: string;
  readonly keyField: string;
  /** 新记录写进哪个文件：缺判骨架的提示用。 */
  readonly target: string;
  readonly files: readonly string[];
  readonly obligations: readonly Obligation[];
  readonly judge: (record: Obj, obligation: Obligation) => Judgment;
};

function inScope(o: Pick<Obligation, 'dir' | 'constraint'>, scope: Scope): boolean {
  if (scope.dirs.length > 0 && (o.dir === null || !scope.dirs.some((d) => inDir(o.dir!, d)))) return false;
  if (scope.constraints.length > 0 && (o.constraint === null || !scope.constraints.includes(o.constraint))) return false;
  return true;
}

function firstDifference(before: string | undefined, after: string | undefined): string {
  if (before === undefined) return '新增了这项依据';
  if (after === undefined) return '这项依据已不存在';
  const a = before.split('\n');
  const b = after.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) return `盖章时「${(a[i] ?? '').trim()}」，现在「${(b[i] ?? '').trim()}」`;
  }
  return '内容变了';
}

function runStamped(s: Stamped, scope: Scope, mode: StampMode, rel: (p: string) => string): Outcome {
  const { entries, notes } = readEntries(s.files, s.list, s.keyField, s.sub, rel);
  const stamps = new Map(s.files.map((f) => [f, readStamps(f)]));
  const changed = new Set<string>();
  const missing: { hint: string; skeleton: Obj }[] = [];
  const selected = s.obligations.filter((o) => inScope(o, scope));
  let judged = 0;
  for (const obligation of selected) {
    const entry = entries.get(obligation.key);
    if (!entry) {
      notes.push(error(s.sub, obligation.key, '缺判：这一项还没有记录。'));
      missing.push({ hint: obligation.hint, skeleton: obligation.skeleton });
      continue;
    }
    const at = `${rel(entry.file)} ${obligation.key}`;
    const result = s.judge(entry.record, obligation);
    for (const e of result.errors) notes.push(error(s.sub, at, e));
    if (result.errors.length > 0) continue;
    for (const w of result.warnings) notes.push(warning(s.sub, at, w));
    const deps: Readonly<Record<string, string>> = { '主体': obligation.subject, ...result.deps };
    const record = canonical(entry.record);
    const fileStamps = stamps.get(entry.file)!;
    const stamp = fileStamps.get(obligation.key);
    const write = () => {
      fileStamps.set(obligation.key, { record, deps });
      changed.add(entry.file);
    };
    if (!stamp || stamp.record !== record) {
      if (mode.stamp) write();
      else {
        notes.push(error(s.sub, at, stamp ? '记录在盖章后改过：核对无误后运行 --stamp。' : '还没盖章：核对无误后运行 --stamp。'));
        continue;
      }
    } else {
      const names = [...new Set([...Object.keys(stamp.deps), ...Object.keys(deps)])].filter((k) => stamp.deps[k] !== deps[k]);
      if (names.length > 0) {
        if (mode.restamp.has(obligation.key)) write();
        else {
          const detail = names.map((k) => `${k}（${firstDifference(stamp.deps[k], deps[k])}）`).join('；');
          notes.push(error(s.sub, at, `过期：${detail}。重新判断后改写记录再 --stamp，或确认结论不变后 --stamp ${JSON.stringify(obligation.key)}。`));
          continue;
        }
      }
    }
    judged++;
  }
  if (scope.dirs.length === 0 && scope.constraints.length === 0) {
    const keys = new Set(s.obligations.map((o) => o.key));
    for (const entry of entries.values()) {
      if (!keys.has(entry.key)) notes.push(error(s.sub, `${rel(entry.file)} ${entry.key}`, '这条记录对应的义务已不存在（对象被改名、删除或改写）：删掉它，按缺判的骨架重判。'));
    }
  }
  for (const file of changed) {
    mkdirSync(dirname(file), { recursive: true });
    writeStamps(file, stamps.get(file)!);
  }
  return { sub: s.sub, notes, missing: missing.length > 0 ? { file: rel(s.target), list: s.list, items: missing } : null, total: selected.length, judged };
}

// ---------------------------------------------------------------- 打印

function printOutcomes(outcomes: readonly Outcome[]): number {
  let errors = 0;
  let warnings = 0;
  for (const o of outcomes) {
    for (const n of o.notes) {
      if (n.severity === 'Error') errors++;
      else warnings++;
      const line = `${n.severity === 'Error' ? '错误' : '警告'} [${n.sub}] ${n.at}：${n.message}`;
      if (n.severity === 'Error') console.error(line);
      else console.log(line);
    }
  }
  for (const o of outcomes) {
    if (!o.missing) continue;
    console.log(`\n# [${o.sub}] 缺判 ${o.missing.items.length} 项：填好下面的骨架，写进 ${o.missing.file}（或同目录下其他 .yaml）的 ${o.missing.list} 列表。`);
    console.log(`${o.missing.list}:`);
    for (const item of o.missing.items) {
      if (item.hint) console.log(item.hint.split('\n').map((l) => `  # ${l}`).join('\n'));
      console.log(Bun.YAML.stringify([item.skeleton], null, 2).trimEnd().split('\n').map((l) => `  ${l}`).join('\n'));
    }
  }
  console.log('');
  for (const o of outcomes) {
    const e = o.notes.filter((n) => n.severity === 'Error').length;
    const w = o.notes.length - e;
    console.log(`[${o.sub}] 义务 ${o.total} 项，判定有效 ${o.judged} 项；错误 ${e}，警告 ${w}。`);
  }
  console.log(errors > 0 ? `未通过：错误 ${errors} 处，警告 ${warnings} 处。` : `通过：没有错误；警告 ${warnings} 处，逐条看过再交付。`);
  return errors > 0 ? 1 : 0;
}

function checkOutcome(design: string, sub: string): Outcome {
  const report = check(design);
  const notes: Note[] =
    report.kind === 'Rejected'
      ? report.diagnostics.map((d) => error(sub, `${d.path}:${d.line}`, `[${d.stage}] ${d.message}`))
      : [...report.obligations.maybe, ...report.obligations.unchecked].map((t) => warning(sub, t, '证明义务未定或未评估：在 verify po 里逐条判断它的守卫。'));
  return { sub, notes, missing: null, total: 1, judged: report.kind === 'Accepted' ? 1 : 0 };
}

function gate(sub: string, message: string): Outcome {
  return { sub, notes: [error(sub, '前置条件', message)], missing: null, total: 0, judged: 0 };
}

// ---------------------------------------------------------------- 草稿

const OBJECT_KINDS = ['definition', 'execution', 'fact', 'index'] as const;
const RELATION_KINDS = ['contains', 'points', 'acts'] as const;
const CATEGORIES = ['invariant', 'admission', 'transition', 'lifecycle'] as const;
type Category = (typeof CATEGORIES)[number];
const DRAFT_SUBS = ['requirements', 'objects', 'constraints', 'owner', 'excluded', 'tradeoffs', 'status'] as const;
type DraftSub = (typeof DRAFT_SUBS)[number];

type DraftConstraint = { readonly id: string; readonly record: Obj; readonly category: Category | null; readonly owner: { readonly layer: 'architecture' | 'business'; readonly holder: string } | null };

type Draft = {
  readonly file: string;
  readonly value: Obj;
  readonly constraints: ReadonlyMap<string, DraftConstraint>;
};

function listOf(value: Obj, field: string): Obj[] {
  const items = value[field];
  return Array.isArray(items) ? items.filter(isObj) : [];
}

function readDraft(repo: string): { readonly draft: Draft | null; readonly problem: string | null } {
  const file = join(repo, '.tmp', 'ssot-draft', 'draft.yaml');
  if (!existsSync(file)) return { draft: null, problem: `没有草稿 ${relative(repo, file)}：先按 ssot-draft 写草稿。` };
  const { value, problem } = readYaml(file);
  if (!value) return { draft: null, problem: `${relative(repo, file)}：${problem}` };
  const constraints = new Map<string, DraftConstraint>();
  for (const c of listOf(value, 'constraints')) {
    if (typeof c.id !== 'string') continue;
    const layer = isObj(c.owner) ? c.owner.layer : undefined;
    const holder = isObj(c.owner) ? c.owner.holder : undefined;
    const owner: DraftConstraint['owner'] = (layer === 'architecture' || layer === 'business') && typeof holder === 'string' ? { layer, holder } : null;
    constraints.set(c.id, { id: c.id, record: c, category: (CATEGORIES as readonly string[]).includes(c.category as string) ? (c.category as Category) : null, owner });
  }
  return { draft: { file, value, constraints }, problem: null };
}

function draftOutcomes(repo: string, sub: DraftSub): Outcome[] {
  const { draft, problem } = readDraft(repo);
  if (!draft) return [gate(sub, problem!)];
  const subs: readonly Exclude<DraftSub, 'status'>[] = sub === 'status' ? ['requirements', 'objects', 'constraints', 'owner', 'excluded', 'tradeoffs'] : [sub];
  return subs.map((s) => draftSub(repo, draft, s));
}

function ids(items: readonly Obj[], sub: string, list: string, notes: Note[]): Set<string> {
  const seen = new Set<string>();
  items.forEach((item, i) => {
    if (typeof item.id !== 'string' || item.id.trim() === '') notes.push(error(sub, `${list}[${i}]`, '没有 id。'));
    else if (seen.has(item.id)) notes.push(error(sub, `${list}[${i}]`, `id ${item.id} 重复。`));
    else seen.add(item.id);
  });
  return seen;
}

function draftSub(repo: string, draft: Draft, sub: Exclude<DraftSub, 'status'>): Outcome {
  const notes: Note[] = [];
  const v = draft.value;
  const at = relative(repo, draft.file);
  const constraintIds = ids(listOf(v, 'constraints'), sub, 'constraints', []);
  const excludedIds = ids(listOf(v, 'excluded'), sub, 'excluded', []);
  const objectIds = ids(listOf(v, 'objects'), sub, 'objects', []);
  const requirements = listOf(v, 'requirements');
  const slotNotes = (slots: Slots) => slots.errors.forEach((e) => notes.push(error(sub, at, e)));
  let total = 0;
  let missing: Outcome['missing'] = null;
  switch (sub) {
    case 'requirements': {
      const materials = Array.isArray(v.materials) ? v.materials.filter((m): m is string => typeof m === 'string') : [];
      const { blocks, notes: materialNotes } = requirementBlocks(repo, materials, sub, `${at} materials`);
      notes.push(...materialNotes);
      const byKey = new Map<string, number>();
      requirements.forEach((r, i) => {
        const where = `requirements[${i}]`;
        const block = blockOf(r.block);
        if (!block) {
          notes.push(error(sub, `${at} ${where}`, 'block 要写成 {path, heading, text}，照缺判骨架抄。'));
          return;
        }
        const key = blockKey(block);
        if (byKey.has(key)) notes.push(error(sub, `${at} ${where}`, `和 requirements[${byKey.get(key)}] 是同一块需求。`));
        byKey.set(key, i);
        const slots = new Slots(r, where);
        slots.only(['block', 'constraints', 'excluded']);
        const cs = slots.list('constraints');
        const xs = slots.list('excluded');
        if (cs.length + xs.length === 0) slots.errors.push(`${where}：这块需求既没有落到约束（constraints），也没有写进不进 VDM 的内容（excluded）。`);
        for (const c of cs) if (!constraintIds.has(c)) slots.errors.push(`${where}.constraints：${c} 不在 constraints 里。`);
        for (const x of xs) if (!excludedIds.has(x)) slots.errors.push(`${where}.excluded：${x} 不在 excluded 里。`);
        slotNotes(slots);
      });
      const current = new Set(blocks.map(blockKey));
      const items: { hint: string; skeleton: Obj }[] = [];
      for (const block of blocks) {
        total++;
        if (!byKey.has(blockKey(block))) {
          notes.push(error(sub, `${block.path} ${block.heading.join(' / ')}`, `缺判：「${block.text.split('\n')[0]}」还没有去向。`));
          items.push({ hint: '', skeleton: { block: { path: block.path, heading: block.heading, text: block.text, ...(block.occurrence > 1 ? { occurrence: block.occurrence } : {}) }, constraints: [], excluded: [] } });
        }
      }
      for (const [key, i] of byKey) if (!current.has(key)) notes.push(error(sub, `${at} requirements[${i}]`, '材料里已经没有这块需求（改写或删除了）：删掉这条，按缺判骨架重判。'));
      if (items.length > 0) missing = { file: at, list: 'requirements', items };
      break;
    }
    case 'objects': {
      const objects = listOf(v, 'objects');
      ids(objects, sub, 'objects', notes);
      objects.forEach((o, i) => {
        total++;
        const slots = new Slots(o, `objects[${i}]`);
        slots.only(['id', 'name', 'kind', 'identity', 'residue']);
        slots.text('name');
        slots.choice('kind', OBJECT_KINDS);
        slots.text('identity');
        slots.text('residue');
        slotNotes(slots);
        const used = listOf(v, 'constraints').some((c) => c.object === o.id) || listOf(v, 'relations').some((r) => r.from === o.id || r.to === o.id);
        if (!used) notes.push(warning(sub, `${at} objects[${i}]`, `对象 ${String(o.id)} 既不被约束引用，也不在任何关系里：它是否需要？`));
      });
      listOf(v, 'relations').forEach((r, i) => {
        total++;
        const slots = new Slots(r, `relations[${i}]`);
        slots.only(['from', 'to', 'kind', 'note']);
        for (const end of ['from', 'to']) {
          const id = slots.text(end);
          if (id && !objectIds.has(id)) slots.errors.push(`relations[${i}].${end}：${id} 不在 objects 里。`);
        }
        slots.choice('kind', RELATION_KINDS);
        slots.text('note');
        slotNotes(slots);
      });
      break;
    }
    case 'constraints': {
      const constraints = listOf(v, 'constraints');
      ids(constraints, sub, 'constraints', notes);
      constraints.forEach((c, i) => {
        total++;
        const where = `constraints[${i}]`;
        const slots = new Slots(c, where);
        slots.only(['id', 'object', 'varies', 'invariant', 'violation', 'not_promised', 'rerun', 'deletion', 'scope', 'category', 'owner']);
        const object = slots.text('object');
        if (object && !objectIds.has(object)) slots.errors.push(`${where}.object：${object} 不在 objects 里。`);
        for (const field of ['varies', 'invariant', 'violation', 'not_promised', 'rerun', 'deletion', 'scope']) slots.text(field);
        slots.choice('category', CATEGORIES);
        slotNotes(slots);
        if (!requirements.some((r) => Array.isArray(r.constraints) && r.constraints.includes(c.id))) {
          notes.push(error(sub, `${at} ${where}`, `约束 ${String(c.id)} 没有出处：没有任何需求块落到它。`));
        }
      });
      break;
    }
    case 'owner': {
      listOf(v, 'constraints').forEach((c, i) => {
        total++;
        const slots = new Slots(c, `constraints[${i}]`);
        const owner = slots.nested('owner');
        if (owner) {
          const layer = owner.choice('layer', ['architecture', 'business'] as const);
          const holder = owner.text('holder');
          if (layer === 'business' && holder && !NAME.test(holder)) owner.errors.push(`constraints[${i}].owner.holder：业务单元名只用小写字母、数字与连字符。`);
          slots.merge(owner);
        }
        slotNotes(slots);
      });
      break;
    }
    case 'excluded': {
      listOf(v, 'excluded').forEach((x, i) => {
        total++;
        const slots = new Slots(x, `excluded[${i}]`);
        slots.only(['id', 'text', 'unaffected']);
        slots.text('text');
        slots.text('unaffected');
        slotNotes(slots);
      });
      break;
    }
    case 'tradeoffs': {
      listOf(v, 'tradeoffs').forEach((t, i) => {
        total++;
        const slots = new Slots(t, `tradeoffs[${i}]`);
        slots.only(['id', 'question', 'options', 'choice', 'basis', 'wrong_when']);
        slots.text('question');
        const options = slots.list('options');
        if (options.length < 2) slots.errors.push(`tradeoffs[${i}].options：至少列两个选项。`);
        const choice = slots.text('choice');
        if (choice && !options.includes(choice)) slots.errors.push(`tradeoffs[${i}].choice：要是 options 里的一项。`);
        slots.text('basis');
        slots.text('wrong_when');
        slotNotes(slots);
      });
      break;
    }
    default:
      return assertNever(sub);
  }
  const errors = notes.filter((n) => n.severity === 'Error').length;
  return { sub, notes, missing, total, judged: errors === 0 ? total : 0 };
}

// ---------------------------------------------------------------- 设计

const DESIGN_SUBS = ['check', 'elements', 'constraints', 'status'] as const;
type DesignSub = (typeof DESIGN_SUBS)[number];
const LANDINGS = ['type', 'inv', 'pre', 'post', 'scenario', 'function', 'import', 'export', 'semantic'] as const;
type Landing = (typeof LANDINGS)[number];
/** 草稿的约束类别允许的写法（ssot-design 第一节）；「语义」任何类别都可以写，但要单独列出。 */
const ALLOWED: Readonly<Record<Category, readonly Landing[]>> = {
  invariant: ['type', 'inv', 'import', 'export', 'function', 'semantic'],
  admission: ['pre', 'function', 'semantic'],
  transition: ['post', 'function', 'semantic'],
  lifecycle: ['scenario', 'semantic'],
};

function elementObligations(spec: Spec, verb: string): Obligation[] {
  return [...spec.elements.values()].map((e) => ({
    key: e.key,
    dir: e.module.place.dir,
    constraint: null,
    subject: e.source,
    skeleton: verb === 'design' ? { element: e.key, constraints: [], connection_for: [], reason: '' } : { element: e.key, verdict: '', constraints: [], reason: '' },
    hint: '',
  }));
}

/** 语义落点：README.md 的「语义」小节里的一行正文。 */
function semanticLine(spec: Spec, path: string, line: number): string | null {
  const place = spec.places.find((p) => p.path === path && p.readme);
  if (!place) return null;
  const file = readMarkdown(spec.design, path);
  let section = '';
  for (const l of file.lines) {
    const heading = l.in === 'Prose' ? /^(#{1,6})\s+(.*)$/.exec(l.raw.trim()) : null;
    if (heading) section = heading[1]!.length === 2 ? heading[2]!.trim() : heading[1]!.length === 1 ? '' : section;
    if (l.line === line) return section === '语义' && l.in === 'Prose' && !heading && l.raw.trim() !== '' ? l.raw.trim() : null;
  }
  return null;
}

function landingCheck(spec: Spec, item: Obj, where: string, slots: Slots, deps: Record<string, string>): { readonly kind: Landing | null; readonly dir: string | null } {
  const s = new Slots(item, where);
  const kind = s.choice('kind', LANDINGS);
  let dir: string | null = null;
  switch (kind) {
    case null:
      break;
    case 'type':
    case 'inv':
    case 'pre':
    case 'post':
    case 'scenario':
    case 'function': {
      s.only(['kind', 'element']);
      const ref = s.text('element');
      const element = ref ? spec.elements.get(ref) : undefined;
      if (ref && !element) s.errors.push(`${where}.element：${ref} 不在规格里。`);
      if (element) {
        deps[ref!] = element.source;
        dir = element.module.place.dir;
        const d = element.definition;
        const fits =
          kind === 'type' ? d.kind === 'type' && element.field === null
          : kind === 'inv' ? (d.kind === 'type' || d.kind === 'state') && d.hasInv
          : kind === 'pre' ? d.hasPre
          : kind === 'post' ? d.hasPost
          : kind === 'scenario' ? d.kind === 'explicit operation' && d.explicit
          : d.kind.includes('function');
        if (!fits) s.errors.push(`${where}：${ref} 没有可作 ${kind} 的部分（它是 ${d.kind}${kind === 'inv' || kind === 'pre' || kind === 'post' ? `，没有写 ${kind}` : ''}）。`);
        if (d.unspecified && element.field === null) s.errors.push(`${where}：${ref} 是不展开的定义（token 或 is not yet specified）；草稿里定下的约束不能藏在这里。`);
      }
      break;
    }
    case 'import': {
      s.only(['kind', 'module', 'from']);
      const name = s.text('module');
      const from = s.text('from');
      const module = spec.modules.find((m) => m.name === name);
      if (name && !module) s.errors.push(`${where}.module：没有模块 ${name}。`);
      if (module && from && !module.imports.some((i) => i.module === from)) s.errors.push(`${where}：${name} 没有从 ${from} 导入。`);
      if (module) {
        dir = module.place.dir;
        deps[`${name} imports`] = module.imports.map((i) => `${i.module}: ${i.items.map((x) => `${x.kind} ${x.name}`).join(', ')}`).join('\n');
      }
      break;
    }
    case 'export': {
      s.only(['kind', 'module', 'name']);
      const name = s.text('module');
      const exported = s.text('name');
      const module = spec.modules.find((m) => m.name === name);
      if (name && !module) s.errors.push(`${where}.module：没有模块 ${name}。`);
      if (module && exported && !module.exports.all && !module.exports.items.some((i) => i.name === exported)) s.errors.push(`${where}：${name} 没有导出 ${exported}。`);
      if (module) {
        dir = module.place.dir;
        deps[`${name} exports`] = module.exports.all ? 'all' : module.exports.items.map((i) => `${i.kind} ${i.name}`).join('\n');
      }
      break;
    }
    case 'semantic': {
      s.only(['kind', 'path', 'line']);
      const path = s.text('path');
      const line = item.line;
      if (typeof line !== 'number') s.errors.push(`${where}.line：写出「语义」小节里那一行的行号。`);
      else if (path) {
        const text = semanticLine(spec, path, line);
        if (text === null) s.errors.push(`${where}：${path}:${line} 不是 README.md「语义」小节里的正文。`);
        else {
          deps[`${path}:${line}`] = text;
          dir = spec.places.find((p) => p.path === path)!.dir;
        }
      }
      break;
    }
    default:
      assertNever(kind);
  }
  slots.merge(s);
  return { kind, dir };
}

function designOutcomes(design: string, sub: DesignSub, mode: StampMode): Outcome[] {
  const repo = dirname(design);
  const rel = (p: string) => relative(repo, p);
  const draftNotes = draftOutcomes(repo, 'status');
  const draftErrors = draftNotes.flatMap((o) => o.notes).filter((n) => n.severity === 'Error').length;
  const outcomes: Outcome[] = [];
  const wants = (s: DesignSub) => sub === s || sub === 'status';
  if (wants('check')) outcomes.push(checkOutcome(design, 'check'));
  if (!wants('elements') && !wants('constraints')) return outcomes;
  if (draftErrors > 0) return [...outcomes, gate(sub, `草稿还没有满足完成条件（ssot draft status ${repo} 有 ${draftErrors} 处错误）：先回 ssot-draft。`)];
  const { draft } = readDraft(repo);
  const { spec, diagnostics } = loadSpec(design);
  if (!spec) return [...outcomes, gate(sub, `设计读不进来：${diagnostics.map((d) => `${d.path}:${d.line} ${d.message}`).join('；')}`)];
  // 每个子命令一个目录：一个盖章文件只有一个子命令写，并行跑 elements 与 constraints 不会互相覆盖。
  const ledger = (s: string) => join(repo, '.tmp', 'ssot-design', s);
  const scope: Scope = { dirs: [], constraints: [] };
  if (wants('elements')) {
    outcomes.push(
      runStamped(
        {
          sub: 'elements',
          list: 'elements',
          keyField: 'element',
          target: join(ledger('elements'), 'elements.yaml'),
          files: yamlFiles(ledger('elements')),
          obligations: elementObligations(spec, 'design'),
          judge: (record, o) => {
            const slots = new Slots(record, o.key);
            slots.only(['element', 'constraints', 'connection_for', 'reason']);
            const cs = slots.list('constraints');
            const conn = slots.list('connection_for');
            if (cs.length + conn.length === 0) slots.errors.push(`${o.key}：答不出它表达哪条约束（constraints）或是哪条约束所需的连接（connection_for）；答不出就不写这个元素。`);
            for (const c of [...cs, ...conn]) if (!draft!.constraints.has(c)) slots.errors.push(`${o.key}：${c} 不在草稿的 constraints 里。`);
            slots.text('reason');
            const deps: Record<string, string> = {};
            for (const c of [...cs, ...conn]) {
              const dc = draft!.constraints.get(c);
              if (dc) deps[`草稿 ${c}`] = canonical(dc.record);
            }
            return { errors: slots.errors, warnings: [], deps };
          },
        },
        scope,
        mode,
        rel,
      ),
    );
  }
  if (wants('constraints')) {
    const obligations: Obligation[] = [...draft!.constraints.values()].map((c) => ({
      key: c.id,
      dir: null,
      constraint: c.id,
      subject: canonical(c.record),
      skeleton: { constraint: c.id, landing: [{ kind: '', element: '' }], excludes: '' },
      hint: `${c.id}（${c.category ?? '未标类别'}）：${String(c.record.invariant ?? '')}\n违反情形：${String(c.record.violation ?? '')}\n允许的写法：${c.category ? ALLOWED[c.category].join(' | ') : '先在草稿里标类别'}`,
    }));
    outcomes.push(
      runStamped(
        {
          sub: 'constraints',
          list: 'constraints',
          keyField: 'constraint',
          target: join(ledger('constraints'), 'constraints.yaml'),
          files: yamlFiles(ledger('constraints')),
          obligations,
          judge: (record, o) => {
            const slots = new Slots(record, o.key);
            slots.only(['constraint', 'landing', 'excludes']);
            const deps: Record<string, string> = {};
            const warnings: string[] = [];
            const dc = draft!.constraints.get(o.key)!;
            const landing = Array.isArray(record.landing) ? record.landing : [];
            if (landing.length === 0) slots.errors.push(`${o.key}.landing：写出这条约束落在规格的哪里。`);
            const kinds = landing.map((item, i) => {
              const where = `${o.key}.landing[${i}]`;
              if (!isObj(item)) {
                slots.errors.push(`${where}：应当是 {kind, …}。`);
                return null;
              }
              const { kind, dir } = landingCheck(spec, item, where, slots, deps);
              if (kind && dc.category && !ALLOWED[dc.category].includes(kind)) warnings.push(`${where}：${dc.category} 类约束一般不写成 ${kind}（ssot-design 第一节）；确认规格里哪个类型或谓词排除了违反情形，指不出就换写法。`);
              if (dir && dc.owner) {
                const expected = dc.owner.layer === 'business' ? `business/${dc.owner.holder}` : 'architecture';
                if (!inDir(dir, expected)) warnings.push(`${where}：草稿把它归给 ${dc.owner.layer === 'business' ? `业务 ${dc.owner.holder}` : `架构（${dc.owner.holder}）`}，落点却在 ${dir}。`);
              }
              return kind;
            });
            if (kinds.length > 0 && kinds.every((k) => k === 'semantic')) warnings.push(`${o.key}：这条约束只写进了「语义」，规格里没有类型或谓词排除它；交付时单独列出。`);
            slots.text('excludes');
            return { errors: slots.errors, warnings, deps };
          },
        },
        scope,
        mode,
        rel,
      ),
    );
  }
  return outcomes;
}

// ---------------------------------------------------------------- 验证

const VERIFY_SUBS = ['check', 'expect', 'gaps', 'attack', 'elements', 'scenarios', 'owner', 'po', 'review', 'verdict', 'status'] as const;
type VerifySub = (typeof VERIFY_SUBS)[number];
const SLOTS = ['initial', 'call', 'compose', 'bypass', 'import'] as const;
type Slot = (typeof SLOTS)[number];
const SLOT_HINT: Readonly<Record<Slot, string>> = {
  initial: '一个初始状态',
  call: '一次满足 pre 的调用，以及 post 允许的一个结果（尤其 post 没约束到的分量）',
  compose: '两个连接先后组合出来的状态',
  bypass: '不经场景、直接调用连接的使用方',
  import: '一条导入路径，让不该触达的模块触达了',
};

type Expected = { readonly id: string; readonly record: Obj; readonly dir: string; readonly subject: string };

/** 验证方的台账根：每个验证方各写各的，结论互不覆盖。 */
function verifyRoot(design: string, as: string): string {
  return join(dirname(design), '.tmp', 'ssot-verify', as);
}

function readExpect(design: string, as: string, spec: Spec | null, sub: string): { readonly expected: ReadonlyMap<string, Expected>; readonly outcome: Outcome } {
  const repo = dirname(design);
  const root = verifyRoot(design, as);
  const rel = (p: string) => relative(repo, p);
  const notes: Note[] = [];
  const materialsFile = join(root, 'materials.yaml');
  const { value: materialsValue, problem } = readYaml(materialsFile);
  if (problem) notes.push(error(sub, rel(materialsFile), problem));
  const materials = Array.isArray(materialsValue?.materials) ? (materialsValue!.materials as unknown[]).filter((m): m is string => typeof m === 'string') : [];
  const { blocks, notes: blockNotes } = requirementBlocks(repo, materials, sub, `${rel(materialsFile)} materials`);
  notes.push(...blockNotes);
  const files = yamlFiles(join(root, 'expect'));
  const requirementRecords: { record: Obj; where: string }[] = [];
  const constraintRecords: { record: Obj; where: string }[] = [];
  for (const file of files) {
    const { value, problem: p } = readYaml(file);
    if (p) notes.push(error(sub, rel(file), p));
    listOf(value ?? {}, 'requirements').forEach((r, i) => requirementRecords.push({ record: r, where: `${rel(file)} requirements[${i}]` }));
    listOf(value ?? {}, 'constraints').forEach((c, i) => constraintRecords.push({ record: c, where: `${rel(file)} constraints[${i}]` }));
  }
  const expected = new Map<string, Expected>();
  for (const { record, where } of constraintRecords) {
    const slots = new Slots(record, where);
    slots.only(['id', 'object', 'kind', 'varies', 'invariant', 'violation', 'category', 'owner']);
    const id = slots.text('id');
    if (id && expected.has(id)) slots.errors.push(`${where}.id：${id} 重复。`);
    slots.text('object');
    slots.choice('kind', OBJECT_KINDS);
    for (const field of ['varies', 'invariant', 'violation']) slots.text(field);
    slots.choice('category', CATEGORIES);
    const owner = slots.nested('owner');
    let dir: string | null = null;
    if (owner) {
      dir = owner.text('dir');
      owner.optionalText('connection');
      if (dir && spec && !spec.dirs.has(dir)) owner.errors.push(`${where}.owner.dir：设计里没有目录 ${dir}；写 architecture、architecture/<子模块> 或 business/<单元>。`);
      slots.merge(owner);
    }
    slots.errors.forEach((e) => notes.push(error(sub, where, e)));
    if (id && !expected.has(id)) expected.set(id, { id, record, dir: dir ?? '', subject: canonical(record) });
  }
  const byKey = new Map<string, string>();
  for (const { record, where } of requirementRecords) {
    const block = blockOf(record.block);
    if (!block) {
      notes.push(error(sub, where, 'block 要写成 {path, heading, text}，照缺判骨架抄。'));
      continue;
    }
    const key = blockKey(block);
    if (byKey.has(key)) notes.push(error(sub, where, `和 ${byKey.get(key)} 是同一块需求。`));
    byKey.set(key, where);
    const slots = new Slots(record, where);
    slots.only(['block', 'constraints', 'none']);
    const cs = slots.list('constraints');
    const none = slots.optionalText('none');
    if (cs.length === 0 && !none) slots.errors.push(`${where}：写出这块需求要求的应有约束（constraints），或说明它不约束任何对象的理由（none）。`);
    for (const c of cs) if (!expected.has(c)) slots.errors.push(`${where}.constraints：${c} 不在 expect 的 constraints 里。`);
    slots.errors.forEach((e) => notes.push(error(sub, where, e)));
  }
  for (const id of expected.keys()) {
    const used = requirementRecords.some(({ record }) => Array.isArray(record.constraints) && record.constraints.includes(id));
    if (!used) notes.push(error(sub, `expect ${id}`, `应有约束 ${id} 没有出处：没有任何需求块落到它。`));
  }
  const items: { hint: string; skeleton: Obj }[] = [];
  const current = new Set(blocks.map(blockKey));
  for (const block of blocks) {
    if (!byKey.has(blockKey(block))) {
      notes.push(error(sub, `${block.path} ${block.heading.join(' / ')}`, `缺判：「${block.text.split('\n')[0]}」还没有写出应有约束。`));
      items.push({ hint: '', skeleton: { block: { path: block.path, heading: block.heading, text: block.text, ...(block.occurrence > 1 ? { occurrence: block.occurrence } : {}) }, constraints: [] } });
    }
  }
  for (const [key, where] of byKey) if (!current.has(key)) notes.push(error(sub, where, '材料里已经没有这块需求（改写或删除了）：删掉这条，按缺判骨架重判。'));
  const errors = notes.filter((n) => n.severity === 'Error').length;
  return {
    expected,
    outcome: {
      sub,
      notes,
      missing: items.length > 0 ? { file: rel(join(root, 'expect', 'requirements.yaml')), list: 'requirements', items } : null,
      total: blocks.length + constraintRecords.length,
      judged: errors === 0 ? blocks.length + constraintRecords.length : 0,
    },
  };
}

/** gaps 的一问（遗漏、过强、误当必需）：有没有、在哪里、为什么。判为没有遗漏时要指出约束写在哪里。 */
function findings(slots: Slots, id: string, field: string, label: string, spec: Spec, deps: Record<string, string>, warnings: string[], requireAtWhenClear: boolean): void {
  const s = slots.nested(field);
  if (!s) return;
  s.only(['found', 'at', 'reason']);
  const found = s.bool('found');
  const at = s.list('at');
  refs(spec, at, `${id}.${field}.at`, s, deps);
  const reason = s.text('reason');
  if (found === false && requireAtWhenClear && at.length === 0) s.errors.push(`${id}.${field}.at：判为没有${label}，要指出规格里写着这条约束的位置。`);
  if (found === true && reason) warnings.push(`${label}：${reason}`);
  slots.merge(s);
}

/** 反例：工具拼出 VDMJ 表达式求值，必须为 true；调用式的反例还要核对没列进 ext wr 的状态分量前后相同。 */
function witness(spec: Spec, w: Obj, where: string, slots: Slots, deps: Record<string, string>): string | null {
  const s = new Slots(w, where);
  if (typeof w.operation === 'string') {
    s.only(['operation', 'args', 'result', 'before', 'after', 'violates']);
    const ref = s.text('operation')!;
    const element = spec.elements.get(ref);
    const args = s.list('args');
    const result = s.optionalText('result');
    const before = s.optionalText('before');
    const after = s.optionalText('after');
    const violates = s.text('violates');
    if (!element || element.field !== null || !element.definition.kind.includes('operation')) {
      s.errors.push(`${where}.operation：${ref} 不是规格里的操作。`);
      slots.merge(s);
      return null;
    }
    deps[ref] = element.source;
    const d = element.definition;
    if (!d.hasPost) s.errors.push(`${where}：${ref} 没有 post，调用式反例拼不出 post_${d.name}；改用 {module, expression}。`);
    const state = element.module.definitions.find((x) => x.kind === 'state');
    if (state && (!before || !after)) s.errors.push(`${where}：${element.module.name} 有状态 ${state.name}，写出 before 与 after（完整的 mk_${state.name}(…)）。`);
    if (s.errors.length > 0 || !violates) {
      slots.merge(s);
      return null;
    }
    const bindings = [state ? `before = ${before}` : null, state ? `after = ${after}` : null, result ? `result = ${result}` : null].filter(Boolean);
    const stateArgs = state ? ['before'] : [];
    const parts = [
      d.hasPre ? `pre_${d.name}(${[...args, ...stateArgs].join(', ')})` : null,
      `post_${d.name}(${[...args, ...(result ? ['result'] : []), ...(state ? ['before', 'after'] : [])].join(', ')})`,
      `(${violates})`,
    ].filter(Boolean);
    const written = new Set(d.ext.filter((x) => x.mode === 'wr').flatMap((x) => x.names));
    const frame = state ? state.fields.filter((f) => !written.has(f.name)).map((f) => f.name) : [];
    const body = frame.length > 0 ? `mk_(${parts.join(' and ')}, [${frame.map((f) => `before.${f} = after.${f}`).join(', ')}])` : parts.join(' and ');
    const expression = bindings.length > 0 ? `let ${bindings.join(', ')} in ${body}` : body;
    const run = evaluate(spec.design, spec.modules, element.module.name, expression);
    if (run.kind === 'Failed') s.errors.push(`${where}：反例求值出错，规格不接受它：${run.text.split('\n').join('；')}（表达式：${expression}）`);
    else {
      const values = [...run.text.matchAll(/\b(true|false)\b/g)].map((m) => m[1] === 'true');
      if (values[0] !== true) s.errors.push(`${where}：反例不成立，求值为 false：pre/post 不允许这次变化，或 violates 不成立（表达式：${expression}）。`);
      frame.forEach((f, i) => {
        if (values[i + 1] !== true) s.errors.push(`${where}：${f} 没列进 ${d.name} 的 ext wr，调用前后必须相同；这个反例改了它，规格不允许。`);
      });
    }
    slots.merge(s);
    return expression;
  }
  s.only(['module', 'expression']);
  const module = s.text('module');
  const expression = s.text('expression');
  const located = spec.modules.find((m) => m.name === module);
  if (module && !located) s.errors.push(`${where}.module：没有模块 ${module}。`);
  if (located && expression) {
    deps[`模块 ${module}`] = sources(spec.design, located).module;
    const run = evaluate(spec.design, spec.modules, located.name, expression);
    if (run.kind === 'Failed') s.errors.push(`${where}：反例求值出错：${run.text.split('\n').join('；')}`);
    else if (run.text.trim() !== 'true') s.errors.push(`${where}：反例表达式求值为 ${run.text.trim()}，要为 true。`);
  }
  slots.merge(s);
  return expression;
}

function attackHint(spec: Spec, e: Expected): string {
  const owned = spec.modules.filter((m) => m.place.dir === e.dir);
  const names = new Set(owned.map((m) => m.name));
  const importers = spec.modules.filter((m) => m.imports.some((i) => names.has(i.module)));
  const states = owned.flatMap((m) => m.definitions.filter((d) => d.kind === 'state').map((d) => `${m.name}\`${d.name}(${d.fields.map((f) => f.name).join(', ')})`));
  const ops = [...owned, ...importers].flatMap((m) =>
    m.definitions.filter((d) => d.kind.includes('operation')).map((d) => `${m.name}\`${d.name}${d.ext.length > 0 ? `[${d.ext.map((x) => `${x.mode} ${x.names.join(' ')}`).join('; ')}]` : d.explicit ? '[场景]' : ''}`),
  );
  const edges = importers.map((m) => `${m.name} -> ${m.imports.filter((i) => names.has(i.module)).map((i) => i.module).join(', ')}`);
  return [
    `${e.id}：${String(e.record.invariant ?? '')}（违反：${String(e.record.violation ?? '')}）`,
    `状态：${states.join('；') || '无'}`,
    `操作：${[...new Set(ops)].join('；') || '无'}`,
    `导入 ${e.dir} 的模块：${edges.join('；') || '无'}`,
    `每个槽：verdict 为 excluded（by 列出排除它的元素）| not_applicable | counterexample（witness：{operation, args, result, before, after, violates} 或 {module, expression}）| undecided`,
  ].join('\n');
}

function verifyOutcomes(design: string, sub: VerifySub, as: string, scope: Scope, mode: StampMode): Outcome[] {
  const repo = dirname(design);
  const root = verifyRoot(design, as);
  const rel = (p: string) => relative(repo, p);
  const wants = (s: VerifySub) => sub === s || sub === 'status';
  const outcomes: Outcome[] = [];
  if (wants('check')) outcomes.push(checkOutcome(design, 'check'));
  if (sub === 'check') return outcomes;
  const { spec, diagnostics } = loadSpec(design);
  if (!spec) return [...outcomes, gate(sub, `设计读不进来：${diagnostics.map((d) => `${d.path}:${d.line} ${d.message}`).join('；')}`)];
  const { expected, outcome: expectOutcome } = readExpect(design, as, spec, 'expect');
  if (wants('expect')) outcomes.push(expectOutcome);
  if (sub === 'expect') return outcomes;
  const expectBlocked = expectOutcome.notes.some((n) => n.severity === 'Error');
  const needsExpect = (s: string) => gate(s, `expect 还有错误（ssot verify expect ${rel(design)} --as ${as}）：先写全应有约束，再做 ${s}。`);
  const files = (s: string) => yamlFiles(join(root, s));
  const target = (s: string) => join(root, s, `${s}.yaml`);
  const expectedObligations = (skeleton: (e: Expected) => Obj, hint: (e: Expected) => string): Obligation[] =>
    [...expected.values()].map((e) => ({ key: e.id, dir: e.dir, constraint: e.id, subject: e.subject, skeleton: skeleton(e), hint: hint(e) }));
  const constraintHint = (e: Expected) => `${e.id}（${e.dir}）：${String(e.record.invariant ?? '')}（违反：${String(e.record.violation ?? '')}）`;

  if (wants('gaps')) {
    if (expectBlocked) outcomes.push(needsExpect('gaps'));
    else {
      outcomes.push(
        runStamped(
          {
            sub: 'gaps',
            list: 'gaps',
            keyField: 'constraint',
            target: target('gaps'),
            files: files('gaps'),
            obligations: expectedObligations(
              (e) => ({ constraint: e.id, ...Object.fromEntries(['missing', 'overstrong', 'misnecessary'].map((q) => [q, { found: false, at: [], reason: '' }])) }),
              constraintHint,
            ),
            judge: (record) => {
              const slots = new Slots(record, String(record.constraint));
              slots.only(['constraint', 'missing', 'overstrong', 'misnecessary']);
              const deps: Record<string, string> = {};
              const warnings: string[] = [];
              const id = String(record.constraint);
              findings(slots, id, 'missing', '遗漏', spec, deps, warnings, true);
              findings(slots, id, 'overstrong', '过强', spec, deps, warnings, false);
              findings(slots, id, 'misnecessary', '误当必需', spec, deps, warnings, false);
              return { errors: slots.errors, warnings, deps };
            },
          },
          scope,
          mode,
          rel,
        ),
      );
    }
  }

  if (wants('attack')) {
    if (expectBlocked) outcomes.push(needsExpect('attack'));
    else {
      outcomes.push(
        runStamped(
          {
            sub: 'attack',
            list: 'attacks',
            keyField: 'constraint',
            target: target('attack'),
            files: files('attack'),
            obligations: expectedObligations((e) => ({ constraint: e.id, ...Object.fromEntries(SLOTS.map((s) => [s, { verdict: '', by: [], reason: '' }])) }), (e) => attackHint(spec, e)),
            judge: (record) => {
              const id = String(record.constraint);
              const slots = new Slots(record, id);
              slots.only(['constraint', ...SLOTS]);
              const deps: Record<string, string> = {};
              const warnings: string[] = [];
              for (const slot of SLOTS) {
                const s = slots.nested(slot);
                if (!s) continue;
                s.only(['verdict', 'by', 'reason', 'witness']);
                const verdict = s.choice('verdict', ['excluded', 'not_applicable', 'counterexample', 'undecided'] as const);
                const reason = s.text('reason');
                switch (verdict) {
                  case null:
                    break;
                  case 'excluded': {
                    const by = s.list('by');
                    if (by.length === 0) s.errors.push(`${id}.${slot}.by：判为排除，要列出排除违反情形的类型或谓词所在的元素。`);
                    const found = refs(spec, by, `${id}.${slot}.by`, s, deps);
                    if (found.length > 0 && found.every((f) => f.element?.definition.explicit && f.element.definition.kind === 'explicit operation')) {
                      warnings.push(`${slot}：只拿场景作排除的依据；场景能走通只说明那一条路没有违反，找出排除它的类型或谓词。`);
                    }
                    break;
                  }
                  case 'not_applicable':
                    break;
                  case 'undecided':
                    warnings.push(`${slot}（${SLOT_HINT[slot]}）未能判定：${reason ?? ''}`);
                    break;
                  case 'counterexample': {
                    const w = s.object('witness');
                    if (w) witness(spec, w, `${id}.${slot}.witness`, s, deps);
                    if (s.errors.length === 0) warnings.push(`${slot} 有反例，约束不成立：${reason ?? ''}`);
                    break;
                  }
                  default:
                    assertNever(verdict);
                }
                slots.merge(s);
              }
              return { errors: slots.errors, warnings, deps };
            },
          },
          scope,
          mode,
          rel,
        ),
      );
    }
  }

  if (wants('elements')) {
    if (expectBlocked) outcomes.push(needsExpect('elements'));
    else {
      outcomes.push(
        runStamped(
          {
            sub: 'elements',
            list: 'elements',
            keyField: 'element',
            target: target('elements'),
            files: files('elements'),
            obligations: elementObligations(spec, 'verify'),
            judge: (record, o) => {
              const slots = new Slots(record, o.key);
              slots.only(['element', 'verdict', 'constraints', 'reason']);
              const verdict = slots.choice('verdict', ['guards', 'connection', 'extraneous'] as const);
              const cs = slots.list('constraints');
              const reason = slots.text('reason');
              const warnings: string[] = [];
              if ((verdict === 'guards' || verdict === 'connection') && cs.length === 0) slots.errors.push(`${o.key}.constraints：写出它守的（或作连接服务的）应有约束。`);
              for (const c of cs) if (!expected.has(c)) slots.errors.push(`${o.key}.constraints：${c} 不在 expect 里。`);
              if (verdict === 'extraneous') warnings.push(`不该进 VDM：${reason ?? ''}`);
              return { errors: slots.errors, warnings, deps: Object.fromEntries(cs.filter((c) => expected.has(c)).map((c) => [`应有 ${c}`, expected.get(c)!.subject])) };
            },
          },
          scope,
          mode,
          rel,
        ),
      );
    }
  }

  if (wants('scenarios')) {
    if (expectBlocked) outcomes.push(needsExpect('scenarios'));
    else {
      const nodes: { module: Located; node: ScenarioNode }[] = spec.modules.flatMap((m) => m.definitions.flatMap((d) => d.scenario.map((node) => ({ module: m, node }))));
      const counts = new Map<string, number>();
      const obligations: Obligation[] = nodes.map(({ module, node }) => {
        const base = `${module.name}\`${node.path}`;
        const n = (counts.get(base) ?? 0) + 1;
        counts.set(base, n);
        const key = n > 1 ? `${base}#${n}` : base;
        return { key, dir: module.place.dir, constraint: null, subject: `${node.kind}: ${node.text}`, skeleton: { node: key, verdict: '', constraints: [], reason: '' }, hint: `${node.kind}（${module.place.path}:${node.line}）：${node.text}` };
      });
      outcomes.push(
        runStamped(
          {
            sub: 'scenarios',
            list: 'scenarios',
            keyField: 'node',
            target: target('scenarios'),
            files: files('scenarios'),
            obligations,
            judge: (record, o) => {
              const slots = new Slots(record, o.key);
              slots.only(['node', 'verdict', 'constraints', 'reason']);
              const verdict = slots.choice('verdict', ['constraint', 'simulation'] as const);
              const cs = slots.list('constraints');
              const reason = slots.text('reason');
              if (verdict === 'constraint' && cs.length === 0) slots.errors.push(`${o.key}.constraints：写出这处先后、分支或挑选对应的应有约束。`);
              for (const c of cs) if (!expected.has(c)) slots.errors.push(`${o.key}.constraints：${c} 不在 expect 里。`);
              return { errors: slots.errors, warnings: verdict === 'simulation' ? [`在模拟业务怎样运行：${reason ?? ''}`] : [], deps: Object.fromEntries(cs.filter((c) => expected.has(c)).map((c) => [`应有 ${c}`, expected.get(c)!.subject])) };
            },
          },
          scope,
          mode,
          rel,
        ),
      );
    }
  }

  if (wants('owner')) {
    if (expectBlocked) outcomes.push(needsExpect('owner'));
    else {
      outcomes.push(
        runStamped(
          {
            sub: 'owner',
            list: 'owners',
            keyField: 'constraint',
            target: target('owner'),
            files: files('owner'),
            obligations: expectedObligations((e) => ({ constraint: e.id, actual: [], verdict: '', reason: '' }), constraintHint),
            judge: (record, o) => {
              const slots = new Slots(record, o.key);
              slots.only(['constraint', 'actual', 'verdict', 'reason']);
              const verdict = slots.choice('verdict', ['match', 'misplaced', 'duplicated', 'absent'] as const);
              const actual = slots.list('actual');
              const reason = slots.text('reason');
              const deps: Record<string, string> = {};
              const found = refs(spec, actual, `${o.key}.actual`, slots, deps);
              const warnings: string[] = [];
              const dir = expected.get(o.key)!.dir;
              if (verdict !== 'absent' && actual.length === 0) slots.errors.push(`${o.key}.actual：写出它实际写在哪里。`);
              if (verdict === 'match') for (const f of found) if (f.dir !== dir) warnings.push(`判为归属一致，但实际位置在 ${f.dir}，应在 ${dir}。`);
              if (verdict === 'misplaced') warnings.push(`归属不对：${reason ?? ''}`);
              if (verdict === 'duplicated') warnings.push(`同一个东西在两处展开：${reason ?? ''}`);
              if (verdict === 'absent') warnings.push(`规格里没有写这条约束：${reason ?? ''}`);
              return { errors: slots.errors, warnings, deps };
            },
          },
          scope,
          mode,
          rel,
        ),
      );
    }
  }

  if (wants('po')) {
    const run = vdmj(design, spec.modules);
    if (run.diagnostics.length > 0) outcomes.push(gate('po', `规格没有通过类型检查或 QuickCheck（ssot check ${rel(design)}）：先修好，证明义务才有意义。`));
    else {
      const pending = run.proofs.filter((p) => p.status === 'MAYBE' || p.status === 'ERROR' || p.status === 'UNCHECKED');
      const counts = new Map<string, number>();
      const obligations: Obligation[] = pending.map((p: ProofObligation) => {
        const base = `${p.module}\`${p.owner}: ${p.kind}`;
        const n = (counts.get(base) ?? 0) + 1;
        counts.set(base, n);
        const key = n > 1 ? `${base} #${n}` : base;
        const place = spec.places.find((pl) => pl.path === p.path);
        return { key, dir: place?.dir ?? null, constraint: null, subject: p.predicate, skeleton: { po: key, verdict: '', guards: [], reason: '' }, hint: `${p.path}:${p.line}（QuickCheck：${p.status}）\n${p.predicate}` };
      });
      outcomes.push(
        runStamped(
          {
            sub: 'po',
            list: 'obligations',
            keyField: 'po',
            target: target('po'),
            files: files('po'),
            obligations,
            judge: (record, o) => {
              const slots = new Slots(record, o.key);
              slots.only(['po', 'verdict', 'guards', 'reason']);
              const verdict = slots.choice('verdict', ['guarded', 'missing_guard', 'undecided'] as const);
              const guards = slots.list('guards');
              const reason = slots.text('reason');
              const deps: Record<string, string> = {};
              refs(spec, guards, `${o.key}.guards`, slots, deps);
              if (verdict === 'guarded' && guards.length === 0) slots.errors.push(`${o.key}.guards：写出守住它的 pre、inv 或分支条件所在位置。`);
              const warnings = verdict === 'missing_guard' ? [`缺前置条件或分支守卫：${reason ?? ''}`] : verdict === 'undecided' ? [`未能判定：${reason ?? ''}`] : [];
              return { errors: slots.errors, warnings, deps };
            },
          },
          scope,
          mode,
          rel,
        ),
      );
    }
  }

  if (wants('review')) outcomes.push(reviewOutcome(design, spec, root, scope, mode, rel));

  if (wants('verdict')) {
    if (expectBlocked) outcomes.push(needsExpect('verdict'));
    else {
      const upstream = (s: string, list: string) => readEntries(files(s), list, 'constraint', s, rel).entries;
      const gaps = upstream('gaps', 'gaps');
      const attacks = upstream('attack', 'attacks');
      const owners = upstream('owner', 'owners');
      outcomes.push(
        runStamped(
          {
            sub: 'verdict',
            list: 'verdicts',
            keyField: 'constraint',
            target: target('verdict'),
            files: files('verdict'),
            obligations: expectedObligations((e) => ({ constraint: e.id, verdict: '', by: [], counterexample: '', contradiction: '', reason: '' }), constraintHint),
            judge: (record, o) => {
              const slots = new Slots(record, o.key);
              slots.only(['constraint', 'verdict', 'by', 'counterexample', 'contradiction', 'reason']);
              const verdict = slots.choice('verdict', ['holds', 'fails', 'undecided'] as const);
              const by = slots.list('by');
              const slot = slots.optionalText('counterexample');
              const contradiction = slots.optionalText('contradiction');
              const reason = slots.text('reason');
              const deps: Record<string, string> = {};
              const warnings: string[] = [];
              const gap = gaps.get(o.key);
              const attack = attacks.get(o.key);
              const owner = owners.get(o.key);
              for (const [name, entry] of [['gaps', gap], ['attack', attack], ['owner', owner]] as const) {
                if (!entry) slots.errors.push(`${o.key}：先在 ${name} 里判完这条约束，再下结论。`);
                else deps[`${name} ${o.key}`] = canonical(entry.record);
              }
              refs(spec, by, `${o.key}.by`, slots, deps);
              const counterexamples = attack ? SLOTS.filter((s) => isObj(attack.record[s]) && (attack.record[s] as Obj).verdict === 'counterexample') : [];
              switch (verdict) {
                case null:
                  break;
                case 'holds':
                  if (by.length === 0) slots.errors.push(`${o.key}.by：判为成立，要列出排除违反情形的元素。`);
                  if (counterexamples.length > 0) slots.errors.push(`${o.key}：attack 的 ${counterexamples.join('、')} 有反例，不能判为成立。`);
                  break;
                case 'fails':
                  if (slot && !counterexamples.includes(slot as Slot)) slots.errors.push(`${o.key}.counterexample：attack 的 ${slot} 不是反例。`);
                  if (!slot && !contradiction) slots.errors.push(`${o.key}：判为不成立，要指出 attack 里的反例槽（counterexample），或写出规格内部的矛盾（contradiction）。`);
                  warnings.push(`不成立：${reason ?? ''}`);
                  break;
                case 'undecided':
                  warnings.push(`未能判定：${reason ?? ''}`);
                  break;
                default:
                  assertNever(verdict);
              }
              return { errors: slots.errors, warnings, deps };
            },
          },
          scope,
          mode,
          rel,
        ),
      );
    }
  }
  return outcomes;
}

/** review.py 的结果文件里，一条材料的判断：它的问题、位置与判断对象，以及 judge 给的概率与是否超过阈值。 */
type ReviewResult = { readonly question: string; readonly path: string; readonly state: unknown; readonly probability: number; readonly finding: boolean };

function reviewAnchor(item: ReviewItem): string {
  const s = item.state as Record<string, unknown>;
  // 先取最能认出这条材料的部分：属主名、元素、段落、图块，最后才是整段定义或整个模块。
  const text = String(s.owner ?? s.element ?? s.paragraph ?? s.block ?? s.comment ?? s.definition ?? s.spec ?? '');
  const first = text.split('\n').find((l) => l.trim() !== '')?.trim() ?? '';
  return first.length > 40 ? `${first.slice(0, 40)}…` : first;
}

function reviewOutcome(design: string, spec: Spec, root: string, scope: Scope, mode: StampMode, rel: (p: string) => string): Outcome {
  const resultsFile = join(root, 'review.json');
  if (!existsSync(resultsFile)) {
    return gate('review', `没有模型审查的结果 ${rel(resultsFile)}：在 omp eval 里运行 review.py 的 review("${design}", save="${resultsFile}")。`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resultsFile, 'utf8'));
  } catch (e) {
    return gate('review', `${rel(resultsFile)} 不是 JSON：${(e as Error).message}`);
  }
  const results = isObj(parsed) && Array.isArray(parsed.items) ? (parsed.items as ReviewResult[]) : [];
  const byState = new Map(results.map((r) => [canonical([r.question, r.path, r.state]), r]));
  const notes: Note[] = [];
  const counts = new Map<string, number>();
  const obligations: Obligation[] = [];
  for (const item of review(design)) {
    const place = spec.places.find((p) => p.path === item.path);
    const dir = place?.dir ?? null;
    if (!inScope({ dir, constraint: null }, scope)) continue;
    const result = byState.get(canonical([item.question, item.path, item.state]));
    if (!result) {
      notes.push(error('review', `${item.path}:${item.line} ${item.question}`, `review.py 没有判断过这条材料（设计改过或没跑全）：重跑 review("${design}", save="${resultsFile}")。`));
      continue;
    }
    if (!result.finding) continue;
    const base = `${item.question} ${item.path} ${reviewAnchor(item)}`;
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    const key = n > 1 ? `${base} #${n}` : base;
    obligations.push({
      key,
      dir,
      constraint: null,
      subject: canonical(item.state),
      skeleton: { item: key, verdict: '', reason: '' },
      hint: `${item.path}:${item.line} [review:${item.question}] p=${result.probability.toFixed(2)}`,
    });
  }
  const outcome = runStamped(
    {
      sub: 'review',
      list: 'reviews',
      keyField: 'item',
      target: join(root, 'review', 'review.yaml'),
      files: yamlFiles(join(root, 'review')),
      obligations,
      judge: (record, o) => {
        const slots = new Slots(record, o.key);
        slots.only(['item', 'verdict', 'reason']);
        const verdict = slots.choice('verdict', ['accept', 'reject'] as const);
        const reason = slots.text('reason');
        const warnings = verdict === 'accept' ? [`采纳模型审查，交回作者修改：${reason ?? ''}`] : verdict === 'reject' ? [`驳回模型审查：${reason ?? ''}`] : [];
        return { errors: slots.errors, warnings, deps: {} };
      },
    },
    scope,
    mode,
    rel,
  );
  return { ...outcome, notes: [...notes, ...outcome.notes] };
}

// ---------------------------------------------------------------- 入口

function assertNever(value: never): never {
  throw new Error(`程序错误：未处理的 variant ${String(value)}`);
}

type Options = { readonly positional: readonly string[]; readonly as: string | null; readonly scope: Scope; readonly mode: StampMode };

function parseOptions(args: readonly string[], allowed: readonly string[]): Options {
  const positional: string[] = [];
  const dirs: string[] = [];
  const constraints: string[] = [];
  const restamp = new Set<string>();
  let stamp = false;
  let as: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const value = () => {
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) throw new UsageError(`${arg} 后面要跟一个值。`);
      i++;
      return next;
    };
    if (arg.startsWith('--') && !allowed.includes(arg)) throw new UsageError(`这里不接受 ${arg}。`);
    if (arg === '--as') as = value();
    else if (arg === '--dir') dirs.push(value().replace(/\/+$/, ''));
    else if (arg === '--constraint') constraints.push(value());
    else if (arg === '--stamp') {
      stamp = true;
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--') && positional.length >= 2) {
        restamp.add(next);
        i++;
      }
    } else positional.push(arg);
  }
  return { positional, as, scope: { dirs, constraints }, mode: { stamp, restamp } };
}

export function judge(stage: 'draft' | 'design' | 'verify', args: readonly string[]): number {
  switch (stage) {
    case 'draft': {
      const { positional } = parseOptions(args, []);
      const [sub, repo] = positional;
      if (!sub || !(DRAFT_SUBS as readonly string[]).includes(sub) || !repo || positional.length !== 2) throw new UsageError(`ssot draft <${DRAFT_SUBS.join('|')}> <仓库根>`);
      return printOutcomes(draftOutcomes(resolve(repo), sub as DraftSub));
    }
    case 'design': {
      const { positional, mode } = parseOptions(args, ['--stamp']);
      const [sub, design] = positional;
      if (!sub || !(DESIGN_SUBS as readonly string[]).includes(sub) || !design || positional.length !== 2) throw new UsageError(`ssot design <${DESIGN_SUBS.join('|')}> <design> [--stamp [键]]`);
      return printOutcomes(designOutcomes(resolve(design), sub as DesignSub, mode));
    }
    case 'verify': {
      const { positional, as, scope, mode } = parseOptions(args, ['--as', '--dir', '--constraint', '--stamp']);
      const [sub, design] = positional;
      if (!sub || !(VERIFY_SUBS as readonly string[]).includes(sub) || !design || positional.length !== 2) {
        throw new UsageError(`ssot verify <${VERIFY_SUBS.join('|')}> <design> --as <验证方> [--dir 目录]… [--constraint 编号]… [--stamp [键]]`);
      }
      if (!as || !NAME.test(as)) throw new UsageError('verify 要用 --as 指明验证方（小写字母、数字与连字符），例如 --as fable。');
      return printOutcomes(verifyOutcomes(resolve(design), sub as VerifySub, as, scope, mode));
    }
    default:
      return assertNever(stage);
  }
}
