import { type Mutation } from "../mutations";

const FLOW = "behavior/flow.qnt";
const payloadError = {
  file: FLOW,
  find: "A::place({ o: o, amount: amt, result: A::Reply_Accepted })",
  replace: "A::place({ o: o, amount: false, result: A::Reply_Accepted })",
};

export const mutations: readonly Mutation[] = [
  {
    id: "attribution-call-payload-outside",
    expect: "compile.quint",
    description: "Call 载荷类型错误归 shop.api，顶层 index 不显示",
    edits: [payloadError],
    regen: true,
    args: ["--scope", "index"],
    expectPass: true,
    outputExcludes: ["error [quint/compile.quint]"],
  },
  {
    id: "attribution-call-payload-inside",
    expect: "compile.quint",
    description: "同一 Call 载荷类型错误在 shopLayer 显示所属元素",
    edits: [payloadError],
    regen: true,
    args: ["--scope", "shopLayer"],
    outputIncludes: ["error [quint/compile.quint] element shop.api"],
    outputExcludes: ["error [quint/compile.quint] global"],
  },
  {
    id: "attribution-syntax-global",
    expect: "compile.quint",
    description: "真实语法错误即使位于 Call 表达式内也保持 global",
    edits: [{
      file: FLOW,
      find: "A::place({ o: o, amount: amt, result: A::Reply_Accepted })",
      replace: "A::place({ o: o, amount: , result: A::Reply_Accepted })",
    }],
    regen: true,
    args: ["--scope", "index"],
    outputIncludes: ["error [quint/compile.quint] global"],
  },
  {
    id: "attribution-unrelated-type-global",
    expect: "compile.quint",
    description: "与 Call 无关的类型错误不因同一行为文件引用了契约而被归属",
    edits: [{ file: FLOW, find: "pure val ORDERS = Set(\"o1\", \"o2\")", replace: "pure val ORDERS: int = Set(\"o1\", \"o2\")" }],
    regen: true,
    args: ["--scope", "index"],
    outputIncludes: ["error [quint/compile.quint] global"],
  },
];
