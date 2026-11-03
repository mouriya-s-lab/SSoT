// 行为验证阶段：对每个可运行模块用 quint run 模拟，检查 val safety；
// 再对每个覆盖目标（val witness*）做以它为终点的定向模拟。返回全部轨迹供回放阶段使用。
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { quint, readJson, errorDiagnostics, type QuintDecl, type QuintError, type QuintModule } from "./compile/quint";
import { type Diagnostic, type Subject, diag, global } from "./diag";
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
  const traces: ItfTrace[] = [];
  const diagnostics: Diagnostic[] = [];
  const reached = new Map<string, { states: number; ms: number }>();
  for (const witness of witnesses) {
    const w = witness.name;
    const at = witness.at;
    const bound = q.decls.find((d) => d.name === `maxSteps_${w}`);
    if (bound && (bound.kind !== "pureval" || bound.intLiteral === null || !Number.isSafeInteger(bound.intLiteral) || bound.intLiteral <= 0)) {
      diagnostics.push(diag("behavior.call", global, bound.at, `maxSteps_${w} 必须是 pure val 的正整数字面量`));
      continue;
    }
    const steps = bound?.intLiteral ?? opts.steps;
    const dir = join(outDir, `${q.name}.cover.${w}`);
    mkdirSync(dir, { recursive: true });
    const res = join(outDir, `${q.name}.cover.${w}.json`);
    const started = performance.now();
    const code = await quint(
      ["run", file, "--main", q.name, "--backend", "typescript", "--mbt", "--invariant", `not(${w})`, "--max-samples", String(opts.samples), "--max-steps", String(steps), "--seed", opts.seed, "--out-itf", join(dir, "t_{seq}.itf.json"), "--out", res],
      opts.deadlineMs,
    );
    const ms = Math.round(performance.now() - started);
    if (code === "timeout") {
      diagnostics.push(diag("resource.deadline", global, at, `${q.name} 的覆盖目标 ${w} 搜索超过截止 ${opts.deadlineMs / 1000}s 被终止；验证未完成（${ms}ms）`, "warning"));
      continue;
    }
    const out = await readJson<{ status?: string; errors: QuintError[] }>(res);
    const files = out.status === "violation" ? readdirSync(dir).filter((f) => f.endsWith(".itf.json")) : [];
    const found = (await Promise.all(files.map((f) => readTrace(join(dir, f))))).find((t) => t.status === "violation");
    if (found) {
      traces.push(found);
      reached.set(w, { states: found.states.length, ms });
    } else {
      diagnostics.push(diag("replay.incomplete", global, at, `验证不完整：覆盖目标 ${w} 在定向模拟 ${opts.samples} 次 × ${steps} 步内没有到达（${out.status}，${ms}ms）`));
    }
  }
  return { traces, diagnostics, reached };
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
  const code = await quint(
    [
      "run", file, "--main", module, "--backend", "typescript", "--mbt",
      "--invariant", "safety",
      "--max-samples", String(opts.samples), "--n-traces", String(opts.samples),
      "--max-steps", String(opts.steps), "--seed", opts.seed,
      "--out-itf", join(itfDir, "t_{seq}.itf.json"), "--out", res,
    ],
    opts.deadlineMs,
  );
  if (code === "timeout")
    return { module, traces: [], diagnostics: [diag("resource.deadline", global, null, `${module} 的模拟超过截止 ${opts.deadlineMs / 1000}s 被终止；验证未完成`, "warning")] };
  const out = await readJson<{ status?: string; errors: QuintError[] }>(res);
  const files = readdirSync(itfDir).filter((f) => f.endsWith(".itf.json")).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const traces = await Promise.all(files.map((f) => readTrace(join(itfDir, f))));
  switch (out.status) {
    case "ok":
      return { module, traces, diagnostics: [] };
    case "violation": {
      const bad = traces.find((t) => t.status === "violation") ?? traces.at(-1);
      const calls = callVar && bad ? bad.states.map((s) => callModuleOf(s.vars.get(callVar))).filter((m): m is string => m !== null) : [];
      const last = calls.at(-1);
      const steps = bad ? bad.states.map((s) => s.action ?? "?").join(" → ") : "（没有轨迹）";
      return {
        module,
        traces,
        diagnostics: [
          diag("behavior.run", last ? subjectOfModules([last]) : global, null, `${module} 的 safety 被违反；轨迹 ${bad?.file ?? "-"}：${steps}`),
        ],
      };
    }
    default:
      return {
        module,
        traces,
        diagnostics: out.errors.length > 0 ? errorDiagnostics(out.errors, mapFile).map((d) => ({ ...d, rule: "behavior.run" as const })) : [diag("behavior.run", global, null, `${module} 模拟失败，状态 ${out.status}`)],
      };
  }
}
