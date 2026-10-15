# software-design：优先投影与检查契约，拆出运行时 Graph 子 skill

本文保存当前实现采用的完整获批实施与验收计划。步骤描述目标和放行条件，不表示这些条件已经全部完成最终验收。源码与安装来源统一为 `mouriya-s-lab/SSoT`；根目录 `old/` 保存重写前的归档，不参与当前实现的 DSL、检查通道或默认安装。

## 背景

用户要求把 Graph 单独设计成子 skill，图在每次调用中从设计源码构建，不持久化图、索引或缓存，并提供最简单的本地 Graph 引擎及轻量搜索。第 15 项（容器/HKT 投影）和第 18 项（自动检查与人工语义边界）必须最先设计；编号 2、3、4、5、6、7、8、9、10、11、12、13、14、16、17、19 要通过补充或修复类型落地，而不是只增加文字限制。所有 Graph 修复都服从运行时子 skill 的契约。

源码仓库是 `https://github.com/mouriya-s-lab/SSoT`，本地检出为 `/Users/mouriya/Ext/code/software-design`。重写前在原 skills 仓库的基线为 `b595dbbf5f66c722ef01f0b0ab6314ef3cd3ee16`，迁移后对应旧版内容保留在提交 `76beea9` 的 `skills/software-design` 中。交付直接在 `main` 提交推送，不开 issue/PR；推送后必须用 `npx skills` 从 GitHub 更新/安装受影响 skill，不得手工复制安装目录。批准执行前已经产生的下面列出的核心改动属于实施起点，执行时必须接续，不得当成用户无关改动删除。

## 已核实的实施基础（批准时的证据）

- 已完整阅读原 `SKILL.md`、`references/sources.md`、`templates/dsl.ts`；原脚本分为 `design.ts`、`extract.ts`、`graph-model.ts`、`graph-checks.ts`、`render.ts`，使用 Babel 自行解释 TS 表面语法。旧语义解释器必须从当前实现删除，不保留 fallback；`old/` 的历史归档不参与当前通道。
- 当时实际安装的 `typescript` 为 7.0.2，其 package 根入口只导出版本；`typescript/unstable/async` 暴露可用的 native `API`、Program、Checker。研究夹具已在 Bun 1.4.3 和 Node 26 实跑 alias、re-export、generic、HKT 和 tuple，设计源里的 `throw` 未执行。Bun 下 sync API 在 `stdout._handle.fd` 失败，所以只使用 async 入口，不做 sync 兼容路径。这些版本是观察证据，不是实现的版本约束。
- 已实跑生命周期：`new API({cwd: explicitRoot})`，`await api.updateSnapshot({openProjects:[absoluteConfig]})`，`snapshot.getProject(config)`，使用 `.program/.checker`，最后先 `await snapshot.dispose()` 再 `await api.close()`；后检无该夹具的 native 进程。
- 已实跑：被引用的 composite 项目不设置 `noEmit:true` 时，native API 可直接读取其源文件，六类 diagnostics 为空，无预先 `.d.ts`、build 目录或 `.tsbuildinfo`。被引用项目设置 `noEmit:true` 会在 `getProgramDiagnostics()` 报 TS6310，即使 semantic diagnostics 为空；不得只收集 semantic diagnostics。
- 独立定义的两个同参数 `Point` alias 保留不同 resolved Type id 和各自 alias symbol；透明 `AliasPort=Port` 归一到 Port。`type.getSymbol()` 在此只指向模板匿名结构，不能作为声明身份。`checker.getSymbolAtLocation(sourceReference)` 可以区分源码中的透明别名。Type/Symbol 数字 id 仅可在一次 session 内使用。
- 已完成并编译通过的投影原型位于当时的 `/tmp/software-design-rewrite/projection.ts`：`Apply<D,F,A>` 保留描述符，`Shape` 只递归 DSL，先 `Shape<A>` 再 `Kind<F,...>`；嵌套、Tuple 多参、核心 Choice、相同字段名不碰撞均有真实类型断言。负例已确认拒绝裸领域 object、藏描述符的原生 Map、非 TypeLambda、经泛型 alias 传入的未知规格键。
- 进入计划阶段前已改动：`templates/dsl.ts` 整份更新为新 DSL；新增 `scripts/diagnostics.ts`、`scripts/model.ts`、`references/checking.md`。这三份 TS 当时已一起 `tsc --noEmit --strict` 通过，但新 DSL 尚未贯通 native resolver/CLI。`workspace-model.ts` 的写入当时被计划模式拒绝，尚未创建。执行者必须先重读这些实施起点再接续。
- 计划阶段通过 native API 虚拟 FS 查询验证：RunFace→Started→Duty→Returned<RunFace.finish> 自引用、Module.core→Event.confirms→Module、两个互相 Next 的 Face 的六类 diagnostics 均为空。源码/配置只在内存，没有写虚拟文件或工作树；API 正常关闭，`pgrep -fl 'tsgo.*--api'` 无匹配。不能把未验证的循环别名推测继续当成缺陷。

## 实施方案

### 1. 先冻结 15：显式数据与 HKT 投影

沿用实施起点中 `templates/dsl.ts` 的新契约，并把验证补完整：

- `Value<D,T>` 的 `T` 只接受 `Scalar | Data`。`Scalar` 包含 string、number、boolean、bigint、symbol、null、undefined、void；包括这些类型的字面量、模板字面量和品牌交叉。`unknown` 和任意领域 object 不属于叶子。未知内部结构用 `Opaque<D,K>`；领域积类型用 `Struct<D,Fields>`，有位置意义的参数集合用 `Tuple<D,Items>`，核心和类型用 `Choice<D,Cases>`，操作结局用 `Outcome<D,Variants>`。
- `Apply<D,F extends TypeLambda,A extends Data>` 是真实保留 `doc/lambda/argument` 的描述符，不是 `Kind` 的别名。唯一投影为 `Shape<Apply<D,F,A>> = Kind<F,Shape<A>>`；不得二次递归扫描 F 的原生输出。
- 容器不设领域名称白名单。设计自己声明 `interface ListF extends TypeLambda { readonly type: readonly this['A'][] }`、`ByKey<K>` 等。多参 F 以 `Tuple` 或 `Struct` 的投影作 A，不接受未经描述的裸字段。
- Choice 和 Outcome 投影统一使用 `{ readonly case: K; readonly fields: ... }`，因此业务字段可以叫 `case` 或 `kind` 而不与标签交叉成 never。
- `Opaque<D,K>` 的稳定领域键 K 与说明 D 分离。自动关系检查拒绝两个独立声明重复使用同一 opaque key；透明别名不制造新定义。实现是否采用 Shape 仍是实现方选择，不增加运行时构造器或强制依赖。

15 的放行门槛是“原生编译与 native semantic resolver 对同一正反夹具一致”，不是只编译原型。该门槛未过，不实施后面的 Graph/外围迁移。Family 只解释类型构造器，Apply 解释这次容器应用；不把设计类型与 src 类型合并。

### 2. 再冻结 18：单一解释、分阶段事实与失败门槛

沿用 `diagnostics.ts` 与 `references/checking.md` 的闭合结果契约。自动阶段只包括 `source | typescript | resolve | relations | markdown`；人工语义不属于自动阶段。成功最终叫 `AutomaticallyChecked`，必须携带 `ManualReviewRequired`，不输出含混的“设计全部有效”。

`Result<T>` 只有 `Accepted<T>` 和 `Rejected`（非空 Diagnostic 元组）；Diagnostic 保留 stage、code、相对路径/行列、message、related 位置。Evidence 的五个 variant 分别定义其能建立的结构事实；不得把人工项做成 pass/warning 以假装完成。

- source 建立有界输入、普通文件与生成文件事实。
- TypeScript 建立局部类型构造、未知规格键、HKT、操作/分支和项目方向。
- resolver 只读取 compiler 语义：声明身份、透明别名、泛型替换、完整描述符、所有辅助定义的真实引用。不得用 Babel、打印类型字符串或 import 路径猜类型。
- relations 建立归属、公开契约、提供与转交、目录组成、依赖、范围、场景和生命周期可判定关系。
- markdown 只建立格式、链接和符号引用事实，不判断说明、定律、依据或需求含义。

任一阶段失败不产生下一阶段成功值。类型错误不继续解析 error Type；解析失败不产生部分 ResolvedDesign；关系或文字失败不产生 ValidatedDesign；Graph 构造函数只接受 ValidatedDesign。Compiler Type/Symbol 不越过 resolver 边界，完成领域值拷贝后释放 snapshot/API，Graph 后续只消费领域值。

18 的放行门槛是四个真实结果都可由闭合类型区分：局部类型拒绝、模型解析拒绝、跨单元关系拒绝、自动通过但人工语义未审查。实施起点中宽松的 DiagnosticCode/Evidence 数组必须按本计划收紧后，才能派发外围实现。

