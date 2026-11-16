// 契约分层图的投影：契约模块之间的 import → 纵向的知识依赖。
// 被 import 的模块在下；业务元素的模块在架构之上，数据存储的模块最深。箭头从 import 方指向被 import 方。
import type { Structure } from "../compile/likec4";
import type { VdmProject } from "../compile/vdm";
import { assertNever } from "../diag";
import { isBusiness } from "../model";

export type LayerTier = "business" | "architecture" | "store";

export interface LayerModule {
  readonly module: string;
  readonly element: string;
  readonly title: string;
  readonly tier: LayerTier;
}

export interface LayerImport {
  readonly from: string;
  readonly to: string;
  /** 被 import 的名字；import 整个模块时为 ["all"]。 */
  readonly names: readonly string[];
}

export interface LayersDiagram {
  readonly modules: readonly LayerModule[];
  readonly imports: readonly LayerImport[];
}

export const TIER_ORDER: readonly LayerTier[] = ["business", "architecture", "store"];

function tierOf(s: Structure, fqn: string): LayerTier {
  const e = s.elements.get(fqn);
  if (!e) throw new Error(`契约模块的元素 ${fqn} 不在结构里`);
  if (isBusiness(s, fqn)) return "business";
  return e.kind === "store" ? "store" : "architecture";
}

/** owner：模块名 → 元素 fqn（只含带 #contract 的元素）。不属于任何元素的模块不画。 */
export function projectLayers(s: Structure, project: VdmProject, owner: ReadonlyMap<string, string>): LayersDiagram {
  const modules = project.modules
    .filter((m) => owner.has(m.name))
    .map((m): LayerModule => {
      const fqn = owner.get(m.name)!;
      return { module: m.name, element: fqn, title: s.elements.get(fqn)?.title ?? fqn, tier: tierOf(s, fqn) };
    })
    .sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || a.module.localeCompare(b.module));
  const shown = new Set(modules.map((m) => m.module));
  const imports = project.modules
    .filter((m) => shown.has(m.name))
    .flatMap((m) => m.imports.filter((i) => shown.has(i.module)).map((i): LayerImport => ({
      from: m.name,
      to: i.module,
      names: i.items.map((item) => {
        switch (item.kind) {
          case "all": return "all";
          case "type": case "operation": case "function": case "value": return item.name;
          default: return assertNever(item);
        }
      }),
    })))
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  return { modules, imports };
}
