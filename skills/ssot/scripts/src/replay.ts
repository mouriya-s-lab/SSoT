// 回放阶段：把 Quint 轨迹里的每次契约调用，交给定义该操作的 VDM 模块，对原样规格求 pre、post 与 frame；
// 轨迹初态与 VDM 的 initial 比较；状态变量在不是本模块调用的一步里变化即报 behavior.call；统计结果并类型各变体在回放中出现的次数。
// 值的转换只由 VDM 类型树与 contract.qnt 的生成规则决定（render）；不透明类型经 opaque.ts 的同一决定重建。
import type { Structure } from "./compile/likec4";
import type { QuintModule } from "./compile/quint";
import { type EvalBind, type EvalResult, type VdmDefinition, type VdmLocation, type VdmProject, type VdmType, type VdmValue, evaluate, vdmPosition } from "./compile/vdm";
import { type Diagnostic, type RuleId, type Subject, assertNever, diag, element, global } from "./diag";
import type { ItfTrace, ItfValue } from "./itf";
import { elementOfModule } from "./model";
import { opaqueEncoding } from "./opaque";

export interface ReplayInput {
  readonly structure: Structure;
  readonly project: VdmProject;
  readonly vdmFiles: readonly string[];
  readonly module: QuintModule;
  readonly callVar: string | null;
  readonly traces: readonly ItfTrace[];
  /** null for full replay; otherwise only calls owned by these generated modules. */
  readonly callModules: ReadonlySet<string> | null;
}

type Op = Extract<VdmDefinition, { category: "operation" }>;
type State = Extract<VdmDefinition, { category: "state" }>;
type Named = Extract<VdmDefinition, { category: "type" | "state" }>;

class Unrenderable extends Error {}

const vdmString = (s: string): string => `"${s.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
const vdmChar = (c: string): string => `'${c.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
/** contract.qnt 里并类型成员的变体名后缀（gen/contract.ts 的 sum）。 */
const memberName = (t: VdmType): string => (t.kind === "quote" ? t.value : t.kind === "ref" ? t.name : t.kind);

/** 一个表达式及它需要的不透明值绑定（按依赖次序）。 */
interface Rendered {
  readonly expr: string;
  readonly binds: readonly EvalBind[];
}

