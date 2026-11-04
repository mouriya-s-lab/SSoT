import assert from "node:assert/strict";
import type { C4View, Structure } from "../../scripts/src/compile/likec4";
import { renderOrder } from "../../scripts/src/render";
import { structureRules } from "../../scripts/src/rules/structure";
import type { Mutation } from "../mutations";

const C4 = "structure/model.c4";
const API = "contract/shop.api.vdmsl";
const LEDGER = "contract/shop.ledger.vdmsl";
const top = "  user = actor 'User'";
const view = "  view shopLayer of shop {";

export const mutations: readonly Mutation[] = [
  {
    id: "struct-nesting-valid", expect: "struct.nesting", description: "actor/system 顶层，system→container→component 严格嵌套通过", regen: true, expectPass: true,
    edits: [
      { file: C4, find: top, replace: `${top}\n  other = system 'Other' {\n    process = container 'Process' {\n      worker = component 'Worker'\n    }\n  }` },
      { file: C4, find: view, replace: "  view otherLayer of other { include * }\n  view processLayer of other.process { include * }\n" + view },
    ], outputExcludes: ["/struct.nesting]"],
  },
  ...([
    ["system-nested", "system"], ["actor-nested", "actor"], ["component-under-system", "component"],
  ] as const).map(([id, kind]): Mutation => ({
    id: `struct-nesting-${id}`, expect: "struct.nesting", description: `${kind} 不能直接嵌套在 system 内`, regen: true,
    edits: [{ file: C4, find: "    description '下单与记账'", replace: `    description '下单与记账'\n    wrong = ${kind} 'Wrong'` }],
  })),
  ...(["container", "component"] as const).map((kind): Mutation => ({
    id: `struct-nesting-top-${kind}`, expect: "struct.nesting", description: `${kind} 不能在顶层`, regen: true,
    edits: [{ file: C4, find: top, replace: `${top}\n  wrong = ${kind} 'Wrong'` }],
  })),
  {
    id: "struct-nesting-component-component", expect: "struct.nesting", description: "component 不能继续嵌套 component", regen: true,
    edits: [{ file: C4, find: top, replace: `${top}\n  other = system 'Other' { process = container 'Process' { worker = component 'Worker' { detail = component 'Detail' } } }` }],
  },
  {
    id: "struct-nesting-actor-children", expect: "struct.nesting", description: "actor 不能有子元素", regen: true,
    edits: [{ file: C4, find: top, replace: "  user = actor 'User' { nested = system 'Nested' }" }], outputIncludes: ["actor 不能有子元素"],
  },
  {
    id: "contract-module-nonleaf", expect: "contract.module", description: "非叶 system 不得标记 #contract", regen: true,
    edits: [{ file: C4, find: "    description '下单与记账'", replace: "    #contract\n    description '下单与记账'" }], outputIncludes: ["带 #contract，不能有子元素"],
  },
  { id: "contract-module-leaves", expect: "contract.module", description: "只有叶子承载契约通过", edits: [], regen: false, expectPass: true, outputExcludes: ["/contract.module]"] },
  {
    id: "struct-kinds-spec-relation", expect: "struct.kinds", description: "未使用的关系种类声明也被拒绝", regen: true,
    edits: [{ file: C4, find: "  tag contract", replace: "  relationship invokes\n  tag contract" }], outputIncludes: ["不得声明关系种类"],
  },
  { id: "struct-kinds-untyped", expect: "struct.kinds", description: "不声明关系种类、无种类箭头通过", edits: [], regen: false, expectPass: true, outputExcludes: ["/struct.kinds]"] },
  {
    id: "struct-views-index-missing", expect: "struct.views", description: "明确缺少 index，即使 LikeC4 自动创建视图也不算", regen: true,
    edits: [{ file: C4, find: "  view index {\n    include *\n  }", replace: "" }], outputIncludes: ["必须恰有一个顶层 index"],
  },
  {
    id: "struct-views-index-duplicate", expect: "compile.c4", description: "重复 index 由 LikeC4 编译器拒绝，不能被模型 Map 合并后隐藏", regen: false,
    edits: [{ file: C4, find: "  view index {", replace: "  view index { include * }\n  view index {" }],
  },
  { id: "struct-views-index-unique", expect: "struct.views", description: "唯一 index 通过", edits: [], regen: false, expectPass: true, outputExcludes: ["/struct.views]"] },
  {
    id: "struct-layering-repeated-tag", expect: "struct.layering", description: "业务标签不能重复标在后代", regen: true,
    edits: [{ file: C4, find: "    description '下单与记账'", replace: "    #business\n    description '下单与记账'" }], outputIncludes: ["#business 重复标记"],
  },
  {
    id: "struct-layering-runtime-call", expect: "struct.layering", description: "架构可以发起对业务的运行期调用，箭头不再约束词汇引用", regen: true, expectPass: true,
    edits: [{ file: C4, find: "    api -> ledger '记下订单金额'", replace: "    api -> ledger '记下订单金额'\n    ledger -> api '通知入账'" }], outputExcludes: ["/struct.layering]", "/contract.layering]"],
  },
  {
    id: "contract-import-cycle", expect: "contract.imports", description: "VDMJ 接受的双向 import 在生成 Quint 前由 VDM 规则拒绝", regen: false,
    edits: [{ file: LEDGER, find: "exports\n", replace: "imports\n  from shop_api types Reply\nexports\n" }],
    outputIncludes: ["error [vdm/contract.imports] element shop.api", "error [vdm/contract.imports] element shop.ledger", "无法生成 contract.qnt"],
  },
  { id: "contract-import-dag", expect: "contract.imports", description: "无环 VDM imports 通过，不要求 C4 关系授权", edits: [{ file: C4, find: "    api -> ledger '记下订单金额'", replace: "" }], regen: true, expectPass: true, outputExcludes: ["/contract.imports]"] },
  {
    id: "contract-layering-architecture-business", expect: "contract.layering", description: "架构契约不得 import 业务契约", regen: true,
    edits: [{ file: C4, find: "#business #contract", replace: "#contract" }, { file: C4, find: "    ledger = container 'Ledger' {\n      #contract", replace: "    ledger = container 'Ledger' {\n      #business #contract" }],
    outputIncludes: ["error [vdm/contract.layering] element shop.api"],
  },
  {
    id: "contract-layering-inherited-business", expect: "contract.layering", description: "祖先业务标签同样约束外部架构 importer", regen: true,
    edits: [
      { file: C4, find: "#business #contract", replace: "#contract" },
      { file: C4, find: "    description '下单与记账'", replace: "    #business\n    description '下单与记账'" },
      { file: C4, find: top, replace: `${top}\n  audit = system 'Audit' { #contract }` },
      { file: "contract/audit.vdmsl", find: null, replace: "module audit\nimports from shop_api types Reply\nexports all\ndefinitions\ntypes\n  Event = token;\nend audit\n" },
    ], outputIncludes: ["error [vdm/contract.layering] element audit"],
  },
  ...([
    ["business-architecture", []],
    ["architecture-architecture", [{ file: C4, find: "#business #contract", replace: "#contract" }]],
    ["business-business", [{ file: C4, find: "    ledger = container 'Ledger' {\n      #contract", replace: "    ledger = container 'Ledger' {\n      #business #contract" }]],
    ["actor-business", [
      { file: C4, find: top, replace: "  user = actor 'User' { #contract }" },
      { file: "contract/user.vdmsl", find: null, replace: "module user\nimports from shop_api types Reply\nexports all\ndefinitions\ntypes\n  Identity = token;\nend user\n" },
    ]],
  ] as const).map(([id, edits]): Mutation => ({ id: `contract-layering-${id}`, expect: "contract.layering", description: `${id} imports 合法`, edits, regen: true, expectPass: true, outputExcludes: ["/contract.layering]"] })),
];

export function verifyStructureProjections(): number {
  const index: C4View = { id: "index", type: "element", viewOf: null, nodes: [], declared: true, at: null };
  const structure: Structure = { elements: new Map(), relations: [], views: [index, index], spec: { elementKinds: [], relationKinds: [], tags: [] } };
  assert.equal(structureRules(structure).filter((d) => d.rule === "struct.views").length, 1, "duplicate projected index");
  assert.equal(structureRules({ ...structure, views: [index] }).length, 0, "unique projected index");
  const scoped = (id: string, viewOf: string): C4View => ({ ...index, id, viewOf });
  const deployment: C4View = { ...index, id: "deploy", type: "deployment" };
  assert.deepEqual(renderOrder([deployment, scoped("z", "b"), scoped("deep", "a.b"), scoped("a", "a"), index]).map((v) => v.id), ["index", "a", "z", "deep", "deploy"]);
  return 3;
}