ValidatedDesign 只表示五个自动阶段的结构证据齐备，不表示人工语义获确认。ManualReviewRequired 是具名事项及来源位置的只读列表，至少保留架构理由、业务含义、载体定律/时间规则、真实关联与履责、场景覆盖、未绑定组合选择；不能压成 boolean、被 Graph 丢弃，或用 ack 文件缓存“已审查”。成功退出只声称自动检查通过。

### 3. 拆出独立的运行时 Graph 子 skill

创建平级 `skills/software-design-graph/`，遵循 sibling skill 契约；父 skill 在 frontmatter 与正文通过 `skill://software-design-graph` 路由。新子 skill 的 `SKILL.md` 由主实现者撰写，不委派文档设计。Graph 的所有脚本只属于新子 skill；父 skill 不再提供 `graph` 命令，也不留下转发 alias。

Graph 子 skill 调用父 skill 唯一的 source→compiler→resolved→validated 通道，不自己读 TS、解释 DSL 或重新实现设计验证。内部引擎使用内存 `Map` 与有向邻接表，不引入数据库、服务、监听、索引文件或跨调用缓存。创建后只读，单次命令完成即释放。视图/JSON 是 stdout 的本次结果，不写回 design、不作为以后输入。

本地查询固定为四种，不做通用查询语言：

- `view <design> [--json] [--composition <selector>]`：完整 validated 设计的 Mermaid/表格或 JSON；默认只看契约与提供角色，显式选组合才显示该组合的局部绑定。
- `search <design> <text> [--kind <kind>] [--composition <selector>]`：名称、说明、路径的大小写不敏感子串匹配。
- `neighbors <design> <selector> [--direction out|in|both] [--depth <positive-int>] [--composition <selector>]`：有界 BFS，默认 out、深度 1。
- `path <design> <from> <to> [--composition <selector>]`：图结构的有向最短路径，不声称可运行调用链；无路径是 NoPath，缺失/歧义是带候选的查询错误。

selector 接受完整声明 id 或唯一可见名称；同名不能任意选择。节点 id 使用 design 相对路径加声明名，成员节点使用其所属节点与具名位置；不持久化 compiler 数字 id。边使用闭合关系类型并保存来源位置，至少覆盖定义归属、公开/转交、提供、使用、组成、字段/参数/结果、HKT 参数、分支、后继、义务、事实锚点、范围、场景步骤及真实类型引用。父模块自己提供、子模块使用的 Clock 关系必须从相同已验证关系画出；不能从“最深 provider”规则遗漏它。

### 4. 把剩余类型决策落实到唯一 DSL 契约

以下更改覆盖 2、3、4、5、6、7、8、13、14、16、17；接续新 DSL，而不是恢复旧构造器：

|类型|最终契约|
|---|---|
|`Family<D,F extends TypeLambda>`|以 `F &` 说明元数据描述一个公开类型构造器；作为 `Core`，可被 `Apply` 引用。私有实现用的 TypeLambda interface 不另成为领域术语，但其引用保留在语义引用图。|
|`Carrier<D,K,F,Laws>`|载体有连接选项内的稳定键、HKT 和准入定律，不以 K 建立全设计名义身份。Point/Face 的非空 carriers 元组明确允许哪些载体；`Implementation<F extends CarrierOf<C>,C>` 不能接受未列入的载体。接受时刻、预期失败、取消等可观察语义写在对应载体/连接定律；类型相容不等于定律成立。|
|`Point<D,O,Modes,Laws=[]>` / `Face<D,Invariant,Ops,Modes,Laws=[]>`|操作保持 Params 与 Data Result。原始同步/异步不再是全局隐含默认，Modes 必填。|
|`Expose<D,C extends Connection,From extends AnyModule \| AnyExternal>`|声明一条公开能力的转交路径，不选择运行提供方。From 是直接子模块已公开的边界，或明确提供 C 且 C 在当前 requires 中的 External。不同 From 的路径可以并存，相同 `(C,From)` 不能重复。|
|`Module<D,S>`|精确键为 `core, ports, provides, requires, public, parts, reexports`。public roots 可为 Data/Event/Lifecycle，以便公开事实锚点与嵌套关系；Family/Carrier/Auxiliary 随必要闭包可见。其余角色如前，不接受未知键。|
|`Unit<D,S>`|精确键为 `types, ports, provides, plugsInto`，plugsInto 必填；删除草稿 Unit.public，避免业务单元绕过连接直接共享材料。业务对外数据/事件只能随连接契约公开。|
|`External<D,S>`|精确键只有 `provides, uses`。它是外部参与方，不兼作事件，也不是内部 Module。|
|`Returned<OpRef<C,K>,B>` / `Occurred<E>`|前者指明一次操作返回的合法分支，后者指明事件已发生；生命周期不再以“调用了 start”代替 `Started`。|
|`Event<D,By,Payload>`|确认者与描述过的数据。确认者是 Participant；不要求一个外部参与方拥有一切操作。|
|`Duty<D,By,CompleteFact>`|By 为 `caller`、`provider` 或具名 Participant；职责附着到产生它的场景步骤，完成条件是 Fact。|
|`Next<D,Targets,Duties=[]>`|Targets 非空，表示该调用方下一次调用必须任选一个目标操作；其他参与方的步骤与 EventStep 可以穿插。Duties 仍是以后须全部履行的义务。|
|`Later<D,Duties>`|Duties 非空，允许任意合法中间步骤，正常完成前逐项履行。|
|`Variant<D,Fields=空字段表,Follow=End>`|不再保留含混的 Then。End、Next、Later 是闭合选择；Choice 的 Case 不附带操作后继。|
|`Lifecycle<D,S>`|精确键为 `key, starts, ends, within`。key 是具名 Data；starts/ends 是 Fact；within 可省略。删除草稿 confirms：Returned 的静态确认关系沿 ends Fact→Connection→capabilities 读取，不选具体提供方；Occurred 由 Event.confirms 确定。场景 Binding 不回写静态 Lifecycle。|
|`Scope<D,Kind,Members>`|Members 只含 Participant 或同种 Scope，不含 Lifecycle。`lifecycle` 范围表示参与方的同一存续分组；具体 Lifecycle 的嵌套只有 within 建立，两者不重复保存。|
|`Scenario<D,Steps,Ends=Complete,Assembly=Uncomposed>`|Step 为调用返回事实，EventStep 为事件事实；可引用一个 Composition，但不强制绑定全部使用关系。`Interrupted<D,Responsible>` 删除 at，最后一步就是中断事实，不声称义务已履行。|
|`Binding<D,Consumer,C,Provider>`|一项局部组合选择：Consumer 已声明使用 C，Provider 已声明能够提供 C，且 Provider 可由 Consumer 经公开边界达到；绑定必须保留消费者，不能把某一次选择套到所有使用方。|
|`Composition<D,Bindings>`|独立的可选组合声明，放 relations；可以只列部分 Binding。不改变 Module/Unit 定义，不要求全体组装。每个 Composition 中 `(Consumer,C)` 只能绑定一次。|

在全部 DSL 描述符中加入同一个未导出的 `unique symbol` 标记，用泛型 Tag/Described 基类型交叉复用；Data/Connection/Participant 等上界同时要求该标记。保留可读的 `design` 字面量判别符给 compiler 查询。这样普通 object 不能仅凭属性名偶合而冒充描述符；resolver 用来自 DSL 模板的标记声明确认来源，不用 `doc/fields` 外观猜类型。不引入运行时 DSL 值或 class。

Module/Unit/External/Lifecycle 的规格约束统一使用已经编译验证的 `S extends Spec & { readonly [K in Exclude<keyof S,keyof Spec>]: never }`。resolver 还核验其闭合字段集合以拒绝 any/error 类型造成的损坏输入，但不自行重新决定 TS assignability。

Binding 的局部可构造性同时进入类型：声明 `Used<P>` 从 Module.requires、Unit.plugsInto、External.uses 取连接并集，`DeclaredProvided<P>` 从 `.provides` 取并集；两者是按 Participant 闭合分类的条件类型，不使用 any。签名为 `Binding<D extends string, Consumer extends Participant, C extends Used<Consumer> & DeclaredProvided<Provider>, Provider extends Participant>`，交叉结果为空时 compiler 拒绝；精确 canonical 连接身份、公开路径和每组合唯一性仍由 relations 建立。DeclaredProvided 不等于边界 Offered（后者含显式转交），不能把转交者当原始 provider。Composition 的成员必须是 Binding 描述符；Scenario 的 Assembly 只接受 Composition 或 Uncomposed，不接受任意 JSON/字符串名称。

`Interrupted` 的非空 Steps 用 Scenario 泛型约束直接表达：当 Ends 的 design 是 Interrupted，Steps 必须是 `readonly [AnyStep,...AnyStep[]]`；否则是普通 readonly AnyStep[]。角色信息不是 optional 布尔组合：`Selection.Role` 和 `Selection.Bound` 各有完整字段。

