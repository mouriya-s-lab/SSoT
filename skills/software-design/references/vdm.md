# VDM-SL 写法范例

本文的规格都取自一份通过 `check` 的设计，演示 SKILL.md「规格：VDM-SL」各条怎样落到 VDM-SL。范例只演示写法，不规定领域的名字。

## 文学式文件

一个 `.tex` 文件以 LaTeX 标题开头，文字写在规格块外面，规格写在 `vdm_al` 环境里。一个文件至多一个具名模块。

```latex
\subsection{运行连接}

本模块拥有运行表；开始、找回与结束运行都经过它。

\begin{vdm_al}
module Run
...
end Run
\end{vdm_al}
```

`README.tex` 以 `\section{模块名}` 开头，接负责范围的一段，再按固定小节写。文字用 `\vdmref` 指认规格元素：

```latex
\section{运行}

负责开始、找回与结束运行，并记下每次尝试的结局；不负责运行内部做什么。

\subsection{依据}

上游在超时后仍可能已经开始运行（来源：示例），所以 \vdmref{Run`StartOutcome} 有结果未知一支，恢复走 \vdmref{Run`Status}。

\subsection{语义}

\vdmref{Run`Recover} 每 30 秒最多重试一次 \vdmref{Run`Status}；进程崩溃后由新进程按 \vdmref{Run`Runs.byRequest} 接管。
```

定时与崩溃后的接管在 VDM-SL 里没有直接表达，所以写在「语义」，但每个被提到的东西都是规格里的名字。

## 连接面、结局、不承诺与生命周期

```vdm
module Run
exports
  types RunId; struct Started; struct StartOutcome; struct StatusOutcome
  operations
    Start: nat ==> StartOutcome;
    Status: nat ==> StatusOutcome;
    Finish: RunId ==> ();
    Recover: nat ==> ()
definitions
types
  -- 一次运行的身份；提供方造出，使用方不读结构
  RunId = token;

  -- 运行已经开始；调用方之后必须用 Finish 结束它
  Started ::
    run : RunId;  -- 结束时交回的身份

  -- Start 的结局：使用方必须区分已开始、被拒绝与结果未知；结果未知时改用 Status 找回
  StartOutcome = Started | <Rejected> | <Unknown>;

  -- Status 的结局：按请求号找回的运行，或确认它不存在
  StatusOutcome = RunId | <Absent>;

  -- 运行表：同一请求号至多对应一次运行，活着的运行都来自某个请求
state Runs of
  byRequest : map nat to RunId  -- 请求号到它产生的运行
  live : set of RunId  -- 已开始、尚未结束的运行
  inv mk_Runs(b, l) == l subset rng b
  init r == r = mk_Runs({|->}, {})
end

operations
  -- 开始一次运行；同一请求号重复开始只产生一次运行
  Start(request: nat) r: StartOutcome
  ext wr byRequest wr live
  post (is_Started(r)
          and (request in set dom byRequest~ => r.run = byRequest~(request))
          and byRequest = byRequest~ ++ {request |-> r.run}
          and live = live~ union {r.run})
       or ((r = <Rejected> or r = <Unknown>) and byRequest = byRequest~ and live = live~);

  -- 按请求号确认运行是否存在；只读，不改变运行表
  Status(request: nat) r: StatusOutcome
  ext rd byRequest
  post (request in set dom byRequest and r = byRequest(request))
       or (request not in set dom byRequest and r = <Absent>);

  -- 结束一次运行；结束两次与一次效果相同
  Finish(run: RunId)
  ext wr live
  post live = live~ \ {run};

  -- 场景：开始的结果未知时，按请求号找回运行并结束它
  Recover: nat ==> ()
  Recover(request) ==
    cases Start(request):
      mk_Started(run) -> Finish(run),
      <Rejected> -> skip,
      <Unknown> ->
        let found = Status(request) in
          if found <> <Absent> then Finish(found)
    end;
