import type { QuintModule } from "../compile/quint";
import type { VdmProject } from "../compile/vdm";
import { assertNever } from "../diag";

/** Steps are boxes, behavior variables are wires between them, contract modules are the boxes the steps call. */
export type CompositionNode =
  | { readonly kind: "step"; readonly id: string }
  | { readonly kind: "wire"; readonly id: string; readonly type: string }
  | { readonly kind: "contract"; readonly id: string };
export type CompositionEdge =
  | { readonly kind: "put"; readonly step: string; readonly wire: string }
  | { readonly kind: "take"; readonly wire: string; readonly step: string }
  | { readonly kind: "update"; readonly wire: string; readonly step: string }
  | { readonly kind: "call"; readonly step: string; readonly contract: string; readonly operations: readonly string[] };
export interface CompositionDiagram {
  readonly module: string;
  readonly nodes: readonly CompositionNode[];
  readonly edges: readonly CompositionEdge[];
}

type Expr =
  | { readonly kind: "name"; readonly id: number }
  | { readonly kind: "app"; readonly id: number; readonly opcode: string; readonly args: readonly Expr[] }
  | { readonly kind: "lambda"; readonly id: number; readonly params: readonly number[]; readonly expr: Expr }
  | { readonly kind: "let"; readonly id: number; readonly definition: Definition; readonly expr: Expr }
  | { readonly kind: "str"; readonly id: number; readonly value: string }
  | { readonly kind: "int" | "bool"; readonly id: number };
type Definition =
  | { readonly kind: "def"; readonly id: number; readonly name: string; readonly qualifier: string; readonly expr: Expr }
  | { readonly kind: "var"; readonly id: number; readonly name: string; readonly type: string }
  | { readonly kind: "typedef" | "param" | "const"; readonly id: number; readonly name: string };
interface IrModule { readonly name: string; readonly declarations: readonly Definition[] }
interface Ir { readonly modules: readonly IrModule[]; readonly table: ReadonlyMap<number, Definition> }
interface Bound { readonly expr: Expr; readonly bindings: Bindings }
type Bindings = ReadonlyMap<number, Bound>;

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Quint 图投影需要 IR 对象");
  return value as Readonly<Record<string, unknown>>;
}
function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error("Quint 图投影需要 IR 数组");
  return value;
}
function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Quint 图投影需要 IR 字符串");
  return value;
}
function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error("Quint 图投影需要 IR 整数 id");
  return value;
}
function rowName(value: unknown, positional = false): string {
  const row = record(value);
  switch (row.kind) {
    case "empty": return "";
    case "var": return `...${text(row.name)}`;
    case "row": return [...array(row.fields).map((value) => { const field = record(value); return positional ? typeName(field.fieldType) : `${text(field.fieldName)}: ${typeName(field.fieldType)}`; }), rowName(row.other, positional)].filter(Boolean).join(", ");
    default: throw new Error(`不支持的 Quint row: ${String(row.kind)}`);
  }
}
function typeName(value: unknown): string {
  const type = record(value);
  switch (type.kind) {
    case "bool": case "int": case "str": return type.kind;
    case "const": case "var": return text(type.name);
    case "set": return `Set[${typeName(type.elem)}]`;
    case "list": return `List[${typeName(type.elem)}]`;
    case "fun": return `(${typeName(type.arg)} -> ${typeName(type.res)})`;
    case "oper": return `(${array(type.args).map(typeName).join(", ")}) => ${typeName(type.res)}`;
    case "rec": return `{ ${rowName(type.fields)} }`;
    case "tup": return `(${rowName(type.fields, true)})`;
    case "sum": return rowName(type.fields);
    case "app": return `${typeName(type.ctor)}[${array(type.args).map(typeName).join(", ")}]`;
    default: throw new Error(`不支持的 Quint type: ${String(type.kind)}`);
  }
}
function expression(value: unknown): Expr {
  const expr = record(value), id = number(expr.id);
  switch (expr.kind) {
    case "name": return { kind: "name", id };
    case "app": return { kind: "app", id, opcode: text(expr.opcode), args: array(expr.args).map(expression) };
    case "lambda": return { kind: "lambda", id, params: array(expr.params).map((param) => number(record(param).id)), expr: expression(expr.expr) };
    case "let": {
      const def = definition(expr.opdef);
      if (!def || def.kind !== "def") throw new Error("Quint let 缺少定义");
      return { kind: "let", id, definition: def, expr: expression(expr.expr) };
    }
    case "str": return { kind: "str", id, value: text(expr.value) };
    case "int": case "bool": return { kind: expr.kind, id };
    default: throw new Error(`不支持的 Quint expression: ${String(expr.kind)}`);
  }
}
function definition(value: unknown): Definition | null {
  const def = record(value);
  switch (def.kind) {
    case "def": return { kind: "def", id: number(def.id), name: text(def.name), qualifier: text(def.qualifier), expr: expression(def.expr) };
    case "var": return { kind: "var", id: number(def.id), name: text(def.name), type: typeName(def.typeAnnotation) };
    case "typedef": case "param": case "const": return { kind: def.kind, id: number(def.id), name: text(def.name) };
    case "import": case "export": case "instance": case "assume": return null;
    default: throw new Error(`不支持的 Quint declaration: ${String(def.kind)}`);
  }
}
function parseIr(value: unknown): Ir {
  const ir = record(value);
  return {
    modules: array(ir.modules).map((value) => {
      const module = record(value);
      return { name: text(module.name), declarations: array(module.declarations).flatMap((value) => { const def = definition(value); return def ? [def] : []; }) };
    }),
    table: new Map(Object.entries(record(ir.table)).flatMap(([key, value]) => { const def = definition(value); return def ? [[Number(key), def] as const] : []; })),
  };
}

