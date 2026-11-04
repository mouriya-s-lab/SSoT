// 担心：停机或 daemon 崩溃之后，一个运行项的结束可能在它的闭包里还有执行时就被写下（REQ-55），
// 或者已退出的 daemon 发出的 launch 在闭包关闭之后才到达执行边界、却被接纳（REQ-24）。
// 盒子：使用方 caller、停机过程 halting、daemon 的崩溃环境 epoch，契约盒子 soroi_store、soroi_workspace；
// 闭包过程是一串顺接的步骤（open → launch → collect → close → end），每一步从它的输入线取一个值、调用端口、
// 把结果放到下一步的输入线上。每个 var 是一条带延迟的线；先后只来自线上的值，不记“走到哪一步”。
module winddown {
  import contract.* from "../.gen/contract"
  import Vdm.* from "../.gen/contract"
  import soroi_store as Store from "../.gen/contract"
  import soroi_workspace as Ws from "../.gen/contract"

  pure val RUNS = Set("r1", "r2")
  pure val RT_IDS = Set("t1", "t2", "t3")
  pure val EXEC_IDS = Set("x1", "x2", "x3")

  // 使用方只认得它拿到的 RunId。
  type Caller = { runs: Set[Store::RunId], stops: Set[Store::RunId] }

  var store: Store::Records
  var ws: Ws::Closures
  var caller: Caller
  var halting: Store::RunId -> Store::Trigger
  // daemon 的第几次运行；崩溃让它加一。
  var epoch: int
  // 在途的 launch：发出它的 daemon 是第几次运行。跨崩溃留下。
  var inflight: Set[(Store::RuntimeId, Ws::ExecRef, int)]
  // 闭包过程各步之间的线（daemon 进程内，崩溃时消失）。
  var toOpen: Set[Store::RuntimeId]
  var toLaunch: Set[Store::RuntimeId]
  var awaiting: Set[(Store::RuntimeId, Ws::ExecRef)]
  var toCollect: Set[(Store::RuntimeId, Ws::ExecRef)]
  var toClose: Set[Store::RuntimeId]
  var toEnd: Set[Store::RuntimeId]
  var lastCall: Call

  pure def without(m: str -> a, k: str): str -> a = m.keys().exclude(Set(k)).mapBy(j => m.get(j))
  pure def dropPair(s: Set[(str, str)], rt: str): Set[(str, str)] = s.filter(p => p._1 != rt)

  def runOf(rt: Store::RuntimeId): Store::RunId = store.runtimes.get(rt)
  def ended(rt: Store::RuntimeId): bool = rt.in(store.ends.keys())
  def stopping(r: Store::RunId): bool = r.in(halting.keys())
  def running(rt: Store::RuntimeId): bool = not(stopping(runOf(rt)))
  // 这个运行项在 daemon 进程里还有闭包过程：它的值还在某条进程内的线上。
  def held(rt: Store::RuntimeId): bool =
    rt.in(toOpen.union(toLaunch).union(toClose).union(toEnd)) or
    awaiting.exists(p => p._1 == rt) or toCollect.exists(p => p._1 == rt)
  def busyExecs: Set[Ws::ExecRef] = ws.running.keys().union(inflight.map(p => p._2))

  // ---------- 契约盒子的反馈线按 VDM post 前进 ----------
  pure def storeAfter(s: Store::Records, call: Call): Store::Records = match call {
    | soroi_store(op) => match op {
        | writeRun(a) => { ...s, runs: s.runs.union(Set(a.r)) }
        | writeStart(a) => { ...s, runtimes: s.runtimes.put(a.result, a.r) }
        | writeEnd(a) => { ...s, ends: s.ends.put(a.rt, a.o) }
        | writeHalt(a) => { ...s, halts: s.halts.put(a.r, a.t) }
      }
    | _ => s
  }

  pure def workspaceAfter(s: Ws::Closures, call: Call): Ws::Closures = match call {
    | soroi_workspace(op) => match op {
        | open(a) => { ...s, opened: s.opened.union(Set(a.rt)) }
        | launch(a) => match a.result {
            | Launch_Result_ExecRef(x) => { ...s, running: s.running.put(x, a.rt) }
            | Launch_Result_Rejected(_) => s
          }
        | collect(a) => { ...s, running: without(s.running, a.x) }
        | close(a) => { ...s, closed: s.closed.union(Set(a.rt)),
            running: s.running.keys().filter(x => s.running.get(x) != a.rt).mapBy(x => s.running.get(x)) }
      }
    | _ => s
  }

