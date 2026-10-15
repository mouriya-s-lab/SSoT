# 自动检查与人工语义

设计源码中的 TypeScript 与 Markdown 是持久输入。TypeScript native compiler 解释类型，解析器拷贝领域事实，关系检查建立结构证据；Markdown parser 只检查文字的语法结构。Graph 子 skill 消费这条通道的成功结果，不自行解释 DSL。

## 生命周期与失败门槛

```mermaid
flowchart LR
    S[有界设计源码] --> T[Native compiler]
    T --> R[完整 ResolvedDesign]
    R --> V[关系与 Markdown 检查]
    V --> C[ValidatedDesign]
    C --> G[单次内存 Graph]
    G --> Q[stdout 查询与视图]
```

任一阶段失败都停止，不产生下一阶段的成功值。类型错误不解析 error Type；解析错误不返回部分模型；关系或 Markdown 错误不返回 ValidatedDesign；Graph 不能展示半张图。`Result<T>` 只有 `Accepted<T>` 和带非空诊断元组的 `Rejected`。诊断保留阶段、闭合分类、相对路径/行列、相关位置和说明；compiler 原错误 code/text 另存结构化 details。

Compiler session 只在一次检查中存在。解析结束后先释放 snapshot，再关闭 API；嵌套 finally 保证前者失败仍关闭后者。领域输出不含 compiler Type、Symbol、Node 或数字句柄。后续关系与 Graph 只读领域值。设计源不会被执行。native API 不可用时输出 `CompilerUnavailable`，不切换解释器。

图、邻接表与查询结果只代表本次读取。工具不写 Graph、索引、缓存、审查确认文件或 compiler 输出，不以旧视图作为下次输入。

## 五阶段证据

|阶段|建立的结构事实|不建立的事实|
|---|---|---|
|`source`|允许目录中的普通文件有界；无 symlink/特殊文件；受管 DSL/config 与当前生成器契约一致|领域内容正确|
|`typescript`|类型构造、HKT、操作/分支、精确规格键与项目方向合法；收集所有项目的 config/program/global/syntactic/semantic/declaration diagnostics|能力存在或定律成立|
|`resolve`|声明身份、透明别名、实际泛型参数、完整描述符与辅助定义真实引用|跨单元引用合法|
|`relations`|归属、公开、能力/转交、合法局部绑定、已声明组合的同层绑定环、范围和有限场景关系|每个角色已选提供方；所有可能组合可行|
|`markdown`|标题、介绍、小节、真实链接、可见且唯一的符号与成员引用|说明准确、依据真实或理由充分|

成功叫 `AutomaticallyChecked`，其 evidence 是固定五阶段元组。`ManualReviewRequired` 始终携带具名事项、来源位置和具体说明，至少包括依据与理由、业务含义、载体定律、时间/并发、真实关联与履责、需求与场景覆盖、未绑定组合选择。自动化不把人工事项显示为 pass/warning，不缓存“已审查”。成功退出只声称自动结构检查通过。

## 数据与投影

`Value` 的叶子只接受 `Scalar` 或已经描述的 Data。普通领域字段使用 `Struct`，有位置意义的参数使用 `Tuple`，核心和类型使用 `Choice`，操作结局使用 `Outcome`。内部结构未知时用带稳定领域 key 的 `Opaque`；说明不是身份。

`Apply<D,F,A>` 保留本次 HKT 应用的说明、lambda 和 argument。唯一投影为先 `Shape<A>`，再 `Kind<F,Shape<A>>`；工具不扫描 F 的原生输出。Family 描述公开类型构造器；私有 TypeLambda 辅助定义保留引用，但不强迫成为领域术语。Choice/Outcome 都投影成 `case` 标签与 `fields` 字段，业务字段也可叫 `case` 或 `kind`。

描述符共有 DSL 私有 unique-symbol 标记；解析器核验标记声明来源，不凭 `doc/fields` 外观猜类型。泛型由 compiler 替换，打印类型只用于展示。透明 alias/re-export 不产生第二个定义；独立定义即使结构相容仍各有 canonical id。id 为相对路径加声明名，局部名称允许重复。递归引用以具名 Reference 截断，不展开成无限树。

局部非法组合优先由类型拒绝；resolver 拒绝无法解释的 any/never/error、空说明、未知成员与非有限拓扑列表。跨文件与全设计规则由 relations 建立，不能把类型结构相容当成领域身份。

## 归属、公开与能力

Module 的 `core` 与 Unit 的 `types` 归属 Data/Family/Carrier/Event/Lifecycle；`ports` 独立归属 Connection。Auxiliary 按词法目录归属。`provides` 声明原始能力；`requires`、`plugsInto`、`uses` 声明使用。它们不反推定义归属。未使用、没有提供方的连接定义合法。

Module 的 `public` 显式公开 Data/Event/Lifecycle roots；父模块只能继续转交直接子模块的同一公开路径。Data 闭包含描述的数据、Family 与必要 Auxiliary；Event 闭包含 payload 与 confirmer identity，在参与方身份处停止；Lifecycle 闭包只带自身与 key 的数据闭包，不隐式公开 starts/ends 的 Connection、Event 或 within。公开 Lifecycle 的这些前置关系必须独立可见。

