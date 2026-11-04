#!/usr/bin/env bun
// 夹具：
// - 突变：对 base 的副本逐个施加 mutations.ts 与 cases/*.ts 里的一处违反，运行 check，断言期望的规则出现在诊断里且 check 按期望退出；
// - status：对 base 的副本施加 status.ts 的改动，运行 status，断言报出的前沿；
// - VDMJ 非公开 API：vdmj-api.ts 逐项探测 Vdm.java 依赖的 VDMJ 内部接口，失败时指出是哪一个。
// 每个夹具的完整输出写进 /tmp 下的结果目录。
//   bun tests/run.ts [--jobs N] [id ...]
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Edit, type Mutation, mutations as core } from "./mutations";
import { type StatusCase, statusCases } from "./status";
import { vdmjApiChecks } from "./vdmj-api";
import { cases as contractBody } from "./cases/contract-body";
import { mutations as replay } from "./cases/replay";
import { mutations as initial } from "./cases/initial";
import { mutations as attribution } from "./cases/attribution";
import { mutations as deadline } from "./cases/deadline";
import { mutations as hints } from "./cases/hints";
import { mutations as structure, verifyStructureProjections } from "./cases/structure";
import { verifyRenderProjections } from "./cases/render";

const HERE = import.meta.dir;
const SSOT = join(HERE, "..", "scripts", "ssot.ts");
const RESULTS = mkdtempSync("/tmp/ssot-fixtures-");

const all: readonly Mutation[] = [...core, ...contractBody, ...replay, ...initial, ...attribution, ...deadline, ...hints, ...structure];

