import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileBehavior } from "../../scripts/src/compile/quint";
import { compileVdm } from "../../scripts/src/compile/vdm";
import { format, global } from "../../scripts/src/diag";
import { generateContract } from "../../scripts/src/gen/contract";
import { projectBox, vdmTypeName } from "../../scripts/src/render/box";
import { projectComposition } from "../../scripts/src/render/composition";

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
    return 10;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
