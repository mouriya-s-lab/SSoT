// `ssot status`：从三种载体与 check 的诊断派生一项前沿。不保存任何过程状态。
// 先后：error 的切片（LikeC4 → VDM → Quint）→ 没有落点的 req → 未展开的非叶元素（浅层先）→ 缺少模块的 #contract 元素
// → 仍有未覆盖结局的行为模块。info 与 MAYBE 不进前沿。
import { basename, dirname, relative } from "node:path";
import type { C4Element, Structure } from "./compile/likec4";
import { type Diagnostic, assertNever, carrierOf } from "./diag";
import { contractElements, contractFileOf, hasTag } from "./model";
import { type Slice, behaviorSlice, contractSlice, elementSlice, levelScope, relationSlice, viewSlice } from "./slices";

export const TAG_LEAF = "leaf";

/** 一个可运行行为模块的回放结局计数（`模块\`操作` → 变体 → 次数）与回放到的调用（`模块\`操作` → 次数）。 */
export interface BehaviorOutcomes {
  readonly module: string;
  readonly outcomes: ReadonlyMap<string, ReadonlyMap<string, number>>;
  readonly replayed: ReadonlyMap<string, number>;
}

export interface StatusInput {
  readonly root: string;
  readonly structure: Structure | null;
  readonly diagnostics: readonly Diagnostic[];
  /** 模拟、覆盖目标与回放产生的诊断 → 产生它的可运行模块。 */
  readonly behaviorOf: ReadonlyMap<Diagnostic, string>;
  readonly behaviorModules: readonly string[];
  /** contract/ 下的文件名。 */
  readonly contractFiles: ReadonlySet<string>;
  /** requirements.md 里的需求 id，按出现次序。 */
  readonly requirements: readonly string[];
  readonly outcomes: readonly BehaviorOutcomes[];
  readonly exit: 0 | 1 | 3;
}

export type Status =
  | { readonly kind: "frontier"; readonly skill: Slice["skill"]; readonly scope: string; readonly reason: string }
  | { readonly kind: "none" }
  | { readonly kind: "incomplete"; readonly reason: string };

const byDepth = (a: C4Element, b: C4Element): number => a.fqn.split(".").length - b.fqn.split(".").length;

/** 没有模块文件的 #contract 元素：作为第四类前沿，不作为 error 的切片。 */
function missingContracts(s: Structure, files: ReadonlySet<string>): C4Element[] {
  return contractElements(s).filter((e) => !files.has(contractFileOf(e.fqn))).sort(byDepth);
}

function fileSlice(root: string, file: string | undefined, dir: string, ext: string): string | null {
  return file !== undefined && dirname(file) === `${root}/${dir}` && file.endsWith(ext) ? basename(file, ext) : null;
}

/** error 诊断 → 拥有它的写作叶子与 scope。tier 决定先后：LikeC4 0，VDM 1，Quint 2。 */
function errorSlice(i: StatusInput, d: Diagnostic): { readonly tier: number; readonly slice: Slice } {
  const s = i.structure;
  const file = d.at?.file;
  const carrier = carrierOf(d);
  switch (carrier) {
    case "likec4": {
      const subject = d.subject;
      if (s === null) return { tier: 0, slice: { skill: "ssot-write-level", scope: "index" } };
      switch (subject.kind) {
        case "element":
          // 视图缺失与兄弟依赖环是被诊断元素自己那一层的问题；其余是写下该元素的父层的问题。
          return {
            tier: 0,
            slice: d.rule === "struct.views" || d.rule === "struct.acyclic" ? { skill: "ssot-write-level", scope: levelScope(s, subject.fqn) } : elementSlice(s, subject.fqn),
          };
        case "elements":
          return { tier: 0, slice: elementSlice(s, subject.fqns[0]!) };
        case "relation":
          return { tier: 0, slice: relationSlice(s, subject.source, subject.target) };
        case "view":
          return { tier: 0, slice: viewSlice(s, subject.id) };
        case "global":
          return { tier: 0, slice: { skill: "ssot-write-level", scope: "index" } };
        default:
          return assertNever(subject);
      }
    }
    case "gen":
      // .gen 落后：structure.json 随 LikeC4，contract.qnt 随 VDM；改法都是 ssot gen。
      return file !== undefined && basename(file) === "structure.json"
        ? { tier: 0, slice: { skill: "ssot-write-level", scope: "index" } }
        : { tier: 1, slice: contractSlice("global") };
    case "vdm": {
      const subject = d.subject;
      switch (subject.kind) {
        case "element":
          return { tier: 1, slice: contractSlice(subject.fqn) };
        case "elements":
          return { tier: 1, slice: contractSlice(subject.fqns[0]!) };
        case "relation":
          return { tier: 1, slice: contractSlice(subject.source) };
        case "view":
        case "global":
          return { tier: 1, slice: contractSlice(fileSlice(i.root, file, "contract", ".vdmsl") ?? "global") };
        default:
          return assertNever(subject);
      }
    }
    case "quint": {
      const module = i.behaviorOf.get(d) ?? fileSlice(i.root, file, "behavior", ".qnt") ?? (i.behaviorModules.length === 1 ? i.behaviorModules[0]! : "global");
      return { tier: 2, slice: behaviorSlice(module) };
    }
    default:
      return assertNever(carrier);
  }
}

