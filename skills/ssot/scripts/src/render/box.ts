import type { VdmModule, VdmType } from "../compile/vdm";
import { assertNever } from "../diag";

export interface BoxPort {
  readonly name: string;
  readonly kind: "operation" | "function";
  readonly inputs: readonly string[];
  readonly output: string;
  readonly ext: { readonly rd: readonly string[]; readonly wr: readonly string[] } | null;
}

export interface BoxDiagram {
  readonly module: string;
  readonly element: string;
  readonly ports: readonly BoxPort[];
  readonly state: { readonly name: string; readonly fields: readonly string[] } | null;
}

export function vdmTypeName(type: VdmType): string {
  switch (type.kind) {
    case "nat": case "nat1": case "int": case "rat": case "real": case "bool": case "char": case "token":
      return type.kind;
    case "void": return "()";
    case "unknown": return "?";
    case "parameter": return `@${type.name}`;
    case "quote": return `<${type.value}>`;
    case "ref": case "record": return type.name;
    case "seq": case "seq1": case "set": case "set1": return `${type.kind} of ${nestedType(type.element)}`;
    case "map": case "inmap": return `${type.kind} ${nestedType(type.from)} to ${nestedType(type.to)}`;
    case "optional": return `[${vdmTypeName(type.type)}]`;
    case "product": return type.types.map(nestedType).join(" * ");
    case "union": return type.types.map(vdmTypeName).join(" | ");
    case "function": return `(${type.params.map(vdmTypeName).join(" * ") || "()"} ${type.partial ? "->" : "+>"} ${vdmTypeName(type.result)})`;
    case "operation": return `(${type.params.map(vdmTypeName).join(" * ") || "()"} ==> ${vdmTypeName(type.result)})`;
    default: return assertNever(type);
  }
}

function nestedType(type: VdmType): string {
  const text = vdmTypeName(type);
  return type.kind === "union" || type.kind === "product" ? `(${text})` : text;
}

export function projectBox(module: VdmModule): BoxDiagram {
  const all = module.exports.some((entry) => entry.kind === "all");
  const exports = new Set(module.exports.flatMap((entry) => entry.kind === "operation" || entry.kind === "function" ? [`${entry.kind}:${entry.name}`] : []));
  const ports: BoxPort[] = [];
  for (const definition of module.definitions) {
    if ((definition.category === "operation" || definition.category === "function") && (all || exports.has(`${definition.category}:${definition.name}`))) {
      ports.push({ name: definition.name, kind: definition.category, inputs: definition.params.map((param) => vdmTypeName(param.type)), output: vdmTypeName(definition.result.type), ext: definition.ext });
    }
  }
  const state = module.definitions.find((definition) => definition.category === "state");
  return {
    module: module.name,
    element: module.name.replaceAll("_", "."),
    ports,
    state: state?.category === "state" ? { name: state.name, fields: state.fields.map((field) => `${field.name}: ${vdmTypeName(field.type)}`) } : null,
  };
}
