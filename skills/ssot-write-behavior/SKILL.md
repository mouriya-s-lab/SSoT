---
name: ssot-write-behavior
description: SSoT 写一个可运行的 Quint 模块：跨连接的次序、窗口、停机与崩溃收束、覆盖目标，契约调用只用生成的 Call，初态只用生成的 initial；末尾按 ssot-verify-behavior 的清单评审。由 ssot status 派出，scope 是 Quint 模块名。先读 ssot。
---

# ssot-write-behavior：写一个行为模块

`scope` 是一个 Quint 模块名 Q，文件是 `behavior/<Q>.qnt`。可运行模块声明 `init` 与 `step`，并有 `val safety`。写法见 `../ssot-write/references/behavior.md`。

本切片的契约模块集 M：Q 调用的每个生成 `Call` 模块。Q 还不存在或还没有调用任何 `Call` 时，M 取前沿 `reason` 里列出的契约落点元素的模块（模块名是元素 fqn 里的 `.` 换成 `_`），需求取 `reason` 里列出的需求 id。M 中每个模块所属的元素 E，取它所在的视图（E 的父元素的视图，E 在顶层时为 `index`）；这些视图组成本切片的视图集 V。

## 五项

| 项 | 内容 |
|---|---|
| 可读 | `behavior/<Q>.qnt` 与它 import 的非生成行为模块；`.gen/contract.qnt`；M 中每个模块的导出签名与导出操作的 `pre`/`post`（为了写出对应的状态转移）；M 所属元素在 `structure/*.c4` 里的标题、描述、关系与 `req`，以及这些 `req` 在 `design/requirements.md` 里的需求原文；`ssot check` 的输出 |
| 可改 | 只有 `behavior/<Q>.qnt`。不改契约模块、`structure/`、`.gen/`、别的行为文件 |
| 工具工作集 | `ssot gen <design>`；对 V 中每个视图运行 `ssot check <design> --scope <视图>` |
| 末尾评审 | 派 `ssot:reviewer` 执行 `ssot-verify-behavior`，`scope` 不变 |
| 向上修正 | 第四步列出的情形 |

前提：M 中的模块在 `check --scope` 下没有错误。有错误时本切片不开始，下一项是那个模块的 `ssot-write-contract`。

## 一、先看要表达什么次序

Quint 只写 VDM 写不了的东西：跨连接的先后与交错、超时窗口、停机与崩溃之后怎样收束、哪些结局必须被走到。读 M 所属元素上的需求，找出其中关于次序的部分；集合与时序的需求在这里完整表达，不靠单个代表元的例子。

## 二、写模块

1. **引用生成的契约。** `import contract.* from "../.gen/contract"`，每个用到的模块再 `import <模块> as <别名>`。类型、`Call`、状态类型都用生成的，不在本文件里重写任何 VDM 类型、操作或事实（`behavior.names` 拒绝重名）。
2. **唯一的 `Call` 变量。** 恰好一个类型为 `Call` 的状态变量（如 `lastCall`）。代表契约调用的每一步只调用一次，把调用写进它；不是契约调用的步骤写 `NoCall`。
3. **契约状态。** 每个被调用的有状态模块，恰好一个类型为生成状态类型的变量。`init` 把它直接赋值为 `<别名>::initial`（`behavior.init`），不自己写初态。只有契约调用那一步改它：某一步改了模块 m 的状态，而那一步的 `Call` 不是 m 的调用，`behavior.call` 拒绝。每一步按被调操作的 `post` 更新它，回放会在 VDM 里核对 pre、post、inv 与 frame（frame 只核对只读与不写的分量）。
4. **参与者只用自己知道的值。** 每个参与者每一步只用它本来知道的值，或它前一步调用的连接交给它的结果；从别处直接读出系统内部的身份或集合，是在替参与者作弊。
5. **每个结局都有处理。** 被调连接的每个可观察结局，在调用方都有一个后续。用 `val witness…` 写出必须被走到的情形；某个目标需要更多步数时声明 `pure val maxSteps_<目标名> = <正整数字面量>`。
6. **`safety`。** 写出要守住的次序性质。只复述 VDM `pre` 的不变式不写：回放已经检查 `pre`。

## 三、检查

运行 `ssot gen <design>`，再对 V 中每个视图运行 `ssot check <design> --scope <视图>`：

- 本模块的 error（`compile.quint`、`behavior.*`、`replay.*`）在本切片内修。回放报 `replay.pre`/`replay.post`/`replay.frame`/`replay.initial` 时，先当作本模块的状态转移写错了：Quint 的转移是 VDM `post` 的第二份手写，VDM 是权威。
- `replay.incomplete` 说明有覆盖目标没被走到，或有值回放不了：调整调度频率或该目标的 `maxSteps_`，不删目标来过检查。
- `replay.outcome` 是 info，但计数为 0 的结局变体会让 `ssot status` 把本模块再派回来（“仍有未覆盖结局”）。是处理缺了，就补上产生与接住它的步骤；是调度走不到，就加覆盖目标或调整调度；是这个结局在需求下确实不会发生，那是契约多列了一个调用方不必处理的结局（S27），按第四步交给 `ssot-write-contract`，不在行为里为它造路径。
- 其余 info 不进 `status` 的前沿，交给末尾评审。
- 退出码 `3`（`resource.deadline`）是验证没做完，不是设计被拒绝：如实写进交付，不当作通过。

## 四、向上修正

遇到下面任何一种，立即停止，不在行为里补一份上游的事实：

- 需要一个契约模块没有导出的操作、类型或结局，契约列了一个在需求下不会发生的结局，或回放证明契约的 `pre`/`post` 本身与需求不符：写明 `{skill: ssot-write-contract, scope: <那个元素的 fqn>, reason: …}`；
- 需要两个元素之间的调用，而结构里它们没有关系，或次序的需求说明某个职责放错了元素：写明 `{skill: ssot-write-level, scope: <相关元素的父元素的视图 id>, reason: …}`；
- 为了让参与者拿到某个值，只能让它读系统内部的东西：是契约缺一个交出它的连接，同第一条。

## 五、末尾评审与交付

1. 对 V 中每个视图运行 `ssot check <design> --scope <视图> --base <开始时的提交>`（开始时的提交见 `ssot` 第四节），撤回 `behavior/<Q>.qnt` 之外的改动。
2. 按 `ssot` 第七节派 `ssot:reviewer`：交给它 `ssot-verify-behavior`、`scope`、设计目录路径与每次 `check --scope` 的诊断。
3. 评审的发现在本模块内修，修完重跑第三步；指向上游的，按第四步处理。
4. 交付：本模块改了什么、每次 `check --scope` 的结果与退出码、留下的 info 与评审对它们的判断、下一项前沿（如有）。
