// 不透明导出的类型（exports 里没有 struct）在 Quint 里怎样表示、回放时怎样重建。
// 生成与回放共用这一个决定，保证 contract.qnt 的形状与回放的构造一致。
import type { VdmDefinition, VdmModule, VdmParam, VdmProject, VdmType } from "./compile/vdm";
import { assertNever } from "./diag";

type Fn = Extract<VdmDefinition, { category: "function" }>;
type TypeDef = Extract<VdmDefinition, { category: "type" }>;

export type OpaqueEncoding =
  /** (i) 公开构造入口：定义模块导出的函数 F 返回该类型；Quint 存 F 的入参，回放求 F(入参)。 */
  | { readonly kind: "constructor"; readonly module: string; readonly type: string; readonly fn: string; readonly params: readonly VdmParam[] }
  /** (ii) 在定义模块里按结构构造，再以该类型绑定进使用方模块的求值（不改 exports）。 */
  | { readonly kind: "structure"; readonly module: string; readonly type: string; readonly underlying: VdmType };

export function isOpaque(m: VdmModule, name: string): boolean {
  return !m.exports.some((e) => e.kind === "all") && m.exports.some((e) => e.kind === "type" && e.name === name && !e.struct);
}

function exportsFunction(m: VdmModule, name: string): boolean {
  return m.exports.some((e) => e.kind === "all" || (e.kind === "function" && e.name === name));
}

/** t 经命名类型展开后是否会到达 target。 */
function reaches(project: VdmProject, t: VdmType, target: string, seen: Set<string>): boolean {
  switch (t.kind) {
    case "ref": {
      const key = `${t.module}\`${t.name}`;
      if (key === target) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      const d = project.modules.find((m) => m.name === t.module)?.definitions.find((x): x is TypeDef => x.category === "type" && x.name === t.name);
      return d ? reaches(project, d.type, target, seen) : false;
    }
    case "record":
      return t.fields.some((f) => reaches(project, f.type, target, seen));
    case "seq":
    case "seq1":
    case "set":
    case "set1":
      return reaches(project, t.element, target, seen);
    case "map":
    case "inmap":
      return reaches(project, t.from, target, seen) || reaches(project, t.to, target, seen);
    case "optional":
      return reaches(project, t.type, target, seen);
    case "product":
    case "union":
      return t.types.some((x) => reaches(project, x, target, seen));
    case "function":
    case "operation":
      return [...t.params, t.result].some((x) => reaches(project, x, target, seen));
    case "nat":
    case "nat1":
    case "int":
    case "rat":
    case "real":
    case "bool":
    case "char":
    case "token":
    case "void":
    case "unknown":
    case "parameter":
    case "quote":
      return false;
    default:
      return assertNever(t);
  }
}

/** 先找 (i)，找不到用 (ii)。返回 null 表示它不是不透明类型。 */
export function opaqueEncoding(project: VdmProject, module: string, type: string): OpaqueEncoding | null {
  const m = project.modules.find((x) => x.name === module);
  if (!m || !isOpaque(m, type)) return null;
  const target = `${module}\`${type}`;
  const ctor = m.definitions.find(
    (d): d is Fn =>
      d.category === "function" &&
      exportsFunction(m, d.name) &&
      d.result.type.kind === "ref" &&
      d.result.type.module === module &&
      d.result.type.name === type &&
      d.params.every((p) => p.name !== null && !reaches(project, p.type, target, new Set())),
  );
  if (ctor) return { kind: "constructor", module, type, fn: ctor.name, params: ctor.params };
  const def = m.definitions.find((d): d is TypeDef => d.category === "type" && d.name === type);
  if (!def) throw new Error(`找不到类型定义 ${target}`);
  return { kind: "structure", module, type, underlying: def.type };
}