function renderer(project: VdmProject) {
  const mod = new Map(project.modules.map((m) => [m.name, m]));
  const namedType = (module: string, name: string): Named | undefined =>
    mod.get(module)?.definitions.find((x): x is Named => (x.category === "type" || x.category === "state") && x.name === name);
  /** 不透明值：使用方模块不是定义模块时，在定义模块里构造（inner），以该类型绑定进来。 */
  const opaqueBind = (module: string, typeModule: string, typeName: string, inner: string, binds: EvalBind[]): string => {
    if (typeModule === module) return inner;
    const name = `ssot_${Bun.hash(`${typeModule}\u0000${inner}`).toString(16)}`;
    if (!binds.some((b) => b.name === name)) binds.push({ name, module: typeModule, expr: inner, typeModule, typeName });
    return name;
  };

  // contract.qnt 生成规则的逆：Quint 值 → 在 module 里求值的 VDM 表达式文本。
  const hasTag = <K extends ItfValue["t"]>(v: ItfValue, t: K): v is Extract<ItfValue, { t: K }> => v.t === t;
  const expect = <K extends ItfValue["t"]>(v: ItfValue, t: K, what: string): Extract<ItfValue, { t: K }> => {
    if (!hasTag(v, t)) throw new Unrenderable(`${what} 期望 Quint ${t}，实际 ${v.t}`);
    return v;
  };
  const field = (v: ItfValue, f: string, what: string): ItfValue => {
    const r = expect(v, "rec", what);
    if (!r.fields.has(f)) throw new Unrenderable(`${what} 缺少字段 ${f}`);
    return r.fields.get(f)!;
  };

  const render = (module: string, t: VdmType, v: ItfValue, what: string, binds: EvalBind[]): string => {
    const r = (tt: VdmType, vv: ItfValue, w: string): string => render(module, tt, vv, w, binds);
    switch (t.kind) {
      case "bool":
        return String(expect(v, "bool", what).v);
      case "nat":
      case "nat1":
      case "int":
        return String(expect(v, "int", what).v);
      case "token":
        return `mk_token(${vdmString(expect(v, "str", what).v)})`;
      case "quote":
      case "union": {
        const x = expect(v, "variant", what);
        const members = t.kind === "union" ? t.types : [t];
        const m = members.find((y) => x.tag.endsWith(`_${memberName(y)}`));
        if (!m) throw new Unrenderable(`${what} 的变体 ${x.tag} 不对应任何并类型成员`);
        return m.kind === "quote" ? `<${m.value}>` : r(m, x.value, what);
      }
      case "seq":
      case "seq1":
        if (t.element.kind === "char") return vdmString(expect(v, "str", what).v);
        return `[${expect(v, "list", what).items.map((x) => r(t.element, x, what)).join(", ")}]`;
      case "set":
      case "set1":
        return `{${expect(v, "set", what).items.map((x) => r(t.element, x, what)).join(", ")}}`;
      case "map":
      case "inmap": {
        const es = expect(v, "map", what).entries;
        return es.length === 0 ? "{|->}" : `{${es.map(([k, x]) => `${r(t.from, k, what)} |-> ${r(t.to, x, what)}`).join(", ")}}`;
      }
      case "optional": {
        const x = expect(v, "variant", what);
        return x.tag === "Nil" ? "nil" : r(t.type, x.value, what);
      }
      case "product":
        return `mk_(${expect(v, "tup", what).items.map((x, i) => r(t.types[i]!, x, what)).join(", ")})`;
      case "record":
        return `mk_${t.module}\`${t.name}(${t.fields.map((f) => r(f.type, field(v, f.name, what), `${what}.${f.name}`)).join(", ")})`;
      case "ref": {
        const d = namedType(t.module, t.name);
        if (!d) throw new Unrenderable(`找不到类型 ${t.module}\`${t.name}`);
        if (d.category === "state")
          return `mk_${t.module}\`${d.name}(${d.fields.map((f) => r(f.type, field(v, f.name, what), `${what}.${f.name}`)).join(", ")})`;
        const enc = opaqueEncoding(project, t.module, t.name);
        if (enc === null) return r(d.type, v, what);
        // 不透明类型：在定义模块里经 (i) 公开构造入口或 (ii) 结构构造。
        const inner =
          enc.kind === "constructor"
            ? `${enc.fn}(${enc.params.map((p) => render(t.module, p.type, field(v, p.name!, what), `${what}.${p.name}`, binds)).join(", ")})`
            : render(t.module, enc.underlying, v, what, binds);
        return opaqueBind(module, t.module, t.name, inner, binds);
      }
      case "char":
      case "rat":
      case "real":
      case "function":
      case "operation":
      case "parameter":
      case "void":
      case "unknown":
        throw new Unrenderable(`${t.kind} 没有 Quint 表示`);
      default:
        return assertNever(t);
    }
  };

  // VDMJ 求得的值（VdmValue，例如状态的 initial）→ 在 module 里求值的 VDM 表达式文本。值就是真实表示，不透明类型一律在定义模块里按结构构造。
  const expectValue = <K extends VdmValue["kind"]>(v: VdmValue, kind: K, what: string): VdmValue & { readonly kind: K } => {
    const hit = (x: VdmValue): x is VdmValue & { readonly kind: K } => x.kind === kind;
    if (!hit(v)) throw new Unrenderable(`${what} 期望 VDM ${kind} 值，实际 ${v.kind}`);
    return v;
  };
  /** token 的内容没有类型树可依，按值本身写出。 */
  const untyped = (v: VdmValue): string => {
    switch (v.kind) {
      case "bool":
        return String(v.v);
      case "int":
        return v.v;
      case "char":
        return vdmChar(v.v);
      case "quote":
        return `<${v.v}>`;
      case "nil":
        return "nil";
      case "token":
        return `mk_token(${untyped(v.v)})`;
      case "seq":
        return v.items.length > 0 && v.items.every((x) => x.kind === "char")
          ? vdmString(v.items.map((x) => (x.kind === "char" ? x.v : "")).join(""))
          : `[${v.items.map(untyped).join(", ")}]`;
      case "set":
        return `{${v.items.map(untyped).join(", ")}}`;
      case "tuple":
        return `mk_(${v.items.map(untyped).join(", ")})`;
      case "map":
        return v.entries.length === 0 ? "{|->}" : `{${v.entries.map(([k, x]) => `${untyped(k)} |-> ${untyped(x)}`).join(", ")}}`;
      case "record":
        return `mk_${v.module}\`${v.name}(${v.fields.map((f) => untyped(f.value)).join(", ")})`;
      default:
        return assertNever(v);
    }
  };
  /** 并类型里 v 属于哪个成员。 */
  const accepts = (t: VdmType, v: VdmValue): boolean => {
    switch (t.kind) {
      case "quote":
        return v.kind === "quote" && v.v === t.value;
      case "bool":
      case "char":
      case "token":
        return v.kind === t.kind;
      case "nat":
      case "nat1":
      case "int":
        return v.kind === "int";
      case "seq":
      case "seq1":
        return v.kind === "seq";
      case "set":
      case "set1":
        return v.kind === "set";
      case "map":
      case "inmap":
        return v.kind === "map";
      case "product":
        return v.kind === "tuple";
      case "optional":
        return v.kind === "nil" || accepts(t.type, v);
      case "record":
        return v.kind === "record" && v.module === t.module && v.name === t.name;
      case "union":
        return t.types.some((x) => accepts(x, v));
      case "ref": {
        const d = namedType(t.module, t.name);
        if (d === undefined) return false;
        return d.category === "state" ? v.kind === "record" && v.module === t.module && v.name === d.name : accepts(d.type, v);
      }
      case "rat":
      case "real":
      case "function":
      case "operation":
      case "parameter":
      case "void":
      case "unknown":
        return false;
      default:
        return assertNever(t);
    }
  };
  const renderValue = (module: string, t: VdmType, v: VdmValue, what: string, binds: EvalBind[]): string => {
    const r = (tt: VdmType, vv: VdmValue, w: string): string => renderValue(module, tt, vv, w, binds);
    const recordOf = (rm: string, rn: string, fields: readonly { readonly name: string; readonly type: VdmType }[]): string => {
      const x = expectValue(v, "record", what);
      const parts = fields.map((f) => {
        const fv = x.fields.find((y) => y.name === f.name);
        if (!fv) throw new Unrenderable(`${what} 缺少字段 ${f.name}`);
        return r(f.type, fv.value, `${what}.${f.name}`);
      });
      return `mk_${rm}\`${rn}(${parts.join(", ")})`;
    };
    switch (t.kind) {
      case "bool":
        return String(expectValue(v, "bool", what).v);
      case "nat":
      case "nat1":
      case "int":
        return expectValue(v, "int", what).v;
      case "char":
        return vdmChar(expectValue(v, "char", what).v);
      case "token":
        return untyped(expectValue(v, "token", what));
      case "quote":
        return `<${expectValue(v, "quote", what).v}>`;
      case "union": {
        const m = t.types.find((x) => accepts(x, v));
        if (!m) throw new Unrenderable(`${what} 的值 ${untyped(v)} 不属于并类型的任何成员`);
        return r(m, v, what);
      }
      case "seq":
      case "seq1":
        return `[${expectValue(v, "seq", what).items.map((x) => r(t.element, x, what)).join(", ")}]`;
      case "set":
      case "set1":
        return `{${expectValue(v, "set", what).items.map((x) => r(t.element, x, what)).join(", ")}}`;
      case "map":
      case "inmap": {
        const es = expectValue(v, "map", what).entries;
        return es.length === 0 ? "{|->}" : `{${es.map(([k, x]) => `${r(t.from, k, what)} |-> ${r(t.to, x, what)}`).join(", ")}}`;
      }
      case "optional":
        return v.kind === "nil" ? "nil" : r(t.type, v, what);
      case "product": {
        const items = expectValue(v, "tuple", what).items;
        if (items.length !== t.types.length) throw new Unrenderable(`${what} 的元组长度 ${items.length} 与类型不符`);
        return `mk_(${items.map((x, i) => r(t.types[i]!, x, what)).join(", ")})`;
      }
      case "record":
        return recordOf(t.module, t.name, t.fields);
      case "ref": {
        const d = namedType(t.module, t.name);
        if (!d) throw new Unrenderable(`找不到类型 ${t.module}\`${t.name}`);
        if (d.category === "state") return recordOf(t.module, d.name, d.fields);
        if (opaqueEncoding(project, t.module, t.name) === null) return r(d.type, v, what);
        return opaqueBind(module, t.module, t.name, renderValue(t.module, d.type, v, what, binds), binds);
      }
      case "rat":
      case "real":
      case "function":
      case "operation":
      case "parameter":
      case "void":
      case "unknown":
        throw new Unrenderable(`${t.kind} 的值不能还原成 VDM 表达式`);
      default:
        return assertNever(t);
    }
  };

  /** 操作结果是并类型时，contract.qnt 里它的全部变体名（gen/contract.ts 的命名）；否则 null。不透明构造入口编码的类型在 Quint 里是记录，不是并类型。 */
  const unionVariants = (op: Op): readonly string[] | null => {
    const named = (module: string, name: string): readonly string[] | null => {
      const d = namedType(module, name);
      if (d === undefined || d.category !== "type" || opaqueEncoding(project, module, name)?.kind === "constructor") return null;
      if (d.type.kind === "union") return d.type.types.map((m) => `${name}_${memberName(m)}`);
      return d.type.kind === "ref" ? named(d.type.module, d.type.name) : null;
    };
    const t = op.result.type;
    if (t.kind === "union") {
      const typeName = `${op.name.charAt(0).toUpperCase()}${op.name.slice(1)}_Result`;
      return t.types.map((m) => `${typeName}_${memberName(m)}`);
    }
    return t.kind === "ref" ? named(t.module, t.name) : null;
  };

  return { itf: render, value: renderValue, unionVariants };
}

