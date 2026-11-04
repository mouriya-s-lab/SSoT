---
name: ssot-vdm
description: SSoT 盒子载体（VDM-SL）：一个带 #contract 的底层元素的模块就是一个盒子——导出是端口，state 是这个盒子自己的反馈线，pre/post/inv 是端口上的承诺；按阶段从模糊到精确；不直接建模状态机；写法、生成到 Quint 的要求、充分与无偏差、工具会拒绝什么、评审怎么判。写或评 VDM（ssot-write-contract、ssot-verify-contract，以及接这些盒子的行为）时与操作 skill 一起完整读。先读 ssot。
---

# ssot-vdm：盒子

例子取自 soroi 示例设计（[`../ssot/references/example/design/`](../ssot/references/example/design/)）的 `soroi_store`、`soroi_workspace`。VDM 语法查 [`references/vdm/`](references/vdm/README.md)。

## 一、一个模块就是一个盒子

- 一个带 `#contract` 的底层元素恰有一个模块，这个模块是一个盒子：
  - 导出的操作与函数是它的**端口**，参数与结果的类型是端口上的**线**；
  - 模块的 `state` 是这个盒子自己的**反馈线**：端口的调用沿着它把上一次留下的事实交给下一次；没有状态的盒子没有 `state`；
  - 每个操作的 `ext rd`/`ext wr` 说明这个端口读、写反馈线的哪一段；
  - `pre`、`post`、`inv` 是端口上的承诺：什么时候能调、调完成立什么、任何时刻都成立什么。
- **不直接建模状态机。** 不把盒子写成“阶段 + 迁移表”，不为一个实体记“它走到了哪一步”：阶段枚举、阶段字段、计数器，以及一组只用来区分进度的布尔位，都不放进反馈线。反馈线上只放端口承诺要读到的源头事实——`soroi_workspace` 记下 `closed`，是因为“关闭之后拒绝 launch”要读它，不是为了记闭包走到了哪里。跨盒子的先后交给接线（`ssot-quint`）。
- 盒子图：`ssot render` 为每个契约模块画一张盒子图（端口、线、反馈线、每个端口读写的分量）。写完先看这张图：端口是不是只有必要的几个，反馈线上是不是只有这个盒子守住的源头事实。

## 二、从模糊到精确

精度随使用者声明的阶段增加（`ssot` 第三节）：

- **早期：** 只写端口签名；类型多为 `token`；效果还没有约束的端口写成显式操作 `is not yet specified`；判定写成体为 `is not yet specified` 的函数；不预建 `state`。
- **有运行观测支撑的地方：** 只把观测证实的那几条性质写成 `pre`/`post`/`inv`。soroi 的 `soroi_store` 停在“事实只写一次、按序写下”：记录的内容保持不透明，结束只区分是否由停机结束：

```vdm
  -- 结束的内容保持不透明，只区分是否由停机结束。
  Outcome = <Settled> | <Halted>;
  …
  -- REQ-34：一个运行项的结束至多写下一次。
  writeEnd(rt : RuntimeId, o : Outcome)
  ext rd runtimes
      wr ends
  pre rt in set dom runtimes and rt not in set dom ends
  post ends = ends~ munion {rt |-> o};
```

`token` 与 `is not yet specified` 是合法的终态，一直保留到有约束要求观察它的结构或规定它的结果。

模块开头的注释写这个盒子负责什么、端口之间的先后归谁、精度停在哪里：

```vdm
-- 事实源头这个盒子：运行、运行项、运行项的结束与运行的停机锚点。
-- 只写每个端口在数据上的前后条件；端口之间的先后由 design/behavior 持有。
-- 精度停在“事实只写一次、按序写下”：记录的内容（输入、产出、现场）保持不透明。
module soroi_store
```

## 三、定义多少

描述“值”的地方和描述“动作”的地方往往不在一处；同一样东西在持有它的盒子里是细节，在别处只是一个占位，需要时才展开。以信号灯为例：

```vdm
SignalColour = <Red> | <Amber> | <FlashingAmber> | <Green>
```

- **定义在持有者。** 信号灯有这几种颜色，`SignalColour` 定义在信号灯的模块里。
- **观察者需要才展开。** 有观察者要按颜色分支，才写出 `=` 右边；没有，它只是一个 `token`。
- **行为归做出行为的一方。** 红灯不许通过是司机的行为，写在司机那里，不写在信号灯里。
- **规则归持有者。** 谁持有切换规则，规则就在谁那里是细节，在别处是概括。
- **隐含前提是软件的一部分，就有它的位置。** 是外部依赖，就是一个可导入的占位；由本系统实现，就在实现它的元素里展开。不是软件的一部分（服务器需要电力），不写进设计。
- **展开只有一处。** 展开了两处，它就有两种解释。

