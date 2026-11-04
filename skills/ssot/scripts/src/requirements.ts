// 需求附着只取声明首行之前连续、无空行的行注释；调用方提供源码与编译器投影。
import type { QuintModule } from "./compile/quint";
import type { VdmProject } from "./compile/vdm";
import type { Position } from "./diag";

export interface RequirementAttachment {
  readonly carrier: "vdm" | "quint";
  readonly module: string;
  readonly declaration: string;
  readonly at: Position;
}

export type RequirementAttachments = ReadonlyMap<string, readonly RequirementAttachment[]>;

export function requirementAttachments(
  sources: ReadonlyMap<string, string>,
  project: VdmProject | null,
  behavior: readonly QuintModule[],
): RequirementAttachments {
  const out = new Map<string, RequirementAttachment[]>();
  const lines = new Map([...sources].map(([file, text]) => [file, text.split(/\r?\n/)]));
  const attach = (attachment: RequirementAttachment, prefix: "--" | "//"): void => {
    const source = lines.get(attachment.at.file);
    if (!source || attachment.at.line < 1 || attachment.at.line > source.length) return;
    const ids = new Set<string>();
    for (let n = attachment.at.line - 2; n >= 0; n--) {
      const line = source[n]!.trimStart();
      if (!line.startsWith(prefix)) break;
      for (const match of line.slice(prefix.length).matchAll(/\bREQ-\d+\b/g)) ids.add(match[0]);
    }
    for (const id of ids) {
      const attached = out.get(id) ?? [];
      attached.push(attachment);
      out.set(id, attached);
    }
  };
  for (const m of project?.modules ?? []) {
    attach({ carrier: "vdm", module: m.name, declaration: "module", at: m.location }, "--");
    for (const d of m.definitions)
      attach({ carrier: "vdm", module: m.name, declaration: d.category === "value" ? d.names.join(", ") : d.name, at: d.location }, "--");
  }
  for (const m of behavior) {
    // QuintModule 没有 module 的源位置：只定位本文件内与投影模块同名的 module 行，不猜测声明位置。
    const source = lines.get(m.file) ?? [];
    for (let n = 0; n < source.length; n++) {
      const name = /^\s*module\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/.exec(source[n]!);
      if (name?.[1] === m.name)
        attach({ carrier: "quint", module: m.name, declaration: "module", at: { file: m.file, line: n + 1, col: 1 } }, "//");
    }
    // 源位置不可得的声明不附着；不会按名称或最近代码推测位置。
    for (const d of m.decls)
      if (d.at !== null) attach({ carrier: "quint", module: m.name, declaration: d.name, at: d.at }, "//");
  }
  return out;
}
