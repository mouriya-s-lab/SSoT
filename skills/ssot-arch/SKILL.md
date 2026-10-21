---
name: ssot-arch
description: SSoT 设计块：核心抽象与架构设计。从外部依据出发，在多视角下权衡需要定义的核心概念、值与动作的位置，划分模块树、连接面、状态不变量与生命周期。当用户明确指定设计或修改架构时调用。
---

# ssot-arch：核心抽象与架构设计

开始前先读 `ssot`。本块按三步推演 `design/architecture/`，示例见 [`../ssot/references/example/design/architecture/`](../ssot/references/example/design/architecture/)。

---

## 第一步：从外部事实推演依据与边界

先问：**外部世界有什么改变不了的事实、约束、系统级需求与质量要求？它让架构多了或少了什么？**

- **依据写来源与“所以”：** 每条一句话，写出来源，并接一句“所以……”，说明它让架构多了或少了什么。例如：
  ```markdown
  上游在超时之后仍可能已经开始了运行（来源：上游接口说明，证据见附录 `evidence/upstream-timeout.md`）。所以 ``Run`StartOutcome`` 有结果未知一支，调用方经 ``Run`Status`` 找回运行。

  在上游可用的情况下，调用方用同一个请求号重复调用 ``Run`Start`` 时，系统只产生一次运行（来源：示例需求）。所以 ``Run`Start`` 按 ``Run`RequestNo`` 幂等，运行表记下请求号到运行的对应。
  ```
- **质量要求：** 写成“在〈环境〉下，〈刺激〉发生时，〈响应〉满足〈度量〉”，并写出来源；数值只在有出处时写。
- **在连接不变时可以替换的做法属于实现：** 只规定怎样兑现连接、换一种做法时连接与不变量都不变的内容（如运行表底层怎样查找与插入、编码与字节、逐项拒绝原因、保护某条不变量的内部机制），留在实现代码或 `appendix/reference/`（如 `reference/run-store.md`），不写进架构。当前实现的目录、调用步骤和偶然行为不是依据；写设计时不参考实现代码。
- **理由写为什么：** 每个改变架构形状的决定在 `## 为什么` 中写明理由并引用依据；确实存在可信替代时，写一句为什么不选它（如：“不让调用方自己记下请求号与运行的对应：结果未知时调用方手里没有运行身份，只有提供方能按请求号找回”）。

---

## 第二步：定视角、持有者与模块树

按 `ssot` 的多视角权衡与两条轴原则，确定本系统需要定义的核心概念及其所属模块：

- **哪些概念展开、哪些保持 `token`：** 观察者需要按状态分支或读字段的，在持有者写出结构并带 `struct` 导出（如 `StartOutcome = Started | <Rejected> | <Unknown>`）；观察者只原样传递的，定义为 `token` 且导出不带 `struct`（如 `RunId = token`）。
- **判定规则写在持有者：** 如哪些运行需要找回由 `Attempt` 持有，在 ``Attempt`Unresolved`` 里写出显式纯函数。
- **子模块拆分理由写进 `README.md`：** 只有当一组元素对外陈述连接、内部决定可对其他模块隐藏，且父模块不需要知道其内部细节时，才拆为子模块。例如 `Attempt` 的 `README.md`：
  ```markdown
  尝试的记录只追加，所以单独成为子模块：它只用到父模块的 ``Run`RunId``，父模块不需要知道记录怎样保存。
  ```

---

## 第三步：定连接、状态不变量与生命周期

连接是一等概念：模块之间只经连接相接，连接写清楚之后，两边可以各自替换实现。

| 概念 | 是什么 | 示例里的写法 |
|---|---|---|
| 连接点 | 一个可以被调用的操作或函数 | ``Run`Status``：一个导出的操作 |
| 连接面 | 共享同一份状态与同一条不变量的一组操作；共享的那条不变量就是这个面的规则 | `Start`、`Status`、`Finish` 共享状态 `Runs`；共同规则是 `inv mk_Runs(b, l) == l subset rng b` |
| 交换 | 连接收进与交出的数据 | 参数与结果类型，如 `Start: RequestNo ==> StartOutcome` |
| 结局 | 一次调用的全部可能结果；只列使用方必须区分处理的结局，不逐项列原因 | `StartOutcome = Started \| <Rejected> \| <Unknown>` |
| 可观察的失败 | 结局中的一支，写明恢复要走哪个连接 | `<Unknown>` 一支，说明里写明改用 `Status` 找回 |
| 准入定律 | 实现必须满足的不变量、前置条件与后置条件，三者各管一件事 | `Start` 的后置条件：同一请求号重复开始，得到同一运行 |
| 不承诺 | 对使用方隐藏结构的类型：使用方只能原样传递，不能读、不能造 | `RunId = token`，导出时不带 `struct` |
| 生命周期 | 一样东西从开始到结束：由哪个连接开始、哪个连接结束，嵌套在谁之内，由谁确认 | 运行由 `Start` 加入 `live` 开始、由 `Finish` 移出结束；`l subset rng b` 规定活着的运行都嵌套在某个请求之内 |
| 判定 | 两个实现必须得出同一结果的计算；这时计算本身就是设计决定 | ``Attempt`Unresolved`` 写出显式体 |

- **不变量、前置条件、后置条件各管一件事：**
  以 Overture 的交通灯示例为例：互相冲突的两条路径至少一条是红灯，任何时刻都成立，是路口 `Kernel` 的不变量（`inv`）；只有黄灯才能转红，是 `ToRed` 的前置条件（`pre`）；调用前后的状态关系与输出要求写进后置条件（`post`）：
  ```vdm
  Kernel :: lights    : map Path to Light
            conflicts : set of Conflict
  inv mk_Kernel(ls,cs) ==
        forall c in set cs &
              mk_Conflict(c.path2,c.path1) in set cs and
              c.path1 in set dom ls and c.path2 in set dom ls and
              (ls(c.path1) = <Red> or ls(c.path2) = <Red>)

  ToRed: Path * Kernel -> Kernel
  ToRed(p,mk_Kernel(lights,conflicts)) ==
    mk_Kernel(ChgLight(lights,p,<Red>),conflicts)
  pre p in set dom lights and lights(p) = <Amber>;
  ```
- **不变量越简单越好：** 不变量复杂，往往说明状态选得不对；不在状态里放冗余信息，能由事实算出的性质写成纯函数。
- **规格说不清的语义写进文字：** 定时与调度（如两次 `Status` 至少相隔 `RetrySeconds` 秒）、跨连接并发与进程边界、事实与副本、包含关系（如 `Run` 与 `Attempt` 运行在同一进程内）、崩溃后的接管写进 `README.md` 的 `## 语义`。
