# 契约的写法（VDM-SL）

`ssot-write-contract` 照这里为一个 `#contract` 元素写它的模块，`ssot-verify-contract` 照这里判断。例子取自 soroi 示例设计（[`../../ssot/references/example/design/`](../../ssot/references/example/design/)）的 `soroi`、`soroi_store`、`soroi_workspace` 模块；VDM 语法查 [`../../ssot/references/vdm/`](../../ssot/references/vdm/README.md)。

## 一、契约只写数据上的承诺

契约持有：连接点（`exports`）、类型、状态与 `inv`、操作的 `pre`/`post`、判定函数、不透明身份。它说一次调用前后数据满足什么，不说怎么做到。

| 不写进契约 | 持有者 |
|---|---|
| 模块之间谁在谁里面、谁能引用谁 | 结构（[`structure.md`](structure.md)）：模块由元素决定，import 范围由关系授予 |
| 跨连接的先后、交错、窗口、时钟、进程、崩溃与重启、调度 | 行为（[`behavior.md`](behavior.md)） |
| 走通一次调用序列的场景 | 行为：集合与次序由 Quint 完整表达，契约不写代表元场景 |

模块开头的注释写本模块负责什么、不负责什么，并指出被拿走的那部分归谁：

```vdm
-- 事实源头的记录契约：运行、运行项、事实追加、结束发布、停机锚点、引用读取与回放读取。
-- 本模块只写每次读写在数据上的前后条件；这些读写的先后由 design/behavior 持有。
module soroi_store
```

## 二、文件与模块

- 每个 `#contract` 元素恰有一个文件 `design/contract/<fqn>.vdmsl`，文件里恰有一个模块，模块名是 fqn 把 `.` 换成 `_`：`soroi.engine.closure` → `soroi_engine_closure`。
- `imports` 只能来自结构授予的模块：本元素恰为源、恰好指向某个 `#contract` 元素的 `calls`/`uses` 关系，以及带 `#shared` 的祖先。要用的词汇不在范围内时，先问结构里是不是缺了这条依赖，而不是换个模块去引。
- 文件是原生 `.vdmsl`，不嵌在 Markdown 里。

为了让 `.gen/contract.qnt` 能生成：

- 导出操作的形参必须是标识符（不能是 `-` 或模式）；形参名就是行为里 `Call` 载荷的字段名。
- 导出类型名以大写字母开头，不叫 `Call`；导出的类型名、操作名、形参名、记录字段名不能是 Quint 保留字或内建名（如 `all`、`any`、`if`、`run`、`val`、`def`、`type`、`import`、`action`、`nondet`、`temporal`、`Set`、`List`、`Map`），也不能是 `result`。
- `Call` 载荷或状态能到达的类型必须能映射进 Quint：`real`、`rat`、单独的 `char`、函数类型、递归类型映射不了。带 `inv` 的类型映射成基础类型，不变式由回放时的 VDMJ 检查。

## 三、VDM-SL 写法

**分号。** 分号分隔同一块里的定义或语句，不是每行的结尾。`imports`、`exports` 的名字列表，`types`、`values`、`functions`、`operations` 块里的定义，`state … end`，`def … in`，块语句 `( …; …; )`，最后一项后面可以多写一个分号。下面这些位置写分号，VDMJ 报解析错误：

- `end M` 之后；
- `let` 的绑定之间与 `in` 之前（绑定用逗号分隔）；
- `cases` 分支之间与 `end` 之前（分支用逗号分隔）；
- 同一个定义内部：`::` 记录字段之间，`inv` 之前，`ext`、`pre`、`post` 之间，`if … then … else` 的分支末尾；
- 连写两个分号。

**模块头。** `exports` 列出别的模块能用的东西；`struct` 表示连同结构导出，不带 `struct` 则使用方不能构造它、不能读字段、不能分支匹配。`imports` 逐项列出用到的名字：

```vdm
module soroi
exports
  types
    struct RunId;
    struct RuntimeId;
    Parsed;
    struct ParseResult;
  functions
    parse : Shape * Raw -> ParseResult;
    valueOf : ParseResult -> Parsed
```

```vdm
module soroi_store
imports
  from soroi
    types RunId; RuntimeId; Path; Digest; Snapshot; Parsed
```

`Parsed` 只导出名字：其他模块拿不到 `mk_Parsed`，业务值唯一的来路是 `parse`。

**类型。** `token` 是没有结构的值；`inv` 给类型加不变式；`::` 定义记录，字段之间不加分号；`|` 组成并类型，`<Halted>` 是 quote 值：

```vdm
  RunId = token;
  Path = seq of char
  inv p == p <> [];
  -- 运行的结束锚点由哪种触发写下
  Trigger = <Manual> | <DaemonLost> | <Uncaught>;
  Own ::
    start   : Start
    buckets : seq of Fact
    fin     : [End];
```

