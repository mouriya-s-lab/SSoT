---
name: ssot
description: SSoT 设计真源总纲（必读）：LikeC4 结构、VDM-SL 契约、Quint 行为三种载体各自负责什么、怎样写、禁止写什么，以及权威顺序、切片模型与命令。任何 ssot 任务先完整读本 skill，再按 `ssot status` 给出的前沿只读并执行一个叶子 skill。
---

# ssot

SSoT 把软件的结构、连接契约与跨连接次序写成三种可编译的原生文件，作为独立于实现代码的设计真源。本文件给出方法、三种载体的硬规则、权威顺序、切片模型与命令；具体工作只在叶子 skill 里做，一次一个切片。

第二节是硬规则：每个叶子都按它写、按它评；叶子 skill 只补充步骤，不放宽、不改写第二节。

## 〇、怎样走这棵 skill 树

1. 完整读完本文件，包括第二节。
2. 运行 `ssot status <design>`。它从三种载体与 `check` 的诊断派生出**一项**前沿，输出一行 JSON `{skill, scope, reason}`。可派生的前沿只有三类，按下面的先后只报第一项：
   - 编译或检查有 error 的切片 → 拥有该切片的写作叶子（先 LikeC4，再 VDM，再 Quint）；
   - `requirements.md` 里在契约与行为中都没有附着的需求（第二节「需求」）→ `ssot-draft-requirement`；
   - 带 `#contract` 却没有契约模块的元素 → `ssot-write-contract`。

   三类都没有时输出“没有前沿”。`check` 因资源超时没有做完（退出码 `3`）时，`status` 报告验证没有做完、不派生前沿，退出码也是 `3`：用更长的 `--deadline <秒>` 重跑 `status`，不把它当成没有前沿。

   info 提示（`hint.*`、`replay.outcome`）与 MAYBE 等未解决的证明义务不进前沿：它们只在写作叶子末尾的评审里交给评审者。
3. 读 `skill` 指出的那一个叶子，以及它写明的必读参考，按它只处理 `scope` 这一个切片。不读别的叶子，不顺手处理别的切片。
4. 叶子交付（含它末尾的评审）后：交付里写明了下一项前沿（向上修正、评审要求修改、草稿交出的落点），就按列出的次序逐项执行它们，每项都是一个 `{skill, scope, reason}`；没写，就再运行 `ssot status` 取下一项。
5. 用户直接指定了切片时跳过第 2 步，按下表的切片种类选叶子。

| 叶子 | `scope` | 切片 |
|---|---|---|
| `ssot-draft-requirement` | 需求 id（`REQ-<编号>`），或 `ssot-migrate-read` 交出的需求摘录路径 | 一条需求（摘录里的每条各做一遍） |
| `ssot-write-level` | 元素已有视图时为视图 id（顶层为 `index`）；元素还没有子元素、也就没有视图时为元素 fqn | 一个元素的一层 |
| `ssot-write-deploy` | 部署视图 id | 该部署视图显示的部署节点及其嵌套内容 |
| `ssot-write-contract` | 元素 fqn | 一个带 `#contract` 的元素的 VDM 模块 |
| `ssot-write-behavior` | Quint 模块名 | 一个可运行的 Quint 模块 |
| `ssot-verify-structure` | 视图 id 或部署视图 id | 同 `ssot-write-level` 或 `ssot-write-deploy`，只看渲染图评审 |
| `ssot-verify-contract` | 元素 fqn | 同 `ssot-write-contract`，独立评审 |
| `ssot-verify-behavior` | Quint 模块名 | 同 `ssot-write-behavior`，独立评审 |
| `ssot-migrate-read` | 旧文档的一个区域 | 不由 `status` 派出；用户开始迁移时使用 |

verify 叶子不由 `status` 派出：写作叶子在末尾按它的清单派评审者；用户直接指定评审某个切片时，也按上表选它。

阶段 skill（`ssot-draft`、`ssot-write`、`ssot-verify`、`ssot-migration`）只说明本阶段的叶子与它们之间的关系，不单独执行。

“没有前沿”只说明可派生的事实里没有待办：它既不说明需求已经兑现，也不说明结构已经展开到足够深。需求是否兑现由契约与行为的评审判断；结构要不要再往下画由写作者决定、由渲染图评审判断。

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

每一处契约与行为的展开都要过两关：

