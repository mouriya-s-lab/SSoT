// ssot status 的夹具：在 base 的副本上各造出一类前沿，断言 status 只报出期望的那一项。
import type { Edit } from "./mutations";

export interface StatusCase {
  readonly id: string;
  readonly description: string;
  readonly edits: readonly Edit[];
  readonly regen: boolean;
  /** "none"：没有前沿。 */
  readonly expect: { readonly skill: string; readonly scope: string } | "none";
}

const C4 = "structure/model.c4";
const FLOW = "behavior/flow.qnt";

/** 行为也产生 Rejected：place 的两个结局都在回放中出现，base 不再有未覆盖结局。 */
const rejected: readonly Edit[] = [
  {
    file: FLOW,
    find: "  action step = {",
    replace:
      "  action doReject(o: str, amt: int): bool = all {\n    not(o.in(placed)),\n    lastCall' = shop_api(A::place({ o: o, amount: amt, result: A::Reply_Rejected })),\n    ledger' = ledger,\n    placed' = placed,\n  }\n\n  action step = {",
  },
  { file: FLOW, find: "any { doPlace(o, amt), doRecord(o, amt), doClose(o) }", replace: "any { doPlace(o, amt), doRecord(o, amt), doClose(o), doReject(o, amt) }" },
];

export const statusCases: readonly StatusCase[] = [
  {
    id: "status-none",
    description: "两个结局都被回放覆盖、元素都已展开或带 #leaf、没有需求清单：没有前沿",
    edits: rejected,
    regen: false,
    expect: "none",
  },
  {
    id: "status-error",
    description: "ledger 的契约有类型错误，同时 REQ-1 没有落点：前沿是 ledger 的 write-contract（error 先于其他各类）",
    edits: [
      ...rejected,
      { file: "contract/shop.ledger.vdmsl", find: "post entries = entries~ munion {o |-> amount};", replace: "post entries = entries~ munion {o |-> amountX};" },
      { file: "requirements.md", find: null, replace: "# 需求\n\n- REQ-1 用户下单后，订单金额被记账。\n" },
    ],
    regen: false,
    expect: { skill: "ssot-write-contract", scope: "shop.ledger" },
  },
  {
    id: "status-req",
    description: "REQ-2 没有任何元素以 metadata req 引用：前沿是 REQ-2 的 draft-requirement（先于未展开的元素）",
    edits: [
      ...rejected,
      { file: "requirements.md", find: null, replace: "# 需求\n\n- REQ-1 用户下单后，订单金额被记账。\n- REQ-2 记过账的订单可以关账。\n" },
      { file: C4, find: "    description '下单与记账'\n", replace: "    description '下单与记账'\n    metadata {\n      req 'REQ-1'\n    }\n" },
      { file: C4, find: "      #contract #leaf\n      description '订单的记账事实'", replace: "      #contract\n      description '订单的记账事实'" },
    ],
    regen: true,
    expect: { skill: "ssot-draft-requirement", scope: "REQ-2" },
  },
  {
    id: "status-unexpanded",
    description: "ledger 没有子元素也没有 #leaf：前沿是展开 ledger 的 write-level，ledger 还没有视图，scope 取 fqn",
    edits: [...rejected, { file: C4, find: "      #contract #leaf\n      description '订单的记账事实'", replace: "      #contract\n      description '订单的记账事实'" }],
    regen: true,
    expect: { skill: "ssot-write-level", scope: "shop.ledger" },
  },
  {
    id: "status-contract",
    description: "顶层元素 audit 带 #contract 却没有契约文件：前沿是 audit 的 write-contract（contract.module 不作为 error 的切片）",
    edits: [...rejected, { file: C4, find: "  user = actor 'User'", replace: "  user = actor 'User'\n  audit = system 'Audit' {\n    #contract #leaf\n  }" }],
    regen: true,
    expect: { skill: "ssot-write-contract", scope: "audit" },
  },
  {
    id: "status-outcome",
    description: "未改动的 base：place 的 Reply_Rejected 在回放中计 0，前沿是行为模块 flow",
    edits: [],
    regen: false,
    expect: { skill: "ssot-write-behavior", scope: "flow" },
  },
];
