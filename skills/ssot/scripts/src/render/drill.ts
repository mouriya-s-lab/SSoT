// 下钻标注：上一层图上标出“这里还有下一层”，点它打开下一层的图。
// view：元素自己的视图；box：元素的契约盒子；promises、types、access：契约盒子的承诺、类型与读写，各是盒子下面一层的图；
// wiring：接线索引里一张接线图（组合图）；properties：组合图下面一层的性质图。
export type DrillKind = "view" | "box" | "promises" | "types" | "access" | "wiring" | "properties";

export interface Drill {
  readonly kind: DrillKind;
  /** 要打开的图的 id。 */
  readonly diagram: string;
  /** 打开后定位到的节点；null：不定位。 */
  readonly node: string | null;
}

/** 契约盒子图上的下钻去处：每个端口与状态的承诺、读写表（模块有状态时）、类型图与其中每个类型的节点（按类型名）。 */
export interface BoxDrills {
  readonly promises: string;
  readonly access: string | null;
  readonly types: string;
  /** 类型名 → 类型图里的节点 id；同名的类型不止一个时不在其中。 */
  readonly typeIds: ReadonlyMap<string, string>;
}

/** 组合图上的下钻去处：它的性质图，以及有盒子图的契约模块（步骤调用的端口打开该盒子承诺图里的端口）。 */
export interface CompositionDrills {
  readonly properties: string;
  readonly boxes: ReadonlySet<string>;
}
