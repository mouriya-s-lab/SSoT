import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileBehavior } from "../../scripts/src/compile/quint";
import { compileVdm } from "../../scripts/src/compile/vdm";
import { format, global } from "../../scripts/src/diag";
import { generateContract } from "../../scripts/src/gen/contract";
import { projectBox, vdmTypeName } from "../../scripts/src/render/box";
import { projectComposition } from "../../scripts/src/render/composition";
import { compileLikeC4 } from "../../scripts/src/compile/likec4";
import { elementOfModule } from "../../scripts/src/model";
import { projectC4View } from "../../scripts/src/render/c4";
import { projectLayers } from "../../scripts/src/render/layers";

const C4_FIXTURE = `specification {
  element actor { notation 'Person' style { shape person } }
  element system { notation 'Software System' }
  element container { notation 'Container' }
  element store { notation 'Container: Data Store' style { shape storage } }
  element component { notation 'Component' }
  tag contract
  tag business
  tag external
}
model {
  user = actor 'User'
  pay = system 'Pay' { #external }
  shop = system 'Shop' {
    web = container 'Web' { metadata { group 'Edge' } }
    api = container 'API' {
      #business #contract
      technology 'HTTP'
      metadata { group 'Edge' }
    }
    ledger = store 'Ledger' { #contract }
    web -> api 'forwards'
    api -> ledger 'writes'
    api -> pay 'charges'
  }
  user -> shop.web 'browses'
}
views {
  view index { include * }
  view shopView of shop { include * }
}
`;

/** C4 投影：可见父元素、分组只在同一可见父下合并、元素种类到 C4 记法；分层图：业务在上、存储最深、import 名字。 */
async function verifyC4AndLayerProjections(stage: string, fixture: string): Promise<void> {
  mkdirSync(join(stage, "c4", "structure"), { recursive: true });
  writeFileSync(join(stage, "c4", "structure", "model.c4"), C4_FIXTURE);
  const c4 = await compileLikeC4(join(stage, "c4", "structure"));
  assert.equal(c4.kind, "ok", c4.diagnostics.map(format).join("\n"));
  const view = (id: string) => c4.structure.views.find((v) => v.id === id)!;
  const summary = (id: string) => {
    const d = projectC4View(c4.structure, view(id));
    return {
      nodes: Object.fromEntries(d.nodes.map((n) => [n.id, { kind: n.kind, parent: n.parent, group: n.group, boundary: n.boundary }])),
      groups: d.groups,
      edges: d.edges.map((e) => `${e.source} -> ${e.target} ${e.label}`).sort(),
    };
  };
  assert.deepEqual(summary("shopView"), {
    nodes: {
      user: { kind: "person", parent: null, group: null, boundary: false },
      pay: { kind: "external", parent: null, group: null, boundary: false },
      shop: { kind: "system", parent: null, group: null, boundary: true },
      "shop.web": { kind: "container", parent: "shop", group: "group:shop:Edge", boundary: false },
      "shop.api": { kind: "container", parent: "shop", group: "group:shop:Edge", boundary: false },
      "shop.ledger": { kind: "store", parent: "shop", group: null, boundary: false },
    },
    groups: [{ id: "group:shop:Edge", name: "Edge", parent: "shop" }],
    edges: ["shop.api -> pay charges", "shop.api -> shop.ledger writes", "shop.web -> shop.api forwards", "user -> shop.web browses"],
  });
  const index = summary("index");
  assert.deepEqual(Object.keys(index.nodes).sort(), ["pay", "shop", "user"]);
  assert.equal(index.nodes["shop"]!.boundary, false);
  assert.deepEqual(index.groups, []);

  const contracts = await compileVdm(["shop.api.vdmsl", "shop.ledger.vdmsl"].map((f) => join(fixture, "..", "base", "contract", f)), () => global, new Set());
  assert.equal(contracts.kind, "ok", contracts.diagnostics.map(format).join("\n"));
  assert.deepEqual(projectLayers(c4.structure, contracts.project, elementOfModule(c4.structure)), {
    modules: [
      { module: "shop_api", element: "shop.api", title: "API", tier: "business" },
      { module: "shop_ledger", element: "shop.ledger", title: "Ledger", tier: "store" },
    ],
    imports: [{ from: "shop_api", to: "shop_ledger", names: ["OrderId"] }],
  });
}

