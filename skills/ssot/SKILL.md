---
name: ssot
description: SSoT 设计真源总纲：LikeC4 结构、VDM-SL 契约、Quint 行为三种载体的方法、分工、权威顺序与切片模型。任何 ssot 任务先读本 skill，再按 `ssot status` 给出的前沿只读并执行一个叶子 skill。
---

# ssot

SSoT 把软件的结构、连接契约与跨连接次序写成三种可编译的原生文件，作为独立于实现代码的设计真源。本文件给出方法、三种载体的分工、权威顺序、切片模型与命令；具体工作只在叶子 skill 里做，一次一个切片。

## 〇、怎样走这棵 skill 树

1. 读完本文件。
2. 运行 `ssot status <design>`。它从三种载体与 `check` 的诊断派生出**一项**前沿，输出一行 JSON `{skill, scope, reason}`。可派生的前沿只有五类，按下面的先后只报第一项：
   - 编译或检查有 error 的切片 → 拥有该切片的写作叶子（先 LikeC4，再 VDM，再 Quint）；
   - 没有落点的 `req` → `ssot-draft-requirement`；
   - 还没有展开的非叶元素，即没有子元素、也没有 `#leaf` 标签的非 `actor` 元素 → `ssot-write-level`（浅层先）；
   - 带 `#contract` 却没有契约模块的元素 → `ssot-write-contract`；
   - 仍有未覆盖结局（`replay.outcome` 计数为 0 的变体）的行为模块 → `ssot-write-behavior`。

   五类都没有时输出“没有前沿”。`check` 因资源超时没有做完（退出码 `3`）时，`status` 报告验证没有做完、不派生前沿，退出码也是 `3`：用更长的 `--deadline <秒>` 重跑 `status`，不把它当成没有前沿。

   其余 info 提示（`hint.*`、`view.unrealized`）与 MAYBE 等未解决的证明义务不进前沿：它们只在写作叶子末尾的评审里交给评审者。评审判定“不构成问题”之后提示仍然在，若它们进前沿，`status` 会一遍遍派出同一次评审。所以 `status` 从不派出 verify 叶子。
3. 只读 `skill` 指出的那一个叶子，按它只处理 `scope` 这一个切片。不读别的叶子，不顺手处理别的切片。
4. 叶子交付（含它末尾的评审）后：交付里写明了下一项前沿（向上修正、评审要求修改、草稿交出的落点），就按列出的次序逐项执行它们，每项都是一个 `{skill, scope, reason}`；没写，就再运行 `ssot status` 取下一项。
5. 用户直接指定了切片时跳过第 2 步，按下表的切片种类选叶子。

| 叶子 | `scope` | 切片 |
|---|---|---|
| `ssot-draft-requirement` | 需求 id（`REQ-<编号>`），或 `ssot-migrate-read` 交出的需求摘录路径 | 一条需求（摘录里的每条各做一遍） |
| `ssot-write-level` | 元素已有视图时为视图 id（顶层为 `index`）；元素还没有子元素、也就没有视图时为元素 fqn | 一个元素的一层 |
| `ssot-write-deploy` | 部署视图 id | 该部署视图显示的部署节点及其嵌套内容 |
| `ssot-write-contract` | 元素 fqn | 一个带 `#contract` 的元素的 VDM 模块 |
| `ssot-write-behavior` | Quint 模块名 | 一个可运行的 Quint 模块 |
| `ssot-verify-structure` | 视图 id 或部署视图 id | 同 `ssot-write-level` 或 `ssot-write-deploy`，独立评审 |
| `ssot-verify-contract` | 元素 fqn | 同 `ssot-write-contract`，独立评审 |
| `ssot-verify-behavior` | Quint 模块名 | 同 `ssot-write-behavior`，独立评审 |
| `ssot-migrate-read` | 旧文档的一个区域 | 不由 `status` 派出；用户开始迁移时使用 |

verify 叶子不由 `status` 派出：写作叶子在末尾按它的清单派评审者；用户直接指定评审某个切片时，也按上表选它。

阶段 skill（`ssot-draft`、`ssot-write`、`ssot-verify`、`ssot-migration`）只说明本阶段的叶子与它们之间的关系，不单独执行。

`status` 没有前沿，只说明可派生的事实里没有待办，不说明需求已经兑现：需求是否兑现由评审判断。

## 一、方法

### 1. 定义多少，是多个视角下的权衡

描述“值”的地方和描述“动作”的地方往往不在一处；同一样东西在持有它的元素里是细节，在别处只是一个占位，需要时才展开。以信号灯为例：

```vdm
SignalColour = <Red> | <Amber> | <FlashingAmber> | <Green>
```

