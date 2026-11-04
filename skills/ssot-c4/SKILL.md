---
name: ssot-c4
description: SSoT 结构载体（LikeC4）：按 C4 逐层放大的架构图怎样写——四种元素与层级、元素与关系写法、视图与部署、样式与图例、禁止写进图的东西、工具会拒绝什么、渲染图自查。写或评 LikeC4 的切片（ssot-write-level、ssot-write-deploy、ssot-verify-structure）时与操作 skill 一起完整读。先读 ssot。
---

# ssot-c4：逐层放大的架构图

LikeC4 只用来画 C4 图。一张图是给人看的：读图的人只看这一层的图，就能知道这一层由什么组成、各自做什么、彼此怎样连。每一层只说这一层的事；下一层的组成与做法藏在下一层的图里，不漏到这一层。文件是 `<design>/structure/*.c4`。完整的范例是 soroi 示例设计的 [`structure/soroi.c4`](../ssot/references/example/design/structure/soroi.c4)，它的渲染图用 `ssot render` 导出。

## 一、层级（严格按 C4）

只用四种元素：

| 种类 | 是什么 | 位置 |
|---|---|---|
| `actor` | 使用系统的人或角色 | 只在顶层，没有子元素 |
| `system` | 一个软件系统：本设计的系统，或它直接交互的外部系统 | 只在顶层 |
| `container` | 一个应用或一个数据存储：必须运行起来系统才能工作的运行单元（进程、服务、数据库、文件存储、队列） | 只在 `system` 里 |
| `component` | 一个 container 里、在明确接口后面的一组相关功能；不能单独运行 | 只在 `container` 里，不再往下 |

- 顶层是系统上下文：一个被设计的系统，周围是使用它的 actor 与它直接交互的外部系统。
- 上下文与容器两层是默认的导航图。组件层只在读图的人确实需要看清某个容器的内部划分时才画。
- 外部系统与别人负责的部分（实现者注入的执行环境、外部执行方）不展开：在本设计里它们是一个框。
- 子系统、分层、角色、团队这类划分不是元素层级；需要在图上表达时，用视图里的 `group` 框起来，不新建元素。
- 一个东西是 container 还是 component，看它能不能单独运行；是 system 还是 container，看它的实现是否在本设计的边界内。

## 二、元素写法

- 标题是名字；`description` 一句话写它负责什么，不写它为什么存在、怎样做、依据什么。
- container 写 `technology`：它是哪一种运行单元（如 `'Daemon process'`、`'Persistent store'`），或设计已经定下的技术。component 只在设计已经定下技术时写；可以替换的技术选型属于实现，不写。
- 数据存储带 `#datastore`，外部系统带 `#external`。它们在逻辑视图里的形状、颜色与图例由全局样式统一给出（见「写法范例」），元素上不单独写样式。
- `#contract` 标记一个已经决定写 VDM 盒子的元素（`ssot` 第三节的深入判断），只能写在没有子元素的元素上。没有决定深入的元素不带它。结构要不要展开、怎样划分，只按 C4 自己的理由决定；一个带 `#contract` 的元素被展开时，原盒子作废，由深入判断重新决定，结构不为保住盒子而不展开或迁就划分。
- 架构与业务：只服务一项业务的元素及其后代标 `#business`。“架构不引用业务”指契约的引用：架构元素的契约模块不得 import 业务元素的契约模块；箭头只表示谁发起调用，不受这条约束。
- 信任边界用部署节点上的标签表达（如 `#untrusted`）。

## 三、关系写法

- 一条关系是一个箭头：从发起调用的一方指向被调用的一方，写成无种类的 `->`。
- 标题是短动词短语，顺箭头读成一句话（“提交运行请求”“读取运行事实”）。不写操作清单，不写理由。
- 请求的回复不画；被调用方另行发起、回到对方的调用，画成它自己的一个箭头。
- 每一层用本层的抽象声明本层的关系：写元素 E 的一层时，关系连在 E 的直接子元素之间、以及子元素与 E 在上一层有关系的外部元素之间，标题用这一层的说法。只在最深一层声明、让 LikeC4 把它推到上层，上层图上就会出现下层的措辞。上一层 E 的每条关系，这一层都应看得出是哪个子元素在承担。
- 关系可以写在模型末尾，也可以写在元素块里（`-> soroi.store '读取运行事实'`，源是所在元素）。跨文件引用元素时写全 fqn。

## 四、视图写法

- 顶层恰有一个视图，id 为 `index`，没有 `of`。
- 每个有子元素的元素恰有一个 `view <id> of <fqn>`，id 取 fqn 最后一段加 `View`（与已有 id 重名时前面再加父元素 fqn 的最后一段）。`include *` 只显示该元素、它的直接子元素和与它们有关系的外部元素，不显示孙辈。
- 每个视图写 `title` 与 `description`：`title` 说明这是哪一种图、画的是谁（“soroi 容器图”），`description` 一句话说这张图回答什么问题。渲染图顶部的标题栏只在视图有 `description` 时出现。
- `specification` 给四种元素写 `notation`，渲染时生成图例。逻辑视图写 `global style theme` 使用全局样式。
- 需要突出或分组时用视图规则（`group`），不改模型。
- 不写动态视图：次序归 Quint。

