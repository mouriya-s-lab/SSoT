---
name: ssot
description: SSoT 核心（必读）：SSoT 是随代码落地、从宏观到微观逐步建模的机会，不证明设计完美、不保证没有 bug；一个位置默认不可见，深度与精度由具体担心及问题热点溯源（高频改动文件 → commit → issue）决定；skill 树怎样分层、怎样组合；命令、诊断、评审者与准入勘探员/热点溯源员、工作边界。任何 ssot 任务先完整读本 skill，再按第五节加载要用的 skill。
---

# ssot

## 一、SSoT 是什么，不是什么

SSoT 给一个系统一个机会：随着代码落地，从宏观到微观逐步建模。设计分三层，复杂度依次升高：

| 层 | 载体 | 回答什么 |
|---|---|---|
| 结构 | LikeC4 | 由什么组成、谁调用谁、部署在哪里、信任边界在哪里 |
| 盒子 | VDM-SL | 一个底层元素对外有哪些端口、线上传什么、承诺什么 |
| 接线 | Quint | 盒子怎样接在一起、状态怎样反馈、跨连接的先后与收束 |

下层只在写下时才存在，存在时只对照上层检查。上游清晰时，往下填充局部才可靠；这是三层单向可验证的用处。

SSoT 不证明设计完美无缺，不保证系统没有 bug，也不是一份要写满的模板。业务边界尚在变动、也没有浮现出具体担心或反复修补的问题热点时，规格本身可能是错的；这时对全系统做前置形式化证明没有意义，无关之处应当保持留白。

## 二、默认不可见

一个位置（一个 C4 元素，或元素之间的一条连接）默认停在图上的一个框或一个箭头，里面不展开。停在这里不是欠账：局部保持不可见，别处真正出错时才不会被它干扰。

不预设一切都不可靠、每个对端都会使坏，再为这些渺小的通道一一建模。上游与业务足够清晰时，往下填充局部才变得可靠；标准范式、排错简单的地方，不值得为它展开与证明。

## 三、两条轴：深度与精度

### 深度由难度与问题热点决定

要不要把一个位置往下写一层（写它的 VDM 盒子，或把它接进 Quint），按顺序回答三问；有一问答不出，就停在原处：

1. 这里有哪一个**具体的、可被证伪的担心**（来自要兑现的需求，或由 `ssot:hotspot` 从代码改动最多的文件 → 问题热点 → 修复 commit 与关联 issue 反推出）？
2. 只靠 C4 的边界与普通的编译检查，能不能定位它？能，就不往下写。
3. 往下写一层之后，哪一个错误的盒子或错误的接线会被模型揭露？

标准范式、写对容易、改动稳定或只是常规 CRUD 扩展的位置，第一问就答不出具体的担心。跨进程的先后、崩溃之后的收束、多方对同一份事实的并发（在 git 历史中常表现为同一批文件反复出现修复 commit、协同改动与关联 issue），常常三问都答得出。

### 精度由担心与热点反推的故障边界决定

写下盒子或接线时，不把一个元素的所有字段、分支与可能故障都写满，只精确到**挡住该担心、兑现该需求或覆盖热点 commit/issue 所暴露故障边界**所需的最小区分。热点溯源由 `ssot:hotspot` 运行 `ssot hotspots` 从高频改动文件反推到 commit 与 issue，只陈述端口调用与返回、进程崩溃重启及持久化结果的偏差，不带表字段、锁、状态码或调用栈。

| 层 | 无热点、与该担心/需求无关之处（默认留白） | 该担心/需求或热点 commit/issue 要求守住之处 |
|---|---|---|
| 盒子 | 只有端口签名；线的类型多为 `token`；函数体 `is not yet specified`；少写或不写 `post` | 写出挡住该错误或兑现该需求所需的 `state`、`pre`/`post` 与 `inv` |
| 接线 | 不接无关盒子；状态取最少的几种，数据抽象成身份 | 只接该担心涉及的盒子，以及触发该交错或热点 commit/issue 证实发生过的环境盒子（崩溃、乱序、重入） |

### C4 的基线不走深入三问

C4 的上下文与容器两层是默认画的导航图，按 C4 自己的用法写。组件层只在读图的人确实需要看清某个容器的内部划分时才画，由渲染图评审判断。三问只决定盒子与接线。

## 四、只写核心

设计只写在连接不变时不会改的东西：由什么组成、各自负责什么、连接上承诺什么、跨连接的次序。在连接不变时可以替换的做法属于实现，不写进设计；一段细节保护某条不变量时，只写这条不变量。业务建在架构上，只经连接接入；架构不引用业务。设计只呈现当前的结果：决策的过程、被放弃的方案与来源论证不写进任何载体。