Connection 的参数、结果、载体、Family、Follow/Fact 中的 Event 与必要 Auxiliary 构成随契约可见的闭包。这个通道不把材料变成全局 public，也不沿 Participant 的 spec 公开全部私有材料。连接不能先引用其他 owner 的私有类型，再以公开签名洗白。Unit 没有 `public` 旁路，只随连接契约共享数据与事件；它的 Lifecycle 不能作为其他 Unit 的公开 within。架构 Lifecycle 跨 owner 的 within 需要显式 public 路径。

`Expose` 保留 `(by,connection,from)` 的每条公开转交路径，不选择运行提供方。直接子模块的公开能力可以转交；External 路径还要求其提供 C 且当前 Module requires C。多条不同 From 可以并存，同路径不重复。

契约沿 `Contracts = Offered ∪ requires` 公开；能力沿 `Offered = provides ∪ reexports` 公开。访问子模块不能跳过中间隐藏边界；business/External 访问架构从根 Contracts 进入。父 Module 的外部 requires 不得绑定给自己或自己的后代 Module。

## 角色与局部组合

每项使用建立 `Selection.Role`，保留零、一或多个合法候选；即使只有一个候选也不选择它。唯一 `eligibleProvider` 谓词用于候选、Binding 与场景见证资格。

`Composition` 是独立、可选、可以部分填写的组合声明。Binding 保留 consumer、connection、provider；消费者必须声明使用，提供方必须声明 provides，且能力沿公开边界可达。转交方不是原始 provider。同一 Composition 内 `(consumer,connection)` 只能绑定一次。每个组合从完整角色集投影，只替换显式绑定项为 Bound；其他项保持 Role，不回退到其他组合。

只有 Binding 建立确定依赖。各组合分别检查同层直接 parts/Units 的绑定环；当前 Module、祖先、External 与跨层边界不混入该层 SCC。默认契约层不声称所有候选组合无环，不枚举候选笛卡尔积。组合不改变 Module/Unit 定义，也不把业务名称写回架构。

所有归属/提供/使用/公开/parts 列表先按 canonical id 拒绝重复；透明别名也算重复。独立 Opaque key 全设计唯一；Carrier key 只在一个连接的选项内唯一，不是全设计身份。内联 Carrier 合法，其稳定 id 来自连接 id 与 key，说明或顺序不影响身份。

## 场景与生命周期

Scenario 默认 Contracts；显式 Assembly 才选择某一 Composition。Call actor 必须声明使用对应连接；操作、分支、Event 与所有 Duty/Lifecycle 的 Fact 均重新核验。自动检查只陈述有限声明事实，不模拟运行值或授权系统。

Next 约束产生它的 actor 的下一次 Call。其他 actor 与 EventStep 可以穿插；同 actor 的下一次 Call 必须命中一个目标。Later 允许任意合法中间步骤，但正常完成前须履行全部义务。

Duty 只由严格后续步骤完成。caller 绑定源 Call.actor；具名 Participant 不变；provider 保留源 Call 的 Selection。Bound 必须由所选提供方完成；Role 可由一个合法候选完成并记为 RoleWitness，不因此产生 Binding。零候选不能由任意参与方冒充。Returned 的动作人是完成 Call.actor；Occurred 的动作人是 Event.confirms。

义务检查使用 duty occurrence 与完成步骤之间的确定最大二分匹配，每步骤最多完成一次义务。顺序按 duty 创建序与步骤序；不能贪心先消费一个稀缺完成者。匹配不创建、推断或补全 Binding，也不限制一个提供方服务多个消费者。

Complete 必须覆盖全部义务，且没有 pendingNext。Interrupted 的 Steps 必须非空，最后一步就是中断事实；它保留接手方、同一最大匹配的未匹配义务及 pendingNext，不声称正常完成。即使当前没有 pending 项也允许中断，因为场景可以从生命周期中途开始。

Lifecycle.key 必须引用具名 Data，且在 starts/ends 两侧各至少出现一次。Returned 只查操作参数与选中顶层分支字段（单值结果为 done）；Occurred 查 payload。嵌套 Choice/Outcome 没有选支时遍历各支，Apply 只查 argument，不查原生输出。within 独立无环。静态 Returned 的确认关系沿 Fact、Connection、capabilities 读取；只有 Event 保存明确 confirms。场景绑定不回写静态 Lifecycle，不为它任选提供方。

真实关联值、同一运行的识别、结束时序、幂等行为是否兑现与场景覆盖属于人工审查。工具不维护 Unknown/Open/Closed 状态机，也不因相同 Fact 再出现便认作同一运行。

## Markdown 与升级

文字检查遍历 typed CommonMark 节点。代码/HTML 不伪造标题或链接；行内与 reference-style 链接均有效。architecture README 小节顺序为依据、为什么、语义；business 增加需求。小节可省略，出现就须有正文。relations README 只作导航与语义说明。

inlineCode 中的完整 `path#Name` 是明确符号引用。存在的可见名称及其 `.成员` 可简写；同名先按文档位置筛选，仍多义则列出完整 id。完全未知的裸 code span 是普通代码文字，不凭大写字母猜引用，也不因 `.json` 等后缀忽略已识别成员。规范性引用宜用完整 id。

受管文件固定为 DSL 与各项目 tsconfig；它们与当前生成器契约一致，用 `upgrade` 更新。`upgrade --check` 只列将替换的固定路径，不写文件；显式 upgrade 不合并受管文件的自定义改动，不触碰领域 `.ts` 或全部语义 Markdown。更新后仍须通过正常检查；旧签名只报告迁移位置，不提供兼容层。中途 IO 失败报告已经确认写入的路径，不声称多文件事务。