具名节点分类为 Data、Family、Carrier、Connection、Module、Unit、External、Event、Lifecycle、Scope、Scenario、Composition、Auxiliary。id 是 `相对文件路径#声明名`，局部名称不要求全设计唯一。模块/业务拥有 Data/Family/Carrier/Event/Lifecycle；ports 拥有 Connection；Module、Unit、External、Scope、Scenario、Composition 是关系声明。Binding、Expose、Op、Case、Variant、Fact、Duty、Step 是内联的有说明成员，不因此强迫作者逐个导出。透明别名和 re-export 只引用 canonical 定义，不复制拥有者。

目录固定为 `design/{dsl,architecture,business?,relations,appendix}`。architecture 每目录一个 Module；business 每直接子目录一个 Unit、不嵌套；relations 是扁平、按内容命名的 `.ts`/主题 `.md`，容纳跨单元 External/Scope/Scenario/Composition 和辅助定义。只使用架构端口的 External 放根 architecture 或最小共同模块，只服务单一业务单元的 External 可放该 business 目录；跨层参与方放 relations，架构/业务定义不得反向 import 它。Event/Lifecycle 放定义拥有者目录，关系材料只引用。文件按内容命名，不预定义领域类型名，也不限制为一个文件。

### 5. 用 native compiler 取代全部 Babel 解释

创建 `scripts/compiler.ts`，唯一 import `typescript/unstable/async` 的实现边界。创建 `scripts/resolve.ts` 消费其函数型 facade；其余模块不 import compiler 的 Type/Symbol/Node。创建 `scripts/service.ts` 组合 source、compiler/resolve、relations、markdown，并定义不导出构造器的 ValidatedDesign 品牌。

`compiler.ts` 导出：

```ts
type TypeHandle = { readonly kind: 'Type'; readonly id: number };
type SemanticDeclaration = {
  readonly id: string; readonly name: string; readonly at: Location;
  readonly place: Place; readonly exported: boolean; readonly generic: boolean;
  readonly type: TypeHandle; readonly references: readonly Reference[];
};
type SemanticMember = { readonly name: string; readonly type: TypeHandle; readonly at: Location };
type TypeClass =
  | { readonly kind: 'StringLiteral'; readonly value: string }
  | { readonly kind: 'Scalar' }
  | { readonly kind: 'Parameter'; readonly name: string; readonly constraint: TypeHandle | undefined }
  | { readonly kind: 'Other' };
type CompilerView = {
  readonly declarations: readonly SemanticDeclaration[];
  readonly property: (type: TypeHandle, name: string) => Promise<TypeHandle | undefined>;
  readonly members: (type: TypeHandle) => Promise<readonly SemanticMember[]>;
  readonly tuple: (type: TypeHandle) => Promise<Result<readonly TypeHandle[]>>;
  readonly classify: (type: TypeHandle) => Promise<TypeClass>;
  readonly canonical: (type: TypeHandle) => Promise<string | undefined>;
  readonly display: (type: TypeHandle) => Promise<string>;
  readonly isDescriptor: (type: TypeHandle) => Promise<boolean>;
};
function withCompiler<T>(
  source: SourceSet,
  consume: (view: CompilerView) => Promise<Result<T>>
): Promise<Result<T>>;
function resolve(source: SourceSet, view: CompilerView): Promise<Result<ResolvedDesign>>;
function loadValidated(root: string): Promise<Result<ValidatedDesign>>;
```

这些是新接口；旧 extractGraph 不提供等价语义能力，不能继续复用它。内部 TypeHandle 注册表只保留本次 compiler 句柄，不序列化、不跨调用保存；领域输出没有句柄。compiler API 的 ID 只在本次根 analysis project 中使用，不拼接到声明身份里。

打开 source 给出的全部绝对项目路径；根 analysis project 用于全设计语义读取，其他项目只建立 import 方向与配置诊断。收集并去重 `getConfigFileParsingDiagnostics/getProgramDiagnostics/getGlobalDiagnostics/getSyntacticDiagnostics/getSemanticDiagnostics/getDeclarationDiagnostics`；任一 error 变成 typescript/CompilerDiagnostic，位置从实际 source span 取得，未关联文件的错误指向实际 config。不得丢掉 design 外的错误，也不得因 semantic 为空忽略 program 错误。没有 error 才调用 consume。

用 native compiler AST 的声明节点和 `checker.getSymbolAtLocation` 建立所有 alias/interface/type-parameter 声明关系；先建立索引，再遍历引用。import 与 re-export 通过 `getAliasedSymbol` 归一，并用 `isUnknownSymbol` 判断失败。只把类型语义中的设计内声明作为引用目标：局部泛型参数不因为与 import 同名而指向 import；默认库不是领域节点。接口/泛型辅助定义中的引用全部保留为边，私有辅助定义按词法目录归属。类型查询与 source node 只提供证据，不自行求值条件类型或展开泛型。

顶层声明以 resolved alias symbol 指认定义；独立同参数定义保留各自 canonical id；纯透明别名建 Auxiliary→canonical 引用，不产生第二个 Data/Connection。泛型辅助声明作为 Auxiliary 保留参数与引用，实际使用处通过 compiler 已替换的属性取得完整描述符，不把 `Keyed<string>` 退化为未经实例化的 Keyed。递归数据用 DataExpression.Reference 截断重复，不无限展开；未实例化参数用 Parameter 保留约束和名称，不猜成 unknown 或 never。

读取描述符只使用 compiler 解析后的 `design` 字面量、字段 Symbol 类型和 tuple 实参。未知字段、空说明、不能成为有限拓扑列表的数组、无法解释的描述符返回 resolve 诊断，不能略过一个文件。tuple 判定必须用 `await checker.isTupleType(type)`；实际元素用实例 `getTypeArguments`，不要因实例 `.isTupleType()` 为 false 而拒绝它。Apply 的 lambda 展示可以用 display，但身份与参数关系不能用打印文字解析。Value 的 never/any/error 不是合法已描述叶子，返回 InvalidDescriptor。

`withCompiler` 的 finally 先释放 snapshot，再关闭 API；两个释放用嵌套 finally，确保前者异常不阻止后者。compiler 和模型解析不执行设计源，不用动态 import 设计文件。打开/查询 API 不支持时给出 CompilerUnavailable 并退出非零，不切换解释器。

### 6. 验证定义边界，同时保留提供角色与可选组合的区别

用户已选择“提供角色加可选显式绑定”：缺少绑定不等于缺陷，类型设计不要求全体组合。不得从一个候选、当前唯一候选、提供者数组顺序或最深模块推断已选择提供方。

创建 `scripts/validate.ts`，导出 `validateRelations(design:ResolvedDesign): Result<RelationFacts>`。`service.ts` 的私有 seal 在 relations 与 markdown 均成功后才创建 ValidatedDesign；不导出品牌构造器。CheckReport.evidence 为固定五阶段元组，Diagnostic 的 stage/code 关联成闭合和类型。自动报告必须区分结构合法与组合选择：

```ts
type ElementUse = { readonly target: ElementId; readonly at: Location };
type Exposure = { readonly by: ElementUse; readonly connection: ElementUse; readonly from: ElementUse };
type Capability = { readonly connection: ElementUse; readonly provider: ElementUse };
type Binding = { readonly doc:string; readonly consumer:ElementUse; readonly connection:ElementUse; readonly provider:ElementUse };
type Selection =
  | { readonly kind:'Role'; readonly consumer:ElementUse; readonly connection:ElementUse; readonly candidates:readonly ElementUse[] }
  | { readonly kind:'Bound'; readonly consumer:ElementUse; readonly connection:ElementUse; readonly provider:ElementUse; readonly composition:ElementId; readonly binding:number };
type CompositionContext = { readonly composition:ElementId; readonly selections:readonly Selection[] };
type CombinationScope =
  | { readonly kind:'ContractOnly'; readonly roles:readonly Extract<Selection,{kind:'Role'}>[] }
  | { readonly kind:'WithCompositions'; readonly roles:readonly Extract<Selection,{kind:'Role'}>[]; readonly contexts:readonly CompositionContext[] };
type ScenarioContext = { readonly kind:'Contracts' } | { readonly kind:'Composition'; readonly composition:ElementUse };
type DutyMatch = { readonly duty:number; readonly completedAt:number; readonly basis:'DeclaredParticipant'|'SelectedBinding'|'RoleWitness' };
type ScenarioFacts = {
  readonly scenario:ElementId; readonly context:ScenarioContext;
  readonly steps:readonly ({readonly kind:'Call';readonly index:number;readonly selection:Selection}|{readonly kind:'Event';readonly index:number;readonly confirmer:ElementUse})[];
  readonly matches:readonly DutyMatch[];
  readonly ending:{readonly kind:'Complete'}|{readonly kind:'Interrupted';readonly responsible:ElementUse;readonly unmatchedDuties:readonly number[];readonly pendingNext:readonly {readonly actor:ElementId;readonly fromStep:number}[]};
};
type CarrierUse =
  | { readonly kind:'Reference'; readonly carrier:ElementUse }
  | { readonly kind:'Inline'; readonly id:string; readonly at:Location; readonly doc:string; readonly key:string; readonly lambda:TypeExpression; readonly laws:readonly string[] };
type RelationFacts = {
  readonly ownership:readonly Ownership[];
  readonly capabilities:readonly Capability[];
  readonly exposures:readonly Exposure[];
  readonly publicMaterials:readonly { readonly boundary:ElementId; readonly explicit:readonly ElementId[]; readonly contracts:readonly { readonly connection:ElementId; readonly materials:readonly ElementId[] }[] }[];
  readonly contracts:readonly Selection[];
  readonly compositions:readonly CompositionContext[];
  readonly scenarios:readonly ScenarioFacts[];
};
```