## 五、部署

部署节点用 `deploymentNode` 声明，节点里用 `instanceOf` 放 container；节点描述一句话写它是什么运行位置；信任边界用节点标签。部署视图单独画，不改变元素树。

- 只有运行位置确实不同（不同主机、不同信任域）时才拆子节点；container 本身就是一个运行单元，不为它单独套一层进程节点。
- 部署视图不应用全局样式：图上每个实例与信任边界节点的样式和 `notation` 写在部署视图里，按实例或节点的路径选中（`daemonHost.store`、`execEnv`）。按标签或种类选中的样式规则 LikeC4 不支持，写了以后整个视图不被导出。
- 部署视图只画容器之间的箭头：用 `exclude * -> * where source.kind is component or target.kind is component` 去掉组件一层的关系，否则同一对实例之间的多条关系会合并成一个标着 `[...]` 的箭头。
- 部署视图的 id 就是部署切片的名字。部署模型不在任何逻辑视图里，它的诊断按全局报告，检查用 `ssot check <design> --scope index`。

```text
specification {
  deploymentNode host
  tag untrusted
}
deployment {
  host daemonHost 'Daemon host' {
    description '运行 soroi 守护进程与事实源头的主机'
    instanceOf soroi.engine
    instanceOf soroi.store
  }
  host execEnv 'Execution environment' {
    #untrusted
    description '实现者提供的执行环境，与核心分属不同的信任边界'
    instanceOf soroi.workspace
    instanceOf preset
  }
}
views {
  deployment view deployed {
    title 'soroi 部署图'
    description 'soroi 的容器运行在哪些主机上，信任边界在哪里'
    include daemonHost.**
    include execEnv.**
    exclude * -> * where source.kind is component or target.kind is component
    style daemonHost.engine { notation 'Container' }
    style execEnv.workspace { notation 'Container' }
    style daemonHost.store {
      shape storage
      notation 'Container: Data Store'
    }
    style execEnv.preset {
      color muted
      notation 'External Software System'
    }
    style execEnv {
      color red
      notation 'Untrusted execution environment'
    }
  }
}
```

## 六、写法范例

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

一层的样子（`engine` 的一层，节选）：

```text
engine = container 'Engine' {
  technology 'Daemon process'
  description '受理运行请求，推进并收束运行'

  closure = component 'Closure' {
    description '负责一个运行项从准入到结束的全部生命周期'
  }
  scheduler = component 'Scheduler' {
    description '准入运行项并判定运行是否自然完成'
  }
}

caller -> soroi.engine.control '提交启动、停止与派生请求'
soroi.engine.scheduler -> soroi.engine.closure '交出准入的运行项'

view engineView of soroi.engine {
  title 'Engine 组件图'
  description 'Engine 内部由哪些功能块组成，它们之间以及与外部怎样调用'
  include *
}
```

## 七、禁止

操作名、类型名、状态字段、数据内容、取值、先后次序、需求编号、依据与论证、决策记录、注释里的解释，都不写进 LikeC4。工具扫描元素种类、标签与 metadata，标题与描述交给渲染图评审。

## 八、自查渲染图

写完一层，运行 `ssot render <design>`，按它列出的顺序看 C4 图：上一层的图里本层被展开的框，与本层的图是否讲的是同一件事；本层的图离开模型源文件能不能读懂；本层有没有出现下一层才该出现的名字与措辞。评审者只看这些图。

## 九、工具会拒绝什么

| 规则 | 拒绝什么 |
|---|---|
| `compile.c4` | LikeC4 语法与引用错误 |
| `struct.kinds` | 四种之外的元素种类；声明或使用关系种类 |
| `struct.nesting` | actor 或 system 不在顶层；actor 有子元素；container 不在 system 里；component 不在 container 里 |
| `struct.layering` | actor 带 `#business`；`#business` 重复标在业务元素的后代上 |
| `struct.views` | `index` 缺失或不唯一；有子元素的元素没有恰好一个 `view of`；视图显示孙辈或无关的外部元素；动态视图 |
| `struct.ids` | 带 `#contract` 的元素或其祖先的 id 含字母数字以外的字符（模块名由 fqn 映射） |
| `vocab.slots` | 元素种类、标签、metadata 的键或值等于契约或行为里的名字 |
| `contract.module` | `#contract` 写在有子元素的元素上；`#contract` 与契约文件、模块名不一一对应 |
| `gen.fresh` | `.gen/structure.json` 与重新生成的结果不一致（它只由 `ssot gen` 写出，不手改） |

标题与描述工具不扫描，交给渲染图评审。
