#!/usr/bin/env bun
// ssot 构建驱动：只负责编排各阶段（编译 → 生成 → 跨载体规则 → 行为验证 → 回放）并输出诊断。
//   ssot setup
//   ssot gen    <design>
//   ssot check  <design> [--scope <视图 id> [--base <rev>]] [--samples N] [--steps K] [--seed S] [--deadline 秒]
//   ssot view   <design> <视图 id>
//   ssot eval   <design> <模块> <表达式> [--bind ...]
//   ssot status <design>
// check 的退出码：0 通过；1 有 error；3 没有 error 但有 resource.deadline（验证未完成）。
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { baseChanges } from "./src/base";
import { compileLikeC4, type Structure } from "./src/compile/likec4";
import { compileBehavior, type QuintModule, typecheckFile } from "./src/compile/quint";
import { compileVdm, type VdmProject } from "./src/compile/vdm";
import { type Diagnostic, diag, element, format, global } from "./src/diag";
import { coverWitnesses, runBehavior } from "./src/behavior";
import { type ContractGen, generateContract } from "./src/gen/contract";
import { generateStructure } from "./src/gen/structure";
import { NotInstalled } from "./src/install";
import { contractElements, contractFileOf, elementOfModule } from "./src/model";
import { replay } from "./src/replay";
import { behaviorNameRules, behaviorSubject, callRules, importRules, isRunnable, moduleRules, vocabRules } from "./src/rules/cross";
import { structureRules } from "./src/rules/structure";
import { type Scope, partition, resolveScope } from "./src/scope";
import { obligationRules } from "./src/obligations";
import { evalCommand } from "./src/evalcmd";
import { hintRules } from "./src/rules/hints";
import { initialRules } from "./src/rules/init";
import { setup } from "./src/setup";
import { type BehaviorOutcomes, deriveStatus, requirementIds } from "./src/status";
import { renderPacket, reviewDiagnostics, reviewPacket } from "./src/view";

interface Layout {
  readonly root: string;
  readonly structure: string;
  readonly contract: string;
  readonly behavior: string;
  readonly gen: string;
}

const layout = (root: string): Layout => ({
  root,
  structure: join(root, "structure"),
  contract: join(root, "contract"),
  behavior: join(root, "behavior"),
  gen: join(root, ".gen"),
});

const listFiles = (dir: string, ext: string): string[] =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(ext)).sort().map((f) => join(dir, f)) : [];

/**
 * 编译 LikeC4 与 VDM，并生成两份 .gen 内容（在内存中）。
 * scopeId：`--scope` 的视图；谓词采样与 QuickCheck 只对作用域节点的模块运行。"none"：不做采样与 QuickCheck（gen、eval）。
 */
async function front(l: Layout, scopeId: string | null | "none") {
  const diagnostics: Diagnostic[] = [];
  const c4 = await compileLikeC4(l.structure);
  diagnostics.push(...c4.diagnostics);
  if (c4.kind === "failed") return { diagnostics, structure: null, scope: { kind: "all" } as const, project: null, contract: null, structureJson: null, vdmFiles: [] as string[] };
  const s = c4.structure;
  const scope = resolveScope(s, scopeId === "none" ? null : scopeId);
  const structureJson = generateStructure(s);
  const vdmFiles = listFiles(l.contract, ".vdmsl");
  const fileOwner = new Map(contractElements(s).map((e) => [contractFileOf(e.fqn), e.fqn]));
  const owner = elementOfModule(s);
  const checked: ReadonlySet<string> | null =
    scopeId === "none" ? new Set() : scope.kind === "view" ? new Set([...owner].filter(([, fqn]) => scope.nodes.has(fqn)).map(([m]) => m)) : null;
  const vdm = scope.kind === "unknown" ? null : await compileVdm(vdmFiles, (f) => {
    const fqn = fileOwner.get(basename(f));
    return fqn ? element(fqn) : global;
  }, checked);
  if (vdm) diagnostics.push(...vdm.diagnostics);
  const project: VdmProject | null = vdm?.kind === "ok" ? vdm.project : null;
  let contract: ContractGen | null = null;
  if (project) {
    contract = generateContract(project, new Set(owner.keys()), (m) => (owner.has(m) ? element(owner.get(m)!) : global));
    diagnostics.push(...contract.diagnostics);
  }
  return { diagnostics, structure: s, scope, project, contract, structureJson, vdmFiles };
}