更新 `model.ts`：Module/Unit/External 列表、Lifecycle/Scope/Scenario 引用使用 ElementUse，保留每一处关系的实际源码位置；DataExpression 增加 `Application { definition:ElementUse; arguments:readonly TypeExpression[]; resolved:DataExpression }` 保留泛型实际应用，不把具体结果换回未实例化定义。Point/Face 的 carrier 既可为具名引用，也可为带完整字段的内联 Carrier；不重新增加“类型通过但必须具名才能读”的表面限制。增加 Family、Composition、Binding、Exposure 与 Selection；删掉单一 provider 的 Provision、Lifecycle.confirms、Interrupted.at。

`Uncomposed = Tag<'Uncomposed'>` 是内联标记，`ScenarioAssembly = Uncomposed | AnyComposition`；resolved Scenario 必须保存 ScenarioContext，不用 optional id，不回退到其他组合。每个 CompositionContext 从全部全局 `(consumer,C)` Role 集合建立，只替换该 Composition 有 Binding 的项，其余保持 Role，各 key 恰好一次。CheckReport 的 `combination:CombinationScope` 使用这份完整投影，不只列已绑定项。

定义唯一纯谓词 `eligibleProvider(consumer,connection,provider,facts): {kind:'Eligible'} | {kind:'Ineligible';code:'NoCapability'|'HiddenCapability'|'InternalRequirement';at:Location}`。Role candidates、Binding 验证、Scenario RoleWitness、Graph candidate 边统一消费它，不各写一套。所有 provides/requires/plugsInto/uses/core/types/ports/public/parts 列表在建立关系前按 canonical id 拒绝重复；透明别名仍算重复，诊断 related 首次位置。Expose 和 Binding 分别使用既定复合 key。

Carrier key 是一个连接内允许载体选项的稳定名字，不是全设计 nominal key；跨连接可同名而有不同定律。一个连接的 carriers 列表内，同 key 无论具名/内联都拒绝，位置指回两项。具名 Carrier 的身份仍为 canonical 声明 id。Port.carriers 用 CarrierUse，内联项的 lambda/laws 必须进入公开闭包与 Graph，不强迫导出。resolver 为内联项生成 `<connection canonical id>/carrier/<encodeURIComponent(key)>`，Graph 原样使用；说明、顺序、compiler 数字 id 不参与身份。resolver 保留列表，不用同 id 覆盖重复项；relations 的重复 key 门槛通过后才能建立 Graph 索引。

关系算法严格按下列顺序：

1. 按 canonical id 建索引；使用 SourceSet 的真实目录检查每个 architecture 目录一个 Module、每个 business 子目录一个 Unit，根 Module 存在。parts 恰为直接子模块，不能漏掉无类型声明的空目录。每个 core/types/ports 列表先检查重复，再建立唯一归属；同一 owner 重复写透明别名也报重复。
2. 连接 owner 只由 ports 建立，材料 owner 只由 core/types 建立，且声明目录必须一致；不从 provides、import 或使用方反推。Auxiliary 按词法目录归属，relations 的辅助定义不成为 Module 材料。独立具名 Opaque 稳定 key 不重复；引用/透明别名不制造新 key。
3. 自底向上建立 architecture 显式 public roots 和转交路径：owner 首次在 public 列入 Data/Event/Lifecycle，父模块只转交直接子模块的同一显式路径。PublicDataClosure 包含该 Data、其描述数据依赖、Family 与必要 Auxiliary；PublicEventClosure 包含 Event、payload 的 PublicDataClosure、confirmer 的 Participant identity，并在 identity 停止。PublicLifecycleClosure 包含 Lifecycle、key 的 PublicDataClosure；其 Fact 连接、Event、within 不是隐式公开根，前置可见性在步骤 7 检查。所有闭包只能随带自己拥有或已有合法公开路径的材料，不能洗白外部私有类型。Unit 没有显式 public 旁路，只随 Connection 契约公开材料；不能从子连接签名随意摘材料变成全局 public。
4. Module.provides、Unit.provides、External.provides 各建立 capability，而非运行绑定。requires/plugsInto/uses 此时只建立 usage key `(consumer,C)`，不计算候选或输出 Selection；未有提供声明的 unused contract 也合法。Expose 的 `(by,C,from)` 不可重复：from 若为直接子模块，其 boundary 必须公开 C；from 若为 External，须同时满足 `C∈External.provides && C∈Module.requires`。多条显式转交路径原样保留，不推断唯一 route。
5. 分清契约与能力：Offered(M)=provides∪reexports，Contracts(M)=Offered(M)∪requires（Unit 对应 provides∪plugsInto）。每个 Contracts 条目都建立 ContractExposure，包括参数/结果 Data、CarrierUse、Family、Follow/Fact 中的 Event 及必要 Auxiliary，不依赖有没有调用。Participant 身份处停止闭包，不能沿 Module.spec 洗出所有私有 core。Fact/Follow 不含 Lifecycle 引用，因此不能声称此闭包自动公开 Lifecycle：架构 Lifecycle 经 Module.public 供其他 owner 的 within 引用；Unit 的 Lifecycle 只在本单元及 relations 走查中引用，不能作为其他 Unit 的公开 within。checking.md 必须明确这个边界。定义 Connection 不得先偷用私有材料再公开签名。
6. 普通类型引用在同 owner、架构祖先材料内允许；跨 owner 只可依赖显式 public 路径，或自己声明提供/使用的公开连接之 ContractExposure。沿完整 Auxiliary 引用闭包检查；business→architecture 不全量放行。显式 public 与随连接签名公开是两条通道，不能把后者自动摘出变成全局 public；需要单独转交数据时由 owner 建立显式 public 路径。
7. 分别核验契约和能力路径。契约按声明 owner 的模块边界经过 Contracts 公开；能力按 provider 的模块边界经过 Offered/Expose 公开。共同祖先以下每穿过一个被访问子模块边界都必须有对应公开关系，不能跳过隐藏子模块；提供方为自己、祖先 Module、平级 Unit 或已声明 External 时按该参与方公开入口处理。business/External 访问架构的入口是根 Contracts。父模块 requires 表示外部需求，不能 Binding 到自己或自己的后代 Module 以把内部材料伪装成外部来源；relations 可以指认所有节点，但仍须检查 Consumer/Provider 的公开资格。公开 Lifecycle 的 Returned 锚点连接须已在该 boundary 的 Contracts 独立公开，Occurred 锚点 Event 须已经由显式 public 或 ContractExposure 可见，within target 须已有显式公开路径；Lifecycle 公开自身不创造这些路径或 capability，不满足则 PrivateReference。全部路径与闭包核验完成后，才对 usage keys 与 capabilities 调用 eligibleProvider，一次性建立全局 Selection.Role：零、一、多候选均合法，不能自动造 External 或任选提供方。
8. 每个 Composition 独立验证 Binding，不影响定义层。Consumer 必须声明 requires/plugsInto/uses C；Provider 必须声明 provides C（转交者不是原始 provider），并有合法公开能力路径。重复 `(Consumer,C)`、不匹配能力、隐藏提供方分别为 relations 的 InvalidBinding/PrivateReference。其余使用关系仍为 Role；部分组合不失败。架构源码仍不得 import 业务，relations 可以把架构要求的抽象 Connection 绑定到 Unit 提供的能力；这是组合声明，不把 Unit 名称写回架构定义。
9. 只有显式 Binding 产生确定的消费者→提供方依赖边；Role 的候选边不冒充确定依赖，不据其排列任选来源。每个 Composition 分别投影同层直接 parts/Units 的绑定依赖并检查 SCC；无 Composition 的定义层只检查组成/公开路径的结构环，不声称所有可能组合无环。当前模块自身/祖先、External、跨层参与方是该分解层的 Boundary 节点，保留视图边但不进入同层 parts SCC；同一子树内的边交给更深分解处理。候选组合的可行性与未绑定选择保留在 ManualReviewRequired，不枚举候选笛卡尔积。
10. Scope 同种直接包含唯一、嵌套同种且无环；Lifecycle.within 单独无环。独立 Opaque 的领域 key 全设计唯一；Carrier key 按一个连接的模式列表检查，不设全局唯一。透明别名不是新定义，doc 不承担投影 key。

CheckReport.combination 使用上述 CombinationScope；ManualReviewRequired 增加 unbound-composition-choices。relations Evidence 只声称归属/公开、声明能力/合法绑定、各已声明组合的同层绑定环/范围/有限场景关系成立；不声称每个 Role 已选提供者或所有候选组合都成立。

