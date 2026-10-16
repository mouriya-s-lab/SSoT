# 日报接入

```vdm
module Report
imports
  from Run
    types RequestNo renamed RequestNo
    operations Finish renamed Finish,
  from Submit
    types Submitted renamed Submitted
    operations Submit renamed Submit
exports
  operations Daily: RequestNo ==> ()
definitions
operations
  -- 场景：提交当天的日报，落到运行上就结束它
  Daily: RequestNo ==> ()
  Daily(request) ==
    cases Submit(request):
      mk_Submitted(run) -> Finish(run),
      <Rejected> -> skip
    end;
end Report
```
