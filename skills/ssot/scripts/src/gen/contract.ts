// 生成阶段：VDM 投影 → .gen/contract.qnt。
// 输出文本、逐行来源（Quint 编译诊断据此映射回 VDM 定义）以及本阶段的诊断。
import { type Diagnostic, type Position, type Subject, assertNever, diag, global } from "../diag";
import { type VdmDefinition, type VdmField, type VdmModule, type VdmProject, type VdmType, type VdmValue, vdmPosition } from "../compile/vdm";
import { opaqueEncoding } from "../opaque";

export interface Origin {
  readonly module: string;
  readonly at: Position;
}

export interface ContractGen {
  readonly text: string;
  /** 1 起算的行号 → 生成这一行的 VDM 定义。 */
  readonly origins: ReadonlyMap<number, Origin>;
  /** 生成了 Call 的模块（有导出操作）。 */
  readonly callModules: readonly string[];
  readonly diagnostics: readonly Diagnostic[];
}

type Op = Extract<VdmDefinition, { category: "operation" }>;
type TypeDef = Extract<VdmDefinition, { category: "type" }>;

interface Line {
  readonly text: string;
  readonly origin: Origin | null;
}

class Unmappable extends Error {}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

class ModuleGen {
  readonly lines: Line[] = [];
  readonly imports = new Set<string>();
  readonly emitted = new Set<string>();
  constructor(readonly module: VdmModule) {}
}