Stage 与诊断 code 的精确对应在 diagnostics.ts 用映射和类型表示：source（UnsafeInput、InvalidLayout、OutdatedGeneratedFile、WriteFailed、MissingDependency）、typescript（CompilerUnavailable、CompilerDiagnostic）、resolve（InvalidDescriptor、UnresolvedReference、EmptyDescription、UnknownMember）、relations（InvalidOwnership、PrivateReference、InvalidComposition、InvalidBinding、DependencyCycle、InvalidScope、InvalidScenario、UnfulfilledDuty、InvalidLifecycle、DuplicateKey）、markdown（InvalidMarkdown、AmbiguousReference）。保留 compiler 原 code/text 作为结构化 details，不用 message 字符串恢复错误类别。Role 候选为空不是 MissingProvider 错误，不把“尚未组合”当成缺陷；Binding 不符合提供声明才是 InvalidBinding。

公开名查找统一返回 `Found(id) | Missing | Ambiguous(candidates)`；Markdown 与 Graph 查询复用，不给同名元素随便选择一个。Binding、Expose 和候选信息均是声明关系，不是 live 服务状态。

### 7. 场景和生命周期只检查声明级事实，不实现运行时模拟

Scenario 默认 `Uncomposed`；若指定 Composition，使用该上下文的 Selection。它可以引用部分组合，未绑定的 Call 保留 Role，不把一条有限路径叫作完整可运行组合。

- 每个 Call actor 仍须通过 requires/plugsInto/uses 声明连接；这是自动关系检查，不因“不模拟授权”而取消。操作、分支、Event 必须存在。所有 Fact（含 Duty/Lifecycle 里的 Fact）统一在 relations 阶段再次检查合法操作/分支；宽上界或手写字面量不得绕过，错误为 InvalidScenario/InvalidLifecycle。
- Next 绑定产生它的 Call.actor，约束该 actor 的下一次 Call；其他 actor 与 EventStep 不消耗它。同 actor 下一次调用不命中任一 Targets 即失败。
- Duty 只可被严格后续步骤履行。caller 在创建时绑定源 Call.actor；具名 Participant 不变；provider 保存源 Call 的 Selection。Bound 时必须由选定提供方履行，Role 时可由候选提供者之一履行，并在 ScenarioFacts 记录 RoleWitness 而不是谎称已绑定。Role 零候选不能由任意参与方冒充 provider。Returned 完成动作人是完成 Call.actor，Occurred 完成动作人是 Event.confirms。
- Duty 覆盖使用有限二分图最大匹配，不能贪心消费：左侧为 duty occurrence，右侧为后续步骤；只有步骤严格晚于创建、Fact 相同、动作人满足责任才有边。按 duty 创建序和步骤序使用确定的增广路径匹配，每步骤最多匹配一个义务。Complete 要覆盖全部义务；Interrupted 保存同一确定最大匹配的未匹配项。必须通过 Role{A,B}+Bound{A}、随后 A/B 完成同一事实的反例；不模拟运行值。
- 上述匹配只在 duty occurrence 与完成步骤之间进行，与 provider/consumer 的配对无关；它不创建、补全或推断 Binding，不限制一个 provider 服务多个 consumer。Uncomposed Scenario 也检查其声明的有限义务，RoleWitness 不改变 Role。正向组合中 System 和 Worker 共用 StoreOne，须同时通过。
- Complete 要求 pendingNext 为空，且上述最大匹配覆盖全部 duty occurrence，不另维护消费义务的队列。Interrupted 的 Steps 在类型上要求非空，relations 也核验；最后一步就是中断事实，Responsible 必须是 Participant。即使当前没有 pending 项也允许 Interrupted，因为场景可以从一段生命周期中途开始；工具不据此推断现实中确有中断。未匹配义务与接手方在 ScenarioFacts/视图显示，不报告其已完成。
- Lifecycle.key 须为具名 Data 引用。Returned 查顶层所选分支字段（done 则单值结果）与操作参数，Occurred 查事件 payload，两侧至少各一次。嵌套 Choice/Outcome 没有被选分支时遍历全部分支。遍历 Value、Struct、Tuple、Apply.argument、Application.resolved、Reference 并带 visited；Opaque 是叶子，不查 HKT 原生输出。key 缺失/within 成环为 InvalidLifecycle。
- 不新增未定义的 ProviderRole 副本。静态生命周期的确认关系沿 ends Fact→Connection→capabilities 读取；只有 Event→Participant 保存 confirms 边。具体 Scenario 的 Call Selection 可以是 Bound 或 Role，不能为静态 Lifecycle 挑一个候选提供者。
- within 只建立静态嵌套；不维护单个运行值的 Unknown/Open/Closed 状态机，不把相同 Fact 的重复出现认作同一运行，不破坏幂等 finish。真实关联值、结束时序、责任兑现和覆盖性属于 ManualReviewRequired。

### 8. 生成骨架、读取有界输入与升级

新增 `scripts/configuration.ts`、`workspace-model.ts`、`workspace.ts`、`source.ts`。旧 initialize/addModule/addUnit 的拒绝覆盖、父目录已存在、名字校验可以按行为复用，但移除“先加载 Babel/tsc 依赖再允许 init”的耦合：CLI 按命令惰性加载 service/compiler/Markdown parser，init/module/unit 只加载生成器及文件系统边界。没有现成的安全升级入口或独立 SourceSet，需要新增。

```ts
type GeneratedFile = { readonly kind: 'Dsl' | 'Configuration'; readonly path: string; readonly content: string };
type Document = { readonly path: string; readonly place: Place; readonly kind: 'Readme' | 'Topic' };
type SourceSet = { readonly root: string; readonly files: readonly string[]; readonly types: readonly string[]; readonly documents: readonly Document[]; readonly projects: readonly string[] };
type WorkspaceChange = { readonly kind: 'Generated'; readonly root: string; readonly written: readonly string[] };
type UpgradePlan = { readonly kind: 'UpToDate' } | { readonly kind: 'UpgradeAvailable'; readonly writes: readonly GeneratedFile[] };
function generatedFiles(business: boolean, dsl: string): readonly GeneratedFile[];
function initialize(repo: string): Result<WorkspaceChange>;
function addModule(root: string, name: string): Result<WorkspaceChange>;
function addUnit(root: string, name: string): Result<WorkspaceChange>;
function planUpgrade(root: string): Result<UpgradePlan>;
function upgrade(root: string): Result<WorkspaceChange>;
function readSource(root: string): Result<SourceSet>;
```

初始化创建 navigation README、dsl、architecture、relations、三类 appendix；不生成占位 Module、领域类型或说明文本。module/unit 只生成真实目录和带标题的 README，作者仍须写职责与类型；第一次 unit 创建 business project 并刷新受工具管理的项目配置。生成的导航指向架构、relations、business（存在时）和附录，不维持第二份完整模块树。

生成配置的精确方案：

- 每个 leaf project 使用 strict、composite、declaration、emitDeclarationOnly、target/module ESNext、moduleResolution Bundler、allowImportingTsExtensions；不设 noEmit。rootDir 为该 project 目录。保持各自 outDir/tsBuildInfoFile 指向仓库 `.design-build/<project>`，但检查器从不调用 build/emitter，因此不写这些输出。
- dsl 项目 files 仅 dsl.ts。architecture include 仅自身递归 ts，references dsl。business（存在时）include 自身，references architecture、dsl。relations include 自身，references architecture、business（存在时）、dsl。
- 根 analysis config 设置 noEmit:true，不设 composite；include 明确为 `dsl/dsl.ts`、`architecture/**/*.ts`、存在时的 `business/**/*.ts`、`relations/**/*.ts`，references 指向上述 leaf projects。它用于 native API 全设计语义；同时打开 leaf configs 收齐项目诊断。
- 空 leaf project 使用已经在 CLI 夹具验证过的 `files:[]`、自身 include 与非空 references 组合；dsl 有实际文件。配置在 native API 下先验证无 emit，若 source redirect 对此发布 API 不可用则以 CompilerUnavailable 明确失败，不先 tsc -b 写产物、不改成另一套解释器或未经计划的配置分支。

readSource 先 lstat 根及每个允许目录/文件，拒绝 symlink、特殊文件、非法名称和越界；不会因为发现一个非法链接而继续 compiler。architecture 可递归模块；business 只直接单元；relations 扁平。附录只做普通文件与路径检查，不把示例/实现参考当规范类型编译。生成配置和 DSL 的检查只针对固定受管路径，对照当前生成器；语义文件不要求逐字节匹配模板。

升级选择最简单的显式命令，不增加版本钉住、Graph manifest 或所有权日志。`upgrade <design> --check` 只报告 UpToDate/UpgradeAvailable 及固定受管路径；`upgrade <design>` 只重写这些由目录契约归工具管理的 DSL/tsconfig，领域 `.ts` 和全部语义 Markdown 均不写。预检查全部路径安全后再开始；损坏/缺失的根结构、受管路径为 symlink/目录等情况非零拒绝，不能覆盖任意路径。中途 IO 失败明确报告已确认写入的路径，不声称多文件事务；再次运行同一命令可完成剩余生成文件，不加 journal 或回滚机制。