async function gen(l: Layout): Promise<number> {
  const f = await front(l, "none");
  const errors = f.diagnostics.filter((d) => d.severity === "error");
  for (const d of f.diagnostics) console.log(format(d));
  if (errors.length > 0 || !f.structureJson || !f.contract) {
    console.log(`\n未生成：${errors.length} 个错误`);
    return 1;
  }
  mkdirSync(l.gen, { recursive: true });
  writeFileSync(join(l.gen, "structure.json"), f.structureJson);
  writeFileSync(join(l.gen, "contract.qnt"), f.contract.text);
  console.log(`已生成 ${join(l.gen, "structure.json")} 与 ${join(l.gen, "contract.qnt")}`);
  return 0;
}

function freshness(l: Layout, name: string, expected: string): Diagnostic[] {
  const path = join(l.gen, name);
  const actual = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (actual === expected) return [];
  return [diag("gen.fresh", global, { file: path, line: 1, col: 1 }, actual === null ? `缺少 .gen/${name}；运行 ssot gen` : `.gen/${name} 与重新生成的结果不一致（被手改或上游已变）；运行 ssot gen`)];
}

interface CheckOptions {
  readonly scope: string | null;
  readonly samples: number;
  readonly steps: number;
  readonly seed: string;
  readonly deadlineMs: number;
}

interface CheckRun {
  readonly kind: "ran";
  readonly structure: Structure | null;
  readonly scope: Scope;
  readonly diagnostics: readonly Diagnostic[];
  readonly behavior: readonly QuintModule[];
  /** 模拟、覆盖目标与回放产生的诊断 → 产生它的可运行模块。 */
  readonly behaviorOf: ReadonlyMap<Diagnostic, string>;
  readonly outcomes: readonly BehaviorOutcomes[];
  readonly info: readonly string[];
  readonly stage: string;
}