/** ITF 值的结构化规范形：集合、映射、记录与元素次序无关；每种值带各自的前缀与括号，不同的值不会得到相同的文本。 */
function canon(v: ItfValue): string {
  switch (v.t) {
    case "int":
      return `i${v.v}`;
    case "str":
      return `s${JSON.stringify(v.v)}`;
    case "bool":
      return `b${v.v}`;
    case "tup":
      return `t(${v.items.map(canon).join(",")})`;
    case "list":
      return `l[${v.items.map(canon).join(",")}]`;
    case "set":
      return `S{${v.items.map(canon).sort().join(",")}}`;
    case "map":
      return `M{${v.entries.map(([k, x]) => `${canon(k)}:${canon(x)}`).sort().join(",")}}`;
    case "rec":
      return `r{${[...v.fields].map(([k, x]) => `${JSON.stringify(k)}=${canon(x)}`).sort().join(",")}}`;
    case "variant":
      return `v${JSON.stringify(v.tag)}(${canon(v.value)})`;
    default:
      return assertNever(v);
  }
}

/** frame 表达式的结果：VDMJ 求出的布尔序列（java/Vdm.java 的 value()）；不是布尔序列时为 null。 */
function boolItems(value: unknown): readonly boolean[] | null {
  if (typeof value !== "object" || value === null || !("kind" in value) || value.kind !== "seq" || !("items" in value) || !Array.isArray(value.items)) return null;
  const out: boolean[] = [];
  for (const x of value.items as readonly unknown[]) {
    if (typeof x !== "object" || x === null || !("value" in x) || typeof x.value !== "boolean") return null;
    out.push(x.value);
  }
  return out;
}