工具受管路径的拥有权由目录契约确定：skill 仓库模板是 DSL/config 的源头，init 后这组固定文件仍由工具生成；领域 `.ts` 与全部 Markdown 由设计作者维护。upgrade 不通过内容相等猜拥有权，也不试图合并作者对受管文件的自定义改动；--check 明列将替换的受管路径，显式 upgrade 按当前模板重建它们。领域文件若阻止新契约通过，只报告迁移位置，绝不静默重写。

现有旧项目没有新 DSL 时，upgrade 仍只换工具文件，然后通过正常 compiler/relations 路径给出需要人工迁移的具体领域位置，退出非零并区分“生成文件已更新”和“设计尚未通过”。不保留旧构造器兼容层、不猜测并改写领域类型。原文“与生成时一致”替换成“与当前生成器契约一致；用 upgrade 更新”。不添加 tooling.json 或保存 checksum 状态，避免把生成副本变成第二个权威。

### 9. Markdown 使用真实语法结构，结果不冒充语义正确

父包保留 `typescript:latest`，删除 `@babel/parser`，增加 `mdast-util-from-markdown:latest` 和供脚本类型验证使用的 `@types/bun:latest`；不钉版本或新增 FP 框架。新 `scripts/markdown.ts` 导出 `checkMarkdown(source:SourceSet, design:ResolvedDesign, facts:RelationFacts): Result<MarkdownEvidence>`。已核实所选 parser 的 `fromMarkdown(string): Root`；类型从 mdast/unist 导入，默认 CommonMark 支持本文语法；不写另一套正则 Markdown 解释器。

只遍历 typed mdast：heading 检查标题与小节次序；paragraph 检查职责介绍存在；link/linkReference+definition 检查真实链接；inlineCode 检查明确元素引用；code/html 不被当成正文标题/链接。引用定义按 CommonMark 标识归一，忽略大小写并折叠空白。主题 README 链接支持 `[x](topic.md)`、`[x][ref]`、shortcut/collapsed references；注释和代码里的文本不能伪造链接。

architecture README 小节依次是依据、为什么、语义；business 依次是依据、需求、为什么、语义；relations README 只作关系材料导航和语义说明，不设领域规则。没有内容的小节不写；出现的小节须有实际正文。工具只判断职责段/内容存在，不判断含义。

引用意图不从大写字母猜：含 `path#Name` 的 inlineCode 是明确符号引用，缺失必须诊断；已存在的可见名称及其 `.成员` 是可用简写，必须验证可见性/歧义/成员。完全不匹配声明的裸 code span（如 JSON/HTTP）是普通代码文字，自动检查不声称核验它；规范性引用应使用完整 id，尤其在可能重命名或歧义时。合法下划线、Unicode、美元符号按 compiler 名称识别；已识别的 `RunFace.json` 不能被文件扩展名豁免。同名先按文档位置筛选，仍多义则要求路径限定；不加注解、术语表或全局前缀规则。

### 10. 本地 Graph 引擎与视图的精确接口

新建子 skill 的 `scripts/graph-model.ts`、`engine.ts`、`project.ts`、`render.ts`、`graph.ts`；只把旧 renderer 的 Mermaid id/cell/label 转义行为迁移，不复制旧领域模型或 provider 推断。

```ts
type Relation =
  | 'owns' | 'can-provide' | 'uses' | 'contract' | 'candidate'
  | 'exposes' | 'forwarded-from' | 'part' | 'public-material'
  | 'field' | 'parameter' | 'result' | 'case' | 'carrier' | 'applies' | 'type-argument' | 'reference'
  | 'next' | 'duty' | 'completes' | 'starts' | 'ends' | 'key' | 'within' | 'confirms'
  | 'contains' | 'step' | 'takes' | 'handoff' | 'composition' | 'binding' | 'bound-to';
type NodeBase = { readonly id:string; readonly name:string; readonly doc:string; readonly at:Location };
type ElementNode = { [K in Element['kind']]: NodeBase & { readonly kind:K; readonly details:Extract<Element,{kind:K}> } }[Element['kind']];
type MemberPayload = {
  Operation:Operation; Field:Field; Case:DataCase; Variant:Variant; Duty:Duty;
  Fact:Fact; Step:Step; Application:DataExpression; Expose:Exposure;
  Binding:Binding; Role:Selection; Completion:Completion; CarrierMember:Extract<CarrierUse,{kind:'Inline'}>;
};
type MemberNode = { [K in keyof MemberPayload]: NodeBase & { readonly kind:K; readonly details:MemberPayload[K] } }[keyof MemberPayload];
type GraphNode = ElementNode | MemberNode;
type GraphEdge = { readonly from:string; readonly to:string; readonly relation:Relation; readonly label:string; readonly at:Location };
type GraphContext = {readonly kind:'Contracts'} | {readonly kind:'Composition'; readonly composition:ElementId};
type Graph = { readonly context:GraphContext; readonly nodes:ReadonlyMap<string,GraphNode>; readonly out:ReadonlyMap<string,readonly GraphEdge[]>; readonly incoming:ReadonlyMap<string,readonly GraphEdge[]> };
type QueryError = { readonly kind:'Missing'; readonly selector:string } | { readonly kind:'Ambiguous'; readonly selector:string; readonly candidates:readonly string[] };
type QueryResult<T> = { readonly kind:'Found'; readonly value:T } | QueryError;
type Neighborhood = { readonly context:GraphContext; readonly nodes:readonly GraphNode[]; readonly edges:readonly GraphEdge[] };
type PathResult = {readonly kind:'StructuralPath'; readonly context:GraphContext; readonly edges:readonly GraphEdge[]; readonly roles:readonly Selection[]} | {readonly kind:'NoPath';readonly context:GraphContext};
function buildGraph(design:ValidatedDesign,context:GraphContext): Graph;
function search(graph:Graph,text:string,kind?:GraphNode['kind']): readonly GraphNode[];
function neighbors(graph:Graph,id:string,direction:'out'|'in'|'both',depth:number): QueryResult<Neighborhood>;
function shortestPath(graph:Graph,from:string,to:string): QueryResult<PathResult>;
```

GraphNode 是闭合 ADT；details 引用领域记录，不是任意 JSON。search 不创建持久全文索引，按稳定 id 顺序扫描节点。BFS 使用队列/visited，不枚举全部简单路径；等长路径按 `(relation,to,from)` 字典序选择。depth 必须正整数，非法参数在打开 compiler 前拒绝。选择不存在/歧义的 Composition 非零，不替调用者选默认组合。即使只有一个候选，Contracts 中仍为 Role；只有 Binding 产生 Bound。

成员 id 固定为 `所属id/member-kind/encodeURIComponent(name)`；匿名 Apply/Fact/Step 用源所属位置及元组下标区分，不用说明文字作身份。所有具名引用通过 canonical id 链接；Graph 保存字段、操作、分支说明、参数结果、载体、HKT 应用、恢复义务和生命周期事实，而不仅是名字名单。

边方向固定为：owner→材料 owns；声明提供方→连接 can-provide；使用方→Role uses；Role→连接 contract、Role→候选 candidate；显式上下文中绑定的 Role 改为→选定提供方 bound-to，并关联对应 Binding 节点，不从候选挑选。module→连接 exposes、module→From forwarded-from；module→part part；连接→载体 carrier、连接→操作、操作→参数/结果；数据→字段/分支；Apply→参数/Family；表达→被引用定义 reference；分支→next 操作/duty；duty→完成事实；Returned Fact→连接/合法分支 reference，Occurred Fact→Event reference，Event→确认参与方 confirms；Lifecycle→starts/ends/key/within；Scope→member contains；Scenario→step，step→事实/actor takes，Interrupted→responsible handoff；Composition→Binding，Binding→使用方/契约/提供方为明确 reference。默认图可以检索组合声明，但不把别的 Composition 的 Binding 当当前选择。StructuralPath 保留经过的 Role/Bound，不能因为图有路径就说已经完成组装。

Markdown view 临时生成模块树、材料表、逐模块组成、业务接入、各类范围、场景时序，以及参数/结果/分支/载体/义务/生命周期表。契约视图中提供能力与需要角色使用不同标记，候选不画成已选关系；选择 Composition 后仅该上下文的 Binding 画实线，剩余 Role 明示未绑定。父自提供 Clock 和 Worker 使用角色在组成视图都出现并连到同一 Clock，不能遗漏。叶模块可用材料表，不重复画同一内容；长说明放表，图标签保留名称与角色。JSON 输出稳定节点/边/上下文/自动与人工边界，不暴露 compiler 句柄、不写 Mermaid/Graph 文件。