async function runCheck(l: Layout, o: CheckOptions): Promise<CheckRun | { readonly kind: "unknown"; readonly id: string }> {
  const f = await front(l, o.scope);
  const scope = f.scope;
  if (scope.kind === "unknown") return { kind: "unknown", id: scope.id };
  const ds: Diagnostic[] = [...f.diagnostics];
  const info: string[] = [];
  const s: Structure | null = f.structure;
  if (s) {
    ds.push(...structureRules(s));
    ds.push(...freshness(l, "structure.json", f.structureJson!));
    ds.push(...moduleRules(s, f.vdmFiles, f.project));
    if (f.project) ds.push(...importRules(s, f.project));
    if (f.project) {
      const po = obligationRules(s, f.project);
      ds.push(...po.diagnostics);
      info.push(po.summary);
    }
    if (f.project) ds.push(...hintRules(s, f.project));
    ds.push(...reviewDiagnostics(s));
  }

  // Quint：在临时目录里对“新生成的” contract.qnt 编译行为文件，使 VDM 的改动立刻体现为 Quint 的编译错误。
  const behavior: QuintModule[] = [];
  const stage = mkdtempSync("/tmp/ssot-check-");
  const work = join(stage, "work");
  mkdirSync(join(stage, "behavior"), { recursive: true });
  mkdirSync(join(stage, ".gen"), { recursive: true });
  mkdirSync(work);
  const mapFile = (p: string): string => {
    const n = p.startsWith("/private/tmp/") ? p.slice("/private".length) : p;
    if (n.startsWith(join(stage, "behavior"))) return join(l.behavior, n.slice(join(stage, "behavior").length + 1));
    if (n.startsWith(join(stage, ".gen"))) return join(l.gen, n.slice(join(stage, ".gen").length + 1));
    return n;
  };
  if (s && f.contract) {
    ds.push(...freshness(l, "contract.qnt", f.contract.text));
    const staged = join(stage, ".gen", "contract.qnt");
    writeFileSync(staged, f.contract.text);
    const owner = elementOfModule(s);
    for (const e of await typecheckFile(staged, work, "contract")) {
      const line = e.locs[0] ? e.locs[0].start.line + 1 : 0;
      const origin = f.contract.origins.get(line);
      ds.push(
        origin
          ? diag("gen.names", owner.has(origin.module) ? element(owner.get(origin.module)!) : global, origin.at, `生成的 Quint 不被 Quint 接受（多为名字与 Quint 保留字、内建名或其他生成名冲突）：${e.explanation.trim()}`)
          : diag("compile.quint", global, e.locs[0] ? { file: join(l.gen, "contract.qnt"), line, col: e.locs[0].start.col + 1 } : null, e.explanation.trim()),
      );
    }
    const generated = new Set(["contract", ...f.contract.callModules, ...owner.keys()]);
    for (const file of listFiles(l.behavior, ".qnt")) {
      const target = join(stage, "behavior", basename(file));
      copyFileSync(file, target);
      const r = await compileBehavior(target, basename(file, ".qnt"), generated, work, mapFile, {
        origins: f.contract.origins,
        subjectOf: (m: string) => (owner.has(m) ? element(owner.get(m)!) : global),
      });
      ds.push(...r.diagnostics);
      if (r.kind === "ok") behavior.push(r.module);
    }
    if (f.project) {
      ds.push(...behaviorNameRules(s, f.project, behavior));
      ds.push(...callRules(behavior, f.contract.callModules));
      // 对暂存的行为文件重新类型检查，使它读到的是本次新生成的 contract.qnt，而不是磁盘上可能过期的 .gen。
      const staged = behavior.map((q) => ({ ...q, file: join(stage, "behavior", `${q.name}.qnt`) }));
      ds.push(...(await initialRules(s, f.project, staged)));
    }
  }
  if (s) ds.push(...vocabRules(s, f.project, behavior));

  // 行为验证与回放只在前面没有错误时进行：类型不对时模拟没有意义。
  const blocking = ds.some((d) => d.severity === "error");
  const owner = s ? elementOfModule(s) : new Map<string, string>();
  const callModules = scope.kind === "all" ? null : new Set(
    (f.contract?.callModules ?? []).filter((m) => {
      const element = owner.get(m);
      return element !== undefined && scope.nodes.has(element);
    }),
  );
  const behaviorOf = new Map<Diagnostic, string>();
  const outcomes: BehaviorOutcomes[] = [];
  const attribute = (q: QuintModule, list: readonly Diagnostic[]): void => {
    for (const d of list) behaviorOf.set(d, q.name);
    ds.push(...list);
  };
  if (callModules !== null && callModules.size === 0) {
    info.push("作用域没有生成的 Call 模块：跳过模拟、覆盖目标与回放");
  } else if (s && f.project && f.contract && !blocking) {
    for (const q of behavior.filter(isRunnable)) {
      // 切片闭包：不引用作用域内任何生成模块（Call 变体、构造子或状态类型）的可运行模块，不模拟也不回放。
      if (callModules !== null && !q.decls.some((d) => d.modules.some((m) => callModules.has(m)) || (d.varType !== null && callModules.has(d.varType.module)))) {
        info.push(`行为 ${q.name}：不引用作用域内的生成模块，跳过模拟、覆盖目标与回放`);
        continue;
      }
      const callVar = q.decls.find((d) => d.isCallVar)?.name ?? null;
      const file = join(stage, "behavior", `${q.name}.qnt`);
      const t0 = performance.now();
      const run = await runBehavior(file, q.name, callVar, work, o, mapFile, (mods) => behaviorSubject(s, mods));
      const simMs = Math.round(performance.now() - t0);
      attribute(q, run.diagnostics);
      const cover = await coverWitnesses(file, q, work, { samples: o.samples * 10, steps: o.steps, seed: o.seed, deadlineMs: o.deadlineMs, callModules });
      attribute(q, cover.diagnostics);
      const r = await replay({ structure: s, project: f.project, vdmFiles: f.vdmFiles, module: q, callVar, traces: [...run.traces, ...cover.traces], callModules });
      attribute(q, r.diagnostics);
      outcomes.push({ module: q.name, outcomes: r.outcomes, replayed: r.replayed });
      info.push(`行为 ${q.name}：模拟 ${run.traces.length} 条轨迹（${simMs}ms）`);
      info.push(`行为 ${q.name}：覆盖目标 ${[...cover.reached].map(([w, x]) => `${w}（定向模拟，${x.states} 个状态，${x.ms}ms）`).join("，") || "（无）"}`);
      info.push(`行为 ${q.name}：回放 ${[...r.replayed].map(([k, n]) => `${k}×${n}`).join("，") || "（无）"}`);
      for (const [op, counts] of r.outcomes) info.push(`行为 ${q.name}：结局 ${op}：${[...counts].map(([v, n]) => `${v}×${n}`).join("，")}`);
    }
  }
  return { kind: "ran", structure: s, scope, diagnostics: ds, behavior, behaviorOf, outcomes, info, stage };
}

function exitOf(ds: readonly Diagnostic[]): 0 | 1 | 3 {
  return ds.some((d) => d.severity === "error") ? 1 : ds.some((d) => d.rule === "resource.deadline") ? 3 : 0;
}