end Run
```

- **连接面**：`Start`、`Status`、`Finish` 共享状态 `Runs` 与它的不变式，所以写在同一模块；不变式就是这个面共享的那条规则。
- **结局**：`StartOutcome` 只有使用方必须区分的三支。结果未知是一支，它的说明写出恢复要走 `Status`。
- **不承诺**：`RunId` 不带 `struct` 导出，使用方拿不到它的结构，也造不出它。需要使用方读或造的类型才带 `struct`。
- **准入定律**：幂等写成后置条件（同一请求号得到同一运行；`Finish` 两次与一次效果相同）。签名对得上的实现，后置条件不成立也不能接入。
- **生命周期**：开始锚点是 `Start` 把运行加入 `live`，结束锚点是 `Finish` 把它移出；确认者写在操作的说明里。
- **隐式优先**：三个连接只有 `pre`/`post`，不写怎么做。只有场景 `Recover` 有显式体，因为它要按次序调用连接。

## 只追加的记录与依赖方向

```vdm
module Attempt
imports from Run types RunId renamed RunId
exports
  types struct Entry
  operations Record: Entry ==> ()
definitions
types
  -- 一条执行事实：只追加，永不改写为从未发生
  Entry ::
    run : RunId  -- 这次尝试属于哪次运行
    outcome : <Accepted> | <Rejected> | <Unknown>;  -- 上游给出的结局，或结果未知

  -- 执行事实日志
state Log of
  entries : seq of Entry  -- 按追加次序排列的执行事实
  init l == l = mk_Log([])
end

operations
  -- 追加一条执行事实；已有的记录不变
  Record(e: Entry)
  ext wr entries
  post entries = entries~ ^ [e];
end Attempt
```

- **只追加**是后置条件：旧日志是新日志的前缀。存储怎样实现追加属于实现。
- **记录字段**之间不加分号，分号结束整个类型定义；每个字段在行末写说明。
- **依赖方向**：`Attempt` 在 `architecture/attempt/`，是 `Run` 所在根模块的子模块，所以它可以 import `Run`；`Run` 不能反过来 import `Attempt`。

## 值代数与判定

```vdm
module Values
exports all
definitions
types
  -- 值的结构：预先声明，运行前用它检查接线
  Shape = <Text> | <Int> | ListShape | RecordShape;

  -- 同一结构的有序列表
  ListShape ::
    item : Shape;  -- 每个元素的结构

  -- 字段齐全的记录
  RecordShape ::
    fields : map seq1 of char to Shape;  -- 字段名到字段结构

  -- 符合某个结构的值；每个值恰好一种
  Value = seq of char | int | seq of Value | map seq1 of char to Value;

functions
  -- 值是否符合结构；两个实现必须给出同一判定，所以写显式体
  Conforms: Value * Shape -> bool
  Conforms(v, s) ==
    cases s:
      <Text> -> is_(v, seq of char),
      <Int> -> is_(v, int),
      mk_ListShape(i) -> is_(v, seq of Value) and forall x in set elems v & Conforms(x, i),
      mk_RecordShape(f) -> is_(v, map seq1 of char to Value) and dom v = dom f
                             and forall k in set dom f & Conforms(v(k), f(k))
    end;
end Values
```

- 闭合的结构树用递归的并类型写。
- `Conforms` 是设计决定本身（两个实现必须得出同一判定），所以写显式体；它只表达判定，不规定实现用什么数据结构。
- 递归函数没有 `measure` 时 VDMJ 给提示，check 不因此失败；终止性要紧时补上度量函数。

## 业务单元的场景

```vdm
module Report
imports
  from Run types Started renamed Started operations Start renamed Start; Finish renamed Finish,
  from Attempt types Entry renamed Entry operations Record renamed Record
exports all
definitions
operations
  -- 场景：开始一次报表运行，记下被接受的尝试，再结束它
  Daily: nat ==> ()
  Daily(request) ==
    cases Start(request):
      mk_Started(run) -> (Record(mk_Entry(run, <Accepted>)); Finish(run)),
      others -> skip
    end;
end Report
```

- 业务单元只 import 架构导出的操作与类型；它拿不到 `RunId` 的结构，只能把 `Start` 交回的身份原样交给 `Finish`。
- 场景走不通时，类型检查或证明义务会指出哪一步：结局名写错是类型错误，前置条件可能不成立是一条证明义务。

## 读 check 的输出

- 类型错误与结构违规逐条给出 `文件:行`，行号就是 `.tex` 里的行。
- “未定”的证明义务是 QuickCheck 既没证明也没找到反例的命题，例如操作的可满足性。逐条判断：它成立，就保留；它可能不成立，就是规格少了前置条件或不变式。
- QuickCheck 找到反例时 check 失败，并给出反例的取值。