- **充分（Jackson）：** 规格的约束加上领域性质（外部世界本身成立、本系统不保证的事实），合起来推出每一条需求；规格拒绝每条约束的具体违反情形。
- **无偏差（Jones）：** 规格里的每个区分，都有一串导出操作能观察到：两个只在这一处不同的合法状态，某个操作的结果或能否调用不同。观察不到的区分是把一种实现写成了承诺，删掉它或收回成 `token`。

前一关决定加什么，后一关决定去掉什么；两关都不看形式的多少。

### 2. 先问设计应该长什么样

三种载体只是把想法写准的形式。写或评一份设计，先问这个系统要满足什么需求、为此它整体应该长什么样，再看字面。一处积压了太多的值，通常是多个来源、多个视角挤在一起，责任边界不清。

### 3. 只写核心

设计只写在连接不变时不会改的东西：由什么组成、各自负责什么、连接上承诺什么、跨连接的次序。在连接不变时可以替换的做法属于实现，不写进设计；一段细节保护某条不变量时，设计只写这条不变量。业务建在架构上，只经连接接入；业务引用架构，架构不引用业务。设计只呈现当前的结果：决策的过程、被放弃的方案与来源论证不写进任何载体。

## 二、三种载体：负责什么、怎样写、禁止什么（必读）

| 载体 | 负责 | 文件 | 不负责（写了就是错） |
|---|---|---|---|
| LikeC4 | 系统由什么组成、谁在谁里面、谁调用谁、部署在哪里、信任边界在哪里；从宏观到微观逐层可读的图 | `<design>/structure/*.c4` | 操作名、类型名、状态字段、数据内容、次序、依据与论证、需求编号 |
| VDM-SL | 底层元素的连接点（exports）、类型、状态、`inv`、操作的 `pre`/`post`、不透明身份 | `<design>/contract/<元素 fqn>.vdmsl` | 元素树、部署、时钟、进程、调度、崩溃与重启、跨连接的先后 |
| Quint | 跨连接的先后、交错、窗口、停机与崩溃收束、覆盖目标 | `<design>/behavior/<模块名>.qnt` | 与 VDM 重名的类型或操作、手写的 VDM 数据契约、自己的初态 |

`<design>/.gen/` 下的 `structure.json` 与 `contract.qnt` 由 `ssot gen` 生成，只读，禁止手改。

### LikeC4：逐层放大的架构图

LikeC4 只用来画 C4 图。一张图是给人看的：读图的人只看这一层的图，就能知道这一层由什么组成、各自做什么、彼此怎样连。每一层只说这一层的事；下一层的组成与做法藏在下一层的图里，不漏到这一层。

**层级（严格按 C4）。** 只用四种元素：

| 种类 | 是什么 | 位置 |
|---|---|---|
| `actor` | 使用系统的人或角色 | 只在顶层，没有子元素 |
| `system` | 一个软件系统：本设计的系统，或它直接交互的外部系统 | 只在顶层 |
| `container` | 一个应用或一个数据存储：必须运行起来系统才能工作的运行单元（进程、服务、数据库、文件存储、队列） | 只在 `system` 里 |
| `component` | 一个 container 里、在明确接口后面的一组相关功能；不能单独运行 | 只在 `container` 里，不再往下 |

- 顶层是系统上下文：一个被设计的系统，周围是使用它的 actor 与它直接交互的外部系统。
- 外部系统与别人负责的部分（实现者注入的执行环境、外部执行方）不展开：在本设计里它们是一个框。
- 不必画到最底层。上下文与容器两层通常就够；某个 container 的内部有值得说明的功能划分时，才画它的组件。
- 子系统、分层、角色、团队这类划分不是元素层级；需要在图上表达时，用视图里的 `group` 框起来，不新建元素。
- 一个东西是 container 还是 component，看它能不能单独运行；是 system 还是 container，看它的实现是否在本设计的边界内。

