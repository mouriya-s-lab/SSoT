import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileBehavior } from "../../scripts/src/compile/quint";
import { compileVdm } from "../../scripts/src/compile/vdm";
import { format, global } from "../../scripts/src/diag";
import { generateContract } from "../../scripts/src/gen/contract";
import { projectBox, vdmTypeName } from "../../scripts/src/render/box";
import { projectComposition } from "../../scripts/src/render/composition";
import { compositionSvg } from "../../scripts/src/render/svg";

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
    const renderedSvg = await compositionSvg(peekDiagram);
    assert.equal(renderedSvg.svg.includes('marker-end="url(#contract-arrow)"'), true);
    assert.equal(renderedSvg.svg.includes("Read · feedback"), true);
    return 13;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
