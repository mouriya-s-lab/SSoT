// 所有阶段共用的诊断类型。规则与载体的对应在 RULES 里固定，诊断只能用这里列出的规则。

export const RULES = {
  "compile.c4": "likec4",
  "compile.vdm": "vdm",
  "compile.quint": "quint",
  "struct.kinds": "likec4",
  "struct.nesting": "likec4",
  "struct.layering": "likec4",
  "struct.views": "likec4",
  "struct.ids": "likec4",
  "vocab.slots": "likec4",
  "contract.module": "vdm",
  "contract.imports": "vdm", // 契约模块 import 成环，无法生成 Quint 模块。
  "contract.layering": "vdm", // 架构契约不得 import 业务契约。
  "contract.po": "vdm",
  "gen.unmappable": "vdm",
  "gen.names": "vdm",
  "gen.fresh": "gen",
  "behavior.names": "quint",
  "behavior.call": "quint",
  "behavior.run": "quint",
  "replay.pre": "quint",
  "replay.post": "quint",
  "replay.inv": "quint",
  "replay.eval": "quint",
  "replay.incomplete": "quint",
  "contract.body": "vdm", // 显式体出现局部可变变量、赋值或循环（error）
  "replay.frame": "quint", // ext rd 分量或未写分量在前后状态不相等（error）
  "replay.initial": "quint", // 轨迹初态不满足 VDM init（error）
  "behavior.init": "quint", // 状态变量没有用生成的 <模块>::initial 初始化（error）
  "resource.deadline": "quint", // 资源超时，验证未完成（独立退出码，不是设计拒绝）
  "replay.outcome": "quint", // 每个 Call 结果变体的出现次数与未覆盖变体（info）
  "hint.export": "vdm", // 没有 importer 的导出（info）
  "hint.single-business": "vdm", // 架构定义只被一个业务模块引用（info）
  "hint.struct-unread": "vdm", // struct 导出没有任何 importer 读字段（info）
  "hint.string": "vdm", // 导出类型里出现 seq of char（info）
  "hint.sampled": "vdm", // pre 或 inv 在采样中全真或全假（info）
  "hint.state-unused": "vdm", // 状态分量从未被写或从未被读（info）
  "hint.no-ext": "vdm", // 没有 ext 子句的操作（info）
} as const;

export type RuleId = keyof typeof RULES;
export type Carrier = (typeof RULES)[RuleId] ;
export type Severity = "error" | "warning" | "info";

/** 1 起算的行列。 */
export interface Position {
  readonly file: string;
  readonly line: number;
  readonly col: number;
}

export type Subject =
  | { readonly kind: "element"; readonly fqn: string }
  /** 行为诊断经 Call 所属模块反推到的一组元素。 */
  | { readonly kind: "elements"; readonly fqns: readonly string[] }
  | { readonly kind: "relation"; readonly source: string; readonly target: string }
  | { readonly kind: "view"; readonly id: string }
  | { readonly kind: "global" };

export interface Diagnostic {
  readonly rule: RuleId;
  readonly severity: Severity;
  readonly subject: Subject;
  readonly at: Position | null;
  readonly message: string;
}

export const element = (fqn: string): Subject => ({ kind: "element", fqn });
export const relation = (source: string, target: string): Subject => ({ kind: "relation", source, target });
export const view = (id: string): Subject => ({ kind: "view", id });
export const global: Subject = { kind: "global" };

export function diag(rule: RuleId, subject: Subject, at: Position | null, message: string, severity: Severity = "error"): Diagnostic {
  return { rule, severity, subject, at, message };
}

export function carrierOf(d: Diagnostic): Carrier {
  return RULES[d.rule];
}

function subjectText(s: Subject): string {
  switch (s.kind) {
    case "element":
      return `element ${s.fqn}`;
    case "elements":
      return `elements ${s.fqns.join(", ")}`;
    case "relation":
      return `relation ${s.source} -> ${s.target}`;
    case "view":
      return `view ${s.id}`;
    case "global":
      return "global";
    default:
      return assertNever(s);
  }
}

export function format(d: Diagnostic): string {
  const at = d.at ? `${d.at.file}:${d.at.line}:${d.at.col}` : "-";
  return `${d.severity} [${carrierOf(d)}/${d.rule}] ${subjectText(d.subject)} @ ${at}\n    ${d.message}`;
}

export function assertNever(x: never): never {
  throw new Error(`unhandled variant: ${JSON.stringify(x)}`);
}