**需求。** `<design>/requirements.md` 不是载体：每条需求一个列表项，以 `REQ-<编号>` 开头，原文由用户给出，只编号、不改原文。一条需求可以由结构回答（图上看得出），由某个盒子或某张接线图兑现，也可以不建模（标准范式，留给代码）。只有当一个 VDM 定义或 Quint 声明确实兑现某条需求时，才在紧贴它首行之上的连续注释里写出编号（逐个写全，不写范围）。LikeC4 里不写需求编号。不要求每条需求都附着。

## 五、skill 树与组合

### 分层

| 层 | skill | 是什么 |
|---|---|---|
| 核心 | `ssot` | 本文件 |
| 核心 | `ssot-judge` | 对一个位置或一项候选担心（含热点 commit/issue 溯源）做深入判断 |
| 核心 | `ssot-requirement` | 收下一条需求，并在同一次调用里对它做深入判断 |
| 核心 | `ssot-iterate` | 日常迭代补充：随代码落地结合静态勘探与 commit/issue 热点溯源，判断哪些增量进入或更新 SSoT、哪些留在代码里 |
| 核心 | `ssot-migrate` | 存量项目迁移（`ssot-iterate` 的全景放大版）：勘探全局立起 C4 基线，结合全仓 commit/issue 热点把区域分流为停在 C4 或排入 `ssot-iterate` |
| 载体 | `ssot-c4` | LikeC4 的写法、惯用法与禁止项 |
| 载体 | `ssot-vdm` | VDM-SL 盒子的写法、String Diagram 视角下的状态、禁止项 |
| 载体 | `ssot-quint` | Quint 接线与反馈的写法、性质与覆盖目标、禁止项 |
| 操作 | `ssot-write-level`、`ssot-write-deploy`、`ssot-write-contract`、`ssot-write-behavior` | 写一个切片 |
| 操作 | `ssot-verify-structure`、`ssot-verify-contract`、`ssot-verify-behavior` | 评一个切片 |

每个操作 skill（及 `ssot-iterate`、`ssot-migrate`）总是与它的载体 skill 一起完整读：

| skill | 同时读 |
|---|---|
| `ssot-iterate`、`ssot-migrate`、`ssot-write-level`、`ssot-write-deploy`、`ssot-verify-structure` | `ssot-c4` |
| `ssot-write-contract`、`ssot-verify-contract` | `ssot-vdm` |
| `ssot-write-behavior`、`ssot-verify-behavior` | `ssot-quint`，以及它接进来的盒子所需的 `ssot-vdm` |

### 判断与操作 skill 是盒子，载体 skill 是规则

载体 skill（`ssot-c4`、`ssot-vdm`、`ssot-quint`）是一种载体的写法与判据，被操作 skill 引用，自己不执行。核心里的 `ssot-judge`、`ssot-requirement`、`ssot-iterate`、`ssot-migrate` 与全部操作 skill 是可组合的盒子，开头用六项写明接口：

| 项 | 含义 |
|---|---|
| 输入 | 它消费什么：一个位置、一条需求、一份局部改动或存量材料、一个视图、一个元素、一个担心（及热点溯源）、一组图片、一组发现 |
| 可读 | 能读哪些设计文件与工具输出；本 skill 树里的文件总是可读 |
| 可改 | 本切片拥有的文件与元素，此外一律不改 |
| 可运行 | 可运行的 `ssot` 命令 |
| 输出 | 改动；交给评审的材料（图片路径，或模块路径与诊断）；发现；判断；准入与热点分流报告 |
| 上抛 | 什么情况说明上层有误，交回什么事实 |

skill 之间不互相调用：写作 skill 不派评审、不写“下一项是某个 skill”。读了本文件的会话按下面几种接法把它们接起来：

- **顺接：** 深入判断 → 写 → 渲染 → 评审。
- **反馈：** 评审的发现属于当前切片、且有明确的修法时，接回同一个写作 skill；属于上层的，按上抛处理；属于需要使用者拍板的判断，交给使用者。检查通过、且评审没有当前切片内的阻塞发现时结束，不以零发现为终点。
- **并接：** 互不相交的切片可以并行。
- **上抛：** 写作 skill 交回“上层划分有误”的事实（元素放错层、该有的元素不存在、关系方向或归属错了），会话把它接到上层那个切片的写作 skill。
- **先后来自输入：** 一个 skill 的输入没准备好，就先接产出它的 skill。`ssot-iterate`、收需求与深入判断需要参照已有的结构基线（存量项目还没有结构基线时，先由 `ssot-migrate` 筛出全局基线并接 `ssot-write-level` 立好，再接 `ssot-iterate`）；写行为需要它接进来的契约模块在 `check` 下没有 error；写契约需要元素已在结构里、没有子元素并带 `#contract`。