function firstLine(text: string): string {
  return text.split("\n")[0]!.trim();
}

/** 结局计数为 0 的变体，归给调用过该操作的第一个模块；没有模块调用过它时归给第一个可运行模块。 */
function uncovered(outcomes: readonly BehaviorOutcomes[]): { readonly module: string; readonly unseen: readonly string[] } | null {
  const total = new Map<string, Map<string, number>>();
  for (const b of outcomes)
    for (const [op, counts] of b.outcomes) {
      const t = total.get(op) ?? new Map<string, number>();
      for (const [v, n] of counts) t.set(v, (t.get(v) ?? 0) + n);
      total.set(op, t);
    }
  const ownerOf = (op: string): string => (outcomes.find((b) => (b.replayed.get(op) ?? 0) > 0) ?? outcomes[0]!).module;
  const gaps = [...total].flatMap(([op, counts]) => [...counts].filter(([, n]) => n === 0).map(([v]) => ({ op, v, module: ownerOf(op) })));
  const first = gaps[0];
  return first ? { module: first.module, unseen: gaps.filter((g) => g.module === first.module).map((g) => `${g.op} → ${g.v}`) } : null;
}

export function deriveStatus(i: StatusInput): Status {
  const s = i.structure;
  const missing = s ? missingContracts(s, i.contractFiles) : [];
  const missingSet = new Set(missing.map((e) => e.fqn));
  const errors = i.diagnostics
    .filter((d) => d.severity === "error")
    .filter((d) => !(d.rule === "contract.module" && d.subject.kind === "element" && missingSet.has(d.subject.fqn)))
    .map((d, n) => ({ d, n, ...errorSlice(i, d) }))
    .sort((a, b) => a.tier - b.tier || a.n - b.n);
  const first = errors[0];
  if (first) return { kind: "frontier", ...first.slice, reason: `${first.d.rule}: ${firstLine(first.d.message)}${first.d.at ? ` @ ${relative(i.root, first.d.at.file)}:${first.d.at.line}` : ""}` };
  if (i.exit === 3) {
    const deadlines = i.diagnostics.filter((d) => d.rule === "resource.deadline").map((d) => firstLine(d.message));
    return { kind: "incomplete", reason: `check 没有做完（resource.deadline）：${deadlines.join("；")}` };
  }
  if (s === null) return { kind: "none" };

  const anchored = new Set<string>();
  for (const e of s.elements.values()) {
    const req = e.metadata["req"];
    for (const id of req === undefined ? [] : typeof req === "string" ? [req] : req) anchored.add(id.trim());
  }
  const free = i.requirements.find((id) => !anchored.has(id));
  if (free !== undefined) return { kind: "frontier", skill: "ssot-draft-requirement", scope: free, reason: `requirements.md 的 ${free} 没有任何元素以 metadata req 引用它` };

  const unexpanded = [...s.elements.values()].filter((e) => e.kind !== "actor" && e.children.length === 0 && !hasTag(e, TAG_LEAF)).sort(byDepth)[0];
  if (unexpanded) return { kind: "frontier", skill: "ssot-write-level", scope: levelScope(s, unexpanded.fqn), reason: `元素 ${unexpanded.fqn} 没有子元素，也没有 #${TAG_LEAF}` };

  const contract = missing[0];
  if (contract) return { kind: "frontier", ...contractSlice(contract.fqn), reason: `元素 ${contract.fqn} 带 #contract，但没有 contract/${contractFileOf(contract.fqn)}` };

  const open = i.outcomes.length > 0 ? uncovered(i.outcomes) : null;
  if (open) return { kind: "frontier", ...behaviorSlice(open.module), reason: `回放中没有出现的结局：${open.unseen.join("，")}` };
  return { kind: "none" };
}

/** requirements.md：每条需求一个列表项，以 REQ-<编号> 开头。 */
export function requirementIds(text: string): string[] {
  const ids: string[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*(?:[-*+]|\d+[.)])\s+(?:\*\*)?(REQ-\d+)\b/.exec(line);
    if (m && !ids.includes(m[1]!)) ids.push(m[1]!);
  }
  return ids;
}
