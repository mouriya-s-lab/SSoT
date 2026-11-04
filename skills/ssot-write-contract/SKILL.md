---
name: ssot-write-contract
description: SSoT 写一个带 contract 标签的底层元素的盒子（VDM-SL 模块）：端口、线上的类型、反馈线（state）与端口上的 pre/post/inv，精度按使用者声明的阶段，交出盒子图与诊断供契约评审；scope 是元素 fqn。与 ssot-vdm 一起读，先读 ssot。
---

# ssot-write-contract：写一个元素的盒子

写法、惯用法与禁止项在 `ssot-vdm`，本 skill 只给步骤。

`scope` 是一个没有子元素、带 `#contract` 的元素 E 的 fqn。本切片是文件 `contract/<E 的 fqn>.vdmsl` 里的那一个模块，模块名是 fqn 里的 `.` 换成 `_`。本切片的视图 V：E 的父元素的视图（E 在顶层时为 `index`）。

`scope` 的元素已经不带 `#contract`（结构展开了它，或深入判断认为它不再需要盒子）时，本切片只做一件事：删除这个模块文件，在输出里写明哪些接线还引用它（那些接线之后接 `ssot-write-behavior`）。

| 项 | 内容 |
|---|---|
| 输入 | E 的 fqn；`reason`：深入判断交出的担心、要兑现的需求编号与精度，或评审的发现；使用者声明的阶段 |
| 可读 | E 在 `structure/*.c4` 里的标题、描述、标签与关系；`reason` 里的需求编号与本模块已附着的编号在 `requirements.md` 里的原文；别的契约模块的 `exports` 部分（以 `struct` 导出的类型的定义也可以读）；接这个盒子的行为模块里引用本模块名字的地方（只看引用处）；本模块原文；`ssot check`、`ssot eval`、`ssot render` 的输出 |
| 可改 | 只有 `contract/<E 的 fqn>.vdmsl` |
| 可运行 | `ssot gen <design>`；`ssot check <design> --scope <V>`（交付前加 `--base <开始时的提交>`）；`ssot eval <design> <本模块名> '<表达式>'`；`ssot render <design>` |
| 输出 | 本模块改了什么、附着了哪些需求编号；`check --scope` 的结果与留下的 info；交给契约评审的材料：本模块的盒子图路径（`ssot render` 里 id 为 `box:<模块名>` 的那一行）、设计目录路径与 `check --scope <V>` 的诊断 |
| 上抛 | 第四步的情形 |

## 一、先看这个盒子要承诺什么

读 E 的描述、关系与 `reason`。盒子只写这个担心或这些需求要求 E 的端口承诺的结果：调用方能调什么（导出的端口）、线上传什么（类型）、什么时候可以调（`pre`）、调完成立什么（`post`）、任何时刻都成立什么（反馈线的 `inv`）。精度按使用者声明的阶段：没有观测支撑的地方只写签名、`token` 或 `is not yet specified`，这些都是合法的终态。

不写进盒子：为实体记进度的阶段枚举、成组布尔位与迁移表，跨盒子的先后、时钟、进程、崩溃与重启（归接线）；元素树与部署（归结构）；连接不变时可以替换的做法与标准算法的实现（不写进设计）。

## 二、写模块

1. **import。** 用到别的模块的定义，就从持有它的模块 import，只列用到的名字。import 不能成环；架构元素的模块不 import 业务元素的模块。
2. **端口。** 只导出有消费者的东西：别的模块、接这个盒子的接线，或系统外调用方。接线要按分支读的类型带 `struct` 导出；只原样传递的身份不带。
3. **反馈线。** 只有约束要求时才建 `state`：只放这个盒子守住、有端口读到的源头事实（例如关闭记下之后拒绝 launch 所要读的 `closed`），不为实体记进度；`init` 写出初态，它会生成为 Quint 的 `initial`。
4. **端口的承诺。** 隐式操作写 `ext` 与 `pre`/`post`，每个结局分支都约束全部可写分量。不读写反馈线的定义写成函数；不写显式的算法体。
5. **能生成到 Quint。** 导出的名字与类型照 `ssot-vdm`「四、文件与模块」写。
6. **需求编号。** 只附在确实兑现它的定义上（`ssot-vdm`「五」）。

每写下一个 `pre`、`post`、`inv` 或承诺性质的函数，就用 `ssot eval` 求一个它所防的违反实例，确认规格拒绝它；规格接受了，就是约束没守住，当场改。实例只在本次调用里用。

## 三、检查与自查

运行 `ssot gen <design>`，再运行 `ssot check <design> --scope <V>`：

- 本模块的 error（`compile.vdm`、`contract.*`、`gen.*`、`replay.*` 中归本模块的）在本切片内修。修法先问出处，不为消掉诊断加东西。
- `hint.*` 与 MAYBE 等未解决的证明义务是 info，交给评审，不必清零。
- 改了签名、类型或反馈线之后，接这个盒子的行为会报 `compile.quint` 或回放错误：那是下游切片，写进输出，接 `ssot-write-behavior`，本切片不改 `behavior/`。

然后运行 `ssot render <design>`，看本模块的盒子图：端口是不是只有承诺所需的几个，反馈线上是不是只有这个盒子守住的事实。

## 四、上抛

- 本模块要写的某个定义，持有者是别的元素；或本模块混着两个职责；或架构元素的模块里需要一个只为单一业务存在的定义：结构问题，交回事实，给 `ssot-write-level` 与 E 的父元素的视图 id。
- 持有者是另一个已经带 `#contract` 的元素、只是那个模块缺了定义：交回事实，给那个元素的 `ssot-write-contract`。
- `reason` 要求的东西，E 的端口承诺不了：交回事实，交给 `ssot-judge` 重新判断落点。

## 五、交付

1. 运行 `ssot check <design> --scope <V> --base <开始时的提交>`，撤回作用域之外的改动。
2. 运行 `ssot render <design>`。
3. 按「输出」交付。
