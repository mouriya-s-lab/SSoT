// 跨载体规则：LikeC4 × VDM（模块对应）、结构化槽位词汇、VDM × Quint（重名、Call 变量）。
import { basename } from "node:path";
import type { Structure } from "../compile/likec4";
import type { QuintModule } from "../compile/quint";
import type { VdmProject } from "../compile/vdm";
import { vdmPosition } from "../compile/vdm";
import { type Diagnostic, type Subject, assertNever, diag, element, global, relation } from "../diag";
import { contractElements, contractFileOf, elementOfModule, isBusiness, moduleNameOf } from "../model";

/** #contract ⇔ contract/<fqn>.vdmsl ⇔ 文件里恰好一个模块，模块名 = 映射名。 */
export function moduleRules(s: Structure, files: readonly string[], project: VdmProject | null): Diagnostic[] {
  const out: Diagnostic[] = [];
  const byFile = new Map(contractElements(s).map((e) => [contractFileOf(e.fqn), e]));
  const present = new Set(files.map((f) => basename(f)));
  for (const [file, e] of byFile) {
    if (e.children.length > 0) out.push(diag("contract.module", element(e.fqn), e.at, `${e.fqn} 带 #contract，不能有子元素`));
    if (!present.has(file)) out.push(diag("contract.module", element(e.fqn), e.at, `${e.fqn} 带 #contract，但没有 contract/${file}`));
  }
  for (const f of files) {
    const e = byFile.get(basename(f));
    if (!e) {
      out.push(diag("contract.module", global, { file: f, line: 1, col: 1 }, `contract/${basename(f)} 没有对应的 #contract 元素（文件名必须是元素 fqn）`));
      continue;
    }
    if (!project) continue;
    const mods = project.modules.filter((m) => m.file === f);
    if (mods.length !== 1)
      out.push(diag("contract.module", element(e.fqn), { file: f, line: 1, col: 1 }, `一个文件只能有一个模块，实际 ${mods.length} 个`));
    for (const m of mods)
      if (m.name !== moduleNameOf(e.fqn))
        out.push(diag("contract.module", element(e.fqn), vdmPosition(m.location), `模块名应为 ${moduleNameOf(e.fqn)}（由元素路径 ${e.fqn} 映射），实际 ${m.name}`));
  }
  return out;
}

/** VDMJ 允许循环 import，但生成的 Quint 模块不能循环引用。每个环上模块各报一条。 */
export function importCycleRules(project: VdmProject, subjectOf: (module: string) => Subject): Diagnostic[] {
  const modules = new Map(project.modules.map((m) => [m.name, m]));
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const active = new Set<string>();
  const out: Diagnostic[] = [];
  let index = 0;
  const visit = (name: string): void => {
    indices.set(name, index);
    low.set(name, index++);
    stack.push(name);
    active.add(name);
    const module = modules.get(name)!;
    for (const imported of module.imports) {
      if (!modules.has(imported.module)) continue;
      if (!indices.has(imported.module)) {
        visit(imported.module);
        low.set(name, Math.min(low.get(name)!, low.get(imported.module)!));
      } else if (active.has(imported.module)) low.set(name, Math.min(low.get(name)!, indices.get(imported.module)!));
    }
    if (low.get(name) !== indices.get(name)) return;
    const cycle: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      active.delete(member);
      cycle.push(member);
    } while (member !== name);
    if (cycle.length === 1 && !module.imports.some((i) => i.module === name)) return;
    cycle.sort();
    for (const n of cycle)
      out.push(diag("contract.imports", subjectOf(n), vdmPosition(modules.get(n)!.location), `契约模块的 import 成环，无法生成 contract.qnt：{${cycle.join(", ")}}`));
  };
  for (const name of [...modules.keys()].sort()) if (!indices.has(name)) visit(name);
  return out;
}

export function contractLayeringRules(s: Structure, project: VdmProject): Diagnostic[] {
  const owner = elementOfModule(s);
  const out: Diagnostic[] = [];
  for (const m of project.modules) {
    const source = owner.get(m.name);
    if (source === undefined || s.elements.get(source)!.kind === "actor" || isBusiness(s, source)) continue;
    for (const imported of m.imports) {
      const target = owner.get(imported.module);
      if (target !== undefined && isBusiness(s, target))
        out.push(diag("contract.layering", element(source), vdmPosition(m.location), `架构元素 ${source} 的契约 ${m.name} 不得 import 业务元素 ${target} 的契约 ${imported.module}`));
    }
  }
  return out;
}


