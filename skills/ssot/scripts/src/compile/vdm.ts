// 编译阶段：VDM-SL。经 java/Vdm.java 调 VDMJ API，读它输出的结构化投影；不读 VDMJ 的人类可读输出。
import { join } from "node:path";
import { type Diagnostic, type Position, diag, global } from "../diag";
import { vdmClasspath } from "../install";

const HELPER = join(import.meta.dir, "..", "..", "java", "Vdm.java");

export type VdmType =
  | { readonly kind: "nat" | "nat1" | "int" | "rat" | "real" | "bool" | "char" | "token" | "void" | "unknown" }
  | { readonly kind: "parameter"; readonly name: string }
  | { readonly kind: "quote"; readonly value: string }
  | { readonly kind: "ref"; readonly module: string; readonly name: string }
  | { readonly kind: "record"; readonly module: string; readonly name: string; readonly fields: readonly VdmField[] }
  | { readonly kind: "seq" | "seq1" | "set" | "set1"; readonly element: VdmType }
  | { readonly kind: "map" | "inmap"; readonly from: VdmType; readonly to: VdmType }
  | { readonly kind: "optional"; readonly type: VdmType }
  | { readonly kind: "product" | "union"; readonly types: readonly VdmType[] }
  | { readonly kind: "function"; readonly partial: boolean; readonly params: readonly VdmType[]; readonly result: VdmType }
  | { readonly kind: "operation"; readonly params: readonly VdmType[]; readonly result: VdmType };

export interface VdmField {
  readonly name: string;
  readonly type: VdmType;
}

export interface VdmLocation {
  readonly file: string;
  readonly module: string | null;
  readonly line: number;
  readonly col: number;
}

export interface VdmParam {
  /** null：形参不是标识符模式。 */
  readonly name: string | null;
  readonly pattern: string;
  readonly type: VdmType;
}

/** VDMJ 值的结构化投影（由 Vdm.java 输出）。 */
export type VdmValue =
  | { readonly kind: "bool"; readonly v: boolean }
  | { readonly kind: "int"; readonly v: string }
  | { readonly kind: "char"; readonly v: string }
  | { readonly kind: "quote"; readonly v: string }
  | { readonly kind: "nil" }
  | { readonly kind: "token"; readonly v: VdmValue }
  | { readonly kind: "seq" | "set" | "tuple"; readonly items: readonly VdmValue[] }
  | { readonly kind: "map"; readonly entries: readonly (readonly [VdmValue, VdmValue])[] }
  | { readonly kind: "record"; readonly module: string; readonly name: string; readonly fields: readonly { readonly name: string; readonly value: VdmValue }[] };

/** 一个谓词（pre、post、inv）在 QuickCheck 采样上的取值计数；没有采样时为 null。 */
export interface VdmSample {
  readonly trueCount: number;
  readonly falseCount: number;
}

interface VdmCallable<Category extends "operation" | "function"> {
  readonly category: Category;
  readonly kind: "implicit" | "explicit";
  readonly name: string;
  readonly location: VdmLocation;
  readonly params: readonly VdmParam[];
  readonly result: { readonly name: string | null; readonly type: VdmType };
  readonly hasPre: boolean;
  readonly hasPost: boolean;
  /** 显式体里出现 dcl、赋值或循环时的位置；没有时为空。 */
  readonly imperative: readonly VdmLocation[];
  /** pre 的采样计数。 */
  readonly preSample: VdmSample | null;
  /** 只对操作：ext 子句（rd、wr 的状态分量名）；没有 ext 子句时为 null。函数恒为 null。 */
  readonly ext: { readonly rd: readonly string[]; readonly wr: readonly string[] } | null;
  /** 只对操作：体或 post 里读、写到的状态分量名（由 AST 求出，不解析文本）。函数恒为空。 */
  readonly reads: readonly string[];
  readonly writes: readonly string[];
}

export type VdmDefinition =
  | { readonly category: "type"; readonly name: string; readonly location: VdmLocation; readonly type: VdmType; readonly hasInvariant: boolean; readonly invSample: VdmSample | null }
  | {
      readonly category: "state";
      readonly name: string;
      readonly location: VdmLocation;
      readonly fields: readonly VdmField[];
      readonly hasInvariant: boolean;
      readonly hasInit: boolean;
      readonly invReads: readonly string[];
      /** init 执行后的状态值（VDMJ 求得）；求不出时为 null，并由 compile.vdm 报原因。 */
      readonly initial: VdmValue | null;
    }
  | { readonly category: "value"; readonly name: string | null; readonly names: readonly string[]; readonly location: VdmLocation; readonly type: VdmType }
  | VdmCallable<"operation">
  | VdmCallable<"function">;

export type VdmImportItem =
  | { readonly kind: "all"; readonly name: null; readonly renamed: null }
  | { readonly kind: "type" | "operation" | "function" | "value"; readonly name: string; readonly renamed: string | null };

export type VdmExport =
  | { readonly kind: "all" }
  | { readonly kind: "type"; readonly name: string; readonly struct: boolean }
  | { readonly kind: "operation" | "function" | "value"; readonly name: string };

