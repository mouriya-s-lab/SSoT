import type { Structure } from "../compile/likec4";
import { readJson, type QuintModule } from "../compile/quint";
import type { VdmProject } from "../compile/vdm";
import { type Diagnostic, assertNever, diag, element, global } from "../diag";
import { elementOfModule } from "../model";
import { isRunnable } from "./cross";

type Expr =
  | { readonly kind: "name"; readonly id: number; readonly name: string }
  | { readonly kind: "app"; readonly id: number; readonly opcode: string; readonly args: readonly Expr[] }
  | { readonly kind: "let"; readonly id: number; readonly opdef: Definition; readonly expr: Expr }
  | { readonly kind: "lambda"; readonly id: number; readonly expr: Expr }
  | { readonly kind: "int" | "bool" | "str"; readonly id: number };
interface Definition {
  readonly id: number;
  readonly kind: string;
  readonly name?: string;
  readonly expr?: Expr;
}
interface InitOutput {
  readonly modules?: readonly { readonly name: string; readonly declarations: readonly Definition[] }[];
  readonly table?: Readonly<Record<string, Definition>>;
}

/**
 * Resolve assignment targets and RHS names from Quint's unflattened, typechecked IR. The IR is the one compileBehavior wrote for
 * the staged file, so it reads this run's freshly generated contract.qnt; a module only reaches here when that typecheck had no errors.
 */
export async function initialRules(s: Structure, project: VdmProject, behavior: readonly QuintModule[]): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const owners = elementOfModule(s);
  const states = new Map(project.modules.flatMap((m) => m.definitions.flatMap((d) => d.category === "state" ? [[m.name, d.name] as const] : [])));
  for (const q of behavior.filter(isRunnable)) {
    const stateVars = q.decls.filter((d) => d.kind === "var" && d.varType !== null && states.get(d.varType.module) === d.varType.name);
    if (stateVars.length === 0) continue;
    const ir = await readJson<InitOutput>(q.typecheckOut);
    const self = ir.modules?.find((m) => m.name === q.name);
    if (!self || !ir.table) throw new Error(`Quint 初态检查缺少 ${q.name} 的类型检查 IR`);
    const table = ir.table;
    const initialIds = new Map(ir.modules!.flatMap((m) => m.declarations.flatMap((d) => d.name === "initial" ? [[m.name, d.id] as const] : [])));
    const assignments = new Map<number, Expr[]>();
    const visited = new Set<number>();
    const walk = (expr: Expr): void => {
      switch (expr.kind) {
        case "name": {
          const def = table[String(expr.id)];
          if (def?.expr && !visited.has(def.id)) {
            visited.add(def.id);
            walk(def.expr);
          }
          return;
        }
        case "app": {
          if (expr.opcode === "assign") {
            const [target, rhs] = expr.args;
            if (target?.kind === "name" && rhs) {
              const def = table[String(target.id)];
              if (def?.kind === "var") {
                const values = assignments.get(def.id) ?? [];
                values.push(rhs);
                assignments.set(def.id, values);
              }
            }
            return;
          }
          const def = table[String(expr.id)];
          if (def?.expr && !visited.has(def.id)) {
            visited.add(def.id);
            walk(def.expr);
          }
          expr.args.forEach(walk);
          return;
        }
        case "let":
        case "lambda":
          walk(expr.expr);
          return;
        case "int":
        case "bool":
        case "str":
          return;
        default:
          return assertNever(expr);
      }
    };
    const init = self.declarations.find((d) => d.name === "init");
    if (init?.expr) walk(init.expr);
    for (const variable of stateVars) {
      const module = variable.varType!.module;
      const declaration = self.declarations.find((d) => d.kind === "var" && d.name === variable.name);
      const values = declaration ? assignments.get(declaration.id) ?? [] : [];
      const initial = initialIds.get(module);
      if (values.length > 0 && initial !== undefined && values.every((rhs) => rhs.kind === "name" && table[String(rhs.id)]?.id === initial)) continue;
      diagnostics.push(diag("behavior.init", owners.has(module) ? element(owners.get(module)!) : global, q.decls.find((d) => d.name === "init")?.at ?? null,
        `${q.name}.init 必须把状态变量 ${variable.name} 直接赋值为 ${module}::initial`));
    }
  }
  return diagnostics;
}
