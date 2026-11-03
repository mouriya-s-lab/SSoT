import { type EvalBind, type VdmProject, evaluate } from "./compile/vdm";
import { type Diagnostic, assertNever } from "./diag";

interface EvalFront {
  readonly diagnostics: readonly Diagnostic[];
  readonly project: VdmProject | null;
  readonly vdmFiles: readonly string[];
}

function binding(source: string): EvalBind {
  const equal = source.indexOf("=");
  const first = source.indexOf(":", equal + 1);
  const last = source.lastIndexOf(":");
  const beforeLast = source.lastIndexOf(":", last - 1);
  if (equal < 1 || first <= equal + 1 || beforeLast <= first + 1 || last <= beforeLast + 1 || last === source.length - 1) {
    throw new Error("--bind requires name=<module>:<expr>:<typeModule>:<typeName>");
  }
  return { name: source.slice(0, equal), module: source.slice(equal + 1, first), expr: source.slice(first + 1, beforeLast), typeModule: source.slice(beforeLast + 1, last), typeName: source.slice(last + 1) };
}

export async function evalCommand(front: EvalFront, args: readonly string[]): Promise<number> {
  const [module, expr, ...options] = args;
  try {
    if (!module || expr === undefined) throw new Error("eval requires <design> <module> <expression> [--bind name=<module>:<expr>:<typeModule>:<typeName>]...");
    const binds: EvalBind[] = [];
    for (let i = 0; i < options.length; i += 2) {
      if (options[i] !== "--bind" || options[i + 1] === undefined) throw new Error(`Unexpected eval option: ${options[i]}`);
      const bind = binding(options[i + 1]!);
      if (binds.some((b) => b.name === bind.name)) throw new Error(`Duplicate binding: ${bind.name}`);
      binds.push(bind);
    }
    const errors = front.diagnostics.filter((d) => d.severity === "error");
    if (!front.project || errors.length > 0) {
      console.log(JSON.stringify({ kind: "compileError", diagnostics: errors }, null, 2));
      return 1;
    }
    const results = await evaluate(front.vdmFiles, [{ module, expr, binds }]);
    const result = results[0];
    if (!result) throw new Error("VDMJ returned no evaluation result");
    console.log(JSON.stringify(result, null, 2));
    switch (result.kind) {
      case "value": return 0;
      case "error": return 1;
      default: return assertNever(result.kind);
    }
  } catch (error: unknown) {
    console.log(JSON.stringify({ kind: "commandError", message: error instanceof Error ? error.message : String(error) }, null, 2));
    return 1;
  }
}