**元素写法。**
- 标题是名字；`description` 一句话写它负责什么，不写它为什么存在、怎样做、依据什么。
- container 写 `technology`：它是哪一种运行单元（如 `'Daemon process'`、`'Persistent store'`），或设计已经定下的技术。component 只在设计已经定下技术时写；可以替换的技术选型属于实现，不写。
- 数据存储带 `#datastore`，外部系统带 `#external`。它们在逻辑视图里的形状、颜色与图例由全局样式统一给出（见下面的范例），元素上不单独写样式；部署视图的样式见「部署」。
- `#contract` 标记带契约模块的元素，只能写在没有子元素的元素上（见 VDM）。
- 架构与业务：只服务一项业务的元素及其后代标 `#business`，图上由此看出哪些框是业务。“架构不引用业务”指契约的引用：架构元素的契约模块不得 import 业务元素的契约模块（`check` 以 `contract.layering` 拒绝）；箭头只表示谁发起调用，不受这条约束。
- 信任边界用部署节点上的标签表达（如 `#untrusted`）。

**关系写法。**
- 一条关系是一个箭头：从发起调用的一方指向被调用的一方，写成无种类的 `->`。
- 标题是短动词短语，顺箭头读成一句话（“提交运行请求”“读取运行事实”）。不写操作清单，不写理由。
- 请求的回复不画；被调用方另行发起、回到对方的调用，画成它自己的一个箭头。
- 每一层用本层的抽象声明本层的关系：写元素 E 的一层时，关系连在 E 的直接子元素之间、以及子元素与 E 在上一层有关系的外部元素之间，标题用这一层的说法。只在最深一层声明、让 LikeC4 把它推到上层，上层图上就会出现下层的措辞。上一层 E 的每条关系，这一层都应看得出是哪个子元素在承担。

**视图写法。**
- 顶层恰有一个视图，id 为 `index`，没有 `of`。
- 每个有子元素的元素恰有一个 `view <id> of <fqn>`，id 取 fqn 最后一段加 `View`（与已有 id 重名时前面再加父元素 fqn 的最后一段）。视图只显示该元素、它的直接子元素和与它们有关系的外部元素，不显示孙辈。
- 每个视图写 `title` 与 `description`：`title` 说明这是哪一种图、画的是谁（“soroi 容器图”），`description` 一句话说这张图回答什么问题。渲染图顶部的标题栏只在视图有 `description` 时出现。
- `specification` 给四种元素写 `notation`，渲染时生成图例。
- 不写动态视图：次序归 Quint。

**部署。** 部署节点用 `deploymentNode` 声明，节点里用 `instanceOf` 放 container；节点描述一句话写它是什么运行位置；信任边界用节点标签。部署视图单独画，不改变元素树。
- 部署视图不应用全局样式：图上每个实例与信任边界节点的样式和 `notation` 写在部署视图里，按实例或节点的路径给出，图例由此说出每个框是什么、哪个节点是信任边界。
- 部署视图只画容器之间的箭头：用 `exclude * -> * where source.kind is component or target.kind is component` 去掉组件一层的关系，否则同一对实例之间的多条关系会合并成一个标着 `[...]` 的箭头。

**写法范例。**

```text
specification {
  element actor { notation 'Person' style { shape person } }
  element system { notation 'Software System' }
  element container { notation 'Container' }
  element component { notation 'Component' }
  tag external
  tag datastore
  tag contract
}
model {
  caller = actor 'Caller' { description '启动与停止运行、读取运行结果的使用方' }
  soroi = system 'soroi' {
    description '管理工作流运行并记录运行事实的核心'
    store = container 'Store' {
      #datastore #contract
      technology 'Persistent store'
      description '运行事实的唯一源头'
    }
  }
  preset = system 'Preset' {
    #external
    description '执行工作流里具体工作的外部程序'
  }
  caller -> soroi '管理运行并读取运行事实'
}
global {
  styleGroup theme {
    style element.tag = #external {
      color muted
      notation 'External Software System'
    }
    style element.tag = #datastore {
      shape storage
      notation 'Container: Data Store'
    }
  }
}
views {
  global style theme
  view index {
    title 'soroi 系统上下文'
    description 'soroi 为谁服务，又调用哪些外部系统'
    include *
  }
}
```

**禁止。** 操作名、类型名、状态字段、数据内容、取值、先后次序、需求编号、依据与论证、决策记录、注释里的解释，都不写进 LikeC4。工具扫描元素种类、标签与 metadata，标题与描述交给渲染图评审。

**评审。** 结构的评审者只看 `ssot render` 导出的渲染图，按 `index` → 逐层下钻 → 部署视图的顺序看；图上看不懂的一律是问题。

### VDM-SL：底层元素的契约

