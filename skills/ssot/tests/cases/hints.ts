import assert from "node:assert/strict";
import type { C4Element, C4Relation, Structure } from "../../scripts/src/compile/likec4";
import type { VdmDefinition, VdmModule, VdmProject, VdmType } from "../../scripts/src/compile/vdm";
import type { RuleId } from "../../scripts/src/diag";
import { hintRules } from "../../scripts/src/rules/hints";
import type { Mutation } from "../mutations";

const LEDGER = "contract/shop.ledger.vdmsl";
const FLOW = { file: "behavior/flow.qnt", find: null, replace: "module flow { pure val marker = true }\n" } as const;

export const mutations: readonly Mutation[] = [
  {
    id: "hints-export", expect: "hint.export", description: "无 importer 的导出仅提示", regen: true, expectPass: true,
    edits: [{ file: LEDGER, find: "types struct OrderId", replace: "types struct OrderId; struct Spare" }, { file: LEDGER, find: "OrderId = token;", replace: "OrderId = token;\n  Spare = nat;" }],
    outputIncludes: ["/hint.export]"],
  },
  {
    id: "hints-single-business", expect: "hint.single-business", description: "架构定义仅被单一业务模块引用", regen: true, expectPass: true,
    edits: [{ file: LEDGER, find: "operations\n    record", replace: "values limit : nat\n  operations\n    record" }, { file: LEDGER, find: "definitions\ntypes", replace: "definitions\nvalues\n  limit : nat = 100;\ntypes" }, { file: "contract/shop.api.vdmsl", find: "from shop_ledger types OrderId renamed OrderId", replace: "from shop_ledger types OrderId renamed OrderId values limit : nat renamed limit" }, { file: "contract/shop.api.vdmsl", find: "pre amount > 0", replace: "pre amount > 0 and amount <= limit" }],
    outputIncludes: ["/hint.single-business]"],
  },
  {
    id: "hints-struct-unread", expect: "hint.struct-unread", description: "struct 导出没有读字段者", regen: true, expectPass: true,
    edits: [], outputIncludes: ["/hint.struct-unread]"],
  },
  {
    id: "hints-string", expect: "hint.string", description: "导出类型含字符串结构", regen: true, expectPass: true,
    edits: [{ file: LEDGER, find: "OrderId = token;", replace: "OrderId = seq of char;" }], outputIncludes: ["/hint.string]"],
  },
  {
    id: "hints-sampled", expect: "hint.sampled", description: "恒真 pre 的采样作为提示", regen: true, expectPass: true,
    edits: [{ file: "contract/shop.api.vdmsl", find: "pre amount > 0", replace: "pre amount >= 0" }], outputIncludes: ["/hint.sampled]"],
  },
  {
    id: "hints-state-unused", expect: "hint.state-unused", description: "没有操作写入也没有读取的状态字段仅提示", regen: true, expectPass: true,
    edits: [{ file: LEDGER, find: "  closed  : set of OrderId\n", replace: "  closed  : set of OrderId\n  note    : nat\n" }, { file: LEDGER, find: "inv mk_Ledger(es, cs)", replace: "inv mk_Ledger(es, cs, -)" }, { file: LEDGER, find: "mk_Ledger({|->}, {})", replace: "mk_Ledger({|->}, {}, 0)" }], outputIncludes: ["/hint.state-unused]"],
  },
  {
    id: "hints-no-ext", expect: "hint.no-ext", description: "隐式操作无 ext 仅提示", regen: true, expectPass: true,
    edits: [], outputIncludes: ["/hint.no-ext]"],
  },
  {
    id: "hints-contract-body", expect: "contract.body", description: "显式操作中的局部可变变量与赋值被拒绝", regen: true,
    edits: [FLOW, { file: "contract/shop.api.vdmsl", find: "end shop_api", replace: "  mutate : () ==> ()\n  mutate() == (dcl local : nat := 0; local := 1; return);\nend shop_api" }], outputIncludes: ["/contract.body]"],
  },
];

const location = { file: "contract/shop.ledger.vdmsl", module: "shop_ledger", line: 12, col: 3 };
const nat: VdmType = { kind: "nat" };
const text: VdmType = { kind: "seq", element: { kind: "char" } };

function typeDef(type: VdmType = nat, name = "Thing"): Extract<VdmDefinition, { category: "type" }> {
  return { category: "type", name, location, type, hasInvariant: false, invSample: null };
}

function operation(overrides: Partial<Extract<VdmDefinition, { category: "operation" }>> = {}): Extract<VdmDefinition, { category: "operation" }> {
  return { category: "operation", kind: "implicit", name: "work", location, params: [], result: { name: null, type: { kind: "void" } }, hasPre: false, hasPost: true, imperative: [], preSample: null, ext: { rd: [], wr: ["count"] }, reads: ["count"], writes: ["count"], ...overrides };
}

