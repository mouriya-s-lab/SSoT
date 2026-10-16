# 运行连接

```vdm
module Run
exports
  types RunId; struct RequestNo; struct Started; struct StartOutcome; struct StatusOutcome
  values RetrySeconds : nat1
  operations
    Start: RequestNo ==> StartOutcome;
    Status: RequestNo ==> StatusOutcome;
    Finish: RunId ==> ();
    Recover: RequestNo ==> ()
definitions
values
  -- 结果未知之后，两次找回之间至少相隔的秒数
  RetrySeconds : nat1 = 30;

types
  -- 一次运行的身份；提供方造出，使用方不读结构
  RunId = token;

  -- 调用方给出的请求号，从 1 开始；同一请求号代表同一次请求
  RequestNo = nat
  inv r == r > 0;

  -- 运行已经开始；调用方之后必须用 Finish 结束它
  Started ::
    run : RunId;  -- 结束时交回的身份

  -- Start 的结局：使用方必须区分已开始、被拒绝与结果未知；结果未知时改用 Status 找回
  StartOutcome = Started | <Rejected> | <Unknown>;

  -- Status 的结局：按请求号找回的运行，或确认它不存在
  StatusOutcome = RunId | <Absent>;

  -- 运行表：同一请求号至多对应一次运行，活着的运行都来自某个请求
state Runs of
  byRequest : map RequestNo to RunId  -- 请求号到它产生的运行
  live : set of RunId  -- 已开始、尚未结束的运行
  inv mk_Runs(b, l) == l subset rng b
  init r == r = mk_Runs({|->}, {})
end

operations
  -- 开始一次运行；同一请求号重复开始只产生一次运行
  Start(request: RequestNo) r: StartOutcome
  ext wr byRequest wr live
  post (is_Started(r)
          and (request in set dom byRequest~ => r.run = byRequest~(request))
          and byRequest = byRequest~ ++ {request |-> r.run}
          and live = live~ union {r.run})
       or ((r = <Rejected> or r = <Unknown>) and byRequest = byRequest~ and live = live~);

  -- 按请求号确认运行是否存在；只读，不改变运行表
  Status(request: RequestNo) r: StatusOutcome
  ext rd byRequest
  post (request in set dom byRequest and r = byRequest(request))
       or (request not in set dom byRequest and r = <Absent>);

  -- 结束一次运行；结束两次与一次效果相同
  Finish(run: RunId)
  ext wr live
  post live = live~ \ {run};

  -- 场景：开始的结果未知时，按请求号找回运行并结束它
  Recover: RequestNo ==> ()
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