- VDM 只证明 LikeC4 的底层元素：`#contract` 只能写在没有子元素的元素上，一个这样的元素恰有一个模块，文件名是元素 fqn，模块名是 fqn 里的 `.` 换成 `_`。
- LikeC4 怎样编排与 VDM 无关：模块之间的 `imports` 由 VDM 自己决定，结构不为某个 import 画关系、加标签或改嵌套。
- 共用的身份、值与判定定义在持有它的底层元素的模块里（谁发出这个身份、谁维护这份事实），别的模块 import 它。模块之间的 import 不能成环：生成的 Quint 模块不允许循环引用，`check` 以 `contract.imports` 拒绝。
- 写法、可观察性与生成到 Quint 的要求见 `ssot-write/references/contract.md`，写契约与评契约之前必须完整读它。

### Quint：跨连接的次序

- 只写 VDM 写不了的东西：跨连接的先后与交错、窗口、停机与崩溃之后的收束、必须被走到的情形。
- 契约调用只用生成的 `Call`，契约状态只用生成的状态类型与 `initial`；不重写任何 VDM 的类型、操作或事实。
- 写法与回放怎样检查见 `ssot-write/references/behavior.md`，写行为与评行为之前必须完整读它。

### 需求

- 需求清单 `<design>/requirements.md` 不是载体：每条需求是一个列表项，以 `REQ-<编号>` 开头，原文由用户给出，模型只给它编号，不改动原文。
- 需求是问题域里可观察的结果，只有契约与行为能兑现它。需求的落点是兑现它的那个声明：在紧贴 VDM 定义（类型、值、函数、操作、状态）或 Quint 声明首行之上的连续注释里写出它的编号，中间不留空行；落在整个模块上时写在紧贴 `module` 行之上的注释里。每个编号逐个写全（`REQ-47、REQ-48、REQ-49`），不写范围。
- 结构不持有需求：LikeC4 里不写需求编号。
- 需求的论证与领域性质只在 `ssot-draft-requirement` 的当次调用里用来定落点，不落盘。

## 三、权威顺序

```text
LikeC4 模型 ──gen──▶ .gen/structure.json（元素树、视图、带 #contract 的底层元素与模块名）
                         │ 约束：每个 VDM 模块对应一个带 #contract 的底层元素
VDM 模块（手写）
VDM 投影 ──gen──▶ .gen/contract.qnt（类型、Call 变体、状态类型、initial；只读）
                         │ import
Quint 行为（手写）
Quint 轨迹 ──回放──▶ 在定义该操作的 VDM 模块里求 pre/post/inv 与 frame
```

只能顺着这个方向写：下游缺了什么，回到上游去改上游；不在下游另写一份上游的事实。上游不为下游迁就：LikeC4 不为 VDM 的 import 画关系，VDM 不为 Quint 的生成改变自己的形状以外的事实。

## 四、切片模型

一次调用只处理一个有界切片。每个叶子写明五项：

- **可读：** 本切片，以及它直接依赖的签名；
- **可改：** 本切片拥有的文件与元素，此外一律不改；
- **工具工作集：** 对应的 `check --scope <视图 id>` 与 `ssot render`；
- **末尾评审：** 写作叶子在同一次调用的末尾，派一个没看过设计的 `ssot:reviewer` 只评本切片（第七节）；
- **向上修正的停止条件：** 什么情况说明上层划分错了。

「可读」「可改」只约束设计目录、需求材料与代读文件；本 skill 树里的文件（含各 skill 的 `references/`）总是可读。叶子里说“元素 P 的视图”，指 `structure/*.c4` 里 `view <id> of P` 的 id；顶层元素的“父元素的视图”是 `index`。为找视图 id，`structure/*.c4` 的 `views` 块总是可读。

**不保存过程状态。** 没有“已确认”“已评审”的记录；前沿只从三种载体与检查结果派生，评审结论只出现在本次调用的交付里。

**向上修正。** 任何叶子发现上层的划分有误（元素放错层、该有的元素不存在、关系方向或归属错了），立即停止当前切片：不在本切片里迁就上层的错误，也不越出可改范围去修上层。交付里写明下一项前沿 `{skill: ssot-write-level, scope: <父元素的视图 id>, reason: <观察到的事实>}`，由下一次调用重开父元素。