CLI 所有成功结果 stdout，诊断 stderr。设计拒绝与查询 Missing/Ambiguous 退出 1；参数/环境不可用退出 2；NoPath 是退出 0 的正常结果。错误不得输出半张 Mermaid 或半段 JSON。`view` 没有“允许部分图”选项；调试只看结构化诊断。

### 11. 入口迁移和文档行为契约

重写父 `scripts/design.ts` 为参数解析与调用编排，仅保留 `init <repo>`、`module <design> <a/b>`、`unit <design> <name>`、`upgrade <design> [--check]`、`check <design> [--json]`。check 调 `loadValidated`；默认输出“自动结构检查通过；设计语义尚需人工审查”及 stage 计数，JSON 输出 CheckReport。无参数/未知命令给精确用法，父 graph 不提供兼容转发。

删除当前父目录 `extract.ts`、`graph-model.ts`、`graph-checks.ts`、`render.ts` 及其全部 import，迁移点可由精确 grep `extractGraph|checkGraph|renderMarkdown|renderJson|graph-model|graph-checks|design\.ts graph|@babel/parser` 列出。批准前的命中仅在父 skill 的 CLI、五个旧脚本、SKILL.md、sources.md、package.json，已实际检索。不要把旧文件原样搬到子 skill。用户指定保存的 `old/` 是独立历史归档，不作为当前实现的调用方或 fallback。

父 `SKILL.md` 仍讲骨架三问、两条轴、架构先于业务、类型/语义分工、允许按内容新增类型与主题文件；把 DSL 词汇/投影指向模板和类型说明，把检查保证指向 checking.md，把所有 Graph 操作路由到子 skill。子 `SKILL.md` 只讲有界读取、运行时构图、查询/视图、输入失败和结果生命周期，引用父 skill 的唯一 DSL 与验证契约，不复制规则。sources.md 直接替换错误的“TS7 无 API”结论，区分文献原则与本 skill 的工程选择，不保留旧说法。全部受影响文档在编辑前后通读全文。

用户设计目录不持久化 Graph；因此不采纳“提交生成图或建立持久阅读图入口”的旧建议。阅读时用子 skill 临时 search/neighbor/path/view，并将语义解释留在所属 README/主题文件。根导航只指向设计材料与运行时查看命令说明，不冒充已生成图。

### 12. 实施分工和依赖顺序

主实现者保留 DSL、diagnostics/model、compiler/resolver 接口、关系/场景/lifecycle 中心语义、Graph 投影/引擎契约及所有文档。先完成步骤 1、2、4 的类型契约与决定性 compile/semantic 夹具，再固定上述接口。

契约固定后，同一批派发无重叠的外围单元：workspace/configuration/source；Markdown 结构检查；Graph renderer/CLI；契约验收夹具。compiler adapter 只有在 facade 已固定后才能委派其 native API 包装，不能让 worker 选择领域语义。并发 writer 必须隔离，路径相对本仓库；会话工作区不是本 repo 时，不得让隔离 child 通过绝对路径回写主 checkout，改用只读调查/补丁交付并由主实现者集成。不要在 sibling 改动未齐时交叉跑全套构建；集成后由独立验收者运行最终用户路径。

### 13. 用户编号与交付对照

编号保留用户原意，15、18 是实施前置门槛；其余项目不能只靠正文声称解决。

|编号|决策位置|必须观察的验收|
|---|---|---|
|15|步骤 1、5|嵌套 Apply/Tuple/HKT 原生投影与 resolver 同时通过；裸领域值拒绝。|
|18|步骤 2、6、9|类型、解析、关系、文字的失败分别定位，自动通过仍携带人工待审。|
|1|步骤 3、10|独立子 skill 的四种真实命令可用，每次重建且没有图/索引持久化。|
|2|步骤 1、4|核心 Struct/Choice/Family 保留说明、成员与实际泛型参数。|
|3|步骤 4、6|ports 归属、provides 能力和 External 使用关系不互相代替。|
|4|步骤 6|私有材料负例拒绝，合法公开契约闭包可用，不把连接公开误当全局数据公开。|
|5|步骤 4、7|Next 按原 actor 下一次调用，Later 允许中间步骤；Complete/Interrupted 分别保留正确义务事实。|
|6|步骤 4、7|Returned/Occurred、key 两侧引用、within 及确认关系进入同一模型。|
|7|步骤 4、6|未允许 Carrier 编译拒绝，内联/具名载体及定律在图上可读，重复连接选项键拒绝。|
|8|步骤 5|合法 generic/re-export/alias/HKT 的真实 check 不再被表面语法解释器拒绝。|
|9|步骤 5、6|本地辅助 interface 捕获私有类型的负例触发 PrivateReference。|
|10|步骤 2、3、10|已知类型/解析/关系错误均非零且 Graph stdout 无部分成功。|
|11|步骤 10|参数/结果/分支/说明/义务/生命周期的节点、边与表均可查询。|
|12|步骤 6、10|父 System 提供 Clock、子 Worker 使用 Clock 的关系完整出现。|
|13|步骤 1、6|Opaque 说明修改不改投影身份；重复独立 key 拒绝。|
|14|步骤 1|case/kind 同名业务字段保持可投影，不被判别标签吞掉。|
|16|步骤 4、5|直接及经 alias 的未知规格键都失败，而非静默丢失关系。|
|17|步骤 4、5、9、10|内联成员不强迫导出，具名节点允许跨目录同名，歧义查询列出完整 id。|
|19|步骤 8|upgrade --check 不写，upgrade 只更新受管文件，不改领域文件；旧签名需明确迁移。|

## 关键文件与定位

- `skills/software-design/templates/dsl.ts`：Data/Shape、ModuleSpec、Fact/Follow/Lifecycle/Scenario；实施起点的新 DSL 必须补 Family、Expose、Composition/Binding 和角色语义，不能恢复旧构造器。
- `skills/software-design/scripts/diagnostics.ts`：Result、Evidence、CheckReport；固定五阶段证据、manual 边界和组合范围，不允许缺阶段的成功。
- `skills/software-design/scripts/model.ts`：DataExpression、Element、Reference；把单 provider 草稿换成 capability/exposure/selection，关系全部保留 ElementUse 位置。
- `skills/software-design/scripts/design.ts`：原 checkStructure/checkTypeScript/check/main；替换编排，删除 Babel/tsc -b/父 graph 分支，不留下第二套入口。
- `skills/software-design/references/checking.md`：权威、场景与失败边界；把实施起点中旧 confirms/Interrupted 说明直接替换为最终类型含义，不追加并列解释。

## 验收规范

以下为获批执行后的验收规范。工作目录为 `/Users/mouriya/Ext/code/software-design`。先 `bun install --no-save --cwd skills/software-design/scripts`，再用相同来源的真实 compiler；不把依赖版本号写入实现。

### A. 保留可复现的行为夹具

新增 `skills/software-design/tests/projection.test.ts`、`runtime.test.ts` 与 `support.ts`。它们只检验真实消费者行为、边界和不变量，不检查源码文字、转发函数或 incidental 默认值。support 使用 `mkdtempSync('/tmp/software-design-accept-')` 创建唯一自有根，把实际 CLI 命令参数数组和退出/JSON 结果记录到测试输出。每个子进程 detached:true、45 秒超时；超时和 finally 按整个进程组结束，先 SIGTERM，必要时 SIGKILL；TypeScript native child 没有 detached 配置，会继承该组。测试结束只删自有根，绝不扫描或清理整个 /tmp。

实际验收命令分别运行，不拼成 shell 链：

```sh
bun test skills/software-design/tests/projection.test.ts
```

```sh
bun test skills/software-design/tests/runtime.test.ts
```

projection.test.ts 用真实 compiler 处理以下独立 source 输入并核验结果类型/diagnostics，不靠 `@ts-expect-error` 吞错：

- 标量、Struct、Choice/Outcome 含 case/kind 字段、多层 Apply、Tuple 多参数、泛型 Keyed 的等价投影通过，分支不变 never、不消失。
- Value 中裸领域 object/ReadonlyMap、非 TypeLambda、缺说明、错误操作/分支、未知规格键（直接写与经 alias 传入）、未允许 Carrier 分别被类型阶段拒绝。
- 两个不同 key 的 Opaque 不相容；修改 D 而保持 K 不改变 Shape；两个独立命名定义重复 K 在 relations 阶段失败，不把编译器的结构相容误当领域键已检查。
- parser 使用 native 已解析的 Apply 参数、透明 alias、re-export、泛型和 HKT，确认并非只测试 tsc 通过而 resolver 仍拒绝。
- RunFace/Returned、Module/Event、两个互相 Next 的 Face 的递归关系必须保持真实编译与语义解析通过；计划阶段的虚拟 FS 已确认实施起点无循环别名，后续 brand/Family/Binding 更改不能破坏它们。

### B. 真实用户入口正向路径

runtime.test.ts 用真实 `design.ts init/module/unit` 创建以下类型设计，不创建运行实现或假提供服务：

