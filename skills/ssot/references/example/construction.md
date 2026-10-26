# 示例设计是怎样选出来的

[`design/`](design/) 是选好之后的结果。本文从同一份需求出发，先写出一版照编程习惯写的模型，再用两条判据（总纲第一节：充分与无偏差）和工具，一步步看它哪里多了、哪里少了，最后得到 `design/`。每一步的工具输出都在这份模型上实际跑过。

## 一、需求与领域性质

需求：

- 调用方用同一个请求号重复开始运行，系统只产生一次运行。
- 开始的结果未知时，调用方能按请求号找回运行并结束它。
- 进程崩溃后，新进程接管仍未结束的运行。
- 记下每次尝试的结局，判定哪些运行需要找回。

领域性质（外部世界本身成立，本系统不保证）：

- W1：上游超时之后仍可能已经开始了运行（上游接口说明）。
- W2：调用方会用同一个请求号重试。

第一条需求的论证：W2 让同一个请求号会到达多次；约束“同一请求号至多对应一个运行”加上 W2，推出“重复开始只产生一次运行”。第二条要用到 W1：没有 W1，结果未知这一支就没有理由存在。

## 二、第一版：照编程习惯写

第一版在运行表里多记了一个计数，`Status` 只区分“有运行”与“没有”，尝试的日志只追加：

```vdm
state Runs of
  byRequest : map RequestNo to RunId  -- 请求号到它产生的运行
  live : set of RunId  -- 已开始、尚未结束的运行
  attempts : nat  -- 调用过开始的次数
  inv mk_Runs(b, l, -) == l subset rng b
  init r == r = mk_Runs({|->}, {}, 0)
end

  Start(request: RequestNo) r: StartOutcome
  ext wr byRequest wr live wr attempts
  post attempts = attempts~ + 1 and ( … )

  StatusOutcome = RunId | <Absent>;

state Log of
  entries : seq of Entry  -- 按追加次序排列的尝试
  init l == l = mk_Log([])
end
```

`ssot check` 通过：类型检查没有错误，QuickCheck 没有找到反例。类型与证明义务只检查模型自洽，不检查模型里有没有多余的区分。

## 三、无偏差：哪些区分没有观察者

工具的静态检查报出两处（`ssot design elements` 报错，`ssot verify elements` 报警告）：

- `Run`Runs.attempts`：没有任何定义读到它，它只被自己的更新式 `attempts = attempts~ + 1` 改写。两个只在 `attempts` 上不同的运行表，任何一串操作的结果都一样。删掉它。
- `Attempt`Log.entries`：同样只被 `Record` 追加，没有任何导出操作读它；导出的 `Unresolved` 是一个函数，算的是传进来的序列，与日志无关。

这两处的处理不同。`attempts` 背后没有需求，直接删掉。`entries` 背后有需求（“判定哪些运行需要找回”），问题出在规格缺了读它的连接：加一个导出操作 `Pending`，按日志算出需要找回的运行。日志从此有了观察者，“只追加”这条性质也随之可以观察。

工具没有报 `Run`Runs.live`：`Start` 的一支和状态的 `inv` 都读到了它。读到不等于能区分，“没有报”也不说明它无偏差，这一处要人去判（验证方在 `bias` 里判，作者写设计时同样要问）：取两个只在 `live` 上不同的运行表，`Status` 只看 `byRequest`，`Start` 交回的结果也不看 `live`，`Finish` 没有结果。找不到区分它们的导出操作，它是偏差。

## 四、充分：缺的是哪个观察

`live` 是偏差，但不能就此删掉。第三条需求的论证要求新进程知道哪些运行仍未结束，第一版里没有任何连接交出这个区分：规格加上领域性质推不出这条需求。

把这条需求落成草稿约束 C2：“按请求号找回时交回的运行一定尚未结束”，用 `ssot design attack` 攻第一版。`call` 一槽构造出反例，VDMJ 求值确认第一版的 `post_Status` 允许它：

```yaml
call:
  verdict: counterexample
  reason: 运行 1 已经结束（不在 live 里），Status 仍把它当作活着的运行交回
  witness:
    operation: "Run`Status"
    args: ["1"]
    result: "mk_token(1)"
    before: "mk_Runs({1 |-> mk_token(1)}, {}, 0)"
    after: "mk_Runs({1 |-> mk_token(1)}, {}, 0)"
    violates: "result = before.byRequest(1) and before.byRequest(1) not in set before.live"
```

修法是补上观察它的连接，而不是删掉事实：

```vdm
  StatusOutcome = RunId | <Finished> | <Absent>;

  Status(request: RequestNo) r: StatusOutcome
  ext rd byRequest rd live
  post (request in set dom byRequest and byRequest(request) in set live and r = byRequest(request))
       or (request in set dom byRequest and byRequest(request) not in set live and r = <Finished>)
       or (request not in set dom byRequest and r = <Absent>);
```

现在 `Status` 能区分只在 `live` 上不同的两个运行表，`live` 不再是偏差；第三条需求由“新进程对每个请求号调用 `Status`，接管仍未结束的运行”推出，写进 `architecture/README.md` 的「语义」。把同一个反例（去掉已删除的 `attempts` 分量）再交给 `ssot design attack`，VDMJ 求值为 false：修改后的 `post_Status` 不允许把已经结束的运行当作活着的交回，反例不成立。

“同一请求号至多对应一个运行”落在 `Start` 的 `post`。把它的违反情形写成具体的值，工具求值确认 `post` 拒绝它：

```yaml
rejects:
  - by: post
    operation: "Run`Start"
    args: ["1"]
    result: "mk_Started(mk_token(2))"
    before: "mk_Runs({1 |-> mk_token(1)}, {mk_token(1)})"
    after: "mk_Runs({1 |-> mk_token(2)}, {mk_token(2)})"
    violates: "result.run <> before.byRequest(1)"
```

## 五、需求反转：同一个字段什么时候该留

再加一条需求：“审计方能查询任一运行的开始时刻。”这时给运行记下开始时刻就不是偏差：只要有一个导出的查询操作交回它，两个只在开始时刻上不同的运行表就能被区分，第三节里删掉 `attempts` 的理由不再成立。判据没有变，变的是需求：有观察者的区分就留下，没有的就删掉，与字段多少无关。

另一个方向也一样：`Run`Started` 带 `struct` 导出，系统外的调用方读得到它的字段，工具不判它不可观察。`Started.run` 留着，是因为调用方要拿它去调用 `Finish`。