  action commit(call: Call): bool = all {
    lastCall' = call,
    store' = storeAfter(store, call),
    ws' = workspaceAfter(ws, call),
  }

  // 进程内的线都不变。
  action processWiresUnchanged = all {
    toOpen' = toOpen, toLaunch' = toLaunch, awaiting' = awaiting,
    toCollect' = toCollect, toClose' = toClose, toEnd' = toEnd,
  }

  action init = all {
    store' = Store::initial,
    ws' = Ws::initial,
    caller' = { runs: Set(), stops: Set() },
    halting' = Map(),
    epoch' = 0,
    inflight' = Set(),
    toOpen' = Set(), toLaunch' = Set(), awaiting' = Set(), toCollect' = Set(), toClose' = Set(), toEnd' = Set(),
    lastCall' = NoCall,
  }

  // ---------- 使用方 ----------
  action startRun(r: Store::RunId): bool = all {
    not(r.in(store.runs)),
    caller' = { ...caller, runs: caller.runs.union(Set(r)) },
    halting' = halting, epoch' = epoch, inflight' = inflight, processWiresUnchanged,
    commit(soroi_store(Store::writeRun({ r: r }))),
  }

  action requestStop(r: Store::RunId): bool = all {
    r.in(caller.runs),
    not(r.in(caller.stops)),
    caller' = { ...caller, stops: caller.stops.union(Set(r)) },
    halting' = halting, epoch' = epoch, inflight' = inflight, processWiresUnchanged,
    commit(NoCall),
  }

  // ---------- 闭包过程：顺接的五步 ----------
  // REQ-54：停机开始后不再为该运行准入；writeStart 返回的 RuntimeId 进入闭包过程的第一条线。
  action startRuntime(r: Store::RunId, rt: Store::RuntimeId): bool = all {
    r.in(store.runs),
    not(r.in(store.halts.keys())),
    not(stopping(r)),
    not(rt.in(store.runtimes.keys())),
    toOpen' = toOpen.union(Set(rt)),
    toLaunch' = toLaunch, awaiting' = awaiting, toCollect' = toCollect, toClose' = toClose, toEnd' = toEnd,
    caller' = caller, halting' = halting, epoch' = epoch, inflight' = inflight,
    commit(soroi_store(Store::writeStart({ r: r, result: rt }))),
  }

  action closureOpen(rt: Store::RuntimeId): bool = all {
    rt.in(toOpen),
    running(rt),
    toOpen' = toOpen.exclude(Set(rt)),
    toLaunch' = toLaunch.union(Set(rt)),
    awaiting' = awaiting, toCollect' = toCollect, toClose' = toClose, toEnd' = toEnd,
    caller' = caller, halting' = halting, epoch' = epoch, inflight' = inflight,
    commit(soroi_workspace(Ws::open({ rt: rt }))),
  }

  // 发出 body 的 launch：请求进入在途，带上发出它的 daemon 是第几次运行。
  action closureLaunch(rt: Store::RuntimeId, x: Ws::ExecRef): bool = all {
    rt.in(toLaunch),
    running(rt),
    not(x.in(busyExecs)),
    toLaunch' = toLaunch.exclude(Set(rt)),
    awaiting' = awaiting.union(Set((rt, x))),
    inflight' = inflight.union(Set((rt, x, epoch))),
    toOpen' = toOpen, toCollect' = toCollect, toClose' = toClose, toEnd' = toEnd,
    caller' = caller, halting' = halting, epoch' = epoch,
    commit(NoCall),
  }

  action closureCollect(rt: Store::RuntimeId, x: Ws::ExecRef): bool = all {
    (rt, x).in(toCollect),
    running(rt),
    toCollect' = toCollect.exclude(Set((rt, x))),
    toClose' = toClose.union(Set(rt)),
    toOpen' = toOpen, toLaunch' = toLaunch, awaiting' = awaiting, toEnd' = toEnd,
    caller' = caller, halting' = halting, epoch' = epoch, inflight' = inflight,
    commit(soroi_workspace(Ws::collect({ rt: rt, x: x }))),
  }