/** VDM 定义名与 Quint 声明名，用于结构化槽位检查。 */
function contractNames(project: VdmProject | null, behavior: readonly QuintModule[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const m of project?.modules ?? [])
    for (const d of m.definitions) {
      switch (d.category) {
        case "type":
        case "operation":
        case "function":
          names.set(d.name, `VDM ${m.name} 的${d.category === "type" ? "类型" : d.category === "operation" ? "操作" : "函数"}`);
          break;
        case "state":
          names.set(d.name, `VDM ${m.name} 的状态`);
          for (const f of d.fields) names.set(f.name, `VDM ${m.name} 的状态分量`);
          break;
        case "value":
          for (const n of d.names) names.set(n, `VDM ${m.name} 的值`);
          break;
        default:
          return assertNever(d);
      }
    }
  for (const q of behavior)
    for (const d of q.decls)
      if (d.name !== "init" && d.name !== "step" && (d.kind === "action" || d.kind === "typedef" || d.kind === "var"))
        names.set(d.name, `Quint ${q.name} 的${d.kind}`);
  return names;
}

const tokens = (v: string | readonly string[]): string[] => (typeof v === "string" ? [v] : [...v]).flatMap((x) => x.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []);

/** 只看元素种类、关系种类、标签、metadata 的键与值；不看标题与描述。 */
export function vocabRules(s: Structure, project: VdmProject | null, behavior: readonly QuintModule[]): Diagnostic[] {
  const names = contractNames(project, behavior);
  const out: Diagnostic[] = [];
  const check = (subject: Subject, at: Diagnostic["at"], slot: string, word: string): void => {
    const owner = names.get(word);
    if (owner) out.push(diag("vocab.slots", subject, at, `${slot} 中出现了 ${owner}名 '${word}'；LikeC4 不写操作、类型、状态与行为`));
  };
  for (const k of s.spec.elementKinds) check(global, null, "元素种类", k);
  for (const k of s.spec.relationKinds) check(global, null, "关系种类", k);
  for (const t of s.spec.tags) check(global, null, "标签", t);
  for (const e of s.elements.values()) {
    for (const [k, v] of Object.entries(e.metadata)) {
      check(element(e.fqn), e.at, "metadata 键", k);
      for (const w of tokens(v)) check(element(e.fqn), e.at, `metadata ${k} 的值`, w);
    }
  }
  for (const r of s.relations) {
    for (const t of r.tags) check(relation(r.source, r.target), r.at, "关系标签", t);
    for (const [k, v] of Object.entries(r.metadata)) {
      check(relation(r.source, r.target), r.at, "metadata 键", k);
      for (const w of tokens(v)) check(relation(r.source, r.target), r.at, `metadata ${k} 的值`, w);
    }
  }
  return out;
}

export function behaviorSubject(s: Structure, modules: readonly string[]): Subject {
  const owner = elementOfModule(s);
  const fqns = [...new Set(modules.flatMap((m) => (owner.has(m) ? [owner.get(m)!] : [])))].sort();
  return fqns.length === 0 ? global : { kind: "elements", fqns };
}

/** 行为不得声明与 VDM 类型、操作、函数同名的东西（CORE §1）。 */
export function behaviorNameRules(s: Structure, project: VdmProject, behavior: readonly QuintModule[]): Diagnostic[] {
  const types = new Map<string, string>();
  const ops = new Map<string, string>();
  for (const m of project.modules)
    for (const d of m.definitions) {
      if (d.category === "type") types.set(d.name, m.name);
      if (d.category === "operation" || d.category === "function") ops.set(d.name, m.name);
    }
  const out: Diagnostic[] = [];
  for (const q of behavior)
    for (const d of q.decls) {
      const clash = d.kind === "typedef" ? types.get(d.name) : d.kind === "var" || d.kind === "const" ? undefined : ops.get(d.name);
      if (clash === undefined) continue;
      const subject = behaviorSubject(s, [clash, ...d.modules]);
      out.push(diag("behavior.names", subject, d.at, `Quint 声明 '${d.name}' 与 VDM ${clash} 的${d.kind === "typedef" ? "类型" : "操作/函数"}同名；契约调用要用生成的 Call 变体，类型要引用 .gen/contract.qnt`));
    }
  return out;
}

export function isRunnable(q: QuintModule): boolean {
  return ["init", "step"].every((n) => q.decls.some((d) => d.name === n && d.kind === "action"));
}

export function callRules(behavior: readonly QuintModule[], callModules: readonly string[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  const runnable = behavior.filter(isRunnable);
  if (behavior.length > 0 && runnable.length === 0)
    out.push(diag("behavior.call", global, null, "行为部分没有可运行模块（同时声明 init 与 step 两个 action）"));
  for (const q of runnable) {
    const at = q.decls.find((d) => d.name === "init")?.at ?? null;
    const vars = q.decls.filter((d) => d.isCallVar);
    if (callModules.length > 0 && vars.length !== 1)
      out.push(diag("behavior.call", global, at, `可运行模块 ${q.name} 必须恰有一个类型为 contract::Call 的状态变量，实际 ${vars.length} 个`));
    if (!q.decls.some((d) => d.name === "safety" && (d.kind === "val" || d.kind === "def")))
      out.push(diag("behavior.call", global, at, `可运行模块 ${q.name} 缺少 val safety`));
  }
  return out;
}
