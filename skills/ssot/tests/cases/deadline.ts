import type { Edit, Mutation } from "../mutations";

/** tests/base 已用生成的 initial 初始化；保留这处编辑只为断言基线确实如此。 */
const initial: readonly Edit[] = [{
  file: "behavior/flow.qnt",
  find: "ledger' = L::initial,",
  replace: "ledger' = L::initial,",
}];

export const mutations: readonly Mutation[] = [
  {
    id: "resource-deadline",
    expect: "resource.deadline",
    description: "1ms 保险丝终止覆盖搜索，报告 global 资源截止，不声称样本预算已耗尽",
    edits: initial,
    regen: true,
    args: ["--samples", "10", "--steps", "12", "--seed", "20261103", "--deadline", "0.001"],
    outputIncludes: ["warning [quint/resource.deadline] global", "覆盖目标 witnessBothClosed 搜索超过截止"],
    outputExcludes: ["/replay.incomplete]", "error [quint/behavior.run]"],
  },
  {
    id: "resource-deadline-normal",
    expect: "-",
    description: "相同样本数、步数与种子使用正常保险丝，覆盖目标照常到达",
    edits: initial,
    regen: true,
    args: ["--samples", "10", "--steps", "12", "--seed", "20261103", "--deadline", "60"],
    expectPass: true,
    outputIncludes: ["witnessBothClosed（定向模拟"],
    outputExcludes: ["/resource.deadline]", "/replay.incomplete]"],
  },
  {
    id: "resource-sample-budget",
    expect: "replay.incomplete",
    description: "正常保险丝下三步不可能完成两张订单，仍按完整样本预算报告目标未到达",
    edits: initial,
    regen: true,
    args: ["--samples", "10", "--steps", "3", "--seed", "20261103", "--deadline", "60"],
    outputIncludes: ["100 次 × 3 步内没有到达"],
    outputExcludes: ["/resource.deadline]"],
  },
];
