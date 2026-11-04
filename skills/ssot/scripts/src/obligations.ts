import type { Structure } from "./compile/likec4";
import { type POStatus, type ProofObligation, vdmPosition } from "./compile/vdm";
import { type Diagnostic, assertNever, diag, element, global } from "./diag";
import { elementOfModule } from "./model";

/** QuickCheck owns the outcome; unresolved obligations are information, never refutations. */
export function obligationRules(structure: Structure, obligations: readonly ProofObligation[]): { readonly diagnostics: Diagnostic[]; readonly summary: string } {
  const owner = elementOfModule(structure);
  const diagnostics: Diagnostic[] = [];
  const counts = new Map<POStatus, number>();
  for (const po of obligations) {
    counts.set(po.status, (counts.get(po.status) ?? 0) + 1);
    const subject = owner.has(po.module) ? element(owner.get(po.module)!) : global;
    const details = [`PO #${po.number} ${po.module}\`${po.name} (${po.kind}): ${po.status}`, po.checkable ? null : "not checkable", po.qualifier, po.message].filter((x) => x !== null).join("; ");
    switch (po.status) {
      case "PROVABLE":
        break;
      case "FAILED": {
        const bindings = Object.entries(po.counterexample).map(([name, value]) => `${name} = ${value}`).join(", ");
        diagnostics.push(diag("contract.po", subject, vdmPosition(po.location), `${details}; counterexample: ${bindings || "(no bindings)"}`));
        break;
      }
      case "UNPROVED":
      case "MAYBE":
      case "UNCHECKED":
        diagnostics.push(diag("contract.po", subject, vdmPosition(po.location), details, "info"));
        break;
      default:
        return assertNever(po.status);
    }
  }
  return { diagnostics, summary: `QuickCheck: ${obligations.length} POs; ${[...counts].sort(([a], [b]) => a.localeCompare(b)).map(([status, count]) => `${status}=${count}`).join(", ") || "(none)"}` };
}
