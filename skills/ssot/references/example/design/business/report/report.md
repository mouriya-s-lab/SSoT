# 日报接入

```vdm
module Report
imports
  from Run
    types RequestNo renamed RequestNo; Started renamed Started
    operations Start renamed Start; Finish renamed Finish,
  from Attempt
    types Entry renamed Entry
    operations Record renamed Record
exports
  types struct DailyOutcome
  operations Daily: RequestNo ==> DailyOutcome
definitions
types
  -- 日报运行的结局：调用方要区分已记下、被拒绝与结果未知；结果未知时改用 Run`Recover 按请求号找回
  DailyOutcome = <Recorded> | <Rejected> | <Unknown>;

operations
  -- 场景：开始当天的日报运行，记下被接受的尝试，再结束它；没有开始成的结局原样交给调用方（Start 的结局除去前两支只剩结果未知，由 others 接住）
  Daily: RequestNo ==> DailyOutcome
  Daily(request) ==
    cases Start(request):
      mk_Started(run) -> (Record(mk_Entry(run, <Accepted>)); Finish(run); return <Recorded>),
      <Rejected> -> return <Rejected>,
      others -> return <Unknown>
    end;
end Report
```
