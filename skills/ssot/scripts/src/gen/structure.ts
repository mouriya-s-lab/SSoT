// 生成阶段：LikeC4 模型 → .gen/structure.json。内容确定（排序、固定缩进），供新鲜度逐字节比较。
import type { Structure } from "../compile/likec4";
import { isBusiness, isContract, moduleNameOf } from "../model";

export function generateStructure(s: Structure): string {
  const elements = [...s.elements.values()]
    .sort((a, b) => a.fqn.localeCompare(b.fqn))
    .map((e) => ({
      fqn: e.fqn,
      kind: e.kind,
      parent: e.parent,
      children: [...e.children].sort(),
      tags: [...e.tags].sort(),
      business: isBusiness(s, e.fqn),
      contract: isContract(e) ? { module: moduleNameOf(e.fqn) } : null,
    }));
  const relations = s.relations
    .map((r) => ({ source: r.source, target: r.target, title: r.title }))
    .sort((a, b) => `${a.source} ${a.target} ${a.title}`.localeCompare(`${b.source} ${b.target} ${b.title}`));
  const views = s.views
    .filter((v) => v.type === "element")
    .map((v) => ({ id: v.id, of: v.viewOf, nodes: [...v.nodes].sort() }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return `${JSON.stringify({ generatedBy: "ssot gen", elements, relations, views }, null, 2)}\n`;
}
