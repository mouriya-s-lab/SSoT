// 回放（frame、behavior.call、结局计数）的 check 级突变，形状同 tests/mutations.ts。
// replay.initial 与 behavior.init 互为冗余：初态不等于 initial 的 Quint 写法必然先被 behavior.init 拦下，而回放只在没有 error 时运行，
// 所以 replay.initial 没有 check 级突变；它由直接回放夹具（手写轨迹调用 replay()）覆盖。
import type { Edit, Mutation } from "../mutations";

const LEDGER = "contract/shop.ledger.vdmsl";
const FLOW = "behavior/flow.qnt";

/** tests/base 已用生成的 initial 初始化；保留这处编辑只为断言基线确实如此。 */
const initial: Edit = { file: FLOW, find: "ledger' = L::initial,", replace: "ledger' = L::initial," };

/** 给账本加一个只读操作 isRecorded（ext rd entries；post 对任意后状态都可满足，QuickCheck 不报 FAILED）。 */
const isRecordedVdm: readonly Edit[] = [
  { file: LEDGER, find: "    close : OrderId ==> Closed\n", replace: "    close : OrderId ==> Closed;\n    isRecorded : OrderId ==> bool\n" },
  {
    file: LEDGER,
    find: "  post closed = closed~ union {o} and r = <Closed>;\n",
    replace: "  post closed = closed~ union {o} and r = <Closed>;\n\n  isRecorded(o : OrderId) r : bool\n  ext rd entries\n  post r = (o in set dom entries);\n",
  },
];

const step = "any { doPlace(o, amt), doRecord(o, amt), doClose(o) }";

export const mutations: readonly Mutation[] = [
  {
    id: "replay-frame-readonly",
    expect: "replay.frame",
    description: "只读操作 isRecorded（ext rd entries）的那一步把 o 记进了 entries；结果取改后的值，post 成立，只有 frame 能拦",
    edits: [
      initial,
      ...isRecordedVdm,
      {
        file: FLOW,
        find: "  action step = {",
        replace:
          "  action doPeek(o: str): bool = all {\n    not(o.in(ledger.entries.keys())),\n    lastCall' = shop_ledger(L::isRecorded({ o: o, result: true })),\n    ledger' = { ...ledger, entries: ledger.entries.put(o, 7) },\n    placed' = placed,\n  }\n\n  action step = {",
      },
      { file: FLOW, find: step, replace: "any { doPlace(o, amt), doRecord(o, amt), doClose(o), doPeek(o) }" },
    ],
    regen: true,
    outputIncludes: ["isRecorded 不得改变的分量 entries 在调用前后不相等"],
    outputExcludes: ["/replay.post]", "/replay.inv]"],
  },
  {
    id: "replay-frame-rd",
    expect: "replay.frame",
    description: "record 的 ext rd closed 在 Quint 里被改（不变式与 post 仍成立）",
    edits: [initial, { file: FLOW, find: "ledger' = { ...ledger, entries: ledger.entries.put(o, amt) },", replace: "ledger' = { entries: ledger.entries.put(o, amt), closed: ledger.closed.union(Set(o)) }," }],
    regen: true,
    outputIncludes: ["record 不得改变的分量 closed 在调用前后不相等"],
    outputExcludes: ["/replay.post]", "/replay.inv]"],
  },
  {
    id: "replay-behavior-call",
    expect: "behavior.call",
    description: "自造 action 绕开 Call 改了账本状态（lastCall 为 NoCall）",
    edits: [
      initial,
      {
        file: FLOW,
        find: "  action step = {",
        replace:
          "  action doTamper(o: str): bool = all {\n    o.in(placed),\n    not(o.in(ledger.entries.keys())),\n    lastCall' = NoCall,\n    ledger' = { ...ledger, entries: ledger.entries.put(o, 9) },\n    placed' = placed,\n  }\n\n  action step = {",
      },
      { file: FLOW, find: step, replace: "any { doPlace(o, amt), doRecord(o, amt), doClose(o), doTamper(o) }" },
    ],
    regen: true,
    outputIncludes: ["在不是 shop_ledger 调用的一步里变了：lastCall 为 NoCall"],
  },
  {
    id: "replay-outcome",
    expect: "-",
    description: "place 的结果并类型 Reply 有两个变体，行为只产生 Accepted：Rejected 计 0 并列为未覆盖（info，不令 check 失败）",
    edits: [initial],
    regen: true,
    expectPass: true,
    outputIncludes: ["info [quint/replay.outcome]", "shop_api`place 的结局：Reply_Accepted×", "Reply_Rejected×0；未覆盖 Reply_Rejected"],
  },
];
