---
name: ssot-quint
description: SSoT 接线载体（Quint）：一个 Quint 模块是围绕一个担心的一张接线图（String Diagram）——每个 var 是一条带延迟的线（某个盒子的反馈，或盒子之间在途的值），契约盒子来自生成的 VDM，进程步骤、在途请求与崩溃这类环境在这里声明；顺接的步骤写成一串盒子，先后只来自线上有没有值，不为实体记进度；性质写在可观察的线上；回放、覆盖目标、组合图、工具会拒绝什么、评审怎么判。写或评 Quint（ssot-write-behavior、ssot-verify-behavior）时与操作 skill 一起完整读。先读 ssot。
---

# ssot-quint：接线与反馈

例子取自 soroi 示例设计（[`../ssot/references/example/design/`](../ssot/references/example/design/)）的 `design/behavior/winddown.qnt`。

## 一、一个模块是一张接线图

依据：Di Lavore 等，*Span(Graph): a Canonical Feedback Algebra of Open Transition Systems*（arXiv 2010.10069）——“Theory of Processes + Feedback = Theory of Stateful Processes”。盒子由端口上的谓词给出，状态只来自反馈；系统由开放的盒子接线组合，不先写出整体的状态空间。

- **一个模块围绕一个担心。** 担心来自深入判断（`ssot` 第三节）。模块开头的注释写出这个担心、接进来的盒子，以及步骤怎样顺接：

```quint
// 担心：停机或 daemon 崩溃之后，一个运行项的结束可能在它的闭包里还有执行时就被写下（REQ-55），
// 或者已退出的 daemon 发出的 launch 在闭包关闭之后才到达执行边界、却被接纳（REQ-24）。
// 盒子：使用方 caller、停机过程 halting、daemon 的崩溃环境 epoch，契约盒子 soroi_store、soroi_workspace；
// 闭包过程是一串顺接的步骤（open → launch → collect → close → end），每一步从它的输入线取一个值、调用端口、
// 把结果放到下一步的输入线上。每个 var 是一条带延迟的线；先后只来自线上的值，不记“走到哪一步”。
module winddown {
```

- **每个 `var` 是一条带延迟的线。** 它要么是一个盒子自己的反馈（契约盒子的状态、停机过程记着的触发、崩溃环境记着 daemon 运行到第几次），要么是两个盒子之间在途的值（一步放上去、下一步取下来）：
  - **契约盒子**：一个 VDM 模块（`ssot-vdm`），它的反馈线是生成的状态类型，只经它的端口（生成的 `Call`）改变；
  - **行为一侧的盒子与线**：只在接线里出现的东西——进程的各个步骤、使用方、在途的请求、崩溃这类环境。它们在本模块里声明类型与 `var`，不伪装成 C4 或 VDM 元素，不为它们新建契约模块。
- **只接这个担心需要的盒子。** 没有接进来的契约模块不要求出现。环境盒子只在使用者的阶段与观测说明它真会发生时才接：不预设每个对端都会使坏。
- **不直接建模状态机。** 不为一个实体记“它走到了哪一步”，再据此选下一步：阶段枚举、阶段字符串、计数器，以及一组只用来区分进度的布尔位或可选字段，都是状态机换了写法。一串先后相继的步骤写成顺接的盒子：每一步从输入线取一个值、调用端口、把结果放到下一步的输入线上；先后只来自线上有没有值：

```quint
  // 闭包过程各步之间的线（daemon 进程内，崩溃时消失）。
  var toOpen: Set[Store::RuntimeId]
  var toLaunch: Set[Store::RuntimeId]
  var awaiting: Set[(Store::RuntimeId, Ws::ExecRef)]
  var toCollect: Set[(Store::RuntimeId, Ws::ExecRef)]
  var toClose: Set[Store::RuntimeId]
  var toEnd: Set[Store::RuntimeId]
  …
  action closureClose(rt: Store::RuntimeId): bool = all {
    rt.in(toClose),
    running(rt),
    toClose' = toClose.exclude(Set(rt)),
    toEnd' = toEnd.union(Set(rt)),
    …
    commit(soroi_workspace(Ws::close({ rt: rt }))),
  }
```

- **在途的请求是一条带延迟的线。** 发出与回复之间可能隔着崩溃：在途请求自己是一条线，跨崩溃留下；回复的一步取下它、调用契约端口，只把结果交给仍在等它的那一步。回复取契约允许的每一种结果，不在行为里替执行边界挑：

