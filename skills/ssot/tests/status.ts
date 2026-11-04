// ssot status 的夹具：从真实检查结果派生一项前沿。
import type { Edit } from "./mutations";

export interface StatusCase {
  readonly id: string;
  readonly description: string;
  readonly edits: readonly Edit[];
  readonly regen: boolean;
  readonly expect: { readonly skill: string; readonly scope: string } | "none";
}

const C4 = "structure/model.c4";
const LEDGER = "contract/shop.ledger.vdmsl";
const missing: Edit = { file: C4, find: "  user = actor 'User'", replace: "  user = actor 'User'\n  audit = system 'Audit' {\n    #contract\n  }" };

export const statusCases: readonly StatusCase[] = [
  { id: "status-none", description: "base 的未覆盖结局只报 info，叶子元素无需标记：没有前沿", edits: [], regen: false, expect: "none" },
  {
    id: "status-error", description: "VDM error 派出契约叶子", regen: false,
    edits: [{ file: LEDGER, find: "post entries = entries~ munion {o |-> amount};", replace: "post entries = entries~ munion {o |-> amountX};" }],
    expect: { skill: "ssot-write-contract", scope: "shop.ledger" },
  },
  {
    id: "status-error-carrier-order", description: "LikeC4 error 先于 VDM 和 Quint error", regen: false,
    edits: [
      { file: C4, find: "  tag contract\n", replace: "  element database\n  tag contract\n" },
      { file: LEDGER, find: "post entries = entries~ munion {o |-> amount};", replace: "post entries = entries~ munion {o |-> amountX};" },
      { file: "behavior/flow.qnt", find: "  val safety =", replace: "  val invalid: int = false\n  val safety =" },
    ], expect: { skill: "ssot-write-level", scope: "index" },
  },
  { id: "status-contract", description: "叶子 #contract 缺模块派 write-contract", edits: [missing], regen: true, expect: { skill: "ssot-write-contract", scope: "audit" } },
];