  // REQ-55：自然收束等 body 结束（或 launch 被拒）之后再关闭闭包。
  action closureClose(rt: Store::RuntimeId): bool = all {
    rt.in(toClose),
    running(rt),
    toClose' = toClose.exclude(Set(rt)),
    toEnd' = toEnd.union(Set(rt)),
    toOpen' = toOpen, toLaunch' = toLaunch, awaiting' = awaiting, toCollect' = toCollect,
    caller' = caller, halting' = halting, epoch' = epoch, inflight' = inflight,
    commit(soroi_workspace(Ws::close({ rt: rt }))),
  }

  // REQ-55：运行项的结束在闭包关闭之后写下。
  action closureEnd(rt: Store::RuntimeId): bool = all {
    rt.in(toEnd),
    running(rt),
    toEnd' = toEnd.exclude(Set(rt)),
    toOpen' = toOpen, toLaunch' = toLaunch, awaiting' = awaiting, toCollect' = toCollect, toClose' = toClose,
    caller' = caller, halting' = halting, epoch' = epoch, inflight' = inflight,
    commit(soroi_store(Store::writeEnd({ rt: rt, o: Store::Outcome_Settled }))),
  }

  // ---------- 在途 launch：执行边界随时给出回复；发出它的 daemon 可能已经退出 ----------
  // REQ-24：关闭已记下时回复 Rejected；未关闭时执行边界也可以拒绝。回复只交给仍在等它的闭包过程。
  action answerLaunch(rt: Store::RuntimeId, x: Ws::ExecRef, e: int, accept: bool): bool = all {
    (rt, x, e).in(inflight),
    val res = if (rt.in(ws.closed) or not(accept)) Ws::Launch_Result_Rejected(Ws::Rejected_Rejected)
              else Ws::Launch_Result_ExecRef(x)
    val waiting = e == epoch and (rt, x).in(awaiting)
    all {
      inflight' = inflight.exclude(Set((rt, x, e))),
      awaiting' = if (waiting) awaiting.exclude(Set((rt, x))) else awaiting,
      toCollect' = if (waiting and res == Ws::Launch_Result_ExecRef(x)) toCollect.union(Set((rt, x))) else toCollect,
      toClose' = if (waiting and res != Ws::Launch_Result_ExecRef(x)) toClose.union(Set(rt)) else toClose,
      toOpen' = toOpen, toLaunch' = toLaunch, toEnd' = toEnd,
      caller' = caller, halting' = halting, epoch' = epoch,
      commit(soroi_workspace(Ws::launch({ rt: rt, x: x, result: res }))),
    }
  }

  // ---------- 停机过程 ----------
  action beginStop(r: Store::RunId): bool = all {
    r.in(caller.stops),
    not(stopping(r)),
    not(r.in(store.halts.keys())),
    halting' = halting.put(r, "Manual"),
    caller' = { ...caller, stops: caller.stops.exclude(Set(r)) },
    epoch' = epoch, inflight' = inflight, processWiresUnchanged,
    commit(NoCall),
  }

  // REQ-58：崩溃之后，还没有写下 halt 的运行若有无人收束的运行项，或已有由停机写下的结束，由 DaemonLost 停机收束。
  action daemonLost(r: Store::RunId): bool = all {
    r.in(store.runs),
    not(stopping(r)),
    not(r.in(store.halts.keys())),
    store.runtimes.keys().exists(rt => runOf(rt) == r and (
      (not(ended(rt)) and not(held(rt))) or
      (ended(rt) and store.ends.get(rt) == Store::Outcome_Halted))),
    halting' = halting.put(r, "DaemonLost"),
    caller' = caller, epoch' = epoch, inflight' = inflight, processWiresUnchanged,
    commit(NoCall),
  }

  // 停机接管一个运行项：它的值从闭包过程的各条线上撤下。
  action dropFromProcess(rt: Store::RuntimeId): bool = all {
    toOpen' = toOpen.exclude(Set(rt)), toLaunch' = toLaunch.exclude(Set(rt)),
    awaiting' = dropPair(awaiting, rt), toCollect' = dropPair(toCollect, rt),
    toClose' = toClose.exclude(Set(rt)), toEnd' = toEnd.exclude(Set(rt)),
  }

  // REQ-55：停机不等执行自行结束，直接请执行边界关闭闭包；闭包过程随之结束。
  action haltClose(rt: Store::RuntimeId): bool = all {
    rt.in(store.runtimes.keys()),
    stopping(runOf(rt)),
    not(ended(rt)),
    rt.in(ws.opened),
    not(rt.in(ws.closed)),
    dropFromProcess(rt),
    caller' = caller, halting' = halting, epoch' = epoch, inflight' = inflight,
    commit(soroi_workspace(Ws::close({ rt: rt }))),
  }

