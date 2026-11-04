---
name: ssot-write-level
description: SSoT 写一个元素的一层（LikeC4）：按总纲第二节写出它的直接子元素、本层关系与它的视图，用 ssot render 自查渲染图，末尾派只看渲染图的结构评审。由 ssot status 因 LikeC4 的 error 派出，或由需求草稿、向上修正交出；scope 是视图 id，元素还没有视图时是元素 fqn。先读 ssot。
---

# ssot-write-level：写一个元素的一层

开始前完整读 `ssot` 总纲第二节「LikeC4：逐层放大的架构图」与 `../ssot-write/references/structure.md`。本叶子只补充步骤，不放宽那里的规则。

`scope` 是一个视图 id，或一个元素 fqn。下文的 V 是本层的视图 id：

- `scope` 是 `view <id> of E` 的 id：本切片是元素 E 的一层，V 就是 `scope`；
- `scope` 是 `index`：本切片是顶层（E 不存在，子元素就是顶层元素），V 是 `index`；
- `scope` 是元素 E 的 fqn：E 还没有子元素、也就没有视图，V 按总纲的视图 id 规则新取。

## 五项

| 项 | 内容 |
|---|---|
| 可读 | `structure/*.c4` 里：E 本身、E 在上一层声明的关系、E 的现有直接子元素、与 E 有关系的外部元素；`design/requirements.md`；交给本切片的前沿 `reason`；`ssot check`、`ssot render` 的输出。不读 `contract/`、`behavior/`、`.gen/contract.qnt` |
| 可改 | `structure/*.c4` 里：E 的直接子元素（种类、id、标题、描述、`technology`、标签）、本层声明的关系、V 的视图；E 带 `#contract` 而本层要给它子元素时，去掉 E 的 `#contract`（第二步第 5 条）。不改 E 的种类、id、标题、描述与上一层关系，不改孙辈元素、别的元素与别的视图，不碰 `contract/`、`behavior/`、`.gen/` |
| 工具工作集 | `ssot gen <design>`；`ssot check <design> --scope <V>`；`ssot render <design>` |
| 末尾评审 | 派 `ssot:reviewer` 执行 `ssot-verify-structure`，`scope` 为 V，材料只有渲染图 |
| 向上修正 | 第五步列出的情形：停止，下一项前沿是 E 的父元素的视图（E 是顶层元素时是 `index`） |

## 一、先看上一层

运行 `ssot render <design>`，看上一层的图里 E 这个框：它负责什么、它与哪些外部元素有哪些箭头。本层要回答的是“E 里面由什么组成、这些箭头由谁承担”，不多也不少：

- 上一层 E 的每条关系，本层都要能看出是哪个子元素在承担；
- 本层不让 E 的子元素与一个 E 在上一层没有关系的外部元素相连；
- E 自己没有对外关系、只有子元素之间的事，本层自由划分。

先问 E 要不要展开：按总纲，上下文与容器两层通常就够；E 的内部有值得说明的功能划分时，才画它的组件。决定不展开时，不写子元素与视图，在交付里写明理由（末尾评审照样核对上一层的图）。

## 二、写子元素与本层关系

1. **子元素。** 种类按总纲的 C4 层级：system 的子元素是 container，container 的子元素是 component。每个子元素一句职责描述；container 写 `technology`；数据存储带 `#datastore`。按职责与运行单元划分，不按执行步骤、角色或文件切；同层的兄弟各管一块，不重叠。
2. **外部元素。** 外部系统与别人负责的部分不展开。
3. **本层关系。** 关系连在子元素之间，以及子元素与 E 在上一层有关系的外部元素 X 之间（写 X 本身，不写 X 的子元素）。标题用本层的说法，短动词短语，顺箭头读成一句话。从外部元素指向子元素的关系也由本层声明，不改 X。
4. **视图。** 有 E 时写 `view <V> of E`，带 `title` 与 `description`，`include *`；V 是 `index` 时写顶层视图 `view index`，不带 `of`。视图使用全局样式（`global style theme`）。
5. **契约标记。** `#contract` 只写在没有子元素的元素上。前沿 `reason` 要求某个子元素承担契约时，给它加 `#contract`。E 本来带 `#contract`、本层给了它子元素时，去掉 E 的 `#contract`，把它的契约应由哪个子元素承担写进交付，下一项前沿是那个子元素的 `ssot-write-contract`（原模块的定义搬过去）。

不预建：没有职责的子元素、没有调用的关系、为将来准备的标签都不写。

## 三、检查

运行 `ssot gen <design>`，再运行 `ssot check <design> --scope <V>`。error 必须修：`compile.c4`、`struct.*`、`vocab.slots`、`contract.module` 中属于本层的，在本切片内修。

删除、改名或改标签的子元素原来已有下一层或契约模块时，下游会报错（如 `contract.module`）。这些错误属于下游切片，由 `ssot status` 派给对应叶子；本叶子不去改下游文件。

## 四、自查渲染图

再运行 `ssot render <design>`，按它列出的顺序看上一层的图与本层的图：

- 只看本层的图，能不能知道 E 由什么组成、各自做什么、彼此怎样连；
- 上一层 E 的每个箭头，在本层的图上能不能找到承担它的子元素；
- 本层的图上有没有出现下一层才该出现的名字、操作、数据或次序；
- 框里的字是不是一句话，箭头标题是不是短动词短语。

看不懂的地方先改，再交给评审。

## 五、向上修正

遇到下面任何一种，立即停止，不在本层迁就：

- 某个子元素需要与 E 在上一层没有关系的外部元素相连；
- E 在上一层的某个箭头，本层没有任何子元素能合理承担；
- E 的职责里有一部分属于 E 的兄弟或父元素；
- 子元素需要的种类不符合 C4 层级（例如 container 里要放一个能单独运行的东西）。

交付里写明：`{skill: ssot-write-level, scope: <E 的父元素的视图 id，E 在顶层时为 index>, reason: <观察到的事实>}`，并撤回本次的改动（或保留已写好、与问题无关的部分，写明保留了什么）。`scope` 是 `index` 时没有上一层：问题就在本层，直接改。

## 六、末尾评审与交付

1. 运行 `ssot check <design> --scope <V> --base <开始时的提交>`（开始时的提交见 `ssot` 第四节），撤回作用域之外的改动。
2. 运行 `ssot render <design>`，按 `ssot` 第七节派 `ssot:reviewer`：交给它 `ssot-verify-structure`、V，以及 `ssot render` 列出的全部图片路径与顺序。不给设计目录路径、诊断、需求或你的说明。
3. 评审的发现在本切片可改范围内修，修完重跑第三、四步；发现指向上一层的，按第五步停止；指向别的切片的，写进交付。
4. 交付：改了哪些元素与关系、`check --scope` 的结果、评审的发现与处理、下一项前沿（如有）。
