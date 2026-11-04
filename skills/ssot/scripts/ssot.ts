#!/usr/bin/env bun
// ssot 构建驱动：只负责编排各阶段（编译 → 生成 → 跨载体规则 → 行为验证 → 回放）并输出诊断。
//   ssot setup
//   ssot gen    <design>
//   ssot check  <design> [--scope <视图 id> [--base <rev>]] [--samples N] [--steps K] [--seed S] [--deadline 秒]
//   ssot render <design> [--out <dir>]
//   ssot eval   <design> <模块> <表达式> [--bind ...]
//   ssot status <design>
// check 的退出码：0 通过；1 有 error；3 没有 error 但有 resource.deadline（验证未完成）。
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { baseChanges } from "./src/base";
import { compileLikeC4, type Structure } from "./src/compile/likec4";
import { compileBehavior, type QuintModule, typecheckFile } from "./src/compile/quint";
import { checkObligations, compileVdm, type VdmProject } from "./src/compile/vdm";
import { type Diagnostic, assertNever, diag, element, format, global } from "./src/diag";
import { coverWitnesses, runBehavior } from "./src/behavior";
import { type ContractGen, generateContract } from "./src/gen/contract";
import { generateStructure } from "./src/gen/structure";
import { NotInstalled } from "./src/install";
import { contractElements, contractFileOf, elementOfModule } from "./src/model";
import { replay } from "./src/replay";
import { behaviorNameRules, behaviorSubject, callRules, contractLayeringRules, importCycleRules, isRunnable, moduleRules, vocabRules } from "./src/rules/cross";
import { structureRules } from "./src/rules/structure";
import { type Scope, partition, resolveScope } from "./src/scope";
import { obligationRules } from "./src/obligations";
import { evalCommand } from "./src/evalcmd";
import { hintRules } from "./src/rules/hints";
import { initialRules } from "./src/rules/init";
import { setup } from "./src/setup";
import { deriveStatus } from "./src/status";
import { render } from "./src/render";

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
 * scopeId：`--scope` 的视图；谓词采样与 QuickCheck 只对作用域节点的模块（checked）运行。"none"：不做采样（gen、eval）。
 */
async function front(l: Layout, scopeId: string | null | "none") {
  const diagnostics: Diagnostic[] = [];
  const c4 = await compileLikeC4(l.structure);
  diagnostics.push(...c4.diagnostics);
  if (c4.kind === "failed") return { diagnostics, structure: null, scope: { kind: "all" } as const, project: null, contract: null, structureJson: null, vdmFiles: [] as string[], checked: null };
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
    const subjectOf = (m: string) => owner.has(m) ? element(owner.get(m)!) : global;
    const cycles = importCycleRules(project, subjectOf);
    diagnostics.push(...cycles);
    if (cycles.length === 0) {
      contract = generateContract(project, new Set(owner.keys()), subjectOf);
      diagnostics.push(...contract.diagnostics);
    }
  }
  return { diagnostics, structure: s, scope, project, contract, structureJson, vdmFiles, checked };
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
  readonly project: VdmProject | null;
  readonly info: readonly string[];
  readonly stage: string;
}

/** 先挂上处理器的结果：并行启动、稍后才 await 的 promise 若在此期间失败，不成为未处理的拒绝；await 时照原样抛出。 */
type Settled<T> = { readonly kind: "value"; readonly value: T } | { readonly kind: "thrown"; readonly error: unknown };

function settle<T>(p: Promise<T>): Promise<Settled<T>> {
  return p.then((value): Settled<T> => ({ kind: "value", value }), (error: unknown): Settled<T> => ({ kind: "thrown", error }));
}

function unwrap<T>(s: Settled<T>): T {
  if (s.kind === "thrown") throw s.error;
  return s.value;
}

type ModuleVerification =
  | { readonly kind: "skipped"; readonly info: string }
  | { readonly kind: "verified"; readonly module: string; readonly diagnostics: readonly Diagnostic[]; readonly info: readonly string[] };

interface BehaviorInput {
  readonly structure: Structure;
  readonly project: VdmProject;
  readonly vdmFiles: readonly string[];
  readonly behavior: readonly QuintModule[];
  readonly stage: string;
  readonly work: string;
  readonly mapFile: (p: string) => string;
  readonly options: CheckOptions;
  readonly callModules: ReadonlySet<string> | null;
}

/**
 * 每个可运行模块：模拟与覆盖目标搜索，再用全部轨迹回放。模块之间、模拟与覆盖搜索之间都并发（并发数由 quint 的进程池限定）；
 * 结果按模块次序返回，诊断与 info 的次序不随完成先后变化。
 */