export function generateContract(project: VdmProject, contractModules: ReadonlySet<string>, subjectOf: (module: string) => Subject): ContractGen {
  const diagnostics: Diagnostic[] = [];
  const byName = new Map(project.modules.map((m) => [m.name, m]));
  const gens = new Map<string, ModuleGen>();
  for (const m of project.modules) if (contractModules.has(m.name)) gens.set(m.name, new ModuleGen(m));

  const typeDef = (module: string, name: string): TypeDef | undefined =>
    byName.get(module)?.definitions.find((d): d is TypeDef => d.category === "type" && d.name === name);

  // 发出命名类型（及其可达的命名类型）；映射不了时抛 Unmappable，由调用处报诊断。
  const visiting = new Set<string>();
  const emitType = (module: string, name: string): void => {
    const g = gens.get(module);
    const key = `${module}\`${name}`;
    if (!g) throw new Unmappable(`类型 ${key} 所在的模块不是承载契约的元素的模块`);
    if (g.emitted.has(name)) return;
    if (visiting.has(key)) throw new Unmappable(`类型 ${key} 是递归类型，Quint 不能表示`);
    const def = typeDef(module, name);
    if (!def) throw new Unmappable(`找不到类型定义 ${key}`);
    visiting.add(key);
    try {
      const origin = { module, at: vdmPosition(def.location) };
      const enc = opaqueEncoding(project, module, name);
      if (enc?.kind === "constructor") {
        // (i) 不透明类型：Quint 存公开构造入口的入参。
        g.lines.push({ text: `  type ${name} = { ${enc.params.map((p) => `${p.name}: ${translate(module, p.type, `${name}_${p.name}`)}`).join(", ")} }`, origin });
      } else if (def.type.kind === "union" || def.type.kind === "quote") {
        const members = def.type.kind === "union" ? def.type.types : [def.type];
        g.lines.push({ text: `  type ${name} = ${sum(module, name, members)}`, origin });
      } else {
        g.lines.push({ text: `  type ${name} = ${translate(module, def.type, name)}`, origin });
      }
      g.emitted.add(name);
    } finally {
      visiting.delete(key);
    }
  };

  // 匿名并类型：在所在模块合成一个命名和类型。
  const synth: { module: string; name: string; types: readonly VdmType[]; origin: Origin }[] = [];
  let currentOrigin: Origin = { module: "", at: { file: "", line: 1, col: 1 } };

  const sum = (module: string, typeName: string, members: readonly VdmType[]): string =>
    members
      .map((t) => {
        switch (t.kind) {
          case "quote":
            return `| ${typeName}_${t.value}`;
          case "ref":
            return `| ${typeName}_${t.name}(${translate(module, t, typeName)})`;
          case "nat":
          case "nat1":
          case "int":
          case "bool":
          case "token":
            return `| ${typeName}_${t.kind}(${translate(module, t, typeName)})`;
          case "rat":
          case "real":
          case "char":
          case "void":
          case "unknown":
          case "parameter":
          case "record":
          case "seq":
          case "seq1":
          case "set":
          case "set1":
          case "map":
          case "inmap":
          case "optional":
          case "product":
          case "union":
          case "function":
          case "operation":
            throw new Unmappable(`并类型 ${typeName} 的成员只能是引号、命名类型或基本类型，遇到 ${t.kind}`);
          default:
            return assertNever(t);
        }
      })
      .join(" ");

  const translate = (module: string, t: VdmType, hint: string): string => {
    switch (t.kind) {
      case "bool":
        return "bool";
      case "nat":
      case "nat1":
      case "int":
        return "int";
      case "token":
        return "str";
      case "quote":
        return translate(module, { kind: "union", types: [t] }, hint);
      case "ref": {
        emitType(t.module, t.name);
        if (t.module === module) return t.name;
        gens.get(module)!.imports.add(t.module);
        return `${t.module}::${t.name}`;
      }
      case "record":
        return `{ ${t.fields.map((f) => `${f.name}: ${translate(module, f.type, `${hint}_${f.name}`)}`).join(", ")} }`;
      case "seq":
      case "seq1":
        return t.element.kind === "char" ? "str" : `List[${translate(module, t.element, `${hint}_Elem`)}]`;
      case "set":
      case "set1":
        return `Set[${translate(module, t.element, `${hint}_Elem`)}]`;
      case "map":
      case "inmap":
        return `${translate(module, t.from, `${hint}_Key`)} -> ${translate(module, t.to, `${hint}_Val`)}`;
      case "optional":
        gens.get(module)!.imports.add("Vdm");
        return `Vdm::Opt[${translate(module, t.type, hint)}]`;
      case "product":
        return `(${t.types.map((x, i) => translate(module, x, `${hint}_${i + 1}`)).join(", ")})`;
      case "union": {
        const name = cap(hint);
        synth.push({ module, name, types: t.types, origin: currentOrigin });
        return name;
      }
      case "char":
      case "rat":
      case "real":
      case "function":
      case "operation":
      case "parameter":
      case "void":
      case "unknown":
        throw new Unmappable(`${t.kind} 不能映射到 Quint`);
      default:
        return assertNever(t);
    }
  };

  const hasValueKind = <K extends VdmValue["kind"]>(v: VdmValue, kind: K): v is VdmValue & { readonly kind: K } => v.kind === kind;
  const expectValue = <K extends VdmValue["kind"]>(v: VdmValue, kind: K): VdmValue & { readonly kind: K } => {
    if (!hasValueKind(v, kind)) throw new Unmappable(`初态期望 ${kind} 值，实际 ${v.kind}`);
    return v;
  };
  const stringLiteral = (v: VdmValue): string => {
    const text = expectValue(v, "seq").items.map((x) => expectValue(x, "char").v).join("");
    if (text.includes('"')) throw new Unmappable("初态字符串含双引号，Quint 字符串字面量不支持转义");
    return `"${text}"`;
  };

  const renderFields = (module: string, fields: readonly VdmField[], value: VdmValue, hint: string, owner = module): string => {
    const record = expectValue(value, "record");
    return `{ ${fields.map((f) => {
      const field = record.fields.find((x) => x.name === f.name);
      if (!field) throw new Unmappable(`初态记录 ${record.name} 缺少字段 ${f.name}`);
      return `${f.name}: ${renderValue(module, f.type, field.value, `${hint}_${f.name}`, owner)}`;
    }).join(", ")} }`;
  };

  const renderValue = (module: string, t: VdmType, v: VdmValue, hint: string, owner = module): string => {
    const render = (type: VdmType, value: VdmValue, name = hint): string => renderValue(module, type, value, name, owner);
    switch (t.kind) {
      case "bool":
        return String(expectValue(v, "bool").v);
      case "nat":
      case "nat1":
      case "int": {
        const value = expectValue(v, "int").v;
        if ((t.kind === "nat" && BigInt(value) < 0n) || (t.kind === "nat1" && BigInt(value) < 1n))
          throw new Unmappable(`初态整数 ${value} 不属于 ${t.kind}`);
        return value;
      }
      case "token":
        return stringLiteral(expectValue(v, "token").v);
      case "ref": {
        const def = typeDef(t.module, t.name);
        if (!def) throw new Unmappable(`找不到类型定义 ${t.module}\`${t.name}`);
        const encoding = opaqueEncoding(project, t.module, t.name);
        if (encoding?.kind === "constructor")
          throw new Unmappable("初态含经构造入口编码的不透明值，无法反推入参");
        return renderValue(module, def.type, v, t.name, t.module);
      }
      case "record": {
        const value = expectValue(v, "record");
        if (value.module !== t.module || value.name !== t.name)
          throw new Unmappable(`初态记录 ${value.module}\`${value.name} 不属于 ${t.module}\`${t.name}`);
        return renderFields(module, t.fields, v, hint, owner);
      }
      case "seq":
      case "seq1":
        return t.element.kind === "char"
          ? stringLiteral(v)
          : `List(${expectValue(v, "seq").items.map((x) => render(t.element, x, `${hint}_Elem`)).join(", ")})`;
      case "set":
      case "set1":
        return `Set(${expectValue(v, "set").items.map((x) => render(t.element, x, `${hint}_Elem`)).join(", ")})`;
      case "map":
      case "inmap":
        return `Map(${expectValue(v, "map").entries.map(([k, x]) => `${render(t.from, k, `${hint}_Key`)} -> ${render(t.to, x, `${hint}_Val`)}`).join(", ")})`;
      case "optional":
        return v.kind === "nil" ? "Vdm::Nil" : `Vdm::Some(${render(t.type, v)})`;
      case "product": {
        const items = expectValue(v, "tuple").items;
        if (items.length !== t.types.length) throw new Unmappable("初态积类型的分量数不匹配");
        return `(${t.types.map((type, i) => render(type, items[i]!, `${hint}_${i + 1}`)).join(", ")})`;
      }
      case "quote":
      case "union": {
        const members = t.kind === "quote" ? [t] : t.types;
        for (const member of members) {
          const name = `${cap(hint)}_${member.kind === "quote" ? member.value : member.kind === "ref" ? member.name : member.kind}`;
          const variant = owner === module ? name : `${owner}::${name}`;
          if (member.kind === "quote") {
            if (v.kind === "quote" && v.v === member.value) return variant;
            continue;
          }
          try {
            return `${variant}(${render(member, v)})`;
          } catch (error) {
            if (!(error instanceof Unmappable)) throw error;
          }
        }
        throw new Unmappable(`初态值 ${v.kind} 不对应并类型 ${hint} 的可映射成员`);
      }
      case "char":
      case "rat":
      case "real":
      case "function":
      case "operation":
      case "parameter":
      case "void":
      case "unknown":
        throw new Unmappable(`${t.kind} 的初态不能映射到 Quint`);
      default:
        return assertNever(t);
    }
  };

  const report = (module: string, at: Position | null, rule: "gen.unmappable" | "gen.names", msg: string): void => {
    diagnostics.push(diag(rule, subjectOf(module), at, msg));
  };

  const callModules: string[] = [];
  for (const g of gens.values()) {
    const m = g.module;
    const exportAll = m.exports.some((e) => e.kind === "all");
    const exportedTypes = m.definitions.filter(
      (d): d is TypeDef => d.category === "type" && (exportAll || m.exports.some((e) => e.kind === "type" && e.name === d.name)),
    );
    for (const t of exportedTypes) {
      currentOrigin = { module: m.name, at: vdmPosition(t.location) };
      if (t.name === "Call") {
        report(m.name, currentOrigin.at, "gen.names", "导出类型不能叫 Call（生成的调用类型名）");
        continue;
      }
      try {
        emitType(m.name, t.name);
      } catch (e) {
        if (!(e instanceof Unmappable)) throw e;
        report(m.name, currentOrigin.at, "gen.unmappable", `类型 ${t.name}：${e.message}`);
      }
    }
    // VDM 状态也生成为 Quint 类型，Quint 状态直接用它。
    const state = m.definitions.find((d): d is Extract<VdmDefinition, { category: "state" }> => d.category === "state");
    if (state) {
      currentOrigin = { module: m.name, at: vdmPosition(state.location) };
      try {
        const fields = state.fields.map((f) => `${f.name}: ${translate(m.name, f.type, `${state.name}_${f.name}`)}`);
        g.lines.push({ text: `  type ${state.name} = { ${fields.join(", ")} }`, origin: currentOrigin });
        g.emitted.add(state.name);
        if (state.initial === null) throw new Unmappable("VDMJ 未能求出 initial");
        g.lines.push({
          text: `  pure val initial: ${state.name} = ${renderFields(m.name, state.fields, state.initial, state.name)}`,
          origin: currentOrigin,
        });
      } catch (e) {
        if (!(e instanceof Unmappable)) throw e;
        report(m.name, currentOrigin.at, "gen.unmappable", `状态 ${state.name}：${e.message}`);
      }
    }
    const ops = m.definitions.filter(
      (d): d is Op => d.category === "operation" && (exportAll || m.exports.some((e) => e.kind === "operation" && e.name === d.name)),
    );
    const variants: Line[] = [];
    for (const op of ops) {
      currentOrigin = { module: m.name, at: vdmPosition(op.location) };
      const bad = op.params.filter((p) => p.name === null);
      if (bad.length > 0) {
        report(m.name, currentOrigin.at, "gen.names", `导出操作 ${op.name} 的形参必须是标识符：${bad.map((p) => p.pattern).join(", ")}`);
        continue;
      }
      if (op.params.some((p) => p.name === "result")) {
        report(m.name, currentOrigin.at, "gen.names", `导出操作 ${op.name} 的形参不能叫 result（载荷保留字段）`);
        continue;
      }
      try {
        const fields = op.params.map((p) => `${p.name}: ${translate(m.name, p.type, `${op.name}_${p.name}`)}`);
        if (op.result.type.kind !== "void") fields.push(`result: ${translate(m.name, op.result.type, `${op.name}_Result`)}`);
        variants.push({ text: fields.length === 0 ? `    | ${op.name}` : `    | ${op.name}({ ${fields.join(", ")} })`, origin: currentOrigin });
      } catch (e) {
        if (!(e instanceof Unmappable)) throw e;
        report(m.name, currentOrigin.at, "gen.unmappable", `操作 ${op.name} 的签名：${e.message}`);
      }
    }
    // 合成的匿名并类型（可能再合成新的，循环到不再增长）。
    while (synth.length > 0) {
      const s = synth.shift()!;
      const sg = gens.get(s.module)!;
      if (sg.emitted.has(s.name)) continue;
      try {
        currentOrigin = s.origin;
        sg.lines.push({ text: `  type ${s.name} = ${sum(s.module, s.name, s.types)}`, origin: s.origin });
        sg.emitted.add(s.name);
      } catch (e) {
        if (!(e instanceof Unmappable)) throw e;
        report(s.module, s.origin.at, "gen.unmappable", `匿名并类型 ${s.name}：${e.message}`);
      }
    }
    if (variants.length > 0) {
      g.lines.push({ text: "  type Call =", origin: null }, ...variants);
      callModules.push(m.name);
    }
  }

  // 模块按 import 依赖排序；VDM import 环由 contract.imports 拒绝，投影另外检查生成类型引用是否成环。
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (n: string, path: Set<string>): void => {
    if (seen.has(n)) return;
    if (path.has(n)) {
      diagnostics.push(diag("gen.unmappable", subjectOf(n), null, `生成的 Quint 模块之间出现循环引用（经 ${[...path].join(" → ")}）`));
      return;
    }
    path.add(n);
    for (const d of [...(gens.get(n)?.imports ?? [])].sort()) if (d !== "Vdm") visit(d, path);
    path.delete(n);
    seen.add(n);
    order.push(n);
  };
  for (const n of [...gens.keys()].sort()) visit(n, new Set());

  const out: Line[] = [
    { text: "// 由 ssot gen 从 contract/*.vdmsl 生成；只读，不要手改。", origin: null },
    { text: "module Vdm {", origin: null },
    { text: "  type Opt[a] = | Nil | Some(a)", origin: null },
    { text: "}", origin: null },
  ];
  for (const n of order) {
    const g = gens.get(n)!;
    out.push({ text: `module ${n} {`, origin: null });
    for (const i of [...g.imports].sort()) out.push({ text: `  import ${i} as ${i}`, origin: null });
    out.push(...g.lines, { text: "}", origin: null });
  }
  out.push({ text: "module contract {", origin: null });
  for (const n of callModules.toSorted()) out.push({ text: `  import ${n} as ${n}`, origin: null });
  out.push({ text: "  type Call =", origin: null }, { text: "    | NoCall", origin: null });
  for (const n of callModules.toSorted()) out.push({ text: `    | ${n}(${n}::Call)`, origin: null });
  out.push({ text: "}", origin: null });

  const origins = new Map<number, Origin>();
  let line = 1;
  for (const entry of out) {
    const count = entry.text.split("\n").length;
    if (entry.origin)
      for (let offset = 0; offset < count; offset++) origins.set(line + offset, entry.origin);
    line += count;
  }
  if (gens.size === 0) diagnostics.push(diag("gen.unmappable", global, null, "没有任何承载契约的 VDM 模块", "warning"));
  return { text: `${out.map((l) => l.text).join("\n")}\n`, origins, callModules: callModules.toSorted(), diagnostics };
}