function state(invReads: readonly string[] = []): Extract<VdmDefinition, { category: "state" }> {
  return { category: "state", name: "State", location, fields: [{ name: "count", type: nat }], hasInvariant: invReads.length > 0, hasInit: true, initial: null, invReads };
}

function module(definitions: readonly VdmDefinition[], overrides: Partial<VdmModule> = {}): VdmModule {
  return { name: "shop_ledger", file: location.file, location, imports: [], exports: [{ kind: "type", name: "Thing", struct: true }], definitions, references: [], fieldReads: [], ...overrides };
}

function architecture(relations: readonly C4Relation[] = []): Structure {
  const elements: readonly Omit<C4Element, "title" | "description">[] = [
    { fqn: "shop", kind: "system", parent: null, children: ["shop.ledger", "shop.api", "shop.other"], tags: [], metadata: {}, at: null },
    { fqn: "shop.ledger", kind: "container", parent: "shop", children: [], tags: ["contract"], metadata: {}, at: null },
    { fqn: "shop.api", kind: "container", parent: "shop", children: ["shop.api.child"], tags: ["business", "contract"], metadata: {}, at: null },
    { fqn: "shop.api.child", kind: "component", parent: "shop.api", children: [], tags: ["contract"], metadata: {}, at: null },
    { fqn: "shop.other", kind: "container", parent: "shop", children: [], tags: ["contract"], metadata: {}, at: null },
    { fqn: "user", kind: "actor", parent: null, children: [], tags: [], metadata: {}, at: null },
    { fqn: "outside", kind: "system", parent: null, children: [], tags: [], metadata: {}, at: null },
  ];
  return { elements: new Map(elements.map((e) => [e.fqn, { ...e, title: e.fqn, description: "" }])), relations, views: [], spec: { elementKinds: ["actor", "system", "container", "component"], relationKinds: [], tags: ["contract", "business"] } };
}

