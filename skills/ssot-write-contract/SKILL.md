---
name: ssot-write-contract
description: SSoT 写一个带 contract 标签的元素的 VDM-SL 模块：导出、类型、状态、inv、pre/post 与不透明身份，只用结构授予的 import；末尾按 ssot-verify-contract 的清单只评本模块。由 ssot status 派出，scope 是元素 fqn。先读 ssot。
---

# ssot-write-contract：写一个元素的契约

`scope` 是一个带 `#contract` 的元素 E 的 fqn。本切片是文件 `contract/<E 的 fqn>.vdmsl` 里的那一个模块，模块名是 fqn 里的 `.` 换成 `_`。写法见 `../ssot-write/references/contract.md`；VDM 语法查 `../ssot/references/vdm/`。

本切片的视图 V：E 有自己的视图（`view … of E`）就用它，没有就用 E 的父元素的视图（E 在顶层时为 `index`）。

## 五项

| 项 | 内容 |
|---|---|
| 可读 | E 在 `structure/*.c4` 里的标题、描述、标签、metadata `req` 与关系；落在 E 上的 `req` 对应的需求原文；`.gen/structure.json` 里 E 的 `allowedImports`；允许集合里每个模块的 `exports` 部分（只读签名，不读它们的定义体）；import 本模块的模块里引用本模块名字的地方（只看引用处，用来确认导出有消费者）；本模块原文；`ssot check`、`ssot eval` 的输出 |
| 可改 | 只有 `contract/<E 的 fqn>.vdmsl`。不改 `structure/`、别的契约模块、`behavior/`、`.gen/` |
| 工具工作集 | `ssot gen <design>`；`ssot check <design> --scope <V>`；`ssot eval <design> <本模块名> '<表达式>'` |
| 末尾评审 | 派 `ssot:reviewer` 执行 `ssot-verify-contract`，`scope` 不变，只评本模块 |
| 向上修正 | 第四步列出的情形 |

## 一、先看 E 要承诺什么

读 E 的描述、关系与落在它上面的需求。E 的模块只写这些需求要求 E 的连接承诺的结果：调用方能调什么（导出的操作与函数）、交出什么（类型）、什么时候可以调（`pre`）、调完之后成立什么（`post`）、任何时刻都成立什么（`inv`）。没有观察者要区分的内容写成 `token`，效果还没有约束的连接写成 `is not yet specified`，这都是合法的终态。

不写进 VDM：时钟、进程、调度、崩溃与重启、跨连接的先后（归 Quint）；模块树（归 LikeC4）；在连接不变时可以替换的做法（不写进设计）。

## 二、写模块

1. **import 只用允许集合。** E 需要别的元素的词汇或调用，必须是 `allowedImports` 里的模块；只读它导出的签名。
2. **导出。** 只导出有消费者的东西：有别的模块 import，或有系统外调用方。观察者要按分支或读字段的类型才带 `struct` 导出；只原样传递的身份不带。
3. **状态。** 只有约束要求时才建 `state`，状态是陈述 `inv` 与前后关系的数学模型，不是存储布局；只放这个连接面守住、有观察者的源头事实，能算出来的写成纯函数。`init` 写出初态：它会生成为 Quint 的 `initial`，行为必须从它开始。
4. **操作与函数。** 隐式操作写 `ext` 与 `pre`/`post`，每个结局分支都约束全部可写分量。不读写状态的定义写成函数。显式体不得有局部可变变量、赋值或循环（`contract.body` 会拒绝）。承载需求的纯函数带 `post`，让证明义务与 QuickCheck 检查函数体。
5. **能生成到 Quint。** 导出的名字与类型照 `contract.md` 的生成要求写，否则 `gen.names`、`gen.unmappable` 拒绝。

每写下一个 `pre`、`post`、`inv` 或纯函数，就用 `ssot eval` 求一个它所防的违反实例，确认规格拒绝它；规格接受了，就是约束没守住，当场改。实例只在本次调用里用，不落盘。

## 三、检查

运行 `ssot gen <design>`，再运行 `ssot check <design> --scope <V>`：

- 本模块的 error（`compile.vdm`、`contract.module`、`contract.imports`、`contract.body`、`contract.po` 的 FAILED、`gen.*`、`replay.*` 中归本模块的）在本切片内修。修法先问出处（`ssot` 第六节），不为消掉诊断加东西。
- `hint.*` 与未解决的证明义务是 info，交给末尾评审，不必清零。
- 改了签名、类型或状态之后，行为文件会报 `compile.quint` 或回放错误：那是下游切片，由 `ssot status` 派给 `ssot-write-behavior`，本叶子不改 `behavior/`。

## 四、向上修正

遇到下面任何一种，立即停止，不在本模块迁就：

- 需要 import 一个不在允许集合里的模块（结构缺一条关系），或允许集合里有本模块根本不需要的依赖；
- 本模块要写的某个定义，持有者是别的元素（它承载的是别人的事实或规则）；
- 本模块混着两个职责，或架构元素的模块里需要一个只为单一业务存在的定义；
- 落在 E 上的需求要求的东西，E 的连接承诺不了。

前三种是结构问题，交付里写明 `{skill: ssot-write-level, scope: <E 的父元素的视图 id>, reason: …}`。持有者是另一个已经带 `#contract` 的元素、且只是那个模块缺了定义时，写明 `{skill: ssot-write-contract, scope: <那个元素的 fqn>, reason: …}`。需求本身落错了元素时，写明 `{skill: ssot-draft-requirement, scope: <需求 id>, reason: …}`。

## 五、末尾评审与交付

1. 运行 `ssot check <design> --scope <V> --base <开始时的提交>`（开始时的提交见 `ssot` 第四节），撤回作用域之外的改动。
2. 按 `ssot` 第七节派 `ssot:reviewer`：交给它 `ssot-verify-contract`、`scope`、设计目录路径与 `check --scope <V>` 的诊断。
3. 评审的发现在本模块内修，修完重跑第三步；指向结构或别的元素的，按第四步处理。
4. 交付：本模块改了什么、`check --scope` 的结果、留下的 info 与评审对它们的判断、下一项前沿（如有）。
