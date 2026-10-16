# 提交

```vdm
module Submit
imports
  from Run
    types RequestNo renamed RequestNo; RunId renamed RunId; Started renamed Started
    operations Start renamed Start; Status renamed Status,
  from Attempt
    types Entry renamed Entry
    operations Record renamed Record
exports
  types struct Submitted; struct SubmitOutcome
  operations Submit: RequestNo ==> SubmitOutcome
definitions
types
  -- 提交落到了一次运行上，这次尝试已经记下；调用方之后必须用 Run 的 Finish 结束这次运行
  Submitted ::
    run : RunId;  -- 提交落到的运行

  -- Submit 的结局：使用方只区分落到运行与被拒绝；结果未知在提交内部按请求号找回，不交给使用方
  SubmitOutcome = Submitted | <Rejected>;

operations
  -- 连接点：开始运行并记下尝试；开始的结果未知时按请求号找回，找不回就算被拒绝
  Submit: RequestNo ==> SubmitOutcome
  Submit(request) ==
    cases Start(request):
      mk_Started(run) -> (Record(mk_Entry(run, <Accepted>)); return mk_Submitted(run)),
      <Rejected> -> return <Rejected>,
      others ->  -- 剩下的一支是结果未知
        let found = Status(request) in
          if found <> <Absent>
          then (Record(mk_Entry(found, <Unknown>)); return mk_Submitted(found))
          else return <Rejected>
    end;
end Submit
```
