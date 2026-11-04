import type { Mutation } from "../mutations";

const flow = (initial: string, extra = ""): string => `module flow {
  import contract.* from "../.gen/contract"
  import shop_ledger as L from "../.gen/contract"
  var lastCall: Call
  var ledger: L::Ledger
  ${extra}
  action init = all { lastCall' = NoCall, ledger' = ${initial} }
  action step = all { lastCall' = NoCall, ledger' = ledger }
  val safety = true
}
`;

export const mutations: readonly Mutation[] = [
  {
    id: "initial-reference",
    expect: "-",
    description: "生成的初态经 import 别名直接赋值，行为通过",
    edits: [{ file: "behavior/flow.qnt", find: null, replace: flow("L::initial") }],
    regen: true,
    expectPass: true,
  },
  {
    id: "initial-literal",
    expect: "behavior.init",
    description: "手写相同的初态值仍不符合直接引用 initial 的要求",
    edits: [{ file: "behavior/flow.qnt", find: null, replace: flow("{ entries: Map(), closed: Set() }") }],
    regen: true,
  },
  {
    id: "initial-local-alias",
    expect: "behavior.init",
    description: "init 仅间接引用 initial 仍被拒绝",
    edits: [{ file: "behavior/flow.qnt", find: null, replace: flow("copied", "pure val copied = L::initial") }],
    regen: true,
  },
  {
    id: "initial-transform",
    expect: "behavior.init",
    description: "表达式中提到 initial 不等于直接使用生成值",
    edits: [{ file: "behavior/flow.qnt", find: null, replace: flow("{ ...L::initial, closed: Set() }") }],
    regen: true,
  },
  {
    id: "initial-opaque-structure",
    expect: "-",
    description: "非空不透明值采用结构编码生成初态",
    edits: [
      { file: "behavior/flow.qnt", find: null, replace: flow("L::initial") },
      { file: "contract/shop.ledger.vdmsl", find: "types struct OrderId", replace: "types OrderId" },
      { file: "contract/shop.ledger.vdmsl", find: "  operations\n", replace: "  values Seed : OrderId\n  operations\n" },
      { file: "contract/shop.ledger.vdmsl", find: "state Ledger of", replace: "values\n  Seed : OrderId = mk_token(\"seed\");\nstate Ledger of" },
      { file: "contract/shop.ledger.vdmsl", find: "mk_Ledger({|->}, {})", replace: "mk_Ledger({Seed |-> 1}, {})" },
    ],
    regen: true,
    expectPass: true,
  },
  {
    id: "initial-opaque-constructor",
    expect: "gen.unmappable",
    description: "构造入口编码的非空初态不能反推构造入参",
    edits: [
      { file: "behavior/flow.qnt", find: null, replace: flow("L::initial") },
      { file: "contract/shop.ledger.vdmsl", find: "types struct OrderId", replace: "types OrderId" },
      { file: "contract/shop.ledger.vdmsl", find: "  operations\n", replace: "  functions makeOrder : seq of char -> OrderId\n  values Seed : OrderId\n  operations\n" },
      { file: "contract/shop.ledger.vdmsl", find: "state Ledger of", replace: "functions\n  makeOrder : seq of char -> OrderId\n  makeOrder(s) == mk_token(s);\nvalues\n  Seed : OrderId = makeOrder(\"seed\");\nstate Ledger of" },
      { file: "contract/shop.ledger.vdmsl", find: "mk_Ledger({|->}, {})", replace: "mk_Ledger({Seed |-> 1}, {})" },
    ],
    regen: true,
    outputIncludes: ["初态含经构造入口编码的不透明值，无法反推入参"],
  },
];