/** 4055：被调用的函数（含不透明值的构造入口）的 pre 不成立；4060/4079：类型或状态不变式被破坏。 */
function errorRule(e: EvalResult): RuleId {
  return e.number === 4055 ? "replay.pre" : e.number === 4060 || e.number === 4079 ? "replay.inv" : "replay.eval";
}

/** 一次被回放的调用：post 只在 pre 成立（或没有 pre）时判定；frame 每步都判定。 */
interface Step {
  readonly module: string;
  readonly op: Op;
  readonly pre: Rendered | null;
  readonly post: Rendered | null;
  /** ext rd 的分量与没有写到的分量，按 fields 的次序逐一比较前后状态；没有要比较的分量时为 null。 */
  readonly frame: { readonly fields: readonly string[]; readonly r: Rendered } | null;
  /** 结果并类型在这一步取到的变体名；结果不是并类型时为 null。 */
  readonly outcome: string | null;
  readonly where: string;
}

/** 一条轨迹的初态检查：生成状态变量的第 0 个值 = VDM 的 initial。 */
interface Initial {
  readonly module: string;
  readonly state: State;
  readonly r: Rendered;
  readonly where: string;
}

export interface ReplayOutcome {
  readonly diagnostics: readonly Diagnostic[];
  /** `模块\`操作` → 回放的步数。 */
  readonly replayed: ReadonlyMap<string, number>;
  /** `模块\`操作` → 结果并类型的变体名 → 在回放中出现的次数（未出现的变体计 0）。 */
  readonly outcomes: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

const keyOf = (module: string, r: Rendered): string => JSON.stringify([module, r.expr, r.binds]);

export async function replay(input: ReplayInput): Promise<ReplayOutcome> {
  if (input.callVar === null) return { diagnostics: [], replayed: new Map(), outcomes: new Map() };
  const callVar = input.callVar;
  const { project } = input;
  const render = renderer(project);
  const owner = elementOfModule(input.structure);
  const subjectOf = (m: string): Subject => (owner.has(m) ? element(owner.get(m)!) : global);
  const mods = new Map(project.modules.map((m) => [m.name, m]));
  const inScope = (m: string): boolean => input.callModules === null || input.callModules.has(m);
  const out: Diagnostic[] = [];
  const fail = (rule: RuleId, m: string, at: VdmLocation | null, msg: string): void => {
    out.push(diag(rule, subjectOf(m), vdmPosition(at ?? mods.get(m)!.location), msg));
  };

  // 每个有状态的 VDM 模块，Quint 里恰有一个类型为生成的状态类型的变量。
  const stateVar = new Map<string, string>();
  const stateOf = new Map<string, State>();
  for (const m of project.modules) {
    const state = m.definitions.find((d): d is State => d.category === "state");
    if (!state) continue;
    stateOf.set(m.name, state);
    const vars = input.module.decls.filter((d) => d.varType?.module === m.name && d.varType.name === state.name);
    if (vars.length === 1) stateVar.set(m.name, vars[0]!.name);
  }

  // 作用域内每个导出操作，结果是并类型时，全部变体先计 0。
  const outcomes = new Map<string, Map<string, number>>();
  const outcomeOps = new Map<string, readonly [string, Op]>();
  for (const m of project.modules) {
    if (!inScope(m.name)) continue;
    const exportAll = m.exports.some((e) => e.kind === "all");
    for (const d of m.definitions) {
      if (d.category !== "operation" || !(exportAll || m.exports.some((e) => e.kind === "operation" && e.name === d.name))) continue;
      const variants = render.unionVariants(d);
      if (variants === null) continue;
      outcomes.set(`${m.name}\`${d.name}`, new Map(variants.map((v) => [v, 0])));
      outcomeOps.set(`${m.name}\`${d.name}`, [m.name, d]);
    }
  }

  const reported = new Set<string>();
  const incomplete = (m: string, at: VdmLocation, key: string, msg: string): void => {
    if (reported.has(key)) return;
    reported.add(key);
    fail("replay.incomplete", m, at, msg);
  };

  // 每条轨迹的第 0 个状态里，生成状态变量 = initial。比较在 VDMJ 里以 = 求值。
  const initials: Initial[] = [];
  for (const trace of input.traces) {
    const s0 = trace.states[0];
    if (s0 === undefined) continue;
    for (const [m, sv] of stateVar) {
      const state = stateOf.get(m)!;
      if (!inScope(m) || state.initial === null) continue;
      const stateRef: VdmType = { kind: "ref", module: m, name: state.name };
      try {
        const binds: EvalBind[] = [];
        const actual = render.itf(m, stateRef, s0.vars.get(sv)!, `${m} 初态`, binds);
        const expected = render.value(m, stateRef, state.initial, `${m} 的 initial`, binds);
        initials.push({ module: m, state, r: { expr: `${actual} = ${expected}`, binds }, where: `${trace.file}#0` });
      } catch (e) {
        if (!(e instanceof Unrenderable)) throw e;
        incomplete(m, state.location, `initial:${m}:${e.message}`, `验证不完整：${m} 的初态不能还原成 VDM，没有与 initial 比较：${e.message}（${trace.file}#0）`);
      }
    }
  }

  // 某一步里生成状态变量 S_m 变了，而 lastCall 不是模块 m 的调用。比较 ITF 值。
  const bypass = new Map<string, { module: string; sv: string; call: string; where: string; count: number }>();
  const steps: Step[] = [];
  for (const trace of input.traces) {
    trace.states.forEach((st, i) => {
      if (i === 0) return;
      const prev = trace.states[i - 1]!;
      const call = st.vars.get(callVar);
      const callTag = call?.t === "variant" ? call.tag : "?";
      const where = `${trace.file}#${i}（${st.action ?? "?"}）`;
      for (const [m, sv] of stateVar) {
        if (!inScope(m) || callTag === m || canon(prev.vars.get(sv)!) === canon(st.vars.get(sv)!)) continue;
        const key = JSON.stringify([m, st.action, callTag]);
        const b = bypass.get(key);
        if (b) b.count++;
        else bypass.set(key, { module: m, sv, call: callTag, where, count: 1 });
      }

      if (!call || call.t !== "variant" || call.tag === "NoCall" || call.value.t !== "variant") return;
      const m = call.tag;
      if (!inScope(m)) return;
      const opv = call.value;
      const op = mods.get(m)?.definitions.find((d): d is Op => d.category === "operation" && d.name === opv.tag);
      if (!op) return;
      const state = stateOf.get(m);
      const sv = stateVar.get(m);
      if (state && !sv) {
        incomplete(m, state.location, `nostate:${m}`, `${m} 有状态 ${state.name}，Quint 里必须恰有一个类型为 ${m}::${state.name} 的变量；${m} 的调用无法回放`);
        return;
      }
      try {
        const binds: EvalBind[] = [];
        const payload = opv.value;
        const arg = (n: string): ItfValue => {
          if (payload.t !== "rec" || !payload.fields.has(n)) throw new Unrenderable(`载荷缺少字段 ${n}`);
          return payload.fields.get(n)!;
        };
        const args = op.params.map((p) => render.itf(m, p.type, arg(p.name!), `${m}.${op.name}.${p.name}`, binds));
        const res = op.result.type.kind === "void" ? [] : [render.itf(m, op.result.type, arg("result"), `${m}.${op.name}.result`, binds)];
        const stateRef: VdmType | null = state ? { kind: "ref", module: m, name: state.name } : null;
        const before = stateRef ? [render.itf(m, stateRef, prev.vars.get(sv!)!, `${m} 调用前状态`, binds)] : [];
        const after = stateRef ? [render.itf(m, stateRef, st.vars.get(sv!)!, `${m} 调用后状态`, binds)] : [];
        // ext rd 的分量，以及既不在 ext wr、也不在 writes 里的分量。
        const frameFields = (state?.fields ?? [])
          .map((f) => f.name)
          .filter((f) => op.ext?.rd.includes(f) || !(op.ext?.wr.includes(f) || op.writes.includes(f)));
        const result = op.result.type.kind === "void" ? null : arg("result");
        steps.push({
          module: m,
          op,
          pre: op.hasPre ? { expr: `pre_${op.name}(${[...args, ...before].join(", ")})`, binds } : null,
          post: op.hasPost ? { expr: `post_${op.name}(${[...args, ...res, ...before, ...after].join(", ")})`, binds } : null,
          frame:
            frameFields.length === 0
              ? null
              : {
                  fields: frameFields,
                  r: { expr: `let ssot_before = ${before[0]}, ssot_after = ${after[0]} in [${frameFields.map((f) => `ssot_before.${f} = ssot_after.${f}`).join(", ")}]`, binds },
                },
          outcome: outcomes.has(`${m}\`${op.name}`) && result?.t === "variant" ? result.tag : null,
          where,
        });
      } catch (e) {
        if (!(e instanceof Unrenderable)) throw e;
        incomplete(m, op.location, `render:${m}.${op.name}:${e.message}`, `验证不完整：${op.name} 的值不能还原成 VDM，这些调用没有回放：${e.message}（${where}）`);
      }
    });
  }
  for (const b of bypass.values()) {
    const state = stateOf.get(b.module)!;
    fail(
      "behavior.call",
      b.module,
      state.location,
      `状态变量 ${b.sv}（${b.module}::${state.name}）在不是 ${b.module} 调用的一步里变了：${callVar} 为 ${b.call}（${b.count} 步）；首例 ${b.where}。契约状态只能经 ${b.module} 的操作改变`,
    );
  }

  // 初态、pre、post、frame 合并成一个 VDMJ 批次；相同表达式（连同绑定）只求一次。
  const items = new Map<string, readonly [string, Rendered]>();
  for (const s of steps) for (const r of [s.pre, s.post, s.frame?.r ?? null]) if (r !== null) items.set(keyOf(s.module, r), [s.module, r]);
  for (const c of initials) items.set(keyOf(c.module, c.r), [c.module, c.r]);
  const list = [...items.values()];
  const results = await evaluate(input.vdmFiles, list.map(([m, r]) => ({ module: m, expr: r.expr, binds: r.binds })));
  const byKey = new Map<string, EvalResult>(list.map(([m, r], i) => [keyOf(m, r), results[i]!]));

  type Verdict = { readonly rule: RuleId; readonly why: string; readonly error: boolean } | "holds";
  const boolVerdict = (e: EvalResult, label: string, falseRule: RuleId, falseWhy: string): Verdict => {
    if (e.kind === "error") return { rule: errorRule(e), why: `${label}：VDMJ ${e.number ?? "?"}: ${e.message}`, error: true };
    if (e.value?.kind === "bool" && typeof e.value.value === "boolean") return e.value.value ? "holds" : { rule: falseRule, why: falseWhy, error: false };
    return { rule: "replay.eval", why: `${label} 的值不是 bool：${e.text}`, error: true };
  };
  const frameVerdict = (s: Step, f: NonNullable<Step["frame"]>): Verdict => {
    const e = byKey.get(keyOf(s.module, f.r))!;
    if (e.kind === "error") return { rule: errorRule(e), why: `frame_${s.op.name}：VDMJ ${e.number ?? "?"}: ${e.message}`, error: true };
    const eq = boolItems(e.value);
    if (eq === null || eq.length !== f.fields.length) return { rule: "replay.eval", why: `frame_${s.op.name} 的值不是 ${f.fields.length} 个 bool 的序列：${e.text}`, error: true };
    const changed = f.fields.filter((_, i) => !eq[i]);
    if (changed.length === 0) return "holds";
    const ext = s.op.ext === null ? "没有 ext 子句" : `ext rd ${s.op.ext.rd.join(", ") || "（无）"}；ext wr ${s.op.ext.wr.join(", ") || "（无）"}`;
    return { rule: "replay.frame", why: `${s.op.name} 不得改变的分量 ${changed.join(", ")} 在调用前后不相等（${ext}；writes ${s.op.writes.join(", ") || "（无）"}）`, error: false };
  };

  const failures = new Map<string, { rule: RuleId; module: string; at: VdmLocation; label: string; unit: string; where: string; r: Rendered; why: string; count: number }>();
  const record = (v: Exclude<Verdict, "holds">, module: string, at: VdmLocation, label: string, unit: string, where: string, r: Rendered): void => {
    const fk = JSON.stringify([v.rule, module, label, v.why]);
    const f = failures.get(fk);
    if (f) f.count++;
    else failures.set(fk, { rule: v.rule, module, at, label, unit, where, r, why: v.why, count: 1 });
  };

  for (const c of initials) {
    const sv = stateVar.get(c.module)!;
    const v = boolVerdict(byKey.get(keyOf(c.module, c.r))!, `${c.module} 初态`, "replay.initial", `${sv} 的初值不等于 ${c.module} 的 init 给出的 initial`);
    if (v !== "holds") record(v, c.module, c.state.location, `${c.module}\`${c.state.name}`, "条轨迹", c.where, c.r);
  }

  const replayed = new Map<string, number>();
  for (const s of steps) {
    const key = `${s.module}\`${s.op.name}`;
    replayed.set(key, (replayed.get(key) ?? 0) + 1);
    if (s.outcome !== null) {
      const counts = outcomes.get(key)!;
      counts.set(s.outcome, (counts.get(s.outcome) ?? 0) + 1);
    }
    const pre = s.pre === null ? "holds" : boolVerdict(byKey.get(keyOf(s.module, s.pre))!, `pre_${s.op.name}`, "replay.pre", `pre_${s.op.name} 为 false`);
    const post = pre !== "holds" || s.post === null ? "holds" : boolVerdict(byKey.get(keyOf(s.module, s.post))!, `post_${s.op.name}`, "replay.post", `post_${s.op.name} 为 false`);
    if (pre !== "holds") record(pre, s.module, s.op.location, key, "步", s.where, s.pre!);
    if (post !== "holds") record(post, s.module, s.op.location, key, "步", s.where, s.post!);
    // frame 的 false 总是报告；它的求值错误与 pre/post 的错误同源（同一组前后状态）时不重复报告。
    const frame = s.frame === null ? "holds" : frameVerdict(s, s.frame);
    const sameError = frame !== "holds" && frame.error && ((pre !== "holds" && pre.error) || (post !== "holds" && post.error));
    if (frame !== "holds" && !sameError) record(frame, s.module, s.op.location, key, "步", s.where, s.frame!.r);
  }
  for (const f of failures.values()) {
    const binds = f.r.binds.map((b) => `${b.name} = ${b.module}: ${b.expr}`).join("; ");
    const text = `${f.r.expr}${binds ? `，其中 ${binds}` : ""}`;
    fail(f.rule, f.module, f.at, `${f.label}：${f.why}（${f.count} ${f.unit}）；首例 ${f.where}；表达式 ${text.length > 500 ? `${text.slice(0, 500)}…` : text}`);
  }

  // 每个结果为并类型的操作一条 info，列出全部变体的次数与未覆盖的变体。
  for (const [key, counts] of outcomes) {
    const [m, op] = outcomeOps.get(key)!;
    const unseen = [...counts].filter(([, n]) => n === 0).map(([v]) => v);
    out.push(
      diag(
        "replay.outcome",
        subjectOf(m),
        vdmPosition(op.location),
        `${key} 的结局：${[...counts].map(([v, n]) => `${v}×${n}`).join("，")}${unseen.length > 0 ? `；未覆盖 ${unseen.join("，")}` : ""}`,
        "info",
      ),
    );
  }
  return { diagnostics: out, replayed, outcomes };
}
