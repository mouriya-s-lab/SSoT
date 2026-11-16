import type { POStatus, ProofObligation, VdmClause, VdmModule, VdmSample, VdmType, VdmValue } from "../compile/vdm";
import { assertNever } from "../diag";

/** 归到一个端口、状态或类型的一条证明义务。 */
export interface BoxObligation {
  readonly number: number;
  /** VDMJ 的义务种类，如 OP_SATISFIABILITY。 */
  readonly kind: string;
  readonly status: POStatus;
}

/** pre 或 post：文本与它在 QuickCheck 采样上的取值计数（没有采样时为 null）。 */
export interface BoxPredicate {
  readonly text: string;
  readonly sample: VdmSample | null;
}

export interface BoxPort {
  readonly name: string;
  readonly kind: "operation" | "function";
  readonly inputs: readonly string[];
  readonly output: string;
  readonly ext: { readonly rd: readonly string[]; readonly wr: readonly string[] } | null;
  readonly pre: BoxPredicate | null;
  readonly post: BoxPredicate | null;
  readonly obligations: readonly BoxObligation[];
}

export interface BoxState {
  readonly name: string;
  readonly fields: readonly string[];
  readonly inv: BoxPredicate | null;
  /** init 子句与它执行后的状态值；值为 null 时 VDMJ 求不出（compile.vdm 报原因）。没有 init 时整体为 null。 */
  readonly init: { readonly clause: string; readonly value: string | null } | null;
  readonly obligations: readonly BoxObligation[];
}

export interface BoxDiagram {
  readonly module: string;
  readonly element: string;
  readonly ports: readonly BoxPort[];
  readonly state: BoxState | null;
}

export function vdmTypeName(type: VdmType): string {
  switch (type.kind) {
    case "nat": case "nat1": case "int": case "rat": case "real": case "bool": case "char": case "token":
      return type.kind;
    case "void": return "()";
    case "unknown": return "?";
    case "parameter": return `@${type.name}`;
    case "quote": return `<${type.value}>`;
    case "ref": case "record": return type.name;
    case "seq": case "seq1": case "set": case "set1": return `${type.kind} of ${nestedType(type.element)}`;
    case "map": case "inmap": return `${type.kind} ${nestedType(type.from)} to ${nestedType(type.to)}`;
    case "optional": return `[${vdmTypeName(type.type)}]`;
    case "product": return type.types.map(nestedType).join(" * ");
    case "union": return type.types.map(vdmTypeName).join(" | ");
    case "function": return `(${type.params.map(vdmTypeName).join(" * ") || "()"} ${type.partial ? "->" : "+>"} ${vdmTypeName(type.result)})`;
    case "operation": return `(${type.params.map(vdmTypeName).join(" * ") || "()"} ==> ${vdmTypeName(type.result)})`;
    default: return assertNever(type);
  }
}

function nestedType(type: VdmType): string {
  const text = vdmTypeName(type);
  return type.kind === "union" || type.kind === "product" ? `(${text})` : text;
}

/** VDM 值的字面写法。 */
export function vdmValueText(value: VdmValue): string {
  switch (value.kind) {
    case "bool": return String(value.v);
    case "int": return value.v;
    case "char": return `'${value.v}'`;
    case "quote": return `<${value.v}>`;
    case "nil": return "nil";
    case "token": return `mk_token(${vdmValueText(value.v)})`;
    case "seq": return `[${value.items.map(vdmValueText).join(", ")}]`;
    case "set": return `{${value.items.map(vdmValueText).join(", ")}}`;
    case "tuple": return `mk_(${value.items.map(vdmValueText).join(", ")})`;
    case "map": return value.entries.length === 0 ? "{|->}" : `{${value.entries.map(([k, v]) => `${vdmValueText(k)} |-> ${vdmValueText(v)}`).join(", ")}}`;
    case "record": return `mk_${value.name}(${value.fields.map((f) => vdmValueText(f.value)).join(", ")})`;
    default: return assertNever(value);
  }
}

/** VDMJ 打印的表达式整体包在一对括号里时去掉这一对。 */
export function bareExpression(text: string): string {
  if (!text.startsWith("(")) return text;
  let depth = 0;
  for (const [index, char] of [...text].entries()) {
    if (char === "(") depth++;
    else if (char === ")") depth--;
    if (depth === 0) return index === text.length - 1 ? text.slice(1, -1) : text;
  }
  return text;
}

export const clauseText = (clause: VdmClause): string => `${clause.pattern} == ${bareExpression(clause.expression)}`;

/**
 * 一个定义的证明义务：VDMJ 把义务名写成 `定义名` 或 `定义名; 子定义名`（如 `reserve; pre_reserve`），按第一段归属。
 */
export function obligationsOf(obligations: readonly ProofObligation[], module: string, name: string): BoxObligation[] {
  return obligations
    .filter((o) => o.module === module && o.name.split(";")[0]!.trim() === name)
    .map((o) => ({ number: o.number, kind: o.kind, status: o.status }));
}

export function projectBox(module: VdmModule, obligations: readonly ProofObligation[]): BoxDiagram {
  const all = module.exports.some((entry) => entry.kind === "all");
  const exports = new Set(module.exports.flatMap((entry) => entry.kind === "operation" || entry.kind === "function" ? [`${entry.kind}:${entry.name}`] : []));
  const ports: BoxPort[] = [];
  for (const definition of module.definitions) {
    if ((definition.category === "operation" || definition.category === "function") && (all || exports.has(`${definition.category}:${definition.name}`))) {
      ports.push({
        name: definition.name, kind: definition.category,
        inputs: definition.params.map((param) => vdmTypeName(param.type)), output: vdmTypeName(definition.result.type), ext: definition.ext,
        pre: definition.pre === null ? null : { text: bareExpression(definition.pre), sample: definition.preSample },
        post: definition.post === null ? null : { text: bareExpression(definition.post), sample: definition.postSample },
        obligations: obligationsOf(obligations, module.name, definition.name),
      });
    }
  }
  const state = module.definitions.find((definition) => definition.category === "state");
  return {
    module: module.name,
    element: module.name.replaceAll("_", "."),
    ports,
    state: state?.category === "state"
      ? {
          name: state.name,
          fields: state.fields.map((field) => `${field.name}: ${vdmTypeName(field.type)}`),
          inv: state.inv === null ? null : { text: clauseText(state.inv), sample: state.invSample },
          init: state.init === null ? null : { clause: clauseText(state.init), value: state.initial === null ? null : vdmValueText(state.initial) },
          obligations: obligationsOf(obligations, module.name, state.name),
        }
      : null,
  };
}