/** Compiler IDs, not surface aliases, identify every variable, definition and Call constructor. */
export function projectComposition(input: unknown, module: QuintModule, project: VdmProject): CompositionDiagram {
  const ir = parseIr(input);
  const self = ir.modules.find((entry) => entry.name === module.name);
  if (!self) throw new Error(`Quint 图投影缺少模块 ${module.name}`);
  const states = new Map(project.modules.flatMap((entry) => entry.definitions.flatMap((def) => def.category === "state" ? [[entry.name, def.name] as const] : [])));
  const excluded = new Set(module.decls.filter((decl) => decl.kind === "var" && (decl.isCallVar || (decl.varType !== null && states.get(decl.varType.module) === decl.varType.name))).map((decl) => decl.name));
  const vars = new Map(self.declarations.flatMap((def) => def.kind === "var" && !excluded.has(def.name) ? [[def.id, def] as const] : []));
  const declaredIn = new Map(ir.modules.flatMap((entry) => entry.declarations.map((def) => [def.id, entry.name] as const)));
  const locateNested = (expr: Expr, owner: string): void => {
    switch (expr.kind) {
      case "let":
        declaredIn.set(expr.definition.id, owner);
        if (expr.definition.kind === "def") locateNested(expr.definition.expr, owner);
        locateNested(expr.expr, owner);
        return;
      case "lambda": locateNested(expr.expr, owner); return;
      case "app": expr.args.forEach((arg) => locateNested(arg, owner)); return;
      case "name": case "str": case "int": case "bool": return;
      default: return assertNever(expr);
    }
  };
  for (const entry of ir.modules) for (const def of entry.declarations) if (def.kind === "def") locateNested(def.expr, entry.name);
  const contractNames = new Set(project.modules.map((entry) => entry.name));
  const constructors = new Map(ir.modules.filter((entry) => entry.name === "contract").flatMap((entry) => entry.declarations.flatMap((def) => def.kind === "def" && contractNames.has(def.name) ? [[def.id, def.name] as const] : [])));
  const step = self.declarations.find((def) => def.kind === "def" && def.name === "step");
  if (!step || step.kind !== "def") throw new Error(`Quint 图投影缺少 ${module.name}.step`);
  const resolve = (expr: Expr): Definition | undefined => ir.table.get(expr.id);
  const dereference = (bound: Bound, active = new Set<number>()): Bound => {
    if (bound.expr.kind !== "name") return bound;
    const def = resolve(bound.expr);
    if (!def || active.has(def.id)) return bound;
    const next = bound.bindings.get(def.id);
    if (!next) return bound;
    active.add(def.id);
    return dereference(next, active);
  };
  const instantiate = (expr: Expr, args: readonly Expr[], bindings: Bindings): Bound => {
    if (expr.kind !== "lambda") return { expr, bindings };
    const nested = new Map(bindings);
    expr.params.forEach((id, index) => { const arg = args[index]; if (arg) nested.set(id, { expr: arg, bindings }); });
    return { expr: expr.expr, bindings: nested };
  };
  type Visit = (expr: Expr, bindings: Bindings, active: Set<number>) => "descend" | "stop";
  const walk = (bound: Bound, active: Set<number>, visit: Visit): void => {
    const { expr, bindings } = dereference(bound);
    if (visit(expr, bindings, active) === "stop") return;
    const expand = (args: readonly Expr[]): void => {
      const def = resolve(expr);
      if (def?.kind !== "def" || active.has(def.id) || declaredIn.get(def.id) !== module.name) return;
      active.add(def.id);
      walk(instantiate(def.expr, args, bindings), active, visit);
      active.delete(def.id);
    };
    switch (expr.kind) {
      case "name": expand([]); return;
      case "app": expand(expr.args); expr.args.forEach((arg) => walk({ expr: arg, bindings }, active, visit)); return;
      case "lambda": walk({ expr: expr.expr, bindings }, active, visit); return;
      case "let": walk({ expr: expr.expr, bindings }, active, visit); return;
      case "str": case "int": case "bool": return;
      default: return assertNever(expr);
    }
  };
  const actions = new Map<number, Extract<Definition, { kind: "def" }>>();
  walk({ expr: step.expr, bindings: new Map() }, new Set([step.id]), (expr) => {
    const def = resolve(expr);
    if (def?.kind === "def" && def.qualifier === "action" && declaredIn.get(def.id) === module.name && def.id !== step.id) {
      actions.set(def.id, def);
      return "stop";
    }
    return "descend";
  });
  const edges: CompositionEdge[] = [];
  const contracts = new Set<string>();
  for (const def of self.declarations) if (def.kind === "def") {
    walk({ expr: def.expr, bindings: new Map() }, new Set([def.id]), (expr) => {
      const resolved = ir.table.get(expr.id);
      const contract = resolved ? constructors.get(resolved.id) : undefined;
      if (contract && expr.kind === "app") contracts.add(contract);
      return "descend";
    });
  }
  for (const action of [...actions.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const changed = new Set<string>(), reads = new Set<string>();
    const calls = new Map<string, Set<string>>();
    // Inside `v' = e`, reading v carries the wire's remaining value forward; only reads elsewhere take from the wire.
    let carried: number | null = null;
    const visit: Visit = (expr, bindings, active) => {
      if (expr.kind === "app" && expr.opcode === "assign") {
        const [lhs, rhs] = expr.args;
        if (!lhs || !rhs) throw new Error("Quint assign 缺少参数");
        const target = resolve(dereference({ expr: lhs, bindings }).expr);
        const value = dereference({ expr: rhs, bindings });
        if (target?.kind === "var" && value.expr.kind === "name" && resolve(value.expr)?.id === target.id) return "stop";
        if (target?.kind === "var" && vars.has(target.id)) changed.add(target.name);
        carried = target?.kind === "var" ? target.id : null;
        walk(value, active, visit);
        carried = null;
        return "stop";
      }
      const def = resolve(expr);
      if (expr.kind === "name" && def?.kind === "var" && vars.has(def.id) && def.id !== carried) reads.add(def.name);
      const contract = def ? constructors.get(def.id) : undefined;
      if (contract && expr.kind === "app") {
        const arg = expr.args[0];
        if (!arg) throw new Error(`Quint Call ${contract} 缺少操作`);
        const operation = dereference({ expr: arg, bindings }).expr;
        const operationDef = resolve(operation);
        if (!operationDef || declaredIn.get(operationDef.id) !== contract) throw new Error(`Quint Call ${contract} 无法解析操作身份`);
        contracts.add(contract);
        const names = calls.get(contract) ?? new Set<string>();
        names.add(operationDef.name);
        calls.set(contract, names);
      }
      return "descend";
    };
    walk({ expr: action.expr, bindings: new Map() }, new Set([action.id]), visit);
    for (const wire of [...new Set([...reads, ...changed])].sort()) {
      if (!changed.has(wire)) edges.push({ kind: "take", wire, step: action.name });
      else if (!reads.has(wire)) edges.push({ kind: "put", step: action.name, wire });
      else edges.push({ kind: "update", wire, step: action.name });
    }
    for (const [contract, operations] of [...calls].sort(([a], [b]) => a.localeCompare(b))) edges.push({ kind: "call", step: action.name, contract, operations: [...operations].sort() });
  }
  return {
    module: module.name,
    nodes: [
      ...[...actions.values()].map((def) => def.name).sort().map((id): CompositionNode => ({ kind: "step", id })),
      ...[...vars.values()].sort((a, b) => a.name.localeCompare(b.name)).map((def): CompositionNode => ({ kind: "wire", id: def.name, type: def.type })),
      ...[...contracts].sort().map((id): CompositionNode => ({ kind: "contract", id })),
    ],
    edges,
  };
}
