import assert from "node:assert/strict";
import type { QuintModule } from "../../scripts/src/compile/quint";
import { requirementAttachments } from "../../scripts/src/requirements";

export function verifyRequirementProjections(): number {
  const file = "/design/behavior/example.qnt";
  const module: QuintModule = {
    file, name: "example", typecheckOut: "/tmp/unused.json",
    decls: [{ name: "marker", kind: "pureval", at: null, modules: [], references: [], intLiteral: null, varType: null, isCallVar: false }],
  };
  const text = "// REQ-1\nmodule example {\n  // REQ-2\n  pure val marker = true\n}\n";
  const absent = requirementAttachments(new Map([[file, text]]), null, [module]);
  assert.deepEqual([...absent.keys()], ["REQ-1"], "missing declaration position does not guess its location");
  assert.equal(absent.get("REQ-1")?.[0]?.declaration, "module", "module-line fallback remains usable");
  const located = { ...module, decls: module.decls.map((d) => ({ ...d, at: { file, line: 4, col: 3 } })) };
  const attached = requirementAttachments(new Map([[file, text]]), null, [located]);
  assert.equal(attached.get("REQ-2")?.[0]?.declaration, "marker", "declaration uses compiler-projected first line");
  assert.deepEqual([...requirementAttachments(new Map(), null, [located])], [], "unavailable source cannot create attachment");
  return 4;
}
