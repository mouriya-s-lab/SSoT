// 行为验证阶段：对每个可运行模块用 quint run 模拟，检查 val safety；
// 再对每个覆盖目标（val witness*）做以它为终点的定向模拟。返回全部轨迹供回放阶段使用。
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { quint, readJson, errorDiagnostics, type QuintDecl, type QuintError, type QuintModule } from "./compile/quint";
import { type Diagnostic, type Subject, assertNever, diag, global } from "./diag";
import { type ItfTrace, type ItfValue, readTrace } from "./itf";

export interface CoverOptions {
  /** 每个覆盖目标以 samples 为搜索预算；deadlineMs 只作进程保险丝。 */
  readonly samples: number;
  readonly steps: number;
  readonly seed: string;
  readonly deadlineMs: number;
  readonly callModules: ReadonlySet<string> | null;
}

export interface Coverage {
  readonly traces: readonly ItfTrace[];
  readonly diagnostics: readonly Diagnostic[];
  /** 覆盖目标 → 到达它的轨迹长度（状态数）与耗时。 */
  readonly reached: ReadonlyMap<string, { readonly states: number; readonly ms: number }>;
}

/** Only compiler-resolved same-module references participate in scope dependency traversal. */
function relatedToScope(q: QuintModule, witness: QuintDecl, modules: ReadonlySet<string> | null): boolean {
  if (modules === null) return true;
  const decls = new Map(q.decls.map((d) => [d.name, d]));
  const seen = new Set<string>();
  const visit = (d: QuintDecl): boolean => {
    if (seen.has(d.name)) return false;
    seen.add(d.name);
    if (d.modules.some((m) => modules.has(m)) || (d.varType !== null && modules.has(d.varType.module))) return true;
    return d.references.some((name) => {
      const referenced = decls.get(name);
      return referenced !== undefined && visit(referenced);
    });
  };
  return visit(witness);
}

/**
 * 随机模拟不保证走到少见的交错（例如 close 之后才回复的 launch）。设计在 Quint 里用 `val witness*` 声明必须覆盖的情形；
 * 这里对每个目标做以它为终点的定向模拟（`--invariant not(witness)`，由 Quint 自己求值目标）：到达即得到一条轨迹交给回放，
 * 到达不了即“验证不完整”。不用 quint verify：Apalache 在这里会把不可达的目标报成可达（见 REPORT §7），
 * 而且在 B2 的契约上被 Quint 0.33.1 的展平器缺陷挡住。
 */
export async function coverWitnesses(file: string, q: QuintModule, outDir: string, opts: CoverOptions): Promise<Coverage> {
  const witnesses = q.decls.filter((d) => (d.kind === "val" || d.kind === "def") && d.name.startsWith("witness") && relatedToScope(q, d, opts.callModules));
  const plans = witnesses.map((witness) => planWitness(q, witness, opts.steps));
  // 各目标的搜索互不依赖（各自的进程、seed 与输出目录），并发运行，并发数由 quint 的进程池限定。进程池按调用先后放行，
  // 所以步数上限大的先启动：最慢的搜索不排在短搜索后面。结果仍按声明次序汇总，输出与回放次序不随启动或完成先后变化。
  const stepsOf = (p: WitnessPlan): number => (p.kind === "search" ? p.steps : 0);
  const searches = new Array<Promise<Search>>(plans.length);
  for (const i of plans.keys().toArray().sort((a, b) => stepsOf(plans[b]!) - stepsOf(plans[a]!))) {
    const plan = plans[i]!;
    switch (plan.kind) {
      case "search":
        searches[i] = searchWitness(file, q, plan, outDir, opts);
        break;
      case "invalid":
        searches[i] = Promise.resolve({ kind: "missed", diagnostic: plan.diagnostic });
        break;
      default:
        assertNever(plan);
    }
  }
  const traces: ItfTrace[] = [];
  const diagnostics: Diagnostic[] = [];
  const reached = new Map<string, { states: number; ms: number }>();
  for (const [i, s] of (await Promise.all(searches)).entries()) {
    switch (s.kind) {
      case "reached":
        traces.push(s.trace);
        reached.set(witnesses[i]!.name, { states: s.trace.states.length, ms: s.ms });
        break;
      case "missed":
        diagnostics.push(s.diagnostic);
        break;
      default:
        assertNever(s);
    }
  }
  return { traces, diagnostics, reached };
}

type WitnessPlan =
  | { readonly kind: "search"; readonly witness: QuintDecl; readonly steps: number }
  | { readonly kind: "invalid"; readonly diagnostic: Diagnostic };

/** 目标的步数上限：`pure val maxSteps_<目标>` 的正整数字面量，没有时用默认步数。 */
function planWitness(q: QuintModule, witness: QuintDecl, defaultSteps: number): WitnessPlan {
  const bound = q.decls.find((d) => d.name === `maxSteps_${witness.name}`);
  if (bound && (bound.kind !== "pureval" || bound.intLiteral === null || !Number.isSafeInteger(bound.intLiteral) || bound.intLiteral <= 0))
    return { kind: "invalid", diagnostic: diag("behavior.call", global, bound.at, `maxSteps_${witness.name} 必须是 pure val 的正整数字面量`) };
  return { kind: "search", witness, steps: bound?.intLiteral ?? defaultSteps };
}