## 四、文件与模块

- 文件 `design/contract/<fqn>.vdmsl`，恰有一个模块，模块名是 fqn 把 `.` 换成 `_`：`soroi.store` → `soroi_store`。`#contract` 只在没有子元素的元素上。
- `imports` 由契约自己决定：用到哪个模块的定义，就从持有它的模块 import，只列实际用到的名字。结构不为 import 画任何关系。
- 模块之间的 import 不能成环（生成的 Quint 模块不允许循环引用）；架构元素的模块不得 import 业务元素的模块。两条由 `contract.imports`、`contract.layering` 拒绝。
- 共用的身份定义在维护它的盒子：soroi 的运行与运行项身份由事实源头 `soroi_store` 持有，`soroi_workspace` import 它。不为了放共用定义新建元素。
- 文件是原生 `.vdmsl`，不嵌在 Markdown 里。

为了让 `.gen/contract.qnt` 能生成：

- 导出操作的形参必须是标识符（不能是 `-` 或模式）；形参名就是行为里 `Call` 载荷的字段名。
- 导出类型名以大写字母开头，不叫 `Call`；导出的类型名、操作名、形参名、记录字段名不能是 Quint 保留字或内建名（如 `all`、`any`、`if`、`run`、`val`、`def`、`type`、`import`、`action`、`nondet`、`temporal`、`Set`、`List`、`Map`），也不能是 `result`。
- `Call` 载荷或状态能到达的类型必须能映射进 Quint：`real`、`rat`、单独的 `char`、函数类型、递归类型映射不了。带 `inv` 的类型映射成基础类型，不变式由回放时的 VDMJ 检查。
- 行为要按分支读的类型（结果的并类型、quote 类型）带 `struct` 导出；只传递的身份不带。

## 五、VDM-SL 写法

**分号。** 分号分隔同一块里的定义或语句，不是每行的结尾。下面这些位置写分号，VDMJ 报解析错误：`end M` 之后；`let` 的绑定之间与 `in` 之前；`cases` 分支之间与 `end` 之前；同一个定义内部（`::` 记录字段之间，`inv` 之前，`ext`、`pre`、`post` 之间，`if … then … else` 的分支末尾）；连写两个分号。

**模块头。** `exports` 列出别的模块能用的东西；`struct` 表示连同结构导出，不带则使用方不能构造、读字段或分支匹配：

```vdm
module soroi_workspace
imports
  from soroi_store
    types RuntimeId
exports
  types
    ExecRef; struct Rejected
  operations
    open : soroi_store`RuntimeId ==> ();
    launch : soroi_store`RuntimeId * ExecRef ==> ExecRef | Rejected;
```

**类型。** `token` 是没有结构的值；`inv` 给类型加不变式；`::` 定义记录，字段之间不加分号；`|` 组成并类型，`<Rejected>` 是 quote 值。

**值。** 有名字的常量写在 `values`；数值写出单位与来源，不为它建计时或计数的状态。

**反馈线（`state`）。** 一条记录，带不变式与初值。`init` 写成 `s == s = mk_<状态名>(...)`：工具从它求出初态，生成行为要用的 `initial`。只放这个盒子守住、有观察者的源头事实；身份之间的事实用映射与集合；能算出来的写成纯函数：

```vdm
-- 一个运行项的闭包是否打开、是否已记下关闭，以及被接纳、尚未终止的执行属于哪个运行项。
state Closures of
  opened  : set of soroi_store`RuntimeId
  closed  : set of soroi_store`RuntimeId
  running : map ExecRef to soroi_store`RuntimeId
inv mk_Closures(os, cs, rn) ==
  cs subset os and rng rn subset os \ cs