export async function verifyRenderProjections(): Promise<number> {
  const fixture = join(import.meta.dir, "..", "render");
  const stage = mkdtempSync("/tmp/ssot-render-fixture-");
  try {
    const vdm = await compileVdm([join(fixture, "contract", "shop.worker.vdmsl")], () => global, new Set());
    assert.equal(vdm.kind, "ok", vdm.diagnostics.map(format).join("\n"));
    if (vdm.kind !== "ok") throw new Error("VDM fixture compilation failed");
    const module = vdm.project.modules[0]!;
    const box = projectBox(module);
    assert.deepEqual(box, {
      module: "shop_worker", element: "shop.worker",
      ports: [
        { name: "describe", kind: "function", inputs: ["seq of nat", "[bool]"], output: "seq of nat", ext: null },
        { name: "increment", kind: "operation", inputs: ["nat"], output: "nat", ext: { rd: [], wr: ["count"] } },
      ],
      state: { name: "Store", fields: ["count: nat"] },
    });
    assert.equal(vdmTypeName({ kind: "map", from: { kind: "ref", module: "shop_worker", name: "Input" }, to: { kind: "optional", type: { kind: "union", types: [{ kind: "quote", value: "Yes" }, { kind: "quote", value: "No" }] } } }), "map Input to [<Yes> | <No>]");
    assert.equal(vdmTypeName({ kind: "seq", element: { kind: "product", types: [{ kind: "nat" }, { kind: "bool" }] } }), "seq of (nat * bool)");
    assert.equal(vdmTypeName({ kind: "function", partial: false, params: [{ kind: "token" }], result: { kind: "set", element: { kind: "char" } } }), "(token +> set of char)");
    assert.equal(projectBox({ ...module, exports: [{ kind: "all" }] }).ports.some((port) => port.name === "hidden"), true);
    assert.equal(projectBox({ ...module, definitions: module.definitions.filter((def) => def.category !== "state") }).state, null);

    const generated = generateContract(vdm.project, new Set([module.name]), () => global);
    assert.deepEqual(generated.diagnostics, []);
    mkdirSync(join(stage, ".gen"));
    mkdirSync(join(stage, "work"));
    cpSync(join(fixture, "behavior"), join(stage, "behavior"), { recursive: true });
    writeFileSync(join(stage, ".gen", "contract.qnt"), generated.text);
    const quint = await compileBehavior(join(stage, "behavior", "wiring.qnt"), "wiring", new Set(["contract", module.name]), join(stage, "work"), (path) => path, { origins: generated.origins, subjectOf: () => global });
    assert.equal(quint.kind, "ok", quint.diagnostics.map(format).join("\n"));
    if (quint.kind !== "ok") throw new Error("Quint fixture compilation failed");
    const input: unknown = await Bun.file(quint.module.typecheckOut).json();
    const composition = projectComposition(input, quint.module, vdm.project);
    assert.deepEqual(composition, {
      module: "wiring",
      nodes: [
        { kind: "step", id: "idle" }, { kind: "step", id: "local" }, { kind: "step", id: "move" }, { kind: "step", id: "sync" },
        { kind: "wire", id: "left", type: "int" },
        { kind: "wire", id: "observer", type: "int" },
        { kind: "wire", id: "payload", type: "Api::Input" },
        { kind: "wire", id: "right", type: "int" },
        { kind: "contract", id: "shop_worker" },
      ],
      edges: [
        { kind: "put", step: "local", wire: "left" },
        { kind: "put", step: "move", wire: "left" },
        { kind: "take", wire: "right", step: "move" },
        { kind: "call", step: "move", contract: "shop_worker", operations: ["increment"] },
        { kind: "update", wire: "left", step: "sync" },
        { kind: "update", wire: "right", step: "sync" },
      ],
    });

    writeFileSync(join(stage, "behavior", "peek.qnt"), `module peek {
  import contract.* from "../.gen/contract"
  import shop_worker as Api from "../.gen/contract"
  var flag: bool
  var store: Api::Store
  var last: Call
  def seenCount: int = store.count
  action init = all { flag' = false, store' = Api::initial, last' = NoCall }
  action callAndRead = all {
    seenCount >= 0,
    flag' = flag,
    store' = { ...store, count: store.count + 1 },
    last' = shop_worker(Api::increment({ n: 1, result: 1 })),
  }
  action peekFeedback = all {
    seenCount > 0,
    flag' = true,
    store' = store,
    last' = NoCall,
  }
  action peekCall = all {
    last != NoCall,
    flag' = false,
    store' = store,
    last' = NoCall,
  }
  action step = any { callAndRead, peekFeedback, peekCall }
}
`);
    const peekCompiled = await compileBehavior(join(stage, "behavior", "peek.qnt"), "peek", new Set(["contract", module.name]), join(stage, "work"), (path) => path, { origins: generated.origins, subjectOf: () => global });
    assert.equal(peekCompiled.kind, "ok", peekCompiled.diagnostics.map(format).join("\n"));
    if (peekCompiled.kind !== "ok") throw new Error("peek.qnt compilation failed");
    const peekIr: unknown = await Bun.file(peekCompiled.module.typecheckOut).json();
    await verifyC4AndLayerProjections(stage, fixture);
    const peekDiagram = projectComposition(peekIr, peekCompiled.module, vdm.project);
    assert.deepEqual(peekDiagram, {
      module: "peek",
      nodes: [
        { kind: "step", id: "callAndRead" }, { kind: "step", id: "peekCall" }, { kind: "step", id: "peekFeedback" },
        { kind: "wire", id: "flag", type: "bool" },
        { kind: "wire", id: "last", type: "Call" },
        { kind: "contract", id: "shop_worker" },
      ],
      edges: [
        { kind: "put", step: "callAndRead", wire: "last" },
        { kind: "call", step: "callAndRead", contract: "shop_worker", operations: ["increment"] },
        { kind: "put", step: "peekCall", wire: "flag" },
        { kind: "update", wire: "last", step: "peekCall" },
        { kind: "put", step: "peekFeedback", wire: "flag" },
        { kind: "put", step: "peekFeedback", wire: "last" },
        { kind: "read", contract: "shop_worker", step: "peekFeedback" },
      ],
    });
    return 19;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