- **定义在持有者。** 信号灯有这几种状态，`SignalColour` 定义在信号灯的模块里。
- **观察者需要才展开。** 有观察者要按颜色分支，才写出 `=` 右边；没有，它只是一个 `token`：这里有个信号灯。
- **行为归做出行为的一方。** 红灯不许通过是司机的行为，写在司机那里，不写在信号灯里。
- **规则归持有者。** 谁持有切换规则，规则就在谁那里是细节，在别处是概括。
- **隐含前提是软件的一部分，就有它的位置。** 是外部依赖，就是一个可导入的占位；由本系统实现，就在实现它的元素里展开。不是软件的一部分（服务器需要电力），不写进设计。
- **展开可以不做，但只有一处。** 展开了两处，它就有两种解释。

每一处展开都要过两关：

- **充分（Jackson）：** 规格的约束加上领域性质（外部世界本身成立、本系统不保证的事实），合起来推出每一条需求；规格拒绝每条约束的具体违反情形。
- **无偏差（Jones）：** 规格里的每个区分，都有一串导出操作能观察到：两个只在这一处不同的合法状态，某个操作的结果或能否调用不同。观察不到的区分是把一种实现写成了承诺，删掉它或收回成 `token`。

前一关决定加什么，后一关决定去掉什么；两关都不看形式的多少。

### 2. 先问设计应该长什么样

三种载体只是把想法写准的形式。写或评一份设计，先问这个系统要满足什么需求、为此它整体应该长什么样，再看字面。一处积压了太多的值，通常是多个来源、多个视角挤在一起，责任边界不清。

### 3. 只写核心

设计只写在连接不变时不会改的东西：由什么组成、用什么组成、为什么。在连接不变时可以替换的做法属于实现，不写进设计；一段细节保护某条不变量时，设计只写这条不变量。业务建在架构上，只经连接接入；业务引用架构，架构不引用业务。

## 二、三种载体的分工

每类事实只有一个载体能写：

| 事实 | 唯一持有者 | 文件 | 该载体里禁止出现 |
|---|---|---|---|
| 元素、嵌套（抽象层级）、依赖方向、部署、信任边界、依据与理由、需求落点（metadata `req`） | LikeC4 | `<design>/structure/*.c4` | 操作名、类型名、状态字段、数据内容、时序 |
| 连接点（exports）、类型、状态、inv、操作的 pre/post、不透明身份 | VDM-SL | `<design>/contract/<元素 fqn>.vdmsl`，一个元素至多一个模块 | 模块树、时钟、进程、调度、崩溃与重启 |
| 跨连接的先后、交错、窗口、停机与崩溃收束、覆盖目标 | Quint | `<design>/behavior/<模块名>.qnt` | 与 VDM 重名的类型或操作、手写的 VDM 数据契约、自己的初态 |

需求清单 `<design>/requirements.md` 不是载体：每条需求是一个列表项，以 `REQ-<编号>` 开头，原文由用户给出，模型只给它编号，不改动原文。LikeC4 元素用 metadata `req` 引用这些 id（只标在元素上，不标在关系上）；`ssot status` 只报告哪些 id 没有落点，不宣称需求已经兑现。依据与理由写进元素的 `description`，关系的依据写进它源元素的 `description`；`//` 注释不算依据。

`<design>/.gen/` 下的 `structure.json` 与 `contract.qnt` 由 `ssot gen` 生成，只读，禁止手改。各载体怎样写，见 `ssot-write/references/` 下的 `structure.md`、`contract.md`、`behavior.md`；三种载体合在一起的完整示例是 [`references/example/design/`](references/example/design/)（soroi）；VDM 语法查 [`references/vdm/`](references/vdm/README.md)。

## 三、权威顺序

```text
LikeC4 模型 ──gen──▶ .gen/structure.json（元素树、依赖、每个元素允许 import 的模块）
                         │ 约束
VDM 模块（手写） ◀────────┘
VDM 投影 ──gen──▶ .gen/contract.qnt（类型、Call 变体、状态类型、initial；只读）
                         │ import
Quint 行为（手写） ◀──────┘
Quint 轨迹 ──回放──▶ 在定义该操作的 VDM 模块里求 pre/post/inv 与 frame
```

只能顺着这个方向写：下游缺了什么，回到上游去改上游；不在下游另写一份上游的事实。VDM 模块与带 `#contract` 的元素一一对应；VDM 的 import 只能落在 LikeC4 授予的允许集合里；Quint 代表契约调用的步骤必须用生成的 `Call`，初态必须用生成的 `initial`。

## 四、切片模型

一次调用只处理一个有界切片。每个叶子写明五项：

- **可读：** 本切片，以及它直接依赖的签名；
- **可改：** 本切片拥有的文件与元素，此外一律不改；
- **工具工作集：** 对应的 `check --scope <视图 id>` 或 `ssot view`；
- **末尾评审：** 写作叶子在同一次调用的末尾，派一个没看过设计的 `ssot:reviewer` 只评本切片（第七节）；没有末尾评审的叶子写明为什么；
- **向上修正的停止条件：** 什么情况说明上层划分错了。

「可读」「可改」只约束设计目录、需求材料与代读文件；本 skill 树里的文件（含各 skill 的 `references/`）总是可读。叶子里说“元素 P 的视图”，指 `structure/*.c4` 里 `view <id> of P` 的 id；顶层元素的“父元素的视图”是 `index`。为找视图 id，`structure/*.c4` 的 `views` 块总是可读。