  action haltEnd(rt: Store::RuntimeId): bool = all {
    rt.in(store.runtimes.keys()),
    stopping(runOf(rt)),
    not(ended(rt)),
    not(rt.in(ws.opened)) or rt.in(ws.closed),
    dropFromProcess(rt),
    caller' = caller, halting' = halting, epoch' = epoch, inflight' = inflight,
    commit(soroi_store(Store::writeEnd({ rt: rt, o: Store::Outcome_Halted }))),
  }

  // REQ-57：全部运行项都有结束之后写下运行的停机锚点。
  action haltAnchor(r: Store::RunId): bool = all {
    stopping(r),
    store.runtimes.keys().forall(rt => runOf(rt) == r implies ended(rt)),
    halting' = without(halting, r),
    caller' = caller, epoch' = epoch, inflight' = inflight, processWiresUnchanged,
    commit(soroi_store(Store::writeHalt({ r: r, t: halting.get(r) }))),
  }

  // ---------- 崩溃环境：daemon 退出并重启。进程内的线与停机过程消失；事实源头、执行边界与在途请求留下 ----------
  action crash = all {
    epoch' = epoch + 1,
    halting' = Map(),
    toOpen' = Set(), toLaunch' = Set(), awaiting' = Set(), toCollect' = Set(), toClose' = Set(), toEnd' = Set(),
    caller' = caller, inflight' = inflight,
    commit(NoCall),
  }

  action step = {
    nondet r = RUNS.oneOf()
    nondet rt = RT_IDS.oneOf()
    nondet x = EXEC_IDS.oneOf()
    nondet accept = Set(true, false).oneOf()
    nondet req = inflight.union(Set(("", "", -1))).oneOf()
    nondet roll = 1.to(8).oneOf()
    any {
      startRun(r), startRuntime(r, rt),
      closureOpen(rt), closureLaunch(rt, x), closureCollect(rt, x), closureClose(rt), closureEnd(rt),
      answerLaunch(req._1, req._2, req._3, accept),
      beginStop(r), daemonLost(r), haltClose(rt), haltEnd(rt), haltAnchor(r),
      all { roll == 1, requestStop(r) },
      all { roll == 2, epoch < 2, crash },
    }
  }

  // ---------- 性质：写在对外可观察的线上 ----------
  // REQ-55：一个运行项的结束写下时，它的闭包里没有仍在运行的执行。
  val noExecAfterEnd = ws.running.keys().forall(x => not(ended(ws.running.get(x))))
  // REQ-55：打开过闭包的运行项，结束写下时闭包已经关闭。
  val endAfterClose = store.ends.keys().forall(rt => rt.in(ws.opened) implies rt.in(ws.closed))
  val safety = noExecAfterEnd and endAfterClose

  // ---------- 覆盖目标：说明模型确实走到了这些情形 ----------
  val witnessSettled = store.ends.keys().exists(rt => store.ends.get(rt) == Store::Outcome_Settled)
  val witnessManualHalt = store.halts.keys().exists(r => store.halts.get(r) == "Manual")
  val witnessDaemonLostHalt = store.halts.keys().exists(r => store.halts.get(r) == "DaemonLost")
  pure val maxSteps_witnessDaemonLostHalt = 40
  // REQ-24：已退出的 daemon 发出的 launch 还在途，它的闭包已经关闭。
  val witnessLateLaunchAfterClose = inflight.exists(p => p._3 < epoch and p._1.in(ws.closed))
  pure val maxSteps_witnessLateLaunchAfterClose = 40
  // REQ-58：停机已为每个运行项写下结束、还没写锚点时崩溃：运行全部结束、带着停机的结束，却既没有锚点也没有停机过程。
  val witnessCrashBeforeAnchor = RUNS.exists(r => r.in(store.runs) and not(r.in(store.halts.keys())) and not(stopping(r)) and
    store.runtimes.keys().exists(rt => runOf(rt) == r and ended(rt) and store.ends.get(rt) == Store::Outcome_Halted) and
    store.runtimes.keys().forall(rt => runOf(rt) == r implies ended(rt)))
  pure val maxSteps_witnessCrashBeforeAnchor = 40
}