async function run(args: readonly string[]): Promise<{ code: number; out: string }> {
  const p = Bun.spawn(["bun", SSOT, ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out: out + err };
}

/** 期望规则出现的那一行：error 级规则看 error 行；info/warning 级规则（hint.*、replay.outcome、resource.deadline）看任一级别。 */
function hitLine(out: string, rule: string): string | undefined {
  return out.split("\n").find((l) => /^(error|warning|info) \[/.test(l) && l.includes(`/${rule}]`));
}

/** 在 base 的副本上施加改动；失败时返回原因。 */
async function copyWith(id: string, edits: readonly Edit[], regen: boolean): Promise<{ readonly dir: string } | { readonly failure: string }> {
  const dir = mkdtempSync(`/tmp/ssot-fixture-${id}-`);
  cpSync(join(HERE, "base"), dir, { recursive: true });
  for (const e of edits) {
    const path = join(dir, e.file);
    const text = e.find === null ? "" : readFileSync(path, "utf8");
    if (e.find !== null && !text.includes(e.find)) return { failure: `改动无法施加：${e.file} 中找不到 ${JSON.stringify(e.find)}` };
    writeFileSync(path, e.find === null ? e.replace : text.replace(e.find, e.replace));
  }
  if (regen) await run(["gen", dir]);
  return { dir };
}

interface Outcome {
  readonly id: string;
  readonly expect: string;
  readonly ok: boolean;
  readonly line: string;
}

async function mutation(m: Mutation): Promise<Outcome> {
  const copy = await copyWith(m.id, m.edits, m.regen);
  if ("failure" in copy) return { id: m.id, expect: m.expect, ok: false, line: copy.failure };
  const r = await run(["check", copy.dir, ...(m.args ?? [])]);
  writeFileSync(join(RESULTS, `${m.id}.txt`), `# ${m.id}：${m.description}\n# 期望规则 ${m.expect}\n$ ssot check <copy> ${(m.args ?? []).join(" ")}\n${r.out}`);
  const hit = m.expect === "-" ? undefined : hitLine(r.out, m.expect);
  const errorHit = hit?.startsWith("error") === true;
  const missing = (m.outputIncludes ?? []).filter((text) => !r.out.includes(text));
  const unexpected = (m.outputExcludes ?? []).filter((text) => r.out.includes(text));
  // expectPass：退出码为 0，期望规则若出现只能是 info 或 warning。否则：退出码非 0（1 表示设计错误，3 表示资源超时），且期望规则出现。
  const verdict = m.expectPass ? r.code === 0 && !errorHit : r.code !== 0 && hit !== undefined;
  const ok = verdict && missing.length === 0 && unexpected.length === 0;
  const detail = missing.length > 0 || unexpected.length > 0 ? `输出断言失败：缺少 ${JSON.stringify(missing)}；不应出现 ${JSON.stringify(unexpected)}` : null;
  return { id: m.id, expect: m.expect, ok, line: detail ?? hit ?? r.out.trim().split("\n").at(-1) ?? "" };
}

async function status(c: StatusCase): Promise<Outcome> {
  const expect = c.expect === "none" ? "没有前沿" : `${c.expect.skill} ${c.expect.scope}`;
  const copy = await copyWith(c.id, c.edits, c.regen);
  if ("failure" in copy) return { id: c.id, expect, ok: false, line: copy.failure };
  const r = await run(["status", copy.dir]);
  writeFileSync(join(RESULTS, `${c.id}.txt`), `# ${c.id}：${c.description}\n# 期望 ${expect}\n$ ssot status <copy>\n${r.out}`);
  const lines = r.out.trim().split("\n");
  const json = lines.find((l) => l.startsWith("{"));
  const found = json ? (JSON.parse(json) as { skill: string; scope: string }) : null;
  const ok =
    r.code === 0 &&
    (c.expect === "none" ? found === null && lines.some((l) => l.startsWith("没有前沿")) : found !== null && found.skill === c.expect.skill && found.scope === c.expect.scope);
  return { id: c.id, expect, ok, line: json ?? lines.at(-1) ?? "" };
}

const argv = Bun.argv.slice(2);
const jobsAt = argv.indexOf("--jobs");
const jobs = jobsAt >= 0 ? Math.max(1, Number(argv[jobsAt + 1])) : 4;
const only = new Set(argv.filter((a, i) => a !== "--jobs" && !(jobsAt >= 0 && i === jobsAt + 1)));
const tasks: { readonly id: string; readonly run: () => Promise<Outcome> }[] = [
  ...all.map((m) => ({ id: m.id, run: () => mutation(m) })),
  ...statusCases.map((c) => ({ id: c.id, run: () => status(c) })),
  {
    id: "structure-projections",
    run: async (): Promise<Outcome> => {
      const checks = verifyStructureProjections();
      return { id: "structure-projections", expect: "-", ok: true, line: `${checks} 项结构投影与渲染次序断言通过` };
    },
  },
  {
    id: "render-projections",
    run: async (): Promise<Outcome> => {
      const checks = await verifyRenderProjections();
      return { id: "render-projections", expect: "-", ok: true, line: `${checks} 项 String Diagram 投影断言通过` };
    },
  },
  {
    id: "vdmj-api",
    run: async (): Promise<Outcome> => {
      const checks = await vdmjApiChecks();
      writeFileSync(join(RESULTS, "vdmj-api.txt"), checks.map((c) => `${c.ok ? "ok  " : "FAIL"} ${c.id} ${c.line}`).join("\n"));
      const bad = checks.filter((c) => !c.ok);
      return { id: "vdmj-api", expect: "-", ok: checks.length > 0 && bad.length === 0, line: bad.length > 0 ? bad.map((c) => `${c.id}: ${c.line}`).join("；") : `${checks.length} 项 VDMJ 内部接口可用` };
    },
  },
];
const selected = tasks.filter((t) => only.size === 0 || only.has(t.id));
const dup = selected.map((t) => t.id).filter((id, i, a) => a.indexOf(id) !== i);
if (dup.length > 0) {
  console.log(`夹具 id 重复：${[...new Set(dup)].join(", ")}`);
  process.exit(2);
}

const results: Outcome[] = [];
let next = 0;
await Promise.all(
  Array.from({ length: Math.min(jobs, selected.length) }, async () => {
    while (next < selected.length) {
      const t = selected[next++]!;
      results.push(await t.run());
    }
  }),
);
const order = new Map(selected.map((t, i) => [t.id, i]));
results.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "ok  " : "FAIL"} ${r.id.padEnd(32)} ${r.expect.padEnd(28)} ${r.line.trim()}`);
}
console.log(`\n${selected.length - failed}/${selected.length} 个夹具符合期望；完整输出在 ${RESULTS}`);
process.exit(failed === 0 ? 0 : 1);
