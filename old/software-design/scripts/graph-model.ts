/**
 * 设计图：从设计文件中的 DSL 类型抽取出的元素与关系。
 * 抽取（extract.ts）产出它，检查（graph-checks.ts）与导出（render.ts）只读它。
 */

/** 元素所在的一侧。 */
export type Layer = 'architecture' | 'business';

/** 以 DSL 构造器直接写成、作为图节点的元素种类。 */
export type NodeKind =
  | 'Value'
  | 'Opaque'
  | 'Struct'
  | 'Outcome'
  | 'Point'
  | 'Face'
  | 'External'
  | 'Lifecycle'
  | 'Module'
  | 'Unit'
  | 'Scope'
  | 'Scenario';

/** 源文件中的一个位置；`file` 相对设计目录，例如 `architecture/runner/run.ts`。 */
export type Location = {
  readonly file: string;
  readonly line: number;
};

/** 一个图节点：一个导出的类型别名，右侧直接是某个 DSL 构造器。名字在整个设计中唯一。 */
export type DesignNode = {
  readonly name: string;
  readonly kind: NodeKind;
  readonly doc: string;
  readonly layer: Layer;
  /**
   * 声明所在的位置：架构侧是模块目录相对 `architecture/` 的路径段（根模块为空数组），
   * 业务侧是业务单元目录名组成的单元素数组。
   */
  readonly place: readonly string[];
  readonly at: Location;
};

/** 指向连接上的一个操作。 */
export type OpTarget = {
  readonly connection: string;
  readonly op: string;
};

/** 生命周期的锚点。 */
export type Anchor =
  | { readonly kind: 'Op'; readonly target: OpTarget }
  | { readonly kind: 'External'; readonly name: string };

/** 连接上的一个操作及其结局分支；结果是单个值时分支为 `['done']`。 */
export type OpSpec = {
  readonly name: string;
  readonly doc: string;
  readonly branches: readonly string[];
  /** 结果是具名 Outcome 节点时为它的名字。 */
  readonly outcome: string | undefined;
};

/** 一个连接节点的内容。 */
export type ConnectionSpec = {
  readonly name: string;
  readonly shape: 'Point' | 'Face';
  /** 面的不变量；连接点为 undefined。 */
  readonly invariant: string | undefined;
  readonly ops: readonly OpSpec[];
  readonly laws: readonly string[];
};

/** 一个具名 Outcome 节点的分支名，按声明次序。 */
export type OutcomeSpec = {
  readonly name: string;
  readonly branches: readonly string[];
};

/** 一个模块节点的内容；列表中是节点名。 */
export type ModuleSpec = {
  readonly name: string;
  readonly provides: readonly string[];
  readonly requires: readonly string[];
  readonly core: readonly string[];
  readonly parts: readonly string[];
};

/** 一个业务单元节点的内容；列表中是节点名。 */
export type UnitSpec = {
  readonly name: string;
  readonly plugsInto: readonly string[];
  readonly provides: readonly string[];
  readonly types: readonly string[];
};

/** 一个范围节点的内容。 */
export type ScopeSpec = {
  readonly name: string;
  readonly kind: 'process' | 'lifecycle' | 'trust' | 'deploy';
  readonly contains: readonly string[];
};

/** 一个生命周期节点的内容。 */
export type LifecycleSpec = {
  readonly name: string;
  readonly start: Anchor;
  readonly end: Anchor;
};

/** 场景中的一步。 */
export type StepSpec = {
  readonly actor: string;
  readonly target: OpTarget;
  readonly take: string;
  readonly at: Location;
};

/** 一个场景节点的内容。 */
export type ScenarioSpec = {
  readonly name: string;
  readonly steps: readonly StepSpec[];
};

/** 结局的一支声明的后续操作。 */
export type Continuation = {
  /** 结局所属的节点：具名 Outcome 节点名，或内联结局所在连接的名字。 */
  readonly owner: string;
  /** 内联结局所在的操作名；具名 Outcome 节点为 undefined。 */
  readonly op: string | undefined;
  readonly variant: string;
  readonly then: readonly OpTarget[];
};

/** 一个节点的类型表达式中对另一个节点的引用。 */
export type Reference = {
  readonly from: string;
  readonly to: string;
  readonly at: Location;
};

/** 抽取时无法按 DSL 读出的写法。 */
export type ExtractProblem = {
  readonly at: Location;
  readonly message: string;
};

/** 整个设计的图。 */
export type DesignGraph = {
  readonly nodes: readonly DesignNode[];
  readonly connections: readonly ConnectionSpec[];
  readonly outcomes: readonly OutcomeSpec[];
  readonly modules: readonly ModuleSpec[];
  readonly units: readonly UnitSpec[];
  readonly scopes: readonly ScopeSpec[];
  readonly lifecycles: readonly LifecycleSpec[];
  readonly scenarios: readonly ScenarioSpec[];
  readonly continuations: readonly Continuation[];
  readonly references: readonly Reference[];
  readonly problems: readonly ExtractProblem[];
};

/** 检查发现的一处违规。 */
export type Violation = {
  readonly at: Location | { readonly file: string; readonly line: 0 };
  readonly message: string;
};
