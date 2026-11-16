// 读写表：契约模块的每个操作对每个状态分量是读、写还是不碰。
import type { VdmModule } from "../compile/vdm";

/** wr 含读；none：不碰。 */
export type Access = "rd" | "wr" | "none";

/**
 * 一行的依据：ext 是操作声明的 ext 子句；body 是没有 ext 子句的操作，由它的体与 post 里实际读写到的分量求出。
 */
export type AccessSource = "ext" | "body";

export interface AccessRow {
  readonly operation: string;
  readonly source: AccessSource;
  readonly exported: boolean;
  /** 与 AccessTable.fields 一一对应。 */
  readonly cells: readonly Access[];
}

export interface AccessTable {
  readonly module: string;
  readonly element: string;
  readonly state: string;
  readonly fields: readonly string[];
  readonly rows: readonly AccessRow[];
}

/** 没有状态的模块没有读写表，返回 null。 */
export function projectAccess(module: VdmModule): AccessTable | null {
  const state = module.definitions.find((d) => d.category === "state");
  if (state?.category !== "state") return null;
  const fields = state.fields.map((f) => f.name);
  const all = module.exports.some((e) => e.kind === "all");
  const exported = new Set(module.exports.flatMap((e) => e.kind === "operation" ? [e.name] : []));
  const rows: AccessRow[] = [];
  for (const d of module.definitions) {
    if (d.category !== "operation") continue;
    const [rd, wr, source]: readonly [readonly string[], readonly string[], AccessSource] = d.ext !== null ? [d.ext.rd, d.ext.wr, "ext"] : [d.reads, d.writes, "body"];
    rows.push({
      operation: d.name, source, exported: all || exported.has(d.name),
      cells: fields.map((f): Access => wr.includes(f) ? "wr" : rd.includes(f) ? "rd" : "none"),
    });
  }
  return { module: module.name, element: module.name.replaceAll("_", "."), state: state.name, fields, rows };
}
