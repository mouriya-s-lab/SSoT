import type { Mutation } from "../mutations";

const C4 = "structure/model.c4";
const CHILD_RELATION = "  user -[calls]-> shop.api '下单'";
const PARENT_RELATION = "  user -[calls]-> shop '受理下单'";

export const mutations: readonly Mutation[] = [
  {
    id: "view-derived-not-obligation",
    expect: "view.unrealized",
    description: "仅有子关系产生的汇总边不成为上一层声明义务",
    edits: [],
    regen: false,
    expectPass: true,
    outputExcludes: ["view.unrealized"],
  },
  {
    id: "view-unrealized-incoming",
    expect: "view.unrealized",
    description: "上层声明的入向关系没有子元素落实，只报 info",
    edits: [{ file: C4, find: CHILD_RELATION, replace: PARENT_RELATION }],
    regen: true,
    expectPass: true,
    outputIncludes: ["info [likec4/view.unrealized]", "user -[calls]-> shop"],
  },
  {
    id: "view-realized-incoming",
    expect: "view.unrealized",
    description: "方向和种类相同的子关系落实入向声明",
    edits: [{ file: C4, find: CHILD_RELATION, replace: `${PARENT_RELATION}\n${CHILD_RELATION}` }],
    regen: true,
    expectPass: true,
    outputExcludes: ["view.unrealized"],
  },
  {
    id: "view-realized-descendant",
    expect: "view.unrealized",
    description: "直接子元素的后代关系也由该直接子元素落实，不把派生边算为义务",
    edits: [
      { file: C4, find: "      description '受理订单'", replace: "      description '受理订单'\n      handler = component 'Handler'" },
      { file: C4, find: CHILD_RELATION, replace: `${PARENT_RELATION}\n  user -[calls]-> shop.api.handler '下单'` },
      { file: C4, find: "    api -[calls]-> ledger '记下订单金额'", replace: "    api -[calls]-> ledger '记下订单金额'\n    api.handler -[calls]-> ledger '记下订单金额'" },
      { file: C4, find: "  view shopLayer of shop {", replace: "  view apiLayer of shop.api {\n    include *\n  }\n  view shopLayer of shop {" },
    ],
    regen: true,
    expectPass: true,
    outputExcludes: ["view.unrealized"],
  },
  {
    id: "view-unrealized-kind",
    expect: "view.unrealized",
    description: "入向 uses 子关系不落实上层 calls 声明",
    edits: [{ file: C4, find: CHILD_RELATION, replace: `${PARENT_RELATION}\n  user -[uses]-> shop.api '下单词汇'` }],
    regen: true,
    expectPass: true,
    outputIncludes: ["info [likec4/view.unrealized]", "user -[calls]-> shop"],
  },
  {
    id: "view-unrealized-direction",
    expect: "view.unrealized",
    description: "相反方向的 callback 子关系不落实上层 callback 声明",
    edits: [{ file: C4, find: CHILD_RELATION, replace: `${CHILD_RELATION}\n  shop -[callback]-> user '通知使用方'\n  user -[callback]-> shop.api '回调入口'` }],
    regen: true,
    expectPass: true,
    outputIncludes: ["info [likec4/view.unrealized]", "shop -[callback]-> user"],
  },
];