function verifyBehavior(x: BehaviorInput): Promise<readonly ModuleVerification[]> {
  const { structure: s, options: o, callModules } = x;
  return Promise.all(x.behavior.filter(isRunnable).map(async (q): Promise<ModuleVerification> => {
    // 切片闭包：不引用作用域内任何生成模块（Call 变体、构造子或状态类型）的可运行模块，不模拟也不回放。
    if (callModules !== null && !q.decls.some((d) => d.modules.some((m) => callModules.has(m)) || (d.varType !== null && callModules.has(d.varType.module))))
      return { kind: "skipped", info: `行为 ${q.name}：不引用作用域内的生成模块，跳过模拟、覆盖目标与回放` };
    const callVar = q.decls.find((d) => d.isCallVar)?.name ?? null;
    const file = join(x.stage, "behavior", `${q.name}.qnt`);
    const [run, cover] = await Promise.all([
      runBehavior(file, q.name, callVar, x.work, o, x.mapFile, (mods) => behaviorSubject(s, mods)),
      coverWitnesses(file, q, x.work, { samples: o.samples * 10, steps: o.steps, seed: o.seed, deadlineMs: o.deadlineMs, callModules }),
    ]);
    const r = await replay({ structure: s, project: x.project, vdmFiles: x.vdmFiles, module: q, callVar, traces: [...run.traces, ...cover.traces], callModules });
    return {
      kind: "verified",
      module: q.name,
      diagnostics: [...run.diagnostics, ...cover.diagnostics, ...r.diagnostics],
      info: [
        `行为 ${q.name}：模拟 ${run.traces.length} 条轨迹（${run.ms}ms）`,
        `行为 ${q.name}：覆盖目标 ${[...cover.reached].map(([w, c]) => `${w}（定向模拟，${c.states} 个状态，${c.ms}ms）`).join("，") || "（无）"}`,
        `行为 ${q.name}：回放 ${[...r.replayed].map(([k, n]) => `${k}×${n}`).join("，") || "（无）"}`,
        ...[...r.outcomes].map(([op, counts]) => `行为 ${q.name}：结局 ${op}：${[...counts].map(([v, n]) => `${v}×${n}`).join("，")}`),
      ],
    };
  }));
}

