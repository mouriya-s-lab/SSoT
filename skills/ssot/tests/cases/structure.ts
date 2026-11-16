import assert from "node:assert/strict";
import type { C4View, Structure } from "../../scripts/src/compile/likec4";
import { renderOrder } from "../../scripts/src/site";
import { structureRules } from "../../scripts/src/rules/structure";
import type { Mutation } from "../mutations";

const C4 = "structure/model.c4";
const API = "contract/shop.api.vdmsl";
const LEDGER = "contract/shop.ledger.vdmsl";
const top = "  user = actor 'User'";
const view = "  view shopLayer of shop {";
const deployed = "  deployment view deployed {\n    include coreNet.**";

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
  ...(["container", "store", "component"] as const).map((kind): Mutation => ({
    id: `struct-nesting-top-${kind}`, expect: "struct.nesting", description: `${kind} 不能在顶层`, regen: true,
    edits: [{ file: C4, find: top, replace: `${top}\n  wrong = ${kind} 'Wrong'` }],
  })),
  {
    id: "struct-nesting-component-component", expect: "struct.nesting", description: "component 不能继续嵌套 component", regen: true,
    edits: [{ file: C4, find: top, replace: `${top}\n  other = system 'Other' { process = container 'Process' { worker = component 'Worker' { detail = component 'Detail' } } }` }],
  },
  {
    id: "struct-nesting-store-valid", expect: "struct.nesting", description: "没有子元素的 store 直接在 system 下通过", regen: true, expectPass: true,
    edits: [{ file: C4, find: "    description '下单与记账'", replace: "    description '下单与记账'\n    archive = store 'Archive'" }], outputExcludes: ["/struct.nesting]"],
  },
  {
    id: "struct-nesting-store-under-container", expect: "struct.nesting", description: "store 不能嵌在 container 里", regen: true,
    edits: [{ file: C4, find: "        group 'Applications'\n      }\n    }\n    reports = container", replace: "        group 'Applications'\n      }\n      cache = store 'Cache'\n    }\n    reports = container" }, { file: C4, find: view, replace: "  view apiLayer of shop.api { include * }\n" + view }],
    outputIncludes: ["store 的父元素必须是 system"],
  },
  {
    id: "struct-nesting-store-children", expect: "struct.nesting", description: "store 不能展开出组件", regen: true,
    edits: [
      { file: C4, find: "    description '下单与记账'", replace: "    description '下单与记账'\n    archive = store 'Archive' { table = component 'Table' }" },
      { file: C4, find: view, replace: "  view archiveLayer of shop.archive { include * }\n" + view },
    ],
    outputIncludes: ["store 不能有子元素", "component 的父元素必须是 container"],
  },
  {
    id: "struct-external-leaf-system", expect: "struct.external", description: "#external 标在没有子元素的顶层 system 上通过", regen: true, expectPass: true,
    edits: [{ file: C4, find: top, replace: `${top}\n  gateway = system 'Gateway' { #external }` }], outputExcludes: ["/struct.external]"],
  },
  {
    id: "struct-external-container", expect: "struct.external", description: "#external 不能标在 container 上：本系统的托管存储不是外部系统", regen: true,
    edits: [{ file: C4, find: "      #business #contract", replace: "      #business #contract #external" }],
    outputIncludes: ["#external 只能标在顶层 system 上"],
  },
  {
    id: "struct-external-expanded", expect: "struct.external", description: "外部系统不能展开", regen: true,
    edits: [
      { file: C4, find: top, replace: `${top}\n  gateway = system 'Gateway' {\n    #external\n    charge = container 'Charge'\n  }` },
      { file: C4, find: view, replace: "  view gatewayLayer of gateway { include * }\n" + view },
    ],
    outputIncludes: ["外部系统 gateway 不能展开"],
  },
  {
    id: "struct-nesting-actor-children", expect: "struct.nesting", description: "actor 不能有子元素", regen: true,
    edits: [{ file: C4, find: top, replace: "  user = actor 'User' { nested = system 'Nested' }" }], outputIncludes: ["actor 不能有子元素"],
  },
  {
    id: "struct-group-valid", expect: "struct.group", description: "同一父元素下的兄弟共用一个组名通过", edits: [], regen: false, expectPass: true,
    outputExcludes: ["/struct.group]"],
  },
  {
    id: "struct-group-cross-parent", expect: "struct.group", description: "同名分组的成员必须同父，不能跨层", regen: true,
    edits: [
      { file: C4, find: "        group 'Applications'\n      }\n    }\n    ledger = container", replace: "        group 'Applications'\n      }\n      writer = component 'Writer' {\n        metadata {\n          group 'Applications'\n        }\n      }\n    }\n    ledger = container" },
      { file: C4, find: view, replace: "  view reportsLayer of reports { include * }\n" + view },
    ],
    outputIncludes: ["同一分组的成员只在这一个父元素下的兄弟之间"],
  },
  {
    id: "struct-views-autolayout", expect: "struct.views", description: "元素视图不写 autoLayout", regen: true,
    edits: [{ file: C4, find: "  view index {\n    include *", replace: "  view index {\n    autoLayout TopBottom\n    include *" }],
    outputIncludes: ["元素视图不写 autoLayout"],
  },
  {
    id: "struct-views-group", expect: "struct.views", description: "元素视图不写 group：分组是模型事实", regen: true,
    edits: [{ file: C4, find: "  view shopLayer of shop {\n    include *", replace: "  view shopLayer of shop {\n    include *\n    group 'Back office' {\n      include reports\n    }" }],
    outputIncludes: ["元素视图不写 group"],
  },
  {
    id: "struct-views-rank", expect: "struct.views", description: "元素视图不写 rank", regen: true,
    edits: [{ file: C4, find: "  view shopLayer of shop {\n    include *", replace: "  view shopLayer of shop {\n    include *\n    rank same { api, reports }" }],
    outputIncludes: ["元素视图不写 rank"],
  },
  {
    id: "struct-views-style", expect: "struct.views", description: "元素视图的形状与颜色由 ssot render 绘制", regen: true,
    edits: [{ file: C4, find: "  view index {\n    include *", replace: "  view index {\n    include *\n    style shop { color red }" }],
    outputIncludes: ["元素视图不写 样式（style）"],
  },
  {
    id: "struct-views-global-style", expect: "struct.views", description: "global style 不再用于逻辑视图", regen: true,
    edits: [
      { file: C4, find: "views {\n", replace: "global {\n  styleGroup theme {\n    style * { color primary }\n  }\n}\n\nviews {\n" },
      { file: C4, find: "  view index {\n    include *", replace: "  view index {\n    global style theme\n    include *" },
    ],
    outputIncludes: ["元素视图不写 全局样式（global style）"],
  },
  {
    id: "struct-views-block-style", expect: "struct.views", description: "views 块里不写样式规则", regen: true,
    edits: [{ file: C4, find: "views {\n", replace: "views {\n  style * { color red }\n" }],
    outputIncludes: ["views 块里不写 样式（style）"],
  },
  {
    id: "struct-views-deployment-style", expect: "struct.views", description: "部署视图的样式由 ssot render 从模型绘制", regen: true,
    edits: [{ file: C4, find: deployed, replace: `${deployed}\n    style coreNet.api { color red }` }],
    outputIncludes: ["部署视图不写 样式（style）"],
  },
  {
    id: "struct-views-deployment-autolayout", expect: "struct.views", description: "部署视图不写 autoLayout", regen: true,
    edits: [{ file: C4, find: deployed, replace: `${deployed}\n    autoLayout TopBottom` }],
    outputIncludes: ["部署视图不写 autoLayout"],
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
  const index: C4View = { id: "index", type: "element", viewOf: null, title: null, description: "", nodes: [], edges: [], deployment: null, writtenRules: [], declared: true, at: null };
  const structure: Structure = { elements: new Map(), relations: [], views: [index, index], viewBlockRules: [], spec: { elementKinds: [], relationKinds: [], tags: [] } };
  const viewDiagnostics = (s: Structure): number => structureRules(s).filter((d) => d.rule === "struct.views").length;
  assert.equal(viewDiagnostics(structure), 1, "duplicate projected index");
  assert.equal(structureRules({ ...structure, views: [index] }).length, 0, "unique projected index");
  assert.equal(viewDiagnostics({ ...structure, views: [{ ...index, writtenRules: [{ kind: "autoLayout", at: null }] }] }), 1, "written layout rule");
  assert.equal(viewDiagnostics({ ...structure, views: [index], viewBlockRules: [{ kind: "globalStyle", at: null }] }), 1, "block style rule");
  const scoped = (id: string, viewOf: string): C4View => ({ ...index, id, viewOf });
  const deployment: C4View = { ...index, id: "deploy", type: "deployment", deployment: { placements: [], edges: [] } };
  assert.deepEqual(renderOrder([deployment, scoped("z", "b"), scoped("deep", "a.b"), scoped("a", "a"), index]).map((v) => v.id), ["index", "a", "z", "deep", "deploy"]);
  return 5;
}