init s == s = mk_Closures({}, {}, {|->})
end
```

**隐式操作（端口）。** 只写 `ext`、`pre` 与 `post`。`ext rd` 列只读的分量，`ext wr` 列要写的分量；没列进 `ext wr` 的分量调用前后不变。`post` 里 `x~` 是调用前的值。`ext wr` 里的分量，每个 `or` 分支都要写出它这一支怎样变，没变就写 `x = x~`，否则那一支允许它变成任意值：

```vdm
  -- REQ-24：关闭记下之后拒绝该运行项的 launch；被接纳的执行记入 running。
  launch(rt : soroi_store`RuntimeId, x : ExecRef) r : ExecRef | Rejected
  ext rd opened, closed
      wr running
  pre rt in set opened and x not in set dom running
  post (rt in set closed => r = <Rejected>) and
       ((r = x and running = running~ munion {x |-> rt}) or
        (r = <Rejected> and running = running~));
```

**函数。** 不读写反馈线的定义写成函数，不写成隐式操作。显式体只在两个独立实现面对同一输入必须得出同一结果、且这个结果本身就是承诺时才写；允许多个合格结果、或不想绑定算法时，只写签名与 `post`。不在规格里实现排序、比较、遍历这类标准算法：写出它要满足的性质，或者干脆不展开。显式体不写局部变量（`dcl`）、赋值（`:=`）与循环。

**显式操作。** 只用于效果还没有约束的端口，体写 `is not yet specified`。不写按次序调用别的操作的场景；先后归接线。

**说明注释。** `--` 写在定义前面，字段说明写在同一行末尾。说明写“它是什么”，不复述类型形状；说明里提到的每个参数、载荷字段或状态区分，都要在定义中真实存在。

**需求编号。** 一条需求由哪个定义兑现，就在紧贴这个定义首行之上的连续 `--` 注释里写出它的编号，中间不留空行，逐个写全；由整个模块兑现时写在紧贴 `module` 行之上。只附在确实兑现它的定义上，不为了让需求“有落点”而附。

## 六、不展开也守住约束

约束要的是排除违反情形，不是把对象写完整。按次序找一种不展开就能排除违反情形的写法；前一种写不出，才用后一种：

1. **身份只比较相等。** 类型保持 `token`，约束写成身份之间的等式或映射。
2. **判定写成不展开的函数，放进谓词。** 条件的内容未定或不归本系统定时，写一个体为 `is not yet specified` 的判定函数，在 `pre`/`post` 里调用它。
3. **事实写成身份之间的映射与集合。** 要记住的只是“哪些运行已写下 halt”“运行项属于哪个运行”时，用 `map RunId to Trigger`、`map RuntimeId to RunId`，不给实体建带状态字段的记录。
4. **结局只列调用方要区分的分支。** 结果写成 quote 并类型，只列合法调用方会分别处理的几支；调用方不分支的结果返回 `()`。违反 `pre` 的调用不列成结局。阶段还不支持的失败分支不预先列出。
5. **端口与外部依赖只留签名。** 效果还没有约束的端口、外部系统提供的端口，写签名加 `== is not yet specified`，不为它预建 `state`。
6. **数值写进 `values`。** 时限、次数写成常量；它们在什么时刻起作用归接线。

已经定下的约束不能藏进 `token` 或 `is not yet specified`，要落到产生或使用它的端口的 `pre`/`post` 或 `inv` 上。

## 七、充分与无偏差

每一处展开都要同时过两关：

- **充分：** 规格的约束加上领域性质（外部世界本身成立、本系统不保证的事实），合起来推出要兑现的需求。规格对每条约束的违反情形都要拒绝。
- **无偏差：** 规格里的每个区分，都有一串导出端口能观察到：两个只在这一处不同的合法状态，某个端口的结果或能否调用不同。观察不到的区分是把一种实现写成了承诺，删掉它或收回成 `token`。

**用 `ssot eval` 求违反实例**，在原样规格里求值：

```sh
# 反馈线的不变式：一个运行项属于一个不存在的运行。构造这个状态本身就被拒绝（VDMJ 报 4079）
ssot eval <design> soroi_store \
  'mk_Records({}, {mk_token("t1") |-> mk_token("r1")}, {|->}, {|->})'
# 端口的前置条件：同一个运行项的结束写第二次，求得 false
ssot eval <design> soroi_store \
  'pre_writeEnd(mk_token("t1"), <Settled>, mk_Records({mk_token("r1")}, {mk_token("t1") |-> mk_token("r1")}, {mk_token("t1") |-> <Settled>}, {|->}))'
```

`pre_op(实参, 前状态)`、`post_op(实参, 结果, 前状态, 后状态)` 同样可以求。表达式求得 `false` 是正常的值，要自己判断它是不是所研究性质的反例。不透明身份用 `--bind name=<模块>:<表达式>:<类型模块>:<类型名>` 在定义模块里构造。不要为了写得出实例而给身份加 `struct` 导出或搬家。

## 八、定义放在持有者

- **定义在持有者，只展开一处。** 别的模块经 import 引用，不复制它的事实或承诺。
- **行为归做出行为的一方。** 一条规则由实际做出这个行为的模块持有，不由它所观察的值持有。
- **契约只承诺结果。** 只写稳定需求的结果与规律；连接不变时可以替换的实现过程、常变的业务内容留在代码里。
- **持续关系先写在持有事实的地方。** 任何时刻都成立的关系，先写在反馈线的 `inv`，或产生它的端口的 `pre`/`post`。
- **接口自我保护。** 被业务元素或系统外调用方调用的端口，谁都能直接调用；绕开预期次序的调用只能由它自己的 `pre`/`post` 挡住。
- **名字就是词汇。** 契约里的名字是这些概念唯一的定义；行为经 `.gen/contract.qnt` 引用它们，结构的槽位不得用它们。

## 九、工具会拒绝什么

| 规则 | 拒绝什么 |
|---|---|
| `compile.vdm` | VDMJ 的语法与类型错误，包括使用方构造或读取不透明身份 |
| `contract.body` | 显式体里出现局部可变变量、赋值或循环 |
| `contract.module` | `#contract` 写在有子元素的元素上；`#contract` 元素与文件、模块名不一一对应 |
| `contract.imports` | 契约模块之间的 import 成环 |
| `contract.layering` | 架构元素的模块 import 了业务元素的模块 |
| `contract.po` | QuickCheck 找到反例的证明义务（带反例） |
| `gen.unmappable` / `gen.names` | 第四节的类型与名字要求；`init` 求不出初态 |
| `replay.pre` / `replay.post` / `replay.inv` / `replay.eval` | 接线轨迹里的一次调用，在本模块的原样规格下 `pre` 或 `post` 为假、不变式被破坏或求值出错 |
| `replay.frame` | 一次调用改动了 `ext rd` 里的分量，或改动了这个端口不写的分量 |

下面这些只是提示（info），交给评审判断：`contract.po` 的 MAYBE 与未证明义务，以及 `hint.export`、`hint.single-business`、`hint.struct-unread`、`hint.string`、`hint.sampled`、`hint.state-unused`、`hint.no-ext`。

## 十、评审时怎么判

先看盒子图：端口是不是只有承诺所需的几个；反馈线上是不是只有这个盒子守住、有观察者的事实；有没有阶段字段。再读模块，每项先问它服务哪条需求或哪个担心，没有出处的结论是删掉或退回占位：

1. **精度与阶段。** 精确的地方都有使用者声明的阶段或观测支撑；其余保持签名、`token` 或 `is not yet specified`。
2. **不直接建模状态机。** 反馈线里没有生命周期阶段的枚举，端口的可调用性不由阶段字段决定；跨盒子的先后没有写进 `pre`。
3. **展开与消费者。** 每个展开的区分都有观察者；每个导出都有真实的消费者（别的模块、接线、系统外调用方）。`hint.export` 指出候选。
4. **架构与业务。** 只为一个业务存在的定义移到那个业务；混着通用保证与业务附加条件的约束拆开。
5. **结构化导出与身份。** 只有要读字段或按分支观察的类型才带 `struct`；`hint.struct-unread` 指出候选，接线按分支读的类型例外。
6. **反馈线。** 是陈述 `inv` 与前后关系的数学模型，不是存储布局；`hint.state-unused` 指出从未被读写的分量。
7. **函数还是端口。** 不读写反馈线的定义是函数；`hint.no-ext` 指出候选。
8. **无类型字符串。** 身份、封闭取值与结构化数据不用 `seq of char`；`hint.string` 指出候选。
9. **恒真与不可满足。** 没有恒真的子句冒充约束，也没有禁止一切合法调用的条件；`hint.sampled` 指出候选。
10. **违反实例。** 对每个 `pre`、`post`、`inv` 和承诺性质的函数各求一个违反实例（第七节），确认规格拒绝它。
11. **每个分支约束全部可写分量。** 逐个 `or` 分支核对 `ext wr` 里的每个分量都有约束；工具查不出漏写。
12. **持有者与写法。** 逐条核对第八节。
13. **领域性质不冒充不变量。** 外部世界成立、本系统不保证的事实，不写成本模块的 `inv`。
14. **需求编号。** 每个附着的编号都在确实兑现它的定义上。