- 根 System 定义 RunHandle、ListFamily、SyncCarrier、Clock、StorePort 与一个未接入 DormantPort；core/ports 列表列出相应定义，provides Clock，requires StorePort，parts Worker，通过 Expose 向外转交 Worker 的 RunFace。
- 两个 External StoreOne/StoreTwo 均声明提供 StorePort；不选择 Composition 时，System/Worker 对 StorePort 的使用都是 Role，保留两个候选；DormantPort 的无提供方定义合法，不制造占位实现。
- Worker 提供 RunFace，并 requires Clock、StorePort。start 的 Started 分支产生 caller 的 Later finish 义务；Unknown 分支 Next status；status Running 再产生 caller finish 义务。start/status/finish 都通过同一 RunHandle 关联，RunLifecycle.starts 选 Started 分支、ends 选 finish.done，不再以 start 调用本身当成功。
- Launch Unit 使用 RunFace；场景含 `start.Started → 一个合法中间 Work 调用 → finish.done`，验证 Later 不要求紧邻。另一个 Next 场景在其他 actor 调用/EventStep 穿插后仍由原 actor 下一次 Call 承接；原 actor 自己插错调用时才失败。
- relations 里放两份部分 Composition：Local 只把 System/Worker 的 StorePort 选 StoreOne；Remote 改选 StoreTwo。另加 ClockBinding 把 Worker.Clock 选 System，Launch.RunFace 可以保持未绑定或显式选 Worker；未绑定不失败。相同契约可有多个候选，具体选择只影响所选上下文。
- 两个业务单元都定义局部 Status，名称相同合法；Graph 以完整 id 区分，裸名称歧义查询失败并列出两个 id。
- 每个 README 有职责介绍和非空的适当小节；一个主题文件通过 reference-style link 相连；注释/围栏里的伪标题、伪链接不参与格式检查。

对实际临时根 `$R/design`，harness 逐条执行下面的 argv 等价命令。它为 `$R` 代入自己生成的绝对路径，并把该路径输出给报告：

```sh
bun skills/software-design/scripts/design.ts check "$R/design" --json
bun skills/software-design-graph/scripts/graph.ts view "$R/design" --json
bun skills/software-design-graph/scripts/graph.ts search "$R/design" Store
bun skills/software-design-graph/scripts/graph.ts neighbors "$R/design" Worker --depth 2
bun skills/software-design-graph/scripts/graph.ts view "$R/design" --composition Local --json
bun skills/software-design-graph/scripts/graph.ts view "$R/design" --composition Remote --json
bun skills/software-design-graph/scripts/graph.ts path "$R/design" Worker StoreOne --composition Local
bun skills/software-design-graph/scripts/graph.ts view "$R/design"
```

观测要求：

1. check 的 JSON 为 AutomaticallyChecked，证据五阶段齐全，ManualReviewRequired 存在，未绑定 Role 不被说成 Bound。
2. 默认 Graph 同时保留 StoreOne/StoreTwo 候选而不任选；Local/Remote 只在各自上下文出现正确 bound-to，未绑定部分仍是 Role。不同调用先后不会留下上一次选择。
3. Graph 包含参数/结果、嵌套 Apply 参数、Case/Variant 字段说明、Later/Next、Fact/lifecycle 及公开转交关系，不只列名字。
4. Worker 的 Clock 角色与 System.can-provide Clock 都在图中；Markdown 组成图有对应关系，不再只有断开的节点。
5. search 找到两项 Store 能力及声明位置，neighbors 返回正确两跳邻域，path 返回实际边序列及上下文，孤立节点查询返回 NoPath；歧义与不存在分别非零。
6. 在 check、每次 query/view 前后比较自有 design 与 repo 文件集合/内容；没有新增或修改 Graph、索引、`.design-build`、`.d.ts`、`.tsbuildinfo`。API 与 Graph 命令完全退出，无该根对应 native --api 子进程。再改一个源说明/Binding 后重新调用，结果必须即时反映新源码，而非缓存。

### C. 每种失败都落在正确阶段，且没有部分图

每次只改变一个输入，其余恢复为基线；每次调用真实 check 与 Graph view。断言结构化 code/stage/位置和退出码，不钉 TypeScript 原文措辞：

|输入变化|预期可观察结果|
|---|---|
|添加 `export type Broken =`|typescript 拒绝，Graph stdout 不含正常图/部分 JSON|
|规格键 requirs，含经别名传入|typescript 拒绝；不能丢掉该关系后成功|
|两个 Unit：Producer.PrivateData 私有，Consumer 的本地 interface extends Struct 捕获它，再包 Value|原生类型可成立；完整语义引用闭包触发 relations/PrivateReference；公开连接签名中的相应数据作为正控制可以使用|
|直接或 barrel re-export 的相同合法 Keyed Op result|类型与 resolver 都接受，透明 alias 不重复 owner|
|Composition 给同一 Consumer/Port 两次 Binding，或选未声明能力/隐藏 provider|relations/InvalidBinding 或 PrivateReference，不能把别的候选当选定方|
|只删除一个 Binding|检查通过，该使用从 Bound 变 Role；不因未完整组合报错|
|Next 原 actor 插错调用；Later Complete 少一次 finish；以宽上界或手写 Fact 绕过局部约束的错误分支|relations 的 InvalidScenario/UnfulfilledDuty/InvalidLifecycle；普通无效操作或分支先由 typescript 拒绝，不靠位置相邻冒充义务|
|Interrupted 非空并给出接手方；空 Interrupted|前者保留未履行项并通过结构检查，后者类型或 relations 拒绝|
|Role-provider duty 候选 A/B 与 Bound-provider duty A 先后创建，A/B 先后完成同一事实|最大匹配覆盖两义务，不能因先消费 A 而错误报 UnfulfilledDuty|
|两个相同 duty occurrence 只有一个合格后续步骤，再补第二步骤|前者 Complete 拒绝，后者通过；一条步骤不能同时抵消两次独立义务|
|provider Duty 的 Role 为零候选，Complete / Interrupted 对照|Complete 因义务未覆盖拒绝；非空 Interrupted 保留义务与接手方，不制造提供者|
|Lifecycle.key 在两侧均无语义引用、within 成环|relations/InvalidLifecycle；不解析说明字符串猜锚点|
|公开 Event 的本地 payload；公开 Lifecycle 的私有 Fact 连接或私有 within|Event 的数据闭包可见而不泄露 Participant.spec；Lifecycle 不洗白私有锚点，relations/PrivateReference；独立公开锚点后通过|
|同连接内联/具名 Carrier 重复 key；两个不同连接用相同 key|前者 relations/DuplicateKey；后者通过，内联节点 id 按所属连接加 key 稳定且不受说明/顺序修改影响|
|README 无介绍、主题仅在 code span 里伪链接、明确 path#Missing 引用|markdown 拒绝；reference-style 真链接和 HTML 注释不误报|
|architecture 下放向自有微型 sibling 的 symlink|source/UnsafeInput，compiler 根本不打开；目标绝不是 /tmp|

### D. 升级与安装后的同一路径

在同一自有根中保留领域文件和 README 的内容摘要，把一份受管 DSL/config 改成旧内容后调用 `upgrade --check`：必须不写文件且报告 UpgradeAvailable。再调用 upgrade：只更新固定 DSL/config 路径；领域/Markdown 摘要完全不变；若领域仍用旧签名，给出明确 migration diagnostics 和非零，不保留兼容别名。把领域类型按新契约修好后，重跑 B 的完整路径；第二次 upgrade 为 UpToDate。

最后从本 repo 的 main 提交推送，不开 issue/PR。用 `npx skills list --global` 取得已安装 agent 列表；来源已为 SSoT 的现有 skill 分别执行：

```sh
npx skills update software-design --global
npx skills update software-design-graph --global
```

首次安装或来源切换时，使用新仓库并保持实际相同的 agents：

```sh
npx skills add mouriya-s-lab/SSoT --skill software-design software-design-graph --global --agent <实际相同agents> --yes
```

不得手工同步安装目录。对两个安装来源及目录内容核对：Source 为 `mouriya-s-lab/SSoT`，`diff -r skills/<name> ~/.agents/skills/<name>` 无输出。安装所需依赖后，用安装入口再跑同一 acceptance 正向路径；不能仅验证仓库入口。

## 假设与异常处理

- 用户要求没有授权持久化 Graph，故不添加图输出文件、数据库或自动快照；stdout 输出可以由调用者查看，但工具不把它作为下一次状态源。
- TypeScript unstable API 的确切调用方式已实跑；实现只使用该一条 async 路径。API 不可用时返回明确 CompilerUnavailable 和非零退出，不降级、不钉版本、不恢复 Babel。
- 设计不要求产出可运行的系统组合根；有限 Scenario 是设计走查，不扩展为完整业务执行器。类型能表达的关系进入 DSL，真实时间规则与理由留给语义文档。
- 用户已选择“另支持可选的组合声明”：默认提供角色不要求选定来源，Composition/Binding 可以表达局部选择；未绑定和已绑定在类型、报告、图中分开。不得再回到“每个连接唯一来源”的草稿假设，也不新增全体必须绑定的要求。