export function verifyProjections(): number {
  let checks = 0;
  const s = architecture();
  const producer = module([typeDef()]);
  const importer = module([], { name: "shop_api", exports: [], imports: [{ module: "shop_ledger", items: [{ kind: "type", name: "Thing", renamed: "Local" }] }] });
  const allImporter = { ...importer, imports: [{ module: "shop_ledger", items: [{ kind: "all", name: null, renamed: null } as const] }] };
  const reader = { ...importer, fieldReads: ["shop_ledger`Thing.value"] };
  function check(id: string, rule: RuleId, count: number, modules: readonly VdmModule[], structure = s): void {
    const project: VdmProject = { modules };
    const found = hintRules(structure, project).filter((d) => d.rule === rule);
    assert.equal(found.length, count, id);
    for (const d of found) {
      assert.equal(d.severity, rule === "contract.body" ? "error" : "info", `${id}: severity`);
      assert.deepEqual(d.subject, { kind: "element", fqn: "shop.ledger" }, `${id}: ownership`);
      assert.deepEqual(d.at, { file: location.file, line: location.line, col: location.col }, `${id}: location`);
    }
    console.log(`ok ${id}: ${rule}=${count}`);
    checks++;
  }
  check("export-unused", "hint.export", 1, [producer]);
  check("export-renamed-import", "hint.export", 0, [producer, importer]);
  check("export-import-all", "hint.export", 0, [producer, allImporter]);
  check("export-all", "hint.export", 1, [{ ...producer, exports: [{ kind: "all" }] }]);
  for (const [source, count] of [["user", 0], ["outside", 0], ["shop.other", 1]] as const) {
    const relation: C4Relation = { id: source, source, target: "shop.ledger", kind: null, title: null, description: "", tags: [], metadata: {}, at: null };
    check(`export-incoming-${source}`, "hint.export", count, [producer], architecture([relation]));
    check(`export-outgoing-${source}`, "hint.export", 1, [producer], architecture([{ ...relation, source: "shop.ledger", target: source }]));
  }
  const business = { ...importer, references: ["shop_ledger`Thing", "shop_ledger`Thing"] };
  check("single-business", "hint.single-business", 1, [producer, business]);
  check("single-business-inherited", "hint.single-business", 1, [producer, { ...business, name: "shop_api_child" }]);
  check("single-business-zero", "hint.single-business", 0, [producer, importer]);
  check("single-business-architect-consumer", "hint.single-business", 0, [producer, { ...business, name: "shop_other" }]);
  check("single-business-plus-architect", "hint.single-business", 0, [producer, business, { ...business, name: "shop_other" }]);
  check("single-business-two-business", "hint.single-business", 0, [producer, business, { ...business, name: "shop_api_child" }]);
  check("single-business-owner-is-business", "hint.single-business", 0, [{ ...producer, name: "shop_api" }, { ...importer, references: ["shop_api`Thing"], name: "shop_api_child" }]);
  check("struct-unread", "hint.struct-unread", 1, [producer, importer]);
  check("struct-read", "hint.struct-unread", 0, [producer, reader]);
  check("struct-read-all", "hint.struct-unread", 0, [producer, { ...allImporter, fieldReads: reader.fieldReads }]);
  check("struct-wrong-type", "hint.struct-unread", 1, [producer, { ...reader, fieldReads: ["shop_ledger`ThingExtra.value"] }]);
  check("struct-wrong-owner", "hint.struct-unread", 1, [producer, { ...reader, fieldReads: ["shop_other`Thing.value"] }]);
  check("struct-reader-not-importer", "hint.struct-unread", 1, [producer, { ...reader, imports: [] }]);
  check("struct-opaque", "hint.struct-unread", 0, [{ ...producer, exports: [{ kind: "type", name: "Thing", struct: false }] }]);
  check("string-direct", "hint.string", 1, [module([typeDef(text)])]);
  check("string-absent", "hint.string", 0, [producer]);
  check("string-private", "hint.string", 0, [module([typeDef(text)], { exports: [] })]);
  check("string-seq1-not-seq", "hint.string", 0, [module([typeDef({ kind: "seq1", element: { kind: "char" } })])]);
  const nested: readonly VdmType[] = [
    { kind: "record", module: "shop_ledger", name: "Thing", fields: [{ name: "label", type: text }] },
    { kind: "optional", type: text }, { kind: "map", from: nat, to: text }, { kind: "inmap", from: text, to: nat },
    { kind: "product", types: [nat, text] }, { kind: "union", types: [nat, text] },
    { kind: "seq", element: text }, { kind: "seq1", element: text }, { kind: "set", element: text }, { kind: "set1", element: text },
    { kind: "function", partial: false, params: [text], result: nat }, { kind: "operation", params: [], result: text },
  ];
  for (const [i, type] of nested.entries()) check(`string-nested-${i}-${type.kind}`, "hint.string", 1, [module([typeDef(type)])]);
  check("string-named-ref", "hint.string", 1, [module([typeDef({ kind: "ref", module: "shop_ledger", name: "Private" }), typeDef(text, "Private")])]);
  check("string-recursive-absent", "hint.string", 0, [module([typeDef({ kind: "ref", module: "shop_ledger", name: "Thing" })])]);
  check("string-recursive-present", "hint.string", 1, [module([typeDef({ kind: "union", types: [{ kind: "ref", module: "shop_ledger", name: "Thing" }, text] })])]);
  check("string-unresolved", "hint.string", 0, [module([typeDef({ kind: "ref", module: "missing", name: "Thing" })])]);
  for (const [id, sample, count] of [
    ["true", { trueCount: 3, falseCount: 0 }, 1], ["false", { trueCount: 0, falseCount: 4 }, 1],
    ["mixed", { trueCount: 1, falseCount: 1 }, 0], ["empty", { trueCount: 0, falseCount: 0 }, 0], ["null", null, 0],
  ] as const) {
    check(`sampled-pre-${id}`, "hint.sampled", count, [module([operation({ preSample: sample })])]);
    check(`sampled-inv-${id}`, "hint.sampled", count, [module([{ ...typeDef(), invSample: sample }])]);
    check(`sampled-function-${id}`, "hint.sampled", count, [module([{ ...operation({ preSample: sample }), category: "function" }])]);
  }
  check("state-unwritten", "hint.state-unused", 1, [module([state(), operation({ writes: [] })])]);
  check("state-unread", "hint.state-unused", 1, [module([state(), operation({ reads: [] })])]);
  check("state-used", "hint.state-unused", 0, [module([state(), operation()])]);
  check("state-read-in-inv", "hint.state-unused", 0, [module([state(["count"]), operation({ reads: [] })])]);
  check("state-unused-both-once", "hint.state-unused", 1, [module([state()])]);
  check("state-inv-does-not-write", "hint.state-unused", 1, [module([state(["count"]), operation({ reads: [], writes: [] })])]);
  check("state-ext-is-not-write-evidence", "hint.state-unused", 1, [module([state(), operation({ writes: [] })])]);
  check("no-ext-implicit", "hint.no-ext", 1, [module([operation({ ext: null })])]);
  check("no-ext-explicit", "hint.no-ext", 0, [module([operation({ kind: "explicit", ext: null })])]);
  check("no-ext-present-empty", "hint.no-ext", 0, [module([operation({ ext: { rd: [], wr: [] } })])]);
  check("no-ext-function", "hint.no-ext", 0, [module([{ ...operation({ ext: null }), category: "function" }])]);
  check("body-imperative-once", "contract.body", 1, [module([operation({ imperative: [location, location], kind: "explicit" })])]);
  check("body-declarative", "contract.body", 0, [module([operation()])]);
  check("body-function", "contract.body", 1, [module([{ ...operation({ imperative: [location], kind: "explicit" }), category: "function" }])]);
  console.log(`${checks}/${checks} hints projection cases passed`);
  return checks;
}

if (import.meta.main) verifyProjections();