async function runCheck(l: Layout, o: CheckOptions): Promise<CheckRun | { readonly kind: "unknown"; readonly id: string }> {
  const f = await front(l, o.scope);
  const scope = f.scope;
  if (scope.kind === "unknown") return { kind: "unknown", id: scope.id };
  const ds: Diagnostic[] = [...f.diagnostics];
  const info: string[] = [];
  const s: Structure | null = f.structure;
  // 证明义务与 QuickCheck 单独一个进程，与下面的 Quint 编译、模拟与回放并行；诊断插回模块检查之后。
  const obligations = s && f.project ? settle(checkObligations(f.vdmFiles, f.checked)) : null;
  let obligationsAt = ds.length;
  if (s) {
    ds.push(...structureRules(s));
    ds.push(...freshness(l, "structure.json", f.structureJson!));
    ds.push(...moduleRules(s, f.vdmFiles, f.project));
    if (f.project) ds.push(...contractLayeringRules(s, f.project));
    obligationsAt = ds.length;
    if (f.project) ds.push(...hintRules(s, f.project));
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
    const contract = f.contract;
    ds.push(...freshness(l, "contract.qnt", contract.text));
    const staged = join(stage, ".gen", "contract.qnt");
    writeFileSync(staged, contract.text);
    const owner = elementOfModule(s);
    const generated = new Set(["contract", ...contract.callModules, ...owner.keys()]);
    const behaviorFiles = listFiles(l.behavior, ".qnt");
    for (const file of behaviorFiles) copyFileSync(file, join(stage, "behavior", basename(file)));
    // 生成的 contract.qnt 单独类型检查，与各行为文件的编译互不依赖（各自读暂存文件、写各自的 --out），并发运行；诊断按原次序加入。
    const [contractErrors, compiled] = await Promise.all([
      typecheckFile(staged, work, "contract"),
      Promise.all(behaviorFiles.map((file) =>
        compileBehavior(join(stage, "behavior", basename(file)), basename(file, ".qnt"), generated, work, mapFile, {
          origins: contract.origins,
          subjectOf: (m: string) => (owner.has(m) ? element(owner.get(m)!) : global),
        }))),
    ]);
    for (const e of contractErrors) {
      const line = e.locs[0] ? e.locs[0].start.line + 1 : 0;
      const origin = contract.origins.get(line);
      ds.push(
        origin
          ? diag("gen.names", owner.has(origin.module) ? element(owner.get(origin.module)!) : global, origin.at, `生成的 Quint 不被 Quint 接受（多为名字与 Quint 保留字、内建名或其他生成名冲突）：${e.explanation.trim()}`)
          : diag("compile.quint", global, e.locs[0] ? { file: join(l.gen, "contract.qnt"), line, col: e.locs[0].start.col + 1 } : null, e.explanation.trim()),
      );
    }
    for (const r of compiled) {
      ds.push(...r.diagnostics);
      if (r.kind === "ok") behavior.push(r.module);
    }
    if (f.project) {
      ds.push(...behaviorNameRules(s, f.project, behavior));
      ds.push(...callRules(behavior, contract.callModules));
      ds.push(...(await initialRules(s, f.project, behavior)));
    }
  }
  if (s) ds.push(...vocabRules(s, f.project, behavior));

  // 行为验证与回放只在前面没有错误时进行：类型不对时模拟没有意义。证明义务的 FAILED 也是前面的错误：
  // 模拟先与 QuickCheck 并行，QuickCheck 报出错误时丢弃模拟的全部结果，输出与等 QuickCheck 之后再决定是否模拟相同。
  const owner = s ? elementOfModule(s) : new Map<string, string>();
  const callModules = scope.kind === "all" ? null : new Set(
    (f.contract?.callModules ?? []).filter((m) => {
      const element = owner.get(m);
      return element !== undefined && scope.nodes.has(element);
    }),
  );
  let verification: Promise<Settled<readonly ModuleVerification[]>> | null = null;
  if (callModules !== null && callModules.size === 0) {
    info.push("作用域没有生成的 Call 模块：跳过模拟、覆盖目标与回放");
  } else if (s && f.project && f.contract && !ds.some((d) => d.severity === "error")) {
    verification = settle(verifyBehavior({ structure: s, project: f.project, vdmFiles: f.vdmFiles, behavior, stage, work, mapFile, options: o, callModules }));
  }
  if (obligations && s) {
    const po = unwrap(await obligations);
    switch (po.kind) {
      case "ok": {
        const r = obligationRules(s, po.obligations);
        ds.splice(obligationsAt, 0, ...r.diagnostics);
        info.unshift(r.summary);
        break;
      }
      case "failed":
        ds.splice(obligationsAt, 0, po.diagnostic);
        break;
      default:
        assertNever(po);
    }
  }
  const behaviorOf = new Map<Diagnostic, string>();
  if (verification) {
    const modules = unwrap(await verification);
    if (!ds.some((d) => d.severity === "error")) {
      for (const m of modules) {
        switch (m.kind) {
          case "skipped":
            info.push(m.info);
            break;
          case "verified":
            for (const d of m.diagnostics) behaviorOf.set(d, m.module);
            ds.push(...m.diagnostics);
            info.push(...m.info);
            break;
          default:
            assertNever(m);
        }
      }
    }
  }
  return { kind: "ran", structure: s, scope, diagnostics: ds, behavior, behaviorOf, project: f.project, info, stage };
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
  const result = deriveStatus({
    root: l.root,
    structure: run.structure,
    diagnostics: run.diagnostics,
    behaviorOf: run.behaviorOf,
    behaviorModules: listFiles(l.behavior, ".qnt").map((f) => basename(f, ".qnt")),
    contractFiles: new Set(listFiles(l.contract, ".vdmsl").map((f) => basename(f))),
    exit,
  });
  switch (result.kind) {
    case "frontier":
      console.log(JSON.stringify({ skill: result.skill, scope: result.scope, reason: result.reason }));
      return 0;
    case "none":
      console.log("没有前沿：可派生的事实里没有待办（不说明需求已经兑现，也不说明结构已经展开到足够深）");
      return 0;
    case "incomplete":
      console.log(`验证没有做完，不派生前沿：${result.reason}`);
      return 3;
  }
}


function option(args: string[], name: string): string | null {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? null) : null;
}

const USAGE =
  "用法：ssot setup | gen <design> | check <design> [--scope <视图 id> [--base <rev>]] [--samples N] [--steps K] [--seed S] [--deadline 秒] | render <design> [--out <dir>] | eval <design> <module> <expression> [--bind name=<module>:<expr>:<typeModule>:<typeName>]... | status <design>";

async function main(argv: string[]): Promise<number> {
  const [cmd, dir, ...rest] = argv;
  if (cmd === "setup" && dir === undefined) return setup();
  if ((cmd !== "gen" && cmd !== "check" && cmd !== "eval" && cmd !== "render" && cmd !== "status") || !dir) {
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
    case "render":
      return render(l.structure, option(rest, "--out"));
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
