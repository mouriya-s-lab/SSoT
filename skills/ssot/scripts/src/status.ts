// `ssot status`：从三种载体与 check 的诊断派生一项前沿。不保存任何过程状态。
// 先后：error 的切片（LikeC4 → VDM → Quint）→ 缺少模块的 #contract 元素。
// info 与 MAYBE 不进前沿。
import { basename, dirname, relative } from "node:path";
import type { C4Element, Structure } from "./compile/likec4";
import { type Diagnostic, assertNever, carrierOf } from "./diag";
import { contractElements, contractFileOf } from "./model";
import { type Slice, behaviorSlice, contractSlice, elementSlice, levelScope, relationSlice, viewSlice } from "./slices";


export interface StatusInput {
  readonly root: string;
  readonly structure: Structure | null;
  readonly diagnostics: readonly Diagnostic[];
  /** 模拟、覆盖目标与回放产生的诊断 → 产生它的可运行模块。 */
  readonly behaviorOf: ReadonlyMap<Diagnostic, string>;
  readonly behaviorModules: readonly string[];
  /** contract/ 下的文件名。 */
  readonly contractFiles: ReadonlySet<string>;
  readonly exit: 0 | 1 | 3;
}

export type Status =
  | { readonly kind: "frontier"; readonly skill: Slice["skill"]; readonly scope: string; readonly reason: string }
  | { readonly kind: "none" }
  | { readonly kind: "incomplete"; readonly reason: string };

const byDepth = (a: C4Element, b: C4Element): number => a.fqn.split(".").length - b.fqn.split(".").length;

/** 没有模块文件的叶子 #contract 元素：独立前沿，不作为 error 的切片。 */
function missingContracts(s: Structure, files: ReadonlySet<string>): C4Element[] {
  return contractElements(s).filter((e) => e.children.length === 0 && !files.has(contractFileOf(e.fqn))).sort(byDepth);
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
          // 视图缺失是被诊断元素自己那一层的问题；其余是写下该元素的父层的问题。
          return {
            tier: 0,
            slice: d.rule === "struct.views" ? { skill: "ssot-write-level", scope: levelScope(s, subject.fqn) } : elementSlice(s, subject.fqn),
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


  const contract = missing[0];
  if (contract) return { kind: "frontier", ...contractSlice(contract.fqn), reason: `元素 ${contract.fqn} 带 #contract，但没有 contract/${contractFileOf(contract.fqn)}` };

  return { kind: "none" };
}