export interface VdmModule {
  readonly name: string;
  readonly file: string;
  readonly location: VdmLocation;
  readonly imports: readonly { readonly module: string; readonly items: readonly VdmImportItem[] }[];
  readonly exports: readonly VdmExport[];
  readonly definitions: readonly VdmDefinition[];
  /** 本模块表达式里读到的记录字段，形如 `模块\`类型.字段`（由 AST 求出）。 */
  readonly fieldReads: readonly string[];
  /** 本模块引用到的其他模块定义，形如 `模块\`名字`。 */
  readonly references: readonly string[];
}

export type POStatus = "UNPROVED" | "PROVABLE" | "MAYBE" | "UNCHECKED" | "FAILED" | "TIMEOUT";

export interface ProofObligation {
  readonly number: number;
  readonly kind: string;
  readonly name: string;
  readonly module: string;
  readonly status: POStatus;
  readonly location: VdmLocation;
  readonly counterexample: Readonly<Record<string, string>>;
  readonly message: string | null;
  readonly qualifier: string | null;
  readonly checkable: boolean;
}

interface Message {
  readonly severity: "error" | "warning";
  readonly number: number;
  readonly message: string;
  readonly file: string;
  readonly line: number;
  readonly col: number;
}

interface ProjectOutput {
  readonly ok: boolean;
  readonly parseDiagnostics: readonly Message[];
  readonly typecheckDiagnostics: readonly Message[];
  readonly modules?: readonly VdmModule[];
  readonly proofObligations?: readonly ProofObligation[];
  readonly kind?: "error";
  readonly message?: string;
}

export interface VdmProject {
  readonly modules: readonly VdmModule[];
  readonly proofObligations: readonly ProofObligation[];
}

export type VdmResult =
  | { readonly kind: "ok"; readonly project: VdmProject; readonly diagnostics: readonly Diagnostic[] }
  | { readonly kind: "failed"; readonly diagnostics: readonly Diagnostic[] };

export interface EvalResult {
  readonly module: string;
  readonly expression: string;
  readonly kind: "value" | "error";
  readonly text?: string;
  readonly value?: { readonly kind: string; readonly value?: unknown };
  readonly message?: string;
  readonly number?: number;
  readonly location?: VdmLocation;
}

/** VDMJ 调用的截止：回放求值可能遇到不终止的递归，超时即失败而不是死等。 */
const DEADLINE_MS = 300_000;

async function helper<T>(args: readonly string[], stdin?: string): Promise<T> {
  const proc = Bun.spawn(["java", "-cp", vdmClasspath(), HELPER, ...args], {
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
    timeout: DEADLINE_MS,
    killSignal: "SIGKILL",
  });
  const [out, , code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (proc.signalCode !== null) throw new Error(`Vdm.java 超过截止 ${DEADLINE_MS / 1000}s 被终止`);
  if (code !== 0) throw new Error(`Vdm.java 以 ${code} 退出`);
  return JSON.parse(out) as T;
}

/**
 * 文件 → 元素归属由调用方给出；这里只把 VDMJ 消息变成诊断。
 * checked：只对这些模块做谓词采样与 QuickCheck（`--scope` 的切片闭包）；null 为全部模块。编译与投影总是全量。
 */
export async function compileVdm(files: readonly string[], subjectOf: (file: string) => Diagnostic["subject"], checked: ReadonlySet<string> | null): Promise<VdmResult> {
  if (files.length === 0) return { kind: "ok", project: { modules: [], proofObligations: [] }, diagnostics: [] };
  const out = await helper<ProjectOutput>(["project", ...(checked === null ? [] : [`--check=${[...checked].sort().join(",")}`]), ...files]);
  if (out.kind === "error") return { kind: "failed", diagnostics: [diag("compile.vdm", global, null, `VDMJ 投影失败：${out.message}`)] };
  const diagnostics = [...out.parseDiagnostics, ...out.typecheckDiagnostics].map((m) =>
    diag("compile.vdm", subjectOf(m.file), { file: m.file, line: m.line, col: m.col }, `VDMJ ${m.number}: ${m.message}`, m.severity),
  );
  if (!out.ok || !out.modules) return { kind: "failed", diagnostics };
  return { kind: "ok", project: { modules: out.modules, proofObligations: out.proofObligations ?? [] }, diagnostics };
}

/** 一个不透明值：在 module 里求 expr 得到，以 typeModule`typeName 的类型绑定为 name（见 java/Vdm.java 的 Bind）。 */
export interface EvalBind {
  readonly name: string;
  readonly module: string;
  readonly expr: string;
  readonly typeModule: string;
  readonly typeName: string;
}

export interface EvalItem {
  readonly module: string;
  readonly expr: string;
  readonly binds: readonly EvalBind[];
}

export async function evaluate(files: readonly string[], items: readonly EvalItem[]): Promise<readonly EvalResult[]> {
  if (items.length === 0) return [];
  const rows = items.map((i) => [i.module, i.expr, ...i.binds.flatMap((b) => [b.name, b.module, b.expr, b.typeModule, b.typeName])]);
  const out = await helper<{ ok: boolean; results?: EvalResult[]; message?: string }>(["eval", ...files], JSON.stringify(rows));
  if (!out.ok || !out.results) throw new Error(`VDMJ 求值未能开始：${out.message ?? "规格未通过类型检查"}`);
  return out.results;
}

export function vdmPosition(l: VdmLocation): Position {
  return { file: l.file, line: l.line, col: l.col };
}