### 从哪里开始

- 用户要建立或扩展结构：`ssot-write-level`（顶层视图是 `index`）。
- 用户给出一条需求：`ssot-requirement`。
- 用户指出某个位置，或对一项候选担心做深入判断：`ssot-judge`。
- 日常开发落地了代码、改动了某个模块或处理了故障，要补充进 SSoT：`ssot-iterate`。
- 把整座存量项目或旧设计迁入 SSoT：`ssot-migrate`（先立全局 C4 基线并结合全仓 commit/issue 热点筛掉常规 CRUD 区域，再对重点热点区域逐个接 `ssot-iterate`）。
- 用户要求评审某个切片：对应的 verify skill。
- 不确定已写下的东西是否一致：运行 `ssot status <design>`。它只报两类事实：已写下内容里的 error（交给拥有那个切片的写作 skill，先 LikeC4，再 VDM，再 Quint），以及带 `#contract` 却还没有模块的元素（这个标签是已经做出的深入选择，模块缺了说明这次深入没做完）。“没有前沿”不说明需求已经兑现，也不说明该往下写什么。

**越界提示。** 写作 skill 开始时运行 `git rev-parse HEAD` 记下开始时的提交；交付前运行 `ssot check <design> --scope <本切片的视图> --base <开始时的提交>`。它列出落在本切片之外的改动并提示应交给谁；列出的改动不是本切片可改的，撤回它，写进交付。

**不保存过程状态。** 没有“已确认”“已评审”“已判断”的记录；判断与评审的结论只出现在本次交付里，设计里看得到的只有被写下的载体。

## 六、单向可验证

```text
LikeC4 ──gen──▶ .gen/structure.json（元素树、视图、带 #contract 的底层元素与模块名）
                    │ 一个 VDM 模块对应一个带 #contract 的底层元素
VDM 盒子（手写）──gen──▶ .gen/contract.qnt（类型、Call 变体、状态类型、initial；只读）
                    │ import
Quint 接线（手写）──回放──▶ 只回放轨迹里出现的契约调用，在定义它的 VDM 模块里求 pre/post/inv 与 frame
```

只顺着这个方向写：下游缺了什么，回到上游去改；不在下游另写一份上游的事实。上游不为下游迁就：LikeC4 不为 VDM 的 import 画关系，VDM 不为 Quint 改自己的事实。没有被接进 Quint 的盒子不要求出现在轨迹里。

## 七、命令

`ssot` 由 `ssot setup` 装进 PATH，入口是 `skills/ssot/scripts/ssot.ts`。

| 命令 | 作用 |
|---|---|
| `ssot setup` | 安装检查与渲染所需的工具，把 `ssot` 装进 PATH；细节见 [`references/setup.md`](references/setup.md) |
| `ssot gen <design>` | 重新生成 `.gen/` |
| `ssot check <design>` | 全量检查：编译三种载体、生成链新鲜度、跨载体规则、模拟、覆盖目标、回放、证明义务 |
| `ssot check <design> --scope <视图 id>` | 仍编译全部内容，模拟、回放、QuickCheck 只在该视图的切片闭包内运行，只报告归属于该视图节点的诊断 |
| `ssot check <design> --scope <视图 id> --base <rev>` | 另列出 `<rev>` 之后落在该作用域之外的改动 |
| `ssot serve <design> [--port N]` | 在本地网页（默认端口 5180）上交互浏览 `ssot render` 的同一批图，侧栏按上下级排成树，点图上的下钻标注打开下一层，设计文件改动后自动重画；给人看设计用，评审仍以 `ssot render` 导出的 PNG 为准 |
| `ssot render <design> [--out <目录>]` | 导出渲染图并按顺序列出 `<路径>\t<id>`：C4 视图（`index` → 逐层下钻 → 部署视图）、契约分层图（id `layers`，只在有契约模块时）、每个契约模块依次是盒子图（id `box:<模块名>`）和它下面一层的承诺图（id `promises:<模块名>`）、类型图（id `types:<模块名>`）与读写表（id `access:<模块名>`，只在模块有 `state` 时）、接线索引（id `wirings`，只在有可运行 Quint 模块时）、每个可运行 Quint 模块依次是组合图（id `composition:<模块名>`）和它下面一层的性质图（id `properties:<模块名>`） |
| `ssot eval <design> <模块> '<表达式>' [--bind …]` | 在原样规格里求一个 VDM 表达式，用来构造违反实例 |
| `ssot status <design> [--deadline 秒]` | 运行一次全量 `check`，报一项第五节所说的事实 `{skill, scope, reason}`；都没有时输出“没有前沿” |
| `ssot hotspots <路径> [--top N] [--since <rev>]` | 分析 git 提交历史中的代码改动热点：统计改动最多的文件与模块、协同改动文件对，并从热点文件反推到关键修复 commit 与关联 issue/PR |