```quint
  // REQ-24：关闭已记下时回复 Rejected；未关闭时执行边界也可以拒绝。回复只交给仍在等它的闭包过程。
  action answerLaunch(rt: Store::RuntimeId, x: Ws::ExecRef, e: int, accept: bool): bool = all {
    (rt, x, e).in(inflight),
    val res = if (rt.in(ws.closed) or not(accept)) Ws::Launch_Result_Rejected(Ws::Rejected_Rejected)
              else Ws::Launch_Result_ExecRef(x)
    val waiting = e == epoch and (rt, x).in(awaiting)
    …
```

- **崩溃是一个环境盒子的一步。** 它有自己的反馈（daemon 运行到第几次），并清掉进程内的线与进程的反馈，留下契约盒子与在途请求；重启后的接管写成后续的步骤。
- **精度随阶段。** 早期只接最少的盒子，线上的值取最少几种，数据抽象成身份；载荷取类型允许的代表值。

## 二、模块与引用

每个行为文件一个模块，模块名与文件名相同。契约的名字全部经生成的模块引用：

```quint
  import contract.* from "../.gen/contract"
  import Vdm.* from "../.gen/contract"
  import soroi_store as Store from "../.gen/contract"
  import soroi_workspace as Ws from "../.gen/contract"
```

`.gen/contract.qnt` 由 `ssot gen` 写出，不手改。行为里不声明与契约的类型、操作或函数同名的东西；行为自己的概念在本模块定义一次。

## 三、契约盒子的端口与反馈线

- **唯一的 `Call` 变量。** 恰好一个类型为 `Call` 的 `var`（`lastCall`）。调用契约端口的一步把生成的 `Call` 变体写进它，参数与结果都在载荷里；不调用契约的一步写 `NoCall`。
- **契约盒子的反馈线只用生成类型，用 `initial` 初始化。** 接进来的每个有状态的契约盒子，恰好一个生成状态类型的 `var`；`init` 把它直接赋为 `<别名>::initial`。
- **按 `post` 前进。** 每一步按被调端口的 `post` 更新契约盒子的反馈线，集中写在一处：

```quint
  action commit(call: Call): bool = all {
    lastCall' = call,
    store' = storeAfter(store, call),
    ws' = workspaceAfter(ws, call),
  }
```

  这是 `post` 的第二份手写，由回放检查：轨迹里出现的每次调用，取调用前后的反馈线与载荷，在定义它的 VDM 模块里求 `pre`、`post`、`inv` 与 frame。没有接进来的端口不回放。
- **契约盒子已经持有的事实，从它的反馈线读。** 守卫要判断“闭包已关闭”，读 `ws.closed`，不在行为一侧的盒子里另记一份。

## 四、不重写契约的事实

- **载荷取值不在行为里判定。** 行为只决定什么时候调用、调用之后走哪条路；载荷与结果取类型允许的值，合不合法交给端口的 `pre`/`post`，由回放检查。
- **只复述某个 `pre` 的不变式不写**：回放已经检查 `pre`。
- **冗余的字段在契约里删掉。** 一个值能由契约里别的值决定，行为却要另选一次，问题在契约的形状。

## 五、次序怎样写

- **参与者只用自己知道的值。** 每一步的守卫与载荷只用它输入线上的值、它所属盒子自己的反馈，或前一个端口交给它的值（闭包过程用 `writeStart` 返回的运行项）。读别的盒子的反馈，就是一条从那个盒子接过来的线，只在确有这条线时才读。
- **每个结局都有去处。** 被调端口的结果是并类型时，每个变体都有产生它的步骤，也有接住它之后的路。
- **集合用有界常量完整表达。** `pure val RUNS = Set("r1", "r2")` 这类常量给出候选集合，每个元素都可能被选到。
- **每一步改它碰到的线。** 一个 `action` 从哪些线取值、往哪些线放值，它就连着哪些线；组合图就按这个画（第七节）。

## 六、性质与覆盖目标

- **性质写在对外可观察的线上。** `safety` 是不变式的合取，写在契约盒子的反馈线或几个盒子之间可观察的关系上，不复述某个动作自己的守卫，不用只为不变式存在的影子变量：

```quint
  // REQ-55：一个运行项的结束写下时，它的闭包里没有仍在运行的执行。
  val noExecAfterEnd = ws.running.keys().forall(x => not(ended(ws.running.get(x))))
  // REQ-55：打开过闭包的运行项，结束写下时闭包已经关闭。
  val endAfterClose = store.ends.keys().forall(rt => rt.in(ws.opened) implies rt.in(ws.closed))
  val safety = noExecAfterEnd and endAfterClose
```