**不保存过程状态。** 没有“已确认”“已评审”的记录；前沿只从三种载体与检查结果派生，评审结论只出现在本次调用的交付里。

**向上修正。** 任何叶子发现上层的划分有误（元素放错层、该有的元素不存在、关系方向或归属错了），立即停止当前切片：不在本切片里迁就上层的错误，也不越出可改范围去修上层。交付里写明下一项前沿 `{skill: ssot-write-level, scope: <父元素的视图 id>, reason: <观察到的事实>}`，由下一次调用重开父元素。

**越界提示。** 叶子开始时运行 `git rev-parse HEAD` 记下开始时的提交；交付前运行 `ssot check <design> --scope <本切片的视图> --base <开始时的提交>`：它列出落在该作用域之外的改动，并提示应交给哪个叶子。它只提示、不拒绝；列出的改动不是本叶子可改的，撤回它，改为在交付里写明应交给的叶子。

## 五、命令

`ssot` 由 `ssot setup` 装进 PATH，入口是 `skills/ssot/scripts/ssot.ts`。

| 命令 | 作用 |
|---|---|
| `ssot setup` | 安装检查所需的工具（VDMJ、QuickCheck、LikeC4、Quint），把 `ssot` 装进 PATH；细节见 [`references/setup.md`](references/setup.md) |
| `ssot gen <design>` | 重新生成 `.gen/` |
| `ssot check <design>` | 全量检查：编译三种载体、生成链新鲜度、跨载体规则、模拟、覆盖目标、回放、证明义务 |
| `ssot check <design> --scope <视图 id>` | 仍编译全部内容，但模拟、回放、QuickCheck 只在该视图的切片闭包内运行，只报告归属于该视图节点的诊断 |
| `ssot check <design> --scope <视图 id> --base <rev>` | 另列出 `<rev>` 之后落在该作用域之外的改动，提示应交给哪个叶子 |
| `ssot view <design> <视图 id>` | 输出本层评审包：本层节点；每条显示的边代表的全部声明关系及其层次；被展开元素在上一层的对外关系与本层落实者；没有子元素落实的上一层关系 |
| `ssot eval <design> <模块> '<表达式>' [--bind …]` | 在原样规格里求一个 VDM 表达式，用来构造违反实例 |
| `ssot status <design> [--deadline 秒]` | 运行一次全量 `check`，派生一项前沿 `{skill, scope, reason}`；没有前沿时输出“没有前沿” |

`check` 的退出码：`0` 通过；`1` 有 error 级诊断；`3` 没有 error，但有 `resource.deadline`（验证没有做完，不是设计被拒绝）。`check` 与 `status` 可能运行数分钟：用能设截止时间的方式运行它们，不在前台死等，不加 `--verbosity 1`。

## 六、诊断怎样用

- **error 是能确证的错误**（如 `compile.*`、`struct.*`、`contract.imports`、`contract.body`、`behavior.init`、`replay.frame`），必须修。
- **info 是提示**（`hint.*`、`view.unrealized`、`replay.outcome`、MAYBE 等未解决的证明义务），交给写作叶子末尾的评审者判断，不是待清零的错误，也不是拒绝设计的理由。它们不进 `status` 的前沿；唯一的例外是 `replay.outcome` 里计数为 0 的变体：它让该行为模块作为“仍有未覆盖结局”进入前沿（第〇节）。
- **修法先问出处。** 被诊断的东西没有需求或约束来源，就删掉它、取消导出或退回 `token`；只有来源确实要求而规格缺了，才补上。不为消掉诊断、通过编译或让工具满意而新增元素、字段、导出、守卫、谓词或消费者。

## 七、评审者与代读者

`agents/` 下有两个预置定义，用时把它原样拷进当前会话所在项目的 `.omp/agents/`（omp 从会话工作目录向上找最近的 `.omp/agents/`，与设计目录在哪里无关），用 `task` 派发（不用 `fork_task`：它会把你的上下文带过去），用完删掉拷入的文件：

- **`ssot:reviewer`**：没看过设计的评审者。只交给它：要执行的 verify 叶子名、`scope`、设计目录路径，以及本切片的工具输出（评审包、`check --scope` 的诊断）。不给它你的推理、草稿或期望的结论。它交回发现，不改文件。
- **`ssot:reader`**：替你读原始来源（旧设计、旧说明），只交出概念、原文明说的需求与出处。用于 `ssot-draft-requirement` 与 `ssot-migrate-read`。

评审的发现由派它的叶子在本切片的可改范围内处理；超出可改范围的，按第四节向上修正或写明应交给的叶子。

## 八、工作边界

- 只读设计目录、用户给的需求材料与本 skill 树；不读实现代码、测试、配置，不看 git 历史（`check --base` 由工具读）。
- 用户给的原始来源设计不直接读，由 `ssot:reader` 代读。
- 方法与文献出处见 [`references/sources.md`](references/sources.md)。