async function check(l: Layout, o: CheckOptions, base: string | null): Promise<number> {
  const run = await runCheck(l, o);
  if (run.kind === "unknown") {
    console.log(`没有 id 为 ${run.id} 的元素视图`);
    return 2;
  }
  const scope = run.scope;
  const { shown, hidden } = partition(scope, run.diagnostics);
  for (const d of shown) console.log(format(d));
  for (const i of run.info) console.log(`info ${i}`);
  if (base !== null && scope.kind === "view" && run.structure) {
    const r = await baseChanges(l.root, base, scope, run.structure, run.behavior, elementOfModule(run.structure));
    if (r.kind === "failed") console.log(`base 无法列出 ${base} 之后的改动：${r.message}`);
    else if (r.changes.length === 0) console.log(`base ${base} 之后没有落在作用域 ${scope.id} 之外的改动`);
    else
      for (const c of r.changes)
        console.log(`base 作用域 ${scope.id} 之外的改动：${c.path}：${c.what} → ${c.owner ? `交给 ${c.owner.skill}（scope ${c.owner.scope}）` : "不属于任何切片"}`);
  }
  const errors = shown.filter((d) => d.severity === "error").length;
  const warnings = shown.filter((d) => d.severity === "warning").length;
  const exit = exitOf(shown);
  const where = scope.kind === "view" ? `作用域 ${scope.id}（${[...scope.nodes].sort().join(", ")}）` : "全量";
  console.log(`\n${exit === 1 ? "FAIL" : exit === 3 ? "INCOMPLETE" : "PASS"} ${where}：${errors} 个错误，${warnings} 个警告${hidden > 0 ? `；作用域外 ${hidden} 条未列出` : ""}；临时目录 ${run.stage}`);
  return exit;
}

async function status(l: Layout, o: CheckOptions): Promise<number> {
  const run = await runCheck(l, o);
  if (run.kind === "unknown") throw new Error("全量检查不应解析出未知视图");
  const exit = exitOf(run.diagnostics);
  const requirementsFile = join(l.root, "requirements.md");
  const result = deriveStatus({
    root: l.root,
    structure: run.structure,
    diagnostics: run.diagnostics,
    behaviorOf: run.behaviorOf,
    behaviorModules: listFiles(l.behavior, ".qnt").map((f) => basename(f, ".qnt")),
    contractFiles: new Set(listFiles(l.contract, ".vdmsl").map((f) => basename(f))),
    requirements: existsSync(requirementsFile) ? requirementIds(readFileSync(requirementsFile, "utf8")) : [],
    outcomes: run.outcomes,
    exit,
  });
  switch (result.kind) {
    case "frontier":
      console.log(JSON.stringify({ skill: result.skill, scope: result.scope, reason: result.reason }));
      return 0;
    case "none":
      console.log("没有前沿：可派生的事实里没有待办（不说明需求已经兑现）");
      return 0;
    case "incomplete":
      console.log(`验证没有做完，不派生前沿：${result.reason}`);
      return 3;
  }
}

async function view(l: Layout, id: string): Promise<number> {
  const c4 = await compileLikeC4(l.structure);
  for (const d of c4.diagnostics) console.log(format(d));
  if (c4.kind === "failed") return 1;
  const p = reviewPacket(c4.structure, id);
  if (p === null) {
    console.log(`没有 id 为 ${id} 的元素视图`);
    return 2;
  }
  console.log(renderPacket(p));
  return 0;
}

function option(args: string[], name: string): string | null {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? null) : null;
}

const USAGE =
  "用法：ssot setup | gen <design> | check <design> [--scope <视图 id> [--base <rev>]] [--samples N] [--steps K] [--seed S] [--deadline 秒] | view <design> <视图 id> | eval <design> <module> <expression> [--bind name=<module>:<expr>:<typeModule>:<typeName>]... | status <design>";

async function main(argv: string[]): Promise<number> {
  const [cmd, dir, ...rest] = argv;
  if (cmd === "setup" && dir === undefined) return setup();
  if ((cmd !== "gen" && cmd !== "check" && cmd !== "eval" && cmd !== "view" && cmd !== "status") || !dir) {
    console.log(USAGE);
    return 2;
  }
  const l = layout(resolve(dir));
  const options: CheckOptions = {
    scope: option(rest, "--scope"),
    samples: Number(option(rest, "--samples") ?? "100"),
    steps: Number(option(rest, "--steps") ?? "30"),
    seed: option(rest, "--seed") ?? "20261103",
    deadlineMs: Number(option(rest, "--deadline") ?? "600") * 1000,
  };
  switch (cmd) {
    case "gen":
      return gen(l);
    case "view":
      return view(l, rest[0] ?? "");
    case "eval":
      return evalCommand(await front(l, "none"), rest);
    case "status":
      return status(l, { ...options, scope: null });
    case "check": {
      const base = option(rest, "--base");
      if (base !== null && options.scope === null) {
        console.log("--base 需要与 --scope 一起使用");
        return 2;
      }
      return check(l, options, base);
    }
  }
}

try {
  process.exit(await main(Bun.argv.slice(2)));
} catch (e) {
  if (!(e instanceof NotInstalled)) throw e;
  console.error(e.message);
  process.exit(2);
}
