// 评审提示只读取编译器投影；只有可确证的命令式体违反是 error。
import type { C4Element, Structure } from "../compile/likec4";
import { type VdmDefinition, type VdmModule, type VdmProject, type VdmSample, type VdmType, vdmPosition } from "../compile/vdm";
import { type Diagnostic, type Subject, assertNever, diag, element, global } from "../diag";
import { ancestors, elementOfModule, isBusiness } from "../model";

function hasExternalIncoming(s: Structure, e: C4Element): boolean {
  const root = ancestors(s, e.fqn).at(-1) ?? e.fqn;
  return s.relations.some((r) => r.target === e.fqn &&
    (s.elements.get(r.source)?.kind === "actor" || (ancestors(s, r.source).at(-1) ?? r.source) !== root));
}

function containsString(t: VdmType, module: string, modules: ReadonlyMap<string, VdmModule>, visiting: Set<string>): boolean {
  switch (t.kind) {
    case "seq":
      return t.element.kind === "char" || containsString(t.element, module, modules, visiting);
    case "seq1":
    case "set":
    case "set1":
      return containsString(t.element, module, modules, visiting);
    case "ref": {
      const owner = t.module || module;
      const key = `${owner}\`${t.name}`;
      if (visiting.has(key)) return false;
      const def = modules.get(owner)?.definitions.find((d) => d.category === "type" && d.name === t.name);
      if (def?.category !== "type") return false;
      visiting.add(key);
      const result = containsString(def.type, owner, modules, visiting);
      visiting.delete(key);
      return result;
    }
    case "record":
      return t.fields.some((f) => containsString(f.type, t.module || module, modules, visiting));
    case "map":
    case "inmap":
      return containsString(t.from, module, modules, visiting) || containsString(t.to, module, modules, visiting);
    case "optional":
      return containsString(t.type, module, modules, visiting);
    case "product":
    case "union":
      return t.types.some((member) => containsString(member, module, modules, visiting));
    case "function":
    case "operation":
      return t.params.some((p) => containsString(p, module, modules, visiting)) || containsString(t.result, module, modules, visiting);
    case "nat":
    case "nat1":
    case "int":
    case "rat":
    case "real":
    case "bool":
    case "char":
    case "token":
    case "void":
    case "unknown":
    case "parameter":
    case "quote":
      return false;
    default:
      return assertNever(t);
  }
}

function sampled(sample: VdmSample | null, label: string, subject: Subject, d: VdmDefinition): Diagnostic[] {
  if (sample === null || sample.trueCount + sample.falseCount === 0 || (sample.trueCount !== 0 && sample.falseCount !== 0)) return [];
  return [diag("hint.sampled", subject, vdmPosition(d.location),
    `${label} 的采样结果全${sample.falseCount === 0 ? "真" : "假"}（true=${sample.trueCount}, false=${sample.falseCount}）；采样不是证明`, "info")];
}

export function hintRules(structure: Structure, project: VdmProject): Diagnostic[] {
  const out: Diagnostic[] = [];
  const owners = elementOfModule(structure);
  const modules = new Map(project.modules.map((m) => [m.name, m]));
  for (const m of project.modules) {
    const fqn = owners.get(m.name);
    const subject = fqn === undefined ? global : element(fqn);
    const owner = fqn === undefined ? undefined : structure.elements.get(fqn);
    const external = owner !== undefined && hasExternalIncoming(structure, owner);
    for (const d of m.definitions) {
      if (d.category !== "state") {
        for (const name of d.category === "value" ? d.names : [d.name]) {
          const isExported = m.exports.some((e) => e.kind === "all" || (e.kind === d.category && e.name === name));
          const consumers = project.modules.filter((consumer) => consumer.name !== m.name && consumer.imports.some((i) =>
            i.module === m.name && i.items.some((item) => item.kind === "all" || (item.kind === d.category && item.name === name))));
          if (isExported && consumers.length === 0 && !external)
            out.push(diag("hint.export", subject, vdmPosition(d.location), `${m.name}\`${name} 导出没有其他模块 import，也没有来自 actor 或系统外元素的关系`, "info"));
          if (owner !== undefined && !isBusiness(structure, owner.fqn)) {
            const references = project.modules.filter((consumer) => consumer.name !== m.name && consumer.references.includes(`${m.name}\`${name}`));
            const only = references.length === 1 ? owners.get(references[0]!.name) : undefined;
            if (only !== undefined && isBusiness(structure, only))
              out.push(diag("hint.single-business", subject, vdmPosition(d.location), `${m.name}\`${name} 只被业务模块 ${references[0]!.name} 引用`, "info"));
          }
          if (d.category === "type" && isExported) {
            const struct = m.exports.some((e) => e.kind === "all" || (e.kind === "type" && e.name === name && e.struct));
            const prefix = `${m.name}\`${name}.`;
            if (struct && !consumers.some((consumer) => consumer.fieldReads.some((read) => read.startsWith(prefix))))
              out.push(diag("hint.struct-unread", subject, vdmPosition(d.location), `${m.name}\`${name} 为 struct 导出，但没有 importer 读取其字段`, "info"));
            if (containsString(d.type, m.name, modules, new Set()))
              out.push(diag("hint.string", subject, vdmPosition(d.location), `${m.name}\`${name} 的类型结构含 seq of char`, "info"));
          }
        }
      }
      switch (d.category) {
        case "type":
          out.push(...sampled(d.invSample, `inv_${d.name}`, subject, d));
          break;
        case "operation":
        case "function":
          out.push(...sampled(d.preSample, `pre_${d.name}`, subject, d));
          if (d.imperative.length > 0)
            out.push(diag("contract.body", subject, vdmPosition(d.imperative[0]!), `${m.name}\`${d.name} 的显式体含局部可变变量、赋值或循环`));
          if (d.category === "operation" && d.kind === "implicit" && d.ext === null)
            out.push(diag("hint.no-ext", subject, vdmPosition(d.location), `${m.name}\`${d.name} 是没有 ext 子句的隐式操作`, "info"));
          break;
        case "state": {
          const operations = m.definitions.filter((def) => def.category === "operation");
          const reads = new Set(operations.flatMap((op) => op.reads));
          const writes = new Set(operations.flatMap((op) => op.writes));
          const invReads = new Set(m.definitions.flatMap((def) => def.category === "state" ? def.invReads : []));
          for (const field of d.fields) {
            const unwritten = !writes.has(field.name);
            const unread = !reads.has(field.name) && !invReads.has(field.name);
            if (unwritten || unread)
              out.push(diag("hint.state-unused", subject, vdmPosition(d.location),
                `${m.name}\`${d.name}.${field.name} ${[...(unwritten ? ["没有操作写入"] : []), ...(unread ? ["没有操作或 inv 读取"] : [])].join("，")}`, "info"));
          }
          break;
        }
        case "value":
          break;
        default:
          assertNever(d);
      }
    }
  }
  return out;
}