type Search =
  | { readonly kind: "reached"; readonly trace: ItfTrace; readonly ms: number }
  | { readonly kind: "missed"; readonly diagnostic: Diagnostic };

async function searchWitness(file: string, q: QuintModule, plan: { readonly witness: QuintDecl; readonly steps: number }, outDir: string, opts: CoverOptions): Promise<Search> {
  const { witness, steps } = plan;
  const w = witness.name;
  const at = witness.at;
  const dir = join(outDir, `${q.name}.cover.${w}`);
  mkdirSync(dir, { recursive: true });
  const res = join(outDir, `${q.name}.cover.${w}.json`);
  const exit = await quint(
    ["run", file, "--main", q.name, "--backend", "rust", "--mbt", "--invariant", `not(${w})`, "--max-samples", String(opts.samples), "--max-steps", String(steps), "--seed", opts.seed, "--out-itf", join(dir, "t_{seq}.itf.json"), "--out", res],
    opts.deadlineMs,
  );
  const ms = exit.ms;
  if (exit.kind === "timeout")
    return { kind: "missed", diagnostic: diag("resource.deadline", global, at, `${q.name} 的覆盖目标 ${w} 搜索超过截止 ${opts.deadlineMs / 1000}s 被终止；验证未完成（${ms}ms）`, "warning") };
  const out = await readJson<{ status?: string; errors: QuintError[] }>(res);
  const files = out.status === "violation" ? readdirSync(dir).filter((f) => f.endsWith(".itf.json")) : [];
  const found = (await Promise.all(files.map((f) => readTrace(join(dir, f))))).find((t) => t.status === "violation");
  return found
    ? { kind: "reached", trace: found, ms }
    : { kind: "missed", diagnostic: diag("replay.incomplete", global, at, `验证不完整：覆盖目标 ${w} 在定向模拟 ${opts.samples} 次 × ${steps} 步内没有到达（${out.status}，${ms}ms）`) };
}

export interface RunOptions {
  readonly samples: number;
  readonly steps: number;
  readonly seed: string;
  /** quint run 的截止（毫秒）。 */
  readonly deadlineMs: number;
}

export interface BehaviorRun {
  readonly module: string;
  readonly traces: readonly ItfTrace[];
  readonly diagnostics: readonly Diagnostic[];
  /** 模拟进程本身的运行时间（不含排队）。 */
  readonly ms: number;
}

/** Call 值（contract::Call）里的模块名；NoCall 返回 null。 */
export function callModuleOf(v: ItfValue | undefined): string | null {
  if (!v || v.t !== "variant" || v.tag === "NoCall") return null;
  return v.tag;
}

export async function runBehavior(
  file: string,
  module: string,
  callVar: string | null,
  outDir: string,
  opts: RunOptions,
  mapFile: (f: string) => string,
  subjectOfModules: (mods: readonly string[]) => Subject,
): Promise<BehaviorRun> {
  const itfDir = join(outDir, `${module}.itf`);
  mkdirSync(itfDir, { recursive: true });
  const res = join(outDir, `${module}.run.json`);
  const exit = await quint(
    [
      "run", file, "--main", module, "--backend", "rust", "--mbt",
      "--invariant", "safety",
      "--max-samples", String(opts.samples), "--n-traces", String(opts.samples),
      "--max-steps", String(opts.steps), "--seed", opts.seed,
      "--out-itf", join(itfDir, "t_{seq}.itf.json"), "--out", res,
    ],
    opts.deadlineMs,
  );
  const ms = exit.ms;
  if (exit.kind === "timeout")
    return { module, traces: [], ms, diagnostics: [diag("resource.deadline", global, null, `${module} 的模拟超过截止 ${opts.deadlineMs / 1000}s 被终止；验证未完成`, "warning")] };
  const out = await readJson<{ status?: string; errors: QuintError[] }>(res);
  const files = readdirSync(itfDir).filter((f) => f.endsWith(".itf.json")).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const traces = await Promise.all(files.map((f) => readTrace(join(itfDir, f))));
  switch (out.status) {
    case "ok":
      return { module, traces, ms, diagnostics: [] };
    case "violation": {
      const bad = traces.find((t) => t.status === "violation") ?? traces.at(-1);
      const calls = callVar && bad ? bad.states.map((s) => callModuleOf(s.vars.get(callVar))).filter((m): m is string => m !== null) : [];
      const last = calls.at(-1);
      const steps = bad ? bad.states.map((s) => s.action ?? "?").join(" → ") : "（没有轨迹）";
      return {
        module,
        traces,
        ms,
        diagnostics: [
          diag("behavior.run", last ? subjectOfModules([last]) : global, null, `${module} 的 safety 被违反；轨迹 ${bad?.file ?? "-"}：${steps}`),
        ],
      };
    }
    default:
      return {
        module,
        traces,
        ms,
        diagnostics: out.errors.length > 0 ? errorDiagnostics(out.errors, mapFile).map((d) => ({ ...d, rule: "behavior.run" as const })) : [diag("behavior.run", global, null, `${module} 模拟失败，状态 ${out.status}`)],
      };
  }
}