**值。** 有名字的常量写在 `values`；数值写出单位与来源，不为它建计时或计数的状态。

**状态。** 模块的状态是一条记录，带不变式与初值。`init` 写成 `s == s = mk_<状态名>(...)`：工具从它求出初态，生成行为要用的 `initial`，求不出值时报 `gen.unmappable`。

```vdm
state Records of
  bundles  : set of BundleDigest
  runs     : map soroi`RunId to RunRecord
  runtimes : map soroi`RuntimeId to Entry
  order    : map soroi`RunId to seq of soroi`RuntimeId
  halts    : map soroi`RunId to Trigger
inv mk_Records(-, rs, rts, os, hs) ==
  dom os = dom rs and
  dom hs subset dom rs and
  (forall rt in set dom rts & exists r in set dom os & rt in set elems os(r))
init s == s = mk_Records({}, {|->}, {|->}, {|->}, {|->})
end
```

**隐式操作。** 只写 `ext`、`pre` 与 `post`。`ext rd` 列只读的分量，`ext wr` 列要写的分量；没列进 `ext wr` 的分量调用前后不变。`post` 里 `x~` 是调用前的值。`ext wr` 里的分量，每个 `or` 分支都要写出它这一支怎样变，没变就写 `x = x~`，否则那一支允许它变成任意值。回放只拦得住只读分量与操作不写的分量被改动；`ext wr` 分量在某一支漏写，工具查不出，要逐支核对：

```vdm
  -- 只有尚未写下 halt 的运行才可能得到新的运行项；返回 StartFailed 时没有运行项
  writeStart(r : soroi`RunId, s : Start) res : soroi`RuntimeId | StartFailed
  ext rd runs, halts
      wr runtimes, order
  pre r in set dom runs and r not in set dom halts
  post (res = <StartFailed> and runtimes = runtimes~ and order = order~) or
       (res <> <StartFailed> and res not in set dom runtimes~ and
        runtimes = runtimes~ munion {res |-> mk_Own(s, [], nil)} and
        order = order~ ++ {r |-> order~(r) ^ [res]});
```

不读写任何状态的定义写成函数（`functions`），不写成隐式操作。

**显式函数。** 两个独立实现面对同一输入必须得出同一结果、且这个结果本身就是需求的承诺时，才写显式体；允许多个合格结果或不想绑定算法时，只写签名与 `post`。显式体用集合推导式、`inds`、`forall`/`exists` 与递归，递归配 `measure`；不写局部变量（`dcl`）、赋值（`:=`）与循环：

```vdm
  -- 产出名按字节序比较
  byteLess : OutputName * OutputName -> bool
  byteLess(a, b) ==
    if len a = 1 or len b = 1 then
      (hd a < hd b) or (hd a = hd b and len a < len b)
    else if hd a = hd b then byteLess(tl a, tl b)
    else hd a < hd b
  measure len a;
```

承载需求的纯函数写上 `post`，说出它必须满足的性质：行为从不调用纯函数，回放也不求值它们，只有 `post` 生成的证明义务会让 QuickCheck 去检查函数体。

**显式操作。** 契约里的显式操作只用于效果还没有约束的连接，体写 `is not yet specified`：

```vdm
  Stop : soroi`RunId ==> StopReply
  Stop(target) == is not yet specified;
```

不写按次序调用别的操作的场景；先后归行为。

**说明注释。** `--` 写在定义前面，记录与状态的字段说明写在同一行末尾。说明写“它是什么”，不复述类型形状；需求要求它承诺某种行为时，才在说明里写这个承诺。说明里提到的每个参数、载荷字段或状态区分，都要在定义中真实存在：不一致时删说明里多说的话，不往签名里加。

## 四、不展开也守住约束

约束要的是排除违反情形，不是把对象写完整。写任何结构之前，按下面的次序找一种不展开就能排除违反情形的写法；前一种写不出，才用后一种：

1. **身份只比较相等。** 要守住“同一个”“不是同一个”时，类型保持 `token`，约束写成身份之间的等式或映射。
2. **判定写成不展开的函数，放进谓词。** 条件的内容未定或不归本系统定时，写一个体为 `is not yet specified` 的判定函数，在 `pre`/`post` 里调用它：

   ```vdm
     -- 原始文本是否符合声明结构；结构语言不在本设计范围内
     accepts : Shape * Raw -> bool
     accepts(-, -) == is not yet specified;

     parse : Shape * Raw -> ParseResult
     parse(s, r) ==
       if accepts(s, r) then mk_Parsed(s, r) else mk_ParseError(s, r);
   ```
3. **事实写成身份之间的映射与集合。** 要记住的只是“哪些运行已写下 halt”“运行有哪些运行项”时，用 `map RunId to Trigger`、`map RunId to seq of RuntimeId`，不给实体建一个带状态字段的记录。
4. **结局只列调用方要区分的分支。** 结果写成 quote 并类型，只列合法调用方会分别处理的几支，失败原因与明细不进结果；调用方不分支的结果返回 `()` 或 `token`。违反 `pre` 的调用是准入契约之外的事，不列成结局。
5. **连接与外部依赖只留签名。** 效果还没有约束的连接、外部系统提供的连接，写签名加 `== is not yet specified`，不为它预建 `state`。
6. **数值写进 `values`。** 时限、次数写成常量；它们在什么时刻起作用归行为。

`token` 与 `is not yet specified` 是合法的终态，一直保留到有约束要求观察它的结构或规定它的结果。已经定下的约束不能藏进它们，要落到产生或使用它的操作的 `pre`/`post` 或状态的 `inv` 上。

## 五、充分与无偏差

每一处展开都要同时过两关：

- **充分：** 规格里的约束加上领域性质，合起来推出每一条需求。规格对每条约束的违反情形都要拒绝：把违反情形写成具体的值，求值时对应的 `pre`、`post` 或 `inv` 不接受它。
- **无偏差：** 规格里的每个区分，都有一串导出操作能观察到：取两个只在这一处不同的合法状态或值，某个操作的结果或能否调用要不同。观察不到的区分是把一种实现写成了承诺，删掉它或收回成 `token`；能由别的分量算出的冗余分量写成纯函数投影。

前一关决定该加什么，后一关决定该去掉什么，两关都不看形式多少。

**用 `ssot eval` 求违反实例。** 在原样规格里求值，不改 exports：

```sh
# 状态不变式：一个不属于任何运行的运行项。构造这个状态本身就被拒绝：
# VDMJ 在 mk_Records 处报 4079（Type invariant violated by mk_Records arguments）
ssot eval <design> soroi_store \
  'mk_Records({}, {|->}, {mk_token("t1") |-> mk_RefEntry(mk_token("t0"))}, {|->}, {|->})'
# 类型不变式的边界值：求得 false
ssot eval <design> soroi_store 'inv_Byte(256)'
# 纯函数的边界值：相同的名字不是严格小于，求得 false
ssot eval <design> soroi_store 'byteLess([1], [1])'
```

`pre_op(实参, 前状态)`、`post_op(实参, 结果, 前状态, 后状态)` 同样可以求。表达式求得 `false` 是正常的值，要自己判断它是不是所研究性质的反例。带 `inv` 的记录与状态，用 `mk_` 构造违反情形时 VDMJ 直接报不变式被违反，这就是拒绝；要确认报错的是你所研究的那条不变式，而不是别处的。不透明身份用 `--bind name=<模块>:<表达式>:<类型模块>:<类型名>` 在定义模块里构造，再以不透明类型绑定进来，使用方仍看不到它的结构。不要为了写得出实例而给身份加 `struct` 导出或搬家。

## 六、定义放在持有者

- **定义在持有者，只展开一处。** 一个概念定义在持有它的模块里；别的模块经 import 引用，不复制它的事实或承诺。展开了两处，它就有多重解释。
- **行为归做出行为的一方。** 一条规则由实际做出这个行为的模块持有，不由它所观察的值持有。
- **契约只承诺结果。** 只写稳定需求的结果与规律；连接不变时可以替换的实现过程、常变的业务内容留在代码里。
- **持续关系先写在持有事实的地方。** 任何时刻都成立的关系，先写在持有这份事实的状态的 `inv`，或产生它的操作的 `pre`/`post`；只有观察者本来就要按它分支或读字段时，才用类型结构让非法组合构造不出来。
- **接口自我保护。** 被业务元素或系统外调用方调用的操作是系统接口，谁都能直接调用它，绕开预期次序的调用只能由它自己的 `pre`/`post` 挡住，不能靠行为里的次序或一句“只由谁调用”。只被架构元素导入的操作是内部连接，调用方由结构授予的引用决定。
- **失败写明恢复连接。** 每个可观察的失败分支，在说明里写明调用方改走哪个连接恢复；恢复的先后由行为写。
- **名字就是词汇。** 契约里的名字是这些概念唯一的定义；行为经 `.gen/contract.qnt` 引用它们，结构的槽位不得用它们。

## 七、工具会拒绝什么

`ssot check` 把下面这些当错误：

| 规则 | 拒绝什么 |
|---|---|
| `compile.vdm` | VDMJ 的语法与类型错误，包括使用方构造或读取不透明身份 |
| `contract.body` | 显式体里出现局部可变变量、赋值或循环 |
| `contract.module` | `#contract` 元素与文件、模块名不一一对应 |
| `contract.imports` | import 越出结构授予的范围 |
| `contract.po` | QuickCheck 找到反例的证明义务（带反例） |
| `gen.unmappable` / `gen.names` | 第二节的类型与名字要求；`init` 求不出初态 |
| `replay.pre` / `replay.post` / `replay.inv` / `replay.eval` | 行为轨迹里的一次调用，在本模块的原样规格下 `pre` 或 `post` 为假、不变式被破坏或求值出错 |
| `replay.frame` | 一次调用改动了 `ext rd` 里的分量，或改动了这个操作不写的分量 |

下面这些只是提示（info），交给评审判断，不令 check 失败：`contract.po` 的 MAYBE 与未证明义务，以及 `hint.export`、`hint.single-business`、`hint.struct-unread`、`hint.string`、`hint.sampled`、`hint.state-unused`、`hint.no-ext`。计数、引用数与采样结果不是拒绝设计的依据。

## 八、评审时怎么判

只评本模块，带着 `ssot check --scope` 给出的提示逐项判断。每项先问被判断的东西服务哪条需求：没有出处的，结论是删掉或退回占位，不是补东西让它看起来被用到。

1. **展开与消费者。** 每个展开的区分都有观察者（第五节）；每个导出、导入、调用结果都有真实的消费者，或有结构里来自系统外调用方的关系。`hint.export` 与没人用的定义指出候选；确实无人需要的删掉，不为它造一个假消费者。
2. **架构与业务。** 架构模块里的每个类型、分支与规则，问：连接的提供方无论服务哪个合法使用方都必须保证它吗？只为一个业务存在的，移到那个业务；一条约束混着通用保证与某个业务附加的条件，拆成两条分别归属。`hint.single-business` 指出只被一个业务模块引用的定义。业务判定缺事实时，改连接提供的内容，不把判定搬进架构。
3. **结构化导出与身份。** 只有使用方要读字段或按分支观察的类型才带 `struct` 导出；只传递身份的保持 `token`、不带 `struct`。`hint.struct-unread` 指出没有读字段者的 `struct` 导出。使用方只能从连接取得不透明身份并原样传递，自造身份由类型检查拒绝。
4. **状态。** 状态是陈述 `inv` 与前后关系的数学模型，不是存储布局；只放本面要守住、且有观察者的源头事实；能由别的分量算出的写成纯函数投影；身份之间的事实用映射与集合；效果还没有约束的连接不预建状态。业务元素的模块不持有状态。`hint.state-unused` 指出从未被写或从未被读的分量。
5. **函数还是操作。** 不读写状态的定义是函数；`hint.no-ext` 指出没有 `ext` 的隐式操作，判断它是不是该写成函数。
6. **无类型字符串。** 身份、封闭取值（状态、种类、角色、结果）与结构化数据不用 `seq of char`；不观察内容的写 `token`，要分支的写 quote 并类型，要读字段的写记录。只原样传递或展示给人的自由文本可以是字符串。`hint.string` 指出导出类型里的 `seq of char`。
7. **恒真与不可满足。** 不写让参数看起来受约束的恒真子句，不写让一切合法调用都被禁止的条件。`hint.sampled` 指出采样里全真或全假的 `pre`/`inv`；用 `ssot eval` 找一个让它取另一个值的实例，找不到再判它是否恒真或不可满足。
8. **违反实例。** 对每个 `pre`、`post`、`inv` 和纯函数各求一个违反实例（第五节），确认规格拒绝它。结果只出现在本次评审里，不另行保存。
9. **每个分支约束全部可写分量。** 对每个隐式操作的 `post`，逐个 `or` 分支核对 `ext wr` 里的每个分量都有约束（第三节「隐式操作」）。`replay.frame` 只拦得住改动了只读分量或不写分量的调用，`ext wr` 分量在某一支漏写，只能靠逐支读出来。
10. **持有者与写法。** 逐条核对第六节：定义在持有者且只展开一处；行为归行为方；不复制别处的事实；只承诺结果；显式体只用于需求承诺的唯一结果；结局只列调用方要区分的分支；持续关系写在 `inv` 或 `pre`/`post`；系统接口自我保护；失败写明恢复连接；说明没有扩张签名。
11. **领域性质与隐含前提。** 领域性质是外部世界成立、本系统不保证的事实，各有来源；它不能写成本模块的 `inv` 冒充系统的承诺——`inv` 只写本模块的操作维持得住的关系。约束依赖的每个前提都有定义：在持有它的模块里，或者经 import 来自外部依赖的占位。规格加领域性质推不出需求时，判定是缺约束还是缺领域性质，把后者退回需求论证。
12. **每个元素都服务需求。** 每个元素、谓词项、参数与调用都能指出它服务的需求或需求所需的连接；只为通过工具而造的元素、守卫或消费者，删掉。