- **覆盖目标证明模型确实在做事。** 每个名字以 `witness` 开头的 `val` 都是必须走到的情形，工具对它做一次定向模拟，走不到时检查失败。一个什么都不做的模型永远满足性质，所以每条性质涉及的情形都要有覆盖目标；需要的步数多于默认值时，在同一模块声明 `pure val maxSteps_<目标名> = <正整数字面量>`。覆盖目标写在可观察的线上，说出的情形要与注释一致——“已退出的 daemon 发出的请求”就要看得出发出它的是哪一次运行：

```quint
  // REQ-24：已退出的 daemon 发出的 launch 还在途，它的闭包已经关闭。
  val witnessLateLaunchAfterClose = inflight.exists(p => p._3 < epoch and p._1.in(ws.closed))
  pure val maxSteps_witnessLateLaunchAfterClose = 40
```

- 随机模拟不保证走到少见的交错。目标很少出现时，用 `nondet roll = 1.to(8).oneOf()` 这类频率放慢外部事件与崩溃，或放宽这个目标的步数。
- **需求编号**写在紧贴兑现它的声明（性质所在的 `val`、覆盖目标、`action`）首行之上的连续 `//` 注释里，逐个写全；只附在确实兑现它的声明上。

## 七、组合图

`ssot render` 为每个可运行模块画一张组合图，图上是这张接线图本身：

- **盒子：** `step` 直接选出的每个 `action` 是一个步骤盒子；被步骤调用的辅助动作（如 `commit`、`dropFromProcess`）并进调用它的步骤，不单独画。被 `Call` 调用到的契约模块是另一种样式的盒子，它的反馈线在盒子里，不另画。
- **线：** 行为一侧的每个 `var` 画成一条线（圆角标签，标出类型）。步骤只读它 → 线指向步骤（取）；只写它 → 步骤指向线（放）；又读又写 → 双向（改）。`v' = …` 右边读 `v` 自己只是把余下的值带过去，不算读。步骤调用契约端口 → 虚线指向那个契约模块，标端口名。

顺接的步骤因此画成“线 → 步骤 → 线 → 步骤”的一串。写完先看组合图：盒子与线是不是这个担心需要的那些；顺接的步骤是不是这样一串，而不是很多步骤都去改同一条线（那条线在记进度）；只有崩溃这类环境与停机接管这类收束才连着几乎所有线。

## 八、工具会拒绝什么

| 规则 | 拒绝什么 |
|---|---|
| `compile.quint` | Quint 的语法与类型错误，包括载荷不符合契约签名 |
| `behavior.names` | 声明了与契约同名的类型、操作或函数 |
| `behavior.call` | 没有或有多个 `Call` 变量；可运行模块缺 `safety`；`maxSteps_<目标名>` 不是正整数字面量的 `pure val`；契约盒子的反馈线变了而 `lastCall` 不是那个模块的调用 |
| `behavior.init` | `init` 没有把契约盒子的反馈线直接赋为 `<别名>::initial` |
| `behavior.run` | 模拟中 `safety` 被违反 |
| `replay.pre` / `replay.post` / `replay.inv` / `replay.eval` | 回放的一次调用在契约下 `pre` 或 `post` 为假、不变式被破坏或求值出错 |
| `replay.frame` | 回放的一次调用改动了端口只读或不写的分量 |
| `replay.initial` | 轨迹的初态不等于契约的初态 |
| `replay.incomplete` | 不透明值无法构造、缺少契约盒子的反馈线、覆盖目标没有走到：验证不完整 |

`replay.outcome`（结局变体的出现次数）只是提示。检查被截止打断时报 `resource.deadline`，`check` 以 3 退出，表示验证没做完。

## 九、评审时怎么判

先看组合图，再读模块：

1. **担心与接线对得上。** 模块开头写的担心，组合图里接进来的盒子足以表达；没有与担心无关的盒子；环境盒子都有阶段或观测支撑。
2. **不直接建模状态机。** 没有阶段枚举、阶段字符串、计数器，也没有一组只用来区分进度的布尔位或可选字段；没有包揽几个进程的大节点；先后来自线上有没有值。
3. **性质在可观察的线上。** `safety` 不复述动作自己的守卫，不依赖影子变量；每条性质都有覆盖目标说明它涉及的情形确实走到了。
4. **换掉一个盒子会怎样。** 对每条性质问：哪一个错误的盒子或错误的接线会让它失败（例如执行边界在关闭之后仍接纳 launch）？答不出，这条性质很可能是空的。
5. **不重写契约事实。** 契约盒子的反馈线只用生成类型、用 `initial` 初始化、只在对应 `Call` 那一步改变；没有与它并行的另一份事实。
6. **参与者只用自己知道的值；每个结局都有处理；集合完整表达。**
7. **需求编号。** 每个附着的编号都在确实兑现它的声明上。