`check` 的退出码：`0` 通过；`1` 有 error；`3` 没有 error，但有 `resource.deadline`（验证没做完，不是设计被拒绝）。`check`、`status` 与 `render` 可能运行数分钟：用能设截止时间的方式运行，不在前台死等，不加 `--verbosity 1`。

## 八、诊断怎样用

- **error 是能确证的错误**（`compile.*`、`struct.*`、`contract.*` 中的 error、`behavior.*`、`replay.*` 中的 error），必须修。
- **info 是提示**（`hint.*`、`replay.outcome`、MAYBE 等未解决的证明义务），交给评审判断，不是待清零的错误，也不是拒绝设计的理由。
- **修法先问出处。** 被诊断的东西没有需求或约束来源，就删掉它、取消导出或退回 `token`；只有来源确实要求而规格缺了，才补上。不为消掉诊断、通过编译或让工具满意而新增元素、关系、字段、导出、守卫、谓词或消费者。

## 九、评审者、准入勘探员与热点溯源员

`agents/` 下有三个预置定义。用时把它原样拷进当前会话所在项目的 `.omp/agents/`（omp 从会话工作目录向上找最近的 `.omp/agents/`），用 `task` 派发（不用 `fork_task`：它会把你的上下文带过去），用完删掉拷入的文件：

- **`ssot:reviewer`**：没看过设计的评审者。只交给它要执行的 verify skill 名、`scope` 与评审材料，不给你的推理、草稿或期望的结论：
  - 结构：`ssot render` 列出的 C4 图片路径与顺序，不给设计目录、诊断或需求；
  - 契约：该模块的盒子图路径与 `ssot render` 列出的契约分层图路径（`layers.png`），加设计目录路径与 `check --scope` 的诊断；
  - 行为：该模块的组合图路径，加设计目录路径与 `check --scope` 的诊断。
- **`ssot:reader`**：替你勘探项目静态材料（代码库结构与配置、局部改动、旧设计文档等）的准入勘探员。只交给它要执行的 skill 名（`ssot-iterate` 或 `ssot-migrate`）、`scope`、原始材料路径与设计目录路径；它按所执行的 skill 筛出 C4 结构事实、系统级需求与领域性质、静态边界上的候选担心，以及停在 C4 或留给代码的淘汰项，把表字段、状态枚举、锁、重试与具体步骤挡在外面。
- **`ssot:hotspot`**：替你从 git 演化历史做问题热点溯源的热点溯源员。交给它勘探范围 `scope`（仓库根目录或局部代码路径）与设计目录路径；它运行 `ssot hotspots` 找出代码改动最多的文件、模块与协同改动对，反推问题热点到具体的修复 commit 与关联 issue/PR，提炼出剥离了代码补丁细节的边界级候选担心与真实故障环境（供 `ssot-migrate` 分流重点区域、供 `ssot-iterate` 与 `ssot-judge` 做深入判断与定精度）。

## 十、工作边界

- 主会话与写作、评审环节只读设计目录、用户给的需求原文、本 skill 树，以及 `ssot:reader` 与 `ssot:hotspot` 交回的准入/溯源报告；不直接读业务实现代码、测试、配置或旧设计文档，不直接翻阅 git 提交 diff 或 issue 堆栈（`check --base` 与 `hotspots` 由工具和 `ssot:hotspot` 执行）。
- 项目的代码、配置与旧文档只由隔离的 `ssot:reader` 在 `ssot-iterate` 与 `ssot-migrate` 中勘探并过滤；项目的 git 改动热点、commit 与 issue 溯源只由隔离的 `ssot:hotspot` 分析并过滤；主会话只消费它们交回的报告。
- 方法与文献出处见 [`references/sources.md`](references/sources.md)。