**越界提示。** 叶子开始时运行 `git rev-parse HEAD` 记下开始时的提交；交付前运行 `ssot check <design> --scope <本切片的视图> --base <开始时的提交>`：它列出落在该作用域之外的改动，并提示应交给哪个叶子。它只提示、不拒绝；列出的改动不是本叶子可改的，撤回它，改为在交付里写明应交给的叶子。

## 五、命令

`ssot` 由 `ssot setup` 装进 PATH，入口是 `skills/ssot/scripts/ssot.ts`。

| 命令 | 作用 |
|---|---|
| `ssot setup` | 安装检查与渲染所需的工具（VDMJ、QuickCheck、LikeC4 与它导出图片用的浏览器、Quint），把 `ssot` 装进 PATH；细节见 [`references/setup.md`](references/setup.md) |
| `ssot gen <design>` | 重新生成 `.gen/` |
| `ssot check <design>` | 全量检查：编译三种载体、生成链新鲜度、跨载体规则、模拟、覆盖目标、回放、证明义务 |
| `ssot check <design> --scope <视图 id>` | 仍编译全部内容，但模拟、回放、QuickCheck 只在该视图的切片闭包内运行，只报告归属于该视图节点的诊断 |
| `ssot check <design> --scope <视图 id> --base <rev>` | 另列出 `<rev>` 之后落在该作用域之外的改动，提示应交给哪个叶子 |
| `ssot render <design> [--out <目录>]` | 用 LikeC4 自己的渲染导出每个视图的 PNG（带标题栏与图例），按 `index` → 逐层下钻 → 部署视图的顺序列出图片路径与视图 id |
| `ssot eval <design> <模块> '<表达式>' [--bind …]` | 在原样规格里求一个 VDM 表达式，用来构造违反实例 |
| `ssot status <design> [--deadline 秒]` | 运行一次全量 `check`，派生一项前沿 `{skill, scope, reason}`；没有前沿时输出“没有前沿” |

`check` 的退出码：`0` 通过；`1` 有 error 级诊断；`3` 没有 error，但有 `resource.deadline`（验证没有做完，不是设计被拒绝）。`check`、`status` 与 `render` 可能运行数分钟：用能设截止时间的方式运行它们，不在前台死等，不加 `--verbosity 1`。

## 六、诊断怎样用

- **error 是能确证的错误**（如 `compile.*`、`struct.*`、`contract.module`、`contract.body`、`behavior.init`、`replay.frame`），必须修。
- **info 是提示**（`hint.*`、`replay.outcome`、MAYBE 等未解决的证明义务），交给写作叶子末尾的评审者判断，不是待清零的错误，也不是拒绝设计的理由，也不进 `status` 的前沿。
- **修法先问出处。** 被诊断的东西没有需求或约束来源，就删掉它、取消导出或退回 `token`；只有来源确实要求而规格缺了，才补上。不为消掉诊断、通过编译或让工具满意而新增元素、关系、字段、导出、守卫、谓词或消费者。

## 七、评审者与代读者

`agents/` 下有两个预置定义，用时把它原样拷进当前会话所在项目的 `.omp/agents/`（omp 从会话工作目录向上找最近的 `.omp/agents/`，与设计目录在哪里无关），用 `task` 派发（不用 `fork_task`：它会把你的上下文带过去），用完删掉拷入的文件：

- **`ssot:reviewer`**：没看过设计的评审者。只交给它：要执行的 verify 叶子名、`scope`，以及本切片的评审材料。结构评审的材料只有 `ssot render` 列出的图片路径与顺序，不给设计目录路径、诊断或需求；契约与行为评审的材料是设计目录路径与 `check --scope` 的诊断。不给它你的推理、草稿或期望的结论。它交回发现，不改文件。
- **`ssot:reader`**：替你读原始来源（旧设计、旧说明），只交出概念、原文明说的需求与出处。用于 `ssot-draft-requirement` 与 `ssot-migrate-read`。

评审的发现由派它的叶子在本切片的可改范围内处理；超出可改范围的，按第四节向上修正或写明应交给的叶子。

## 八、工作边界

- 只读设计目录、用户给的需求材料与本 skill 树；不读实现代码、测试、配置，不看 git 历史（`check --base` 由工具读）。
- 用户给的原始来源设计不直接读，由 `ssot:reader` 代读。
- 方法与文献出处见 [`references/sources.md`](references/sources.md)。
