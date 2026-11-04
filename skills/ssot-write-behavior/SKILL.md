---
name: ssot-write-behavior
description: SSoT 为一个担心写一张接线图（Quint 模块）：接进来的契约盒子与行为一侧的盒子、反馈线、先后来自已到手的回复、可观察线上的性质与覆盖目标，交出组合图与诊断供行为评审；scope 是 Quint 模块名。与 ssot-quint 一起读，并读它接进来的盒子所需的 ssot-vdm；先读 ssot。
---

# ssot-write-behavior：为一个担心写一张接线图

写法、惯用法与禁止项在 `ssot-quint`，本 skill 只给步骤。

`scope` 是一个 Quint 模块名 Q，文件是 `behavior/<Q>.qnt`。本切片的契约盒子集 M：Q 接进来（在 `Call` 里调用）的契约模块；Q 还不存在时，M 取 `reason` 里列出的盒子。M 中每个模块所属元素的父元素的视图（元素在顶层时为 `index`）组成视图集 V。

| 项 | 内容 |
|---|---|
| 输入 | Q；`reason`：深入判断交出的担心、要接进来的盒子、要兑现的需求编号与精度，或评审的发现；使用者声明的阶段与运行观测 |
| 可读 | `behavior/<Q>.qnt` 与它 import 的非生成行为模块；`.gen/contract.qnt`；M 中每个模块的导出签名与导出端口的 `pre`/`post`；M 所属元素在 `structure/*.c4` 里的标题、描述与关系；需求编号在 `requirements.md` 里的原文；`ssot check`、`ssot render` 的输出 |
| 可改 | 只有 `behavior/<Q>.qnt` |
| 可运行 | `ssot gen <design>`；对 V 中每个视图运行 `ssot check <design> --scope <视图>`（交付前加 `--base <开始时的提交>`）；`ssot render <design>` |
| 输出 | 本模块改了什么；每次 `check --scope` 的结果与退出码、留下的 info；交给行为评审的材料：本模块的组合图路径（`ssot render` 里 id 为 `composition:<Q>` 的那一行）、设计目录路径与每次 `check --scope` 的诊断 |
| 上抛 | 第四步的情形 |

输入前提：M 中的模块在 `check --scope` 下没有 error；有 error 时先接那个模块的 `ssot-write-contract`。

## 一、先写下担心与盒子

模块开头的注释写出担心（一句可以被证伪的话）与接进来的盒子：契约盒子，以及行为一侧的进程、在途请求、使用方与环境盒子。只接担心需要的盒子；环境盒子只接使用者的阶段与观测说明会发生的。

## 二、写模块

1. **引用生成的契约。** 按 `ssot-quint`「二」import，不重写任何 VDM 的类型、端口或事实。
2. **线。** 每条线一个 `var`：契约盒子的反馈用生成的状态类型，`init` 赋为 `<别名>::initial`；行为一侧的反馈与在途的值在本模块里声明类型。顺接的步骤写成一串线，不为实体记进度（`ssot-quint`「一」）。再加唯一的 `Call` 变量。
3. **每一步碰它的线。** 一个 `action` 从它的输入线取值、往输出线放值：守卫只读它的输入线、它所属盒子的反馈、前一个端口交给它的值，以及确实接过来的线；契约调用经 `commit` 把 `Call` 写进 `lastCall`，并按端口的 `post` 前进契约盒子的反馈线。
4. **每个结局都有去处。** 被调端口的每个结局变体，都有产生它的一步与接住它之后的路。
5. **性质。** `safety` 写在可观察的线上，不复述动作自己的守卫，不用影子变量。
6. **覆盖目标。** 每条性质涉及的情形各写一个 `val witness…`；需要更多步数时声明 `pure val maxSteps_<目标名> = <正整数字面量>`。
7. **需求编号。** 只附在确实兑现它的声明上。

## 三、检查与自查

运行 `ssot gen <design>`，再对 V 中每个视图运行 `ssot check <design> --scope <视图>`：

- 本模块的 error（`compile.quint`、`behavior.*`、`replay.*`）在本切片内修。回放报 `replay.pre`/`replay.post`/`replay.frame`/`replay.initial` 时，先当作本模块对 `post` 的第二份手写写错了：VDM 是权威。
- `replay.incomplete` 说明有覆盖目标没走到：调整调度频率或该目标的 `maxSteps_`，不删目标来过检查。
- `replay.outcome` 与其余 info 交给评审。退出码 `3` 是验证没做完，如实写进输出，不当作通过。

然后运行 `ssot render <design>`，按 `ssot-quint`「七」看本模块的组合图：步骤盒子与线是不是这个担心需要的那些；顺接的步骤是不是画成“线 → 步骤 → 线 → 步骤”的一串；有没有一条线被很多步骤又读又改（它在记进度）。再对每条性质问一次：换掉哪一个盒子会让它失败？答不出，回头看性质是否写在了可观察的线上。

## 四、上抛

- 需要一个契约盒子没有导出的端口、类型或结局，或回放说明某个 `post` 本身与担心不符：交回事实，给那个元素的 `ssot-write-contract`；
- 需要两个元素之间的调用，而结构里它们没有关系，或某个职责放错了元素：交回事实，给 `ssot-write-level` 与相关元素的父元素的视图 id；
- 为了让一个盒子拿到某个值，只能让它读别的盒子的内部：说明缺一个交出它的端口，同第一条。

## 五、交付

1. 对 V 中每个视图运行 `ssot check <design> --scope <视图> --base <开始时的提交>`，撤回 `behavior/<Q>.qnt` 之外的改动。
2. 运行 `ssot render <design>`。
3. 按「输出」交付。
