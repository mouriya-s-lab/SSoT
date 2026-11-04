// ssot status 的夹具：从真实源码声明附着与检查结果派生一项前沿。
import type { Edit } from "./mutations";

export interface StatusCase {
  readonly id: string;
  readonly description: string;
  readonly edits: readonly Edit[];
  readonly regen: boolean;
  readonly expect: { readonly skill: string; readonly scope: string } | "none";
}

const C4 = "structure/model.c4";
const FLOW = "behavior/flow.qnt";
const API = "contract/shop.api.vdmsl";
const LEDGER = "contract/shop.ledger.vdmsl";
const requirement: Edit = { file: "requirements.md", find: null, replace: "# 需求\n\n- REQ-1 订单金额被记账。\n" };
const free = { skill: "ssot-draft-requirement", scope: "REQ-1" } as const;
const missing: Edit = { file: C4, find: "  user = actor 'User'", replace: "  user = actor 'User'\n  audit = system 'Audit' {\n    #contract\n  }" };

export const statusCases: readonly StatusCase[] = [
  { id: "status-none", description: "base 的未覆盖结局只报 info，叶子元素无需标记：没有前沿", edits: [], regen: false, expect: "none" },
  {
    id: "status-error", description: "VDM error 先于没有附着的需求", regen: false,
    edits: [requirement, { file: LEDGER, find: "post entries = entries~ munion {o |-> amount};", replace: "post entries = entries~ munion {o |-> amountX};" }],
    expect: { skill: "ssot-write-contract", scope: "shop.ledger" },
  },
  {
    id: "status-error-carrier-order", description: "LikeC4 error 先于 VDM 和 Quint error", regen: false,
    edits: [
      { file: C4, find: "  tag contract\n", replace: "  element database\n  tag contract\n" },
      { file: LEDGER, find: "post entries = entries~ munion {o |-> amount};", replace: "post entries = entries~ munion {o |-> amountX};" },
      { file: FLOW, find: "  val safety =", replace: "  val invalid: int = false\n  val safety =" },
    ], expect: { skill: "ssot-write-level", scope: "index" },
  },
  { id: "status-req-before-contract", description: "未附着需求先于缺契约模块", edits: [requirement, missing], regen: true, expect: free },
  { id: "status-contract", description: "叶子 #contract 缺模块派 write-contract", edits: [missing], regen: true, expect: { skill: "ssot-write-contract", scope: "audit" } },
  { id: "status-req", description: "未附着需求派 draft-requirement", edits: [requirement], regen: false, expect: free },
  {
    id: "status-metadata-not-attachment", description: "结构 metadata 不作为需求声明附着", regen: true,
    edits: [requirement, { file: C4, find: "    description '下单与记账'", replace: "    description '下单与记账'\n    metadata { req 'REQ-1' }" }], expect: free,
  },
  ...([
    ["vdm-type", LEDGER, "  OrderId = token;", "  -- REQ-1\n  OrderId = token;"],
    ["vdm-state", LEDGER, "state Ledger of", "-- REQ-1\nstate Ledger of"],
    ["vdm-operation", LEDGER, "  record(o : OrderId, amount : nat)", "  -- REQ-1\n  record(o : OrderId, amount : nat)"],
    ["vdm-function", API, "\noperations\n", "\nfunctions\n  -- REQ-1\n  positive : nat -> bool\n  positive(n) == n > 0;\noperations\n"],
    ["vdm-value", API, "types\n", "values\n  -- REQ-1\n  limit : nat = 1;\ntypes\n"],
    ["vdm-module", API, "module shop_api", "-- REQ-1\nmodule shop_api"],
    ["quint-val", FLOW, "  val safety =", "  // REQ-1\n  val safety ="],
    ["quint-pureval", FLOW, "  pure val ORDERS =", "  // REQ-1\n  pure val ORDERS ="],
    ["quint-action", FLOW, "  action init =", "  // REQ-1\n  action init ="],
    ["quint-var", FLOW, "  var placed:", "  // REQ-1\n  var placed:"],
    ["quint-type", FLOW, "  pure val ORDERS =", "  // REQ-1\n  type Marker = int\n  pure val ORDERS ="],
    ["quint-def", FLOW, "  pure val ORDERS =", "  // REQ-1\n  def marked(n: int): int = n\n  pure val ORDERS ="],
    ["quint-puredef", FLOW, "  pure val ORDERS =", "  // REQ-1\n  pure def marked(n: int): int = n\n  pure val ORDERS ="],
    ["quint-temporal", FLOW, "  val safety =", "  // REQ-1\n  temporal marked = always(safety)\n  val safety ="],
    ["quint-module", FLOW, "module flow {", "// REQ-1\nmodule flow {"],
    ["vdm-comment-block", API, "  Reply =", "  -- REQ-1\n  -- 回复承诺\n  Reply ="],
    ["quint-comment-block", FLOW, "  val safety =", "  // REQ-1\n  // 安全承诺\n  val safety ="],
  ] as const).map(([id, file, find, replace]): StatusCase => ({ id: `status-attached-${id}`, description: `${id} 紧贴注释附着`, edits: [requirement, { file, find, replace }], regen: true, expect: "none" })),
  ...([
    ["vdm-blank", API, "  Reply =", "  -- REQ-1\n\n  Reply ="],
    ["quint-blank", FLOW, "  val safety =", "  // REQ-1\n\n  val safety ="],
    ["vdm-module-blank", API, "module shop_api", "-- REQ-1\n\nmodule shop_api"],
    ["quint-module-blank", FLOW, "module flow {", "// REQ-1\n\nmodule flow {"],
    ["vdm-inline", API, "  Reply = <Accepted> | <Rejected>;", "  Reply = <Accepted> | <Rejected>; -- REQ-1"],
    ["quint-inline", FLOW, "  val safety = ledger.closed.subseteq(ledger.entries.keys())", "  val safety = ledger.closed.subseteq(ledger.entries.keys()) // REQ-1"],
  ] as const).map(([id, file, find, replace]): StatusCase => ({ id: `status-unattached-${id}`, description: `${id} 不附着`, edits: [requirement, { file, find, replace }], regen: false, expect: free })),
  ...(["REQ-1–REQ-3", "REQ-1-3"] as const).map((range, n): StatusCase => ({
    id: `status-range-literals-${n}`, description: "范围只识别字面 REQ 编号，不展开缺省数字", regen: true,
    edits: [{ file: "requirements.md", find: null, replace: "- REQ-1 第一条。\n- REQ-2 第二条。\n- REQ-3 第三条。\n" }, { file: API, find: "  Reply =", replace: `  -- ${range}\n  Reply =` }],
    expect: { skill: "ssot-draft-requirement", scope: "REQ-2" },
  })),
  {
    id: "status-attached-both-carriers", description: "契约和行为分别附着的需求取并集", regen: false,
    edits: [
      { file: "requirements.md", find: null, replace: "- REQ-1 第一条。\n- REQ-2 第二条。\n" },
      { file: API, find: "  Reply =", replace: "  -- REQ-1\n  Reply =" },
      { file: FLOW, find: "  val safety =", replace: "  // REQ-2\n  val safety =" },
    ], expect: "none",
  },
];
