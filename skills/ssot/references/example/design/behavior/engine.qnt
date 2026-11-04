// 行为层：跨连接的次序、交错、停机与崩溃收束。
// 类型、操作与两个契约状态（事实源头的 Records、执行边界的 Closures）都来自 .gen/contract.qnt（由 design/contract 生成）。
// 代表契约调用的步骤经 commit 把 Call 写进 lastCall，并按该操作的 VDM post 更新 store/ws；
// 检查器把每次调用连同前后状态回放进 VDMJ，比对 pre/post。
// 其余变量只持有过程、请求与调度状态，不复制契约状态。
module engine {
  import contract.* from "../.gen/contract"
  import Vdm.* from "../.gen/contract"
  import soroi_store as Store from "../.gen/contract"
  import soroi_workspace as Ws from "../.gen/contract"
  import soroi_engine_control as Control from "../.gen/contract"
  import soroi_engine_derivation as Derivation from "../.gen/contract"
  import soroi as Shared from "../.gen/contract"

  // ---------- 有界常量 ----------
  pure val RUNS = Set("r1", "r2")
  pure val RT_IDS = ["t1", "t2", "t3", "t4", "t5"]
  pure val EXEC_IDS = [
    "x1", "x2", "x3", "x4", "x5", "x6", "x7", "x8", "x9", "x10",
    "x11", "x12", "x13", "x14", "x15", "x16", "x17", "x18", "x19", "x20",
    "x21", "x22", "x23", "x24", "x25", "x26", "x27", "x28", "x29", "x30",
  ]
  pure val CAPTURES = Set("c1", "c2")
  // 自然结束的结局：Out、被线接住的异常、没有线接住的异常（欠下停机）。
  pure val NATURAL_KINDS = Set("Out", "Caught", "Uncaught")
  pure val BUDGET = 2
  pure val NONE = "None"

  // ---------- 契约调用的载荷 ----------
  // 业务值的一个代表；它在行为里只被搬运、不被构造或检查，结构由 soroi`parse 持有。
  pure val aValue: Shared::Parsed = { shape: "s", raw: "v" }
  // 每个运行项在自己的位置上（位置取运行项 id）。
  pure def startOf(rt: str): Store::Start = { position: rt, declared: Set(), input: { attrs: Map(), controls: Set() }, at: 0, rendered: "" }
  pure def record(derived: Opt[Store::Derived]): Store::RunRecord = {
    bundle: "b", task: "task", workflow: "wf", inputs: Map(), workspace: "ws", harness: "hs",
    startedAt: 0, parallel: 1, derivedFrom: derived,
  }
  pure def handle(rt: str): Ws::Handle = { runtime: rt, closure: rt }
  pure val anExec: Ws::Exec = { program: "prog", args: "args" }
  pure val okCollected: Ws::Collected = { status: Ws::Exit_Success, stdout: "" }
  pure val failure: Ws::Failure = { message: "boundary failure" }
  pure def endOf(kind: str): Store::End = {
    at: 0,
    outcome: if (kind == "Out") Store::Outcome_Out({ captured: List() })
             else if (kind == "Halted") Store::Outcome_Halted
             else Store::Outcome_Thrown({ label: "e", payload: aValue }),
    snapshot: Map(),
  }
  pure def triggerOf(t: str): Store::Trigger =
    if (t == "Manual") Store::Trigger_Manual
    else if (t == "DaemonLost") Store::Trigger_DaemonLost
    else Store::Trigger_Uncaught
  pure val deriveReq: Control::DeriveReq = { source: "r1", cwd: "/", edits: List(), parallel: Nil }

  // ---------- 状态 ----------
  // 调度与工作流事实：不在契约状态里，跨崩溃保留。
  type Sched = {
    // 已交给推进的运行：可启动候选由推进依据记录给出。
    handedOver: Set[str],
    // 结局是异常、且工作流有线接住它的运行项（REQ-47 的 consumed，由边文件决定，不在事实源头里）。
    caught: Set[str],
  }

  // 执行边界里尚未得到回复的 launch；跨崩溃保留。接纳与关闭不在这里另存：
  // 被接纳、尚未终止的执行读 ws.running，已关闭的运行项读 ws.closed（Closures 持有）。
  type Boundary = {
    // 已由某个 daemon 进程发出、执行边界尚未接纳或拒绝的 launch（包括已退出进程发出的）。
    inflight: Set[(str, str)],
    // 已发出、执行边界尚未回复的 inject（REQ-21 的输入文件；包括已退出进程发出的）。
    injecting: Set[str],
  }

  // daemon 进程内的东西；崩溃时消失。
  type Daemon = {
    budget: str -> int,
    pendingStarts: str -> int,
    nextRt: int,
    nextExec: int,
    // 闭包过程："None" | "Running" | "Ending" | "Done" | "Lost"
    //           | "Defect"（执行边界 Failure 使闭包过程以 engine defect 结束，运行项保持无 end：REQ-56、REQ-59）
    proc: str -> str,
    // 闭包过程的进度："Init" | "Read" | "Opened" | "Injecting" | "Injected" | "Launched" | "Collected" | "Verified"
    //                 | "Reattach" | "HaltClose" | "Closing" | "Closed" | "Listed" | "Done"
    phase: str -> str,
    bodyRef: str -> str,
    // REQ-11：soroi-closure 的受理窗口。
    window: str -> bool,
    // 一次工具调用的进度："None" | "Launched" | "Done"（已取回结果或 launch 被拒）
    tool: str -> str,
    toolRef: str -> str,
    recorded: str -> int,
    replied: str -> int,
    // REQ-28：已完成的出口捕获项。
    capturedItems: str -> Set[str],
    // REQ-53：每个运行至多一个进行中的停机过程；值为它最先受理的触发。
    halting: str -> str,
    // REQ-53：停机过程停在 engine defect 上。
    defect: str -> bool,
    stopWaiting: str -> bool,
    finished: Set[str],
    crashed: bool,
    startState: str,              // "None" | "Bundled" | "Published" | "Replied" | "Lost"
    // 介入："None" | "Rejected" | "Waiting" | "Ready" | "Bundled" | "Created" | "Replied" | "Lost"
    derive: str,
    haltByDerive: bool,
    // 派生计划（derivation`plan 的结果）中要追加 Ref 的旧记录。
    plannedRefs: Set[str],
  }

  // 只用于不变式：被守卫排除的事件一旦发生就置位，或记录历史上的先后。
  type Ghost = {
    admittedWhileHalting: bool,
    cmdOutsideWindow: bool,
    recordedOutsideWindow: bool,
    recordedUnobserved: bool,
    captureBeforeBody: bool,
    verifiedEarly: bool,
    deriveRejected: bool,
    reattached: bool,
    defectReplied: bool,
    deriveDefectReplied: bool,
    lateLaunchAnswered: bool,
    lateInjectAnswered: bool,
    listFailed: bool,
    firstTrigger: str -> str,
  }

  var store: Store::Records
  var ws: Ws::Closures
  var sched: Sched
  var bnd: Boundary
  var dmn: Daemon
  var ghost: Ghost
  var lastCall: Call

  // ---------- 读取契约状态 ----------
  pure def elemsOf(l: List[str]): Set[str] = l.foldl(Set(), (s, x) => s.union(Set(x)))
  pure val ALL_RTS = elemsOf(RT_IDS)

  def published(r: str): bool = r.in(store.runs.keys())
  def runtimeOrder(r: str): List[str] = if (r.in(store.order.keys())) store.order.get(r) else List()
  // 运行项的结束种类，只从事实源头读："None" | "Open" | "Out" | "Thrown" | "RuntimeFault" | "Halted" | "Ref"
  def endTag(rt: str): str =
    if (not(rt.in(store.runtimes.keys()))) NONE
    else match store.runtimes.get(rt) {
      | Entry_RefEntry(_) => "Ref"
      | Entry_Own(o) => match o.fin {
          | Nil => "Open"
          | Some(e) => match e.outcome {
              | Outcome_Out(_) => "Out"
              | Outcome_Halted => "Halted"
              | Outcome_Thrown(_) => "Thrown"
              | Outcome_RuntimeFault(_) => "RuntimeFault"
            }
        }
    }
  def haltTag(r: str): str =
    if (not(r.in(store.halts.keys()))) NONE
    else match store.halts.get(r) {
      | Trigger_Manual => "Manual"
      | Trigger_DaemonLost => "DaemonLost"
      | Trigger_Uncaught => "Uncaught"
    }
  def referenceSources: Set[str] = store.runtimes.keys().fold(Set(), (s, rt) =>
    match store.runtimes.get(rt) {
      | Entry_Own(_) => s
      | Entry_RefEntry(e) => s.union(Set(e.source))
    })

  // ---------- 辅助 ----------
  def rtsOfRun(r: str): Set[str] = elemsOf(runtimeOrder(r))
  def runOfRt(rt: str): str = RUNS.filter(r => rt.in(rtsOfRun(r))).fold("", (_a, r) => r)
  def allocated: Set[str] = RUNS.fold(Set(), (s, r) => s.union(rtsOfRun(r)))
  def isEnded(rt: str): bool = endTag(rt) != "Open"
  def allEndedRun(r: str): bool = rtsOfRun(r).forall(rt => isEnded(rt))
  def isException(rt: str): bool = endTag(rt) == "Thrown" or endTag(rt) == "RuntimeFault"
  def settledNaturally(rt: str): bool =
    endTag(rt) == "Out" or endTag(rt) == "Ref" or (isException(rt) and rt.in(sched.caught))
  // REQ-57：没有线接住的异常使运行欠下一次停机。
  def owesHalt(r: str): bool = rtsOfRun(r).exists(rt => isException(rt) and not(rt.in(sched.caught)))
  def stopping(r: str): bool = dmn.halting.get(r) != NONE
  def over(r: str): bool = haltTag(r) != NONE or r.in(dmn.finished)
  // body 的 launch 已被接纳、尚未取回。
  def bodyAccepted(rt: str): bool = dmn.bodyRef.get(rt).in(ws.running.keys())
  // REQ-7/REQ-57：按记录判断 Finished：全部运行项自然结束、没有欠下的停机、没有可启动候选、没有在途的开始。
  def finishedByRecords(r: str): bool =
    r.in(sched.handedOver) and rtsOfRun(r).forall(rt => settledNaturally(rt)) and not(owesHalt(r))
    and dmn.budget.get(r) == 0 and dmn.pendingStarts.get(r) == 0
  // 旧运行 r1 的记录（r1 只有 Own），作为 derivation`plan 的输入。
  def ownOf(rt: str): Store::Own = match store.runtimes.get(rt) {
    | Entry_Own(o) => o
    | Entry_RefEntry(_) => { start: startOf(rt), buckets: List(), fin: Nil }
  }
  def oldRecords: str -> Store::Own = rtsOfRun("r1").mapBy(rt => ownOf(rt))
  def freshRt: str = RT_IDS[dmn.nextRt]
  def freshExec: str = EXEC_IDS[dmn.nextExec]
  def execLeft: bool = dmn.nextExec < length(EXEC_IDS)
  def windowOpen(rt: str): bool = dmn.window.get(rt)
  def live(rt: str): bool = dmn.proc.get(rt) == "Running" and not(dmn.crashed)

  def beginOrJoin(r: str, t: str): Daemon =
    if (stopping(r)) dmn else { ...dmn, halting: dmn.halting.set(r, t) }
  def noteTrigger(r: str, t: str): Ghost =
    if (stopping(r) or ghost.firstTrigger.get(r) != NONE) ghost
    else { ...ghost, firstTrigger: ghost.firstTrigger.set(r, t) }
  def appendGhost(rt: str): Ghost =
    { ...ghost, recordedOutsideWindow: ghost.recordedOutsideWindow or not(windowOpen(rt)) }

  // ---------- 契约状态按 VDM post 更新 ----------
  pure def appendFact(s: Store::Records, rt: str, f: Store::Fact): Store::Records =
    match s.runtimes.get(rt) {
      | Entry_Own(o) => { ...s, runtimes: s.runtimes.set(rt, Store::Entry_Own({ ...o, buckets: o.buckets.append(f) })) }
      | Entry_RefEntry(_) => s
    }

  pure def storeAfter(s: Store::Records, call: Call): Store::Records = match call {
    | NoCall => s
    | soroi_engine_control(_) => s
    | soroi_engine_derivation(_) => s
    | soroi_workspace(_) => s
    | soroi_store(op) => match op {
        | writeBundle(a) => { ...s, bundles: s.bundles.union(Set(a.b)) }
        | writeRun(a) => { ...s, runs: s.runs.put(a.r, a.rec), order: s.order.put(a.r, List()) }
        | writeStart(a) => match a.result {
            | WriteStart_Result_RuntimeId(rt) => { ...s,
                runtimes: s.runtimes.put(rt, Store::Entry_Own({ start: a.s, buckets: List(), fin: Nil })),
                order: s.order.set(a.r, s.order.get(a.r).append(rt)) }
            | WriteStart_Result_StartFailed(_) => s
          }
        | readStart(_) => s
        | appendBucket(a) => appendFact(s, a.rt, a.f)
        | writeEnd(a) => match s.runtimes.get(a.rt) {
            | Entry_Own(o) => { ...s, runtimes: s.runtimes.set(a.rt, Store::Entry_Own({ ...o, fin: Some(a.e) })) }
            | Entry_RefEntry(_) => s
          }
        | writeHalt(a) => { ...s, halts: s.halts.put(a.r, a.t) }
        | appendRef(a) => { ...s,
            runtimes: s.runtimes.put(a.result, Store::Entry_RefEntry({ source: a.src })),
            order: s.order.set(a.r, s.order.get(a.r).append(a.result)) }
        | readActivation(_) => s
        | replay(_) => s
        | timeline(_) => s
        | compare(_) => s
      }
  }

  pure def workspaceAfter(s: Ws::Closures, call: Call): Ws::Closures = match call {
    | NoCall => s
    | soroi_engine_control(_) => s
    | soroi_engine_derivation(_) => s
    | soroi_store(_) => s
    | soroi_workspace(op) => match op {
        | open(a) => match a.result {
            | Open_Result_Handle(h) =>
                if (a.rt.in(s.closures.keys())) s
                else { ...s, closures: s.closures.put(a.rt, h.closure), configs: s.configs.put(a.rt, a.c),
                             routing: s.routing.union(Set(a.rt)), roots: s.roots.put(a.rt, Map()) }
            | Open_Result_Failure(_) => s
          }
        | inject(_) => s
        | launch(a) => match a.result {
            | Launch_Result_ExecRef(x) => { ...s, running: s.running.put(x, a.h.runtime) }
            | Launch_Result_Rejected(_) => s
            | Launch_Result_Failure(_) => s
          }
        | collect(a) => { ...s, running: s.running.keys().exclude(Set(a.x)).mapBy(x => s.running.get(x)) }
        | close(a) => match a.result {
            | Close_Result_Closed(_) => { ...s, closed: s.closed.union(Set(a.h.runtime)),
                running: s.running.keys().filter(x => s.running.get(x) != a.h.runtime).mapBy(x => s.running.get(x)),
                routing: s.routing.exclude(Set(a.h.runtime)) }
            | Close_Result_Failure(_) => s
          }
        | list(_) => s
      }
  }

  action commit(call: Call): bool = all {
    lastCall' = call,
    store' = storeAfter(store, call),
    ws' = workspaceAfter(ws, call),
  }

  // ---------- 初始状态 ----------
  action init = all {
    store' = Store::initial,
    ws' = Ws::initial,
    sched' = { handedOver: Set(), caught: Set() },
    bnd' = { inflight: Set(), injecting: Set() },
    dmn' = {
      budget: RUNS.mapBy(_r => 0), pendingStarts: RUNS.mapBy(_r => 0), nextRt: 0, nextExec: 0,
      proc: ALL_RTS.mapBy(_rt => NONE), phase: ALL_RTS.mapBy(_rt => NONE), bodyRef: ALL_RTS.mapBy(_rt => NONE),
      window: ALL_RTS.mapBy(_rt => false), tool: ALL_RTS.mapBy(_rt => NONE), toolRef: ALL_RTS.mapBy(_rt => NONE),
      recorded: ALL_RTS.mapBy(_rt => 0), replied: ALL_RTS.mapBy(_rt => 0),
      capturedItems: ALL_RTS.mapBy(_rt => Set()),
      halting: RUNS.mapBy(_r => NONE), defect: RUNS.mapBy(_r => false),
      stopWaiting: RUNS.mapBy(_r => false), finished: Set(),
      crashed: false, startState: NONE, derive: NONE, haltByDerive: false, plannedRefs: Set(),
    },
    ghost' = {
      admittedWhileHalting: false, cmdOutsideWindow: false,
      recordedOutsideWindow: false, recordedUnobserved: false,
      captureBeforeBody: false, verifiedEarly: false, deriveRejected: false, reattached: false,
      defectReplied: false, deriveDefectReplied: false, lateLaunchAnswered: false, lateInjectAnswered: false, listFailed: false, firstTrigger: RUNS.mapBy(_r => NONE),
    },
    lastCall' = NoCall,
  }

  // ---------- 使用方的操作面（REQ-8） ----------
  // 起运行：先发布 bundle，再发布完整的运行记录，之后才回复 RunId。
  action publishStartBundle = all {
    dmn.startState == NONE,
    not(dmn.crashed),
    sched' = sched, bnd' = bnd, ghost' = ghost,
    dmn' = { ...dmn, startState: "Bundled" },
    commit(soroi_store(Store::writeBundle({ b: "b" }))),
  }

  // REQ-2：任务输入不符合声明结构时拒绝起运行；不发布 bundle 与运行记录。
  action rejectStart = all {
    dmn.startState == NONE,
    not(dmn.crashed),
    sched' = sched, bnd' = bnd, ghost' = ghost, dmn' = dmn,
    commit(soroi_engine_control(Control::Start({
      req: { workflow: "wf", inputs: Map() }, result: Control::StartReply_InputRejected }))),
  }

  action publishStartRun = all {
    dmn.startState == "Bundled",
    not(dmn.crashed),
    sched' = sched, bnd' = bnd, ghost' = ghost,
    dmn' = { ...dmn, startState: "Published" },
    commit(soroi_store(Store::writeRun({ r: "r1", rec: record(Nil) }))),
  }

  action replyStart = all {
    dmn.startState == "Published",
    not(dmn.crashed),
    sched' = { ...sched, handedOver: sched.handedOver.union(Set("r1")) },
    bnd' = bnd, ghost' = ghost,
    dmn' = { ...dmn, startState: "Replied", budget: dmn.budget.set("r1", BUDGET) },
    commit(soroi_engine_control(Control::Start({
      req: { workflow: "wf", inputs: Map() }, result: Control::StartReply_RunId("r1") }))),
  }

  // REQ-53：同一运行后到的停机请求并入进行中的停机过程，触发保持为最先受理的那个。
  // 使用方只能停下它拿到 RunId 的运行。
  action requestStop(r: str): bool = all {
    r.in(sched.handedOver),
    not(dmn.stopWaiting.get(r)),
    not(dmn.crashed),
    sched' = sched, bnd' = bnd,
    dmn' = if (over(r)) { ...dmn, stopWaiting: dmn.stopWaiting.set(r, true) }
           else { ...beginOrJoin(r, "Manual"), stopWaiting: dmn.stopWaiting.set(r, true) },
    ghost' = if (over(r)) ghost else noteTrigger(r, "Manual"),
    commit(NoCall),
  }

  // REQ-57：并入的 Stop 在停机过程结束后得到结局；运行已按记录 Finished 时得到用户错误。
  action replyStop(r: str): bool = all {
    dmn.stopWaiting.get(r),
    over(r),
    not(dmn.crashed),
    sched' = sched, bnd' = bnd, ghost' = ghost,
    dmn' = { ...dmn, stopWaiting: dmn.stopWaiting.set(r, false) },
    commit(soroi_engine_control(Control::Stop({
      target: r,
      result: if (haltTag(r) != NONE) Control::StopReply_Stopped else Control::StopReply_AlreadyFinished }))),
  }

  // REQ-53：停机过程停在 engine defect 上时，并入的请求得到 engine defect；停机过程不结束。
  action replyStopDefect(r: str): bool = all {
    dmn.stopWaiting.get(r),
    dmn.defect.get(r),
    stopping(r),
    not(dmn.crashed),
    sched' = sched, bnd' = bnd,
    dmn' = { ...dmn, stopWaiting: dmn.stopWaiting.set(r, false) },
    ghost' = { ...ghost, defectReplied: true },
    commit(soroi_engine_control(Control::Stop({ target: r, result: Control::StopReply_EngineDefect }))),
  }

  // REQ-42：编辑准入（derivation 的 validateEdits）在任何停机之前判定；被拒绝时旧运行不变、不建立新运行。
  action requestDerive(valid: bool): bool = all {
    dmn.derive == NONE,
    "r1".in(sched.handedOver),
    not(dmn.crashed),
    sched' = sched, bnd' = bnd,
    if (not(valid)) dmn' = { ...dmn, derive: "Rejected" }
    else if (over("r1")) dmn' = { ...dmn, derive: "Ready" }
    else dmn' = { ...beginOrJoin("r1", "Manual"), derive: "Waiting", haltByDerive: not(stopping("r1")) },
    ghost' = if (not(valid)) { ...ghost, deriveRejected: true }
             else if (over("r1")) ghost
             else noteTrigger("r1", "Manual"),
    commit(NoCall),
  }

  action replyDeriveRejected = all {
    dmn.derive == "Rejected",
    not(dmn.crashed),
    sched' = sched, bnd' = bnd, ghost' = ghost,
    dmn' = { ...dmn, derive: "Replied" },
    commit(soroi_engine_control(Control::Derive({
      req: deriveReq, result: Control::DeriveReply_Rejected({ reason: Derivation::RejectedEdit_UnknownAttr }) }))),
  }

  // REQ-53：并入的介入在停机过程停在 engine defect 上时报告 engine defect，不派生。
  action replyDeriveDefect = all {
    dmn.derive == "Waiting",
    dmn.defect.get("r1"),
    not(dmn.crashed),
    sched' = sched, bnd' = bnd,
    dmn' = { ...dmn, derive: "Replied" },
    ghost' = { ...ghost, defectReplied: true, deriveDefectReplied: true },
    commit(soroi_engine_control(Control::Derive({ req: deriveReq, result: Control::DeriveReply_EngineDefect }))),
  }

  // REQ-44：旧运行停下（已写 halt 或已 Finished）之后，复制的 bundle 与新运行记录才依次发布。
  action publishDerivedBundle = all {
    dmn.derive == "Waiting" or dmn.derive == "Ready",
    over("r1"),
    not(dmn.crashed),
    sched' = sched, bnd' = bnd, ghost' = ghost,
    dmn' = { ...dmn, derive: "Bundled" },
    commit(soroi_store(Store::writeBundle({ b: "b" }))),
  }

  action publishDerivedRun = all {
    dmn.derive == "Bundled",
    not(published("r2")),
    not(dmn.crashed),
    sched' = sched, bnd' = bnd, ghost' = ghost,
    dmn' = { ...dmn, derive: "Created" },
    commit(soroi_store(Store::writeRun({ r: "r2",
      rec: record(Some({ id: "d1", source: "r1", edits: List() })) }))),
  }

  // REQ-47–REQ-49：派生按旧运行的记录取得沿用与重跑分区。分区只由 derivation`plan 的 post 定义，
  // 这里给出的结果载荷由回放检查（本模型的编辑集合为空、记录没有来源，重跑的就是不可引用的记录）。
  action planDerive = all {
    dmn.derive == "Created",
    not(dmn.crashed),
    val refs = rtsOfRun("r1").filter(rt => settledNaturally(rt))
    all {
      sched' = sched, bnd' = bnd, ghost' = ghost,
      dmn' = { ...dmn, derive: "Planned", plannedRefs: refs },
      commit(soroi_engine_derivation(Derivation::plan({ f: oldRecords, consumed: sched.caught, es: List(),
        result: { refs: refs, rerun: rtsOfRun("r1").exclude(refs) } }))),
    }
  }

  // REQ-49：计划中的每个旧记录各追加一条 Ref。
  action appendDerivedRef(src: str): bool = all {
    dmn.derive == "Planned",
    src.in(dmn.plannedRefs),
    not(src.in(referenceSources)),
    dmn.nextRt < length(RT_IDS),
    not(dmn.crashed),
    val rt = freshRt
    all {
      sched' = sched, bnd' = bnd, ghost' = ghost,
      dmn' = { ...dmn, nextRt: dmn.nextRt + 1 },
      commit(soroi_store(Store::appendRef({ r: "r2", src: src, result: rt }))),
    }
  }

  // REQ-49：Ref 追加完毕后，受影响的位置交给普通推进，作为新的 Own 激活启动。
  action replyDerive = all {
    dmn.derive == "Planned",
    dmn.plannedRefs == referenceSources,
    not(dmn.crashed),
    sched' = { ...sched, handedOver: sched.handedOver.union(Set("r2")) },
    bnd' = bnd, ghost' = ghost,
    dmn' = { ...dmn, derive: "Replied", budget: dmn.budget.set("r2", 1) },
    commit(soroi_engine_control(Control::Derive({ req: deriveReq, result: Control::DeriveReply_RunId("r2") }))),
  }

  // ---------- 推进 ----------
  // REQ-53：停机过程开始后不为该运行准入候选。
  action admit(r: str): bool = all {
    r.in(sched.handedOver),
    dmn.budget.get(r) > 0,
    not(stopping(r)),
    not(over(r)),
    not(dmn.crashed),
    sched' = sched, bnd' = bnd,
    dmn' = { ...dmn, budget: dmn.budget.set(r, dmn.budget.get(r) - 1),
                     pendingStarts: dmn.pendingStarts.set(r, dmn.pendingStarts.get(r) + 1) },
    ghost' = { ...ghost, admittedWhileHalting: ghost.admittedWhileHalting or stopping(r) },
    commit(NoCall),
  }

  // REQ-54：已经发出的开始在返回 RuntimeId 时为它启动闭包过程，即使停机已经开始。
  action recordStart(r: str): bool = all {
    dmn.pendingStarts.get(r) > 0,
    dmn.nextRt < length(RT_IDS),
    haltTag(r) == NONE,
    not(dmn.crashed),
    val rt = freshRt
    all {
      sched' = sched, bnd' = bnd, ghost' = ghost,
      dmn' = { ...dmn, nextRt: dmn.nextRt + 1,
                       pendingStarts: dmn.pendingStarts.set(r, dmn.pendingStarts.get(r) - 1),
                       proc: dmn.proc.set(rt, "Running"), phase: dmn.phase.set(rt, "Init") },
      commit(soroi_store(Store::writeStart({ r: r, s: startOf(rt), result: Store::WriteStart_Result_RuntimeId(rt) }))),
    }
  }

  // REQ-54：返回 Failure 的开始没有运行项；它不再是在途的开始。
  action startFailed(r: str): bool = all {
    dmn.pendingStarts.get(r) > 0,
    haltTag(r) == NONE,
    not(dmn.crashed),
    sched' = sched, bnd' = bnd, ghost' = ghost,
    dmn' = { ...dmn, pendingStarts: dmn.pendingStarts.set(r, dmn.pendingStarts.get(r) - 1) },
    commit(soroi_store(Store::writeStart({ r: r, s: startOf("p"),
      result: Store::WriteStart_Result_StartFailed(Store::StartFailed_StartFailed) }))),
  }

  // REQ-7：没有在途激活、没有可启动候选、没有欠下的停机、没有停机过程时，运行自然完成。
  action naturalFinish(r: str): bool = all {
    not(stopping(r)),
    not(over(r)),
    finishedByRecords(r),
    not(dmn.crashed),
    sched' = sched, bnd' = bnd, ghost' = ghost,
    dmn' = { ...dmn, finished: dmn.finished.union(Set(r)) },
    commit(NoCall),
  }

  // REQ-57：没有线接住的异常（uncaught = halt）触发停机。
  action haltOnUncaught(r: str): bool = all {
    owesHalt(r),
    not(stopping(r)),
    not(over(r)),
    not(dmn.crashed),
    sched' = sched, bnd' = bnd,
    dmn' = beginOrJoin(r, "Uncaught"),
    ghost' = noteTrigger(r, "Uncaught"),
    commit(NoCall),
  }

  // ---------- 闭包过程 ----------
  // REQ-60：闭包过程按自己的运行项直接从事实源头取得输入，不经推进转交。
  action readOwnStart(rt: str): bool = all {
    live(rt),
    dmn.phase.get(rt) == "Init",
    sched' = sched, bnd' = bnd, ghost' = ghost,
    dmn' = { ...dmn, phase: dmn.phase.set(rt, "Read") },
    commit(soroi_store(Store::readStart({ rt: rt, result: startOf(rt) }))),
  }

  action openClosure(rt: str): bool = all {
    live(rt),
    dmn.phase.get(rt) == "Read",
    sched' = sched, bnd' = bnd, ghost' = ghost,
    dmn' = { ...dmn, phase: dmn.phase.set(rt, "Opened") },
    commit(soroi_workspace(Ws::open({ c: "cfg", rt: rt, result: Ws::Open_Result_Handle(handle(rt)) }))),
  }

  // REQ-59：闭包过程里执行边界的 Failure 是 engine defect：闭包过程结束，运行项保持无 end，
  // 之后由停机过程按“本进程没有它的闭包过程”收束（REQ-56）。
  def endedByDefect(rt: str): Daemon =
    if (live(rt)) { ...dmn, proc: dmn.proc.set(rt, "Defect"), phase: dmn.phase.set(rt, NONE), window: dmn.window.set(rt, false) }
    else dmn

  action openFails(rt: str): bool = all {
    live(rt),
    dmn.phase.get(rt) == "Read",
    sched' = sched, bnd' = bnd, ghost' = ghost,
    dmn' = endedByDefect(rt),
    commit(soroi_workspace(Ws::open({ c: "cfg", rt: rt, result: Ws::Open_Result_Failure(failure) }))),
  }

  // REQ-21：进入闭包时，闭包过程把输入文件放进工作根，再启动 body。
  action issueInject(rt: str): bool = all {
    live(rt),
    dmn.phase.get(rt) == "Opened",
    sched' = sched, ghost' = ghost,
    bnd' = { ...bnd, injecting: bnd.injecting.union(Set(rt)) },
    dmn' = { ...dmn, phase: dmn.phase.set(rt, "Injecting") },
    commit(NoCall),
  }

  // REQ-24：关闭记下之后 inject 被拒绝（已退出进程发出的在途 inject 也一样）；Failure 是 engine defect（REQ-59）。
  action answerInject(rt: str, ok: bool): bool = all {
    rt.in(bnd.injecting),
    sched' = sched,
    bnd' = { ...bnd, injecting: bnd.injecting.exclude(Set(rt)) },
    val waiting = live(rt) and dmn.phase.get(rt) == "Injecting"
    if (rt.in(ws.closed)) all {
      dmn' = if (waiting) endedByDefect(rt) else dmn,
      ghost' = { ...ghost, lateInjectAnswered: true },
      commit(soroi_workspace(Ws::inject({ h: handle(rt), files: Map(), result: Ws::Inject_Result_Rejected(Ws::Rejected_Rejected) }))),
    } else if (ok) all {
      dmn' = if (waiting) { ...dmn, phase: dmn.phase.set(rt, "Injected") } else dmn,
      ghost' = ghost,
      commit(soroi_workspace(Ws::inject({ h: handle(rt), files: Map(), result: Ws::Inject_Result_Injected(Ws::Injected_Injected) }))),
    } else all {
      dmn' = if (waiting) endedByDefect(rt) else dmn,
      ghost' = ghost,
      commit(soroi_workspace(Ws::inject({ h: handle(rt), files: Map(), result: Ws::Inject_Result_Failure(failure) }))),
    },
  }

  // REQ-11：受理窗口从闭包过程发出 body 的 launch 起打开。
  action issueBodyLaunch(rt: str): bool = all {
    live(rt),
    dmn.phase.get(rt) == "Injected",
    execLeft,
    val x = freshExec
    all {
      sched' = sched, ghost' = ghost,
      bnd' = { ...bnd, inflight: bnd.inflight.union(Set((rt, x))) },
      dmn' = { ...dmn, nextExec: dmn.nextExec + 1, phase: dmn.phase.set(rt, "Launched"),
                       bodyRef: dmn.bodyRef.set(rt, x), window: dmn.window.set(rt, true) },
      commit(NoCall),
    }
  }

  // body 的 launch 不被接纳（被拒或 Failure）时窗口关闭（REQ-11）。
  def launchRefused(rt: str): Daemon =
    if (live(rt) and dmn.phase.get(rt) == "Launched")
      { ...dmn, window: dmn.window.set(rt, false), phase: dmn.phase.set(rt, "Collected") }
    else dmn

  // REQ-24：关闭与接纳互斥：在途 launch 要么在关闭之前被接纳，要么被拒绝。关闭锚点是 ws.closed。
  action answerLaunch(rt: str, x: str): bool = all {
    (rt, x).in(bnd.inflight),
    sched' = sched,
    bnd' = { ...bnd, inflight: bnd.inflight.exclude(Set((rt, x))) },
    if (rt.in(ws.closed)) all {
      dmn' = launchRefused(rt),
      ghost' = { ...ghost, lateLaunchAnswered: true },
      commit(soroi_workspace(Ws::launch({ h: handle(rt), x: anExec,
        result: Ws::Launch_Result_Rejected(Ws::Rejected_Rejected) }))),
    } else all {
      dmn' = dmn, ghost' = ghost,
      commit(soroi_workspace(Ws::launch({ h: handle(rt), x: anExec, result: Ws::Launch_Result_ExecRef(x) }))),
    },
  }

  // REQ-11：body 的 launch 以 Failure 返回时窗口关闭。
  action launchFails(rt: str, x: str): bool = all {
    (rt, x).in(bnd.inflight),
    not(rt.in(ws.closed)),
    sched' = sched, ghost' = ghost,
    bnd' = { ...bnd, inflight: bnd.inflight.exclude(Set((rt, x))) },
    dmn' = launchRefused(rt),
    commit(soroi_workspace(Ws::launch({ h: handle(rt), x: anExec, result: Ws::Launch_Result_Failure(failure) }))),
  }

  // REQ-11/REQ-13：窗口内的 run 命令；闭包启动声明的工具程序，不由调用者执行。
  action toolCalled(rt: str): bool = all {
    dmn.tool.get(rt) == NONE,
    live(rt),
    windowOpen(rt),
    execLeft,
    val x = freshExec
    val refused = rt.in(ws.closed)
    all {
      sched' = sched, bnd' = bnd,
      dmn' = { ...dmn, nextExec: dmn.nextExec + 1,
                       tool: dmn.tool.set(rt, if (refused) "Done" else "Launched"),
                       toolRef: dmn.toolRef.set(rt, x) },
      ghost' = { ...ghost, cmdOutsideWindow: ghost.cmdOutsideWindow or not(windowOpen(rt)) },
      commit(soroi_workspace(Ws::launch({ h: handle(rt), x: anExec,
        result: if (refused) Ws::Launch_Result_Rejected(Ws::Rejected_Rejected) else Ws::Launch_Result_ExecRef(x) }))),
    }
  }

  // REQ-13：闭包取回工具程序的 stdout（成功）或 Failure。
  action toolCollected(rt: str, ok: bool): bool = all {
    dmn.tool.get(rt) == "Launched",
    not(dmn.crashed),
    sched' = sched, bnd' = bnd, ghost' = ghost,
    dmn' = { ...dmn, tool: dmn.tool.set(rt, "Done") },
    commit(soroi_workspace(Ws::collect({ h: handle(rt), x: dmn.toolRef.get(rt),
      result: if (ok) Ws::Collect_Result_Collected(okCollected) else Ws::Collect_Result_Failure(failure) }))),
  }

  // REQ-13/REQ-15/REQ-33：工具的结果先记录，再回复；只在窗口仍开时记录（运行项无 end 由 appendBucket 的 pre 持有）。
  // 记录哪一种事实（ToolRecord 或带 call 的拒绝）由闭包的 toolStep 决定，这里只取一个代表值。
  def toolFacts(rt: str): Set[Store::Fact] = Set(
    Store::Fact_ToolRecord({ call: "k", tool: "tool", seqNo: dmn.recorded.get(rt) + 1, value: aValue }),
    Store::Fact_CallRejected({ call: Some("k"), reason: { kind: Store::RejectKind_Infra, message: "boundary failure" } }),
  )
  action toolRecorded(rt: str): bool = {
    nondet f = toolFacts(rt).oneOf()
    all {
      dmn.tool.get(rt) == "Done",
      dmn.recorded.get(rt) == dmn.replied.get(rt),
      windowOpen(rt),
      endTag(rt) == "Open",
      sched' = sched, bnd' = bnd,
      dmn' = { ...dmn, recorded: dmn.recorded.set(rt, dmn.recorded.get(rt) + 1) },
      ghost' = { ...appendGhost(rt), recordedUnobserved: ghost.recordedUnobserved or dmn.tool.get(rt) != "Done" },
      commit(soroi_store(Store::appendBucket({ rt: rt, f: f }))),
    }
  }

  action toolReplied(rt: str): bool = all {
    dmn.tool.get(rt) != NONE,
    dmn.recorded.get(rt) > dmn.replied.get(rt),
    sched' = sched, bnd' = bnd, ghost' = ghost,
    dmn' = { ...dmn, replied: dmn.replied.set(rt, dmn.replied.get(rt) + 1), tool: dmn.tool.set(rt, NONE) },
    commit(NoCall),
  }

  // REQ-15：交互已被要求结束：未记录的调用不再记录，只回复。
  action toolDropped(rt: str): bool = all {
    dmn.tool.get(rt) == "Done",
    not(windowOpen(rt)),
    dmn.recorded.get(rt) == dmn.replied.get(rt),
    sched' = sched, bnd' = bnd, ghost' = ghost,
    dmn' = { ...dmn, tool: dmn.tool.set(rt, NONE) },
    commit(NoCall),
  }

  // REQ-11：窗口内的 return 命令：解析后的值写进返回槽。
  action bodyReturned(rt: str): bool = all {
    live(rt),
    windowOpen(rt),
    endTag(rt) == "Open",
    sched' = sched, bnd' = bnd, dmn' = dmn,
    ghost' = { ...appendGhost(rt), cmdOutsideWindow: ghost.cmdOutsideWindow or not(windowOpen(rt)) },
    commit(soroi_store(Store::appendBucket({ rt: rt, f: Store::Fact_SlotWrite({ value: aValue }) }))),
  }

  // REQ-11：窗口内的 throw 命令：受理后成为本运行项的异常结局候选，不写 bucket。
  action bodyThrew(rt: str): bool = all {
    live(rt),
    windowOpen(rt),
    sched' = sched, bnd' = bnd, dmn' = dmn,
    ghost' = { ...ghost, cmdOutsideWindow: ghost.cmdOutsideWindow or not(windowOpen(rt)) },
    commit(NoCall),
  }

  // REQ-11：body 的 collect 返回时窗口关闭。
  action collectBody(rt: str): bool = all {
    live(rt),
    dmn.phase.get(rt) == "Launched",
    bodyAccepted(rt),
    sched' = sched, bnd' = bnd, ghost' = ghost,
    dmn' = { ...dmn, window: dmn.window.set(rt, false), phase: dmn.phase.set(rt, "Collected") },
    commit(soroi_workspace(Ws::collect({ h: handle(rt), x: dmn.bodyRef.get(rt),
      result: Ws::Collect_Result_Collected(okCollected) }))),
  }

  // REQ-12/REQ-28：每个 capture 程序在 body 结束之后运行一次；各项互不等待、次序任意。
  action captureItem(rt: str, c: str): bool = all {
    live(rt),
    dmn.phase.get(rt) == "Collected",
    not(c.in(dmn.capturedItems.get(rt))),
    execLeft,
    val x = freshExec
    all {
      sched' = sched, bnd' = bnd,
      dmn' = { ...dmn, nextExec: dmn.nextExec + 1,
                       capturedItems: dmn.capturedItems.set(rt, dmn.capturedItems.get(rt).union(Set(c))) },
      ghost' = { ...ghost, captureBeforeBody: ghost.captureBeforeBody or dmn.phase.get(rt) != "Collected" },
      commit(soroi_workspace(Ws::launch({ h: handle(rt), x: anExec, result: Ws::Launch_Result_ExecRef(x) }))),
    }
  }

  // REQ-29：verify 程序只在全部出口捕获完成之后运行。
  action verifyOutputs(rt: str): bool = all {
    live(rt),
    dmn.phase.get(rt) == "Collected",
    dmn.capturedItems.get(rt) == CAPTURES,
    execLeft,
    val x = freshExec
    all {
      sched' = sched, bnd' = bnd,
      dmn' = { ...dmn, nextExec: dmn.nextExec + 1, phase: dmn.phase.set(rt, "Verified") },
      ghost' = { ...ghost, verifiedEarly: ghost.verifiedEarly or dmn.capturedItems.get(rt) != CAPTURES },
      commit(soroi_workspace(Ws::launch({ h: handle(rt), x: anExec, result: Ws::Launch_Result_ExecRef(x) }))),
    }
  }

  // REQ-55：自然收束在出口校验之后请执行边界关闭闭包。
  action closeNatural(rt: str): bool = all {
    live(rt),
    dmn.phase.get(rt) == "Verified",
    sched' = sched, bnd' = bnd, ghost' = ghost,
    dmn' = { ...dmn, phase: dmn.phase.set(rt, "Closing") },
    commit(NoCall),
  }

  // REQ-24：close 返回；被接纳执行的终止与关闭锚点由 close 的 post 写进 ws。
  action closeReturns(rt: str): bool = all {
    dmn.phase.get(rt) == "Closing",
    not(dmn.crashed),
    sched' = sched, bnd' = bnd, ghost' = ghost,
    dmn' = { ...dmn, phase: dmn.phase.set(rt, "Closed") },
    commit(soroi_workspace(Ws::close({ h: handle(rt), result: Ws::Close_Result_Closed(Ws::Closed_Closed) }))),
  }

  // REQ-53：为停机关闭闭包时执行边界返回 Failure：运行项保持无 end，停机过程停在原处（engine defect）。
  action closeFailsForHalt(rt: str): bool = all {
    dmn.proc.get(rt) == "Ending",
    dmn.phase.get(rt) == "Closing",
    not(dmn.crashed),
    sched' = sched, bnd' = bnd, ghost' = ghost,
    dmn' = { ...dmn, phase: dmn.phase.set(rt, "HaltClose"), defect: dmn.defect.set(runOfRt(rt), true) },
    commit(soroi_workspace(Ws::close({ h: handle(rt), result: Ws::Close_Result_Failure(failure) }))),
  }

  // REQ-39：现场是 close 返回之后的工作根观察。
  action listRoot(rt: str): bool = all {
    dmn.phase.get(rt) == "Closed",
    not(dmn.crashed),
    sched' = sched, bnd' = bnd, ghost' = ghost,
    dmn' = { ...dmn, phase: dmn.phase.set(rt, "Listed") },
    commit(soroi_workspace(Ws::list({ h: handle(rt), result: Ws::List_Result_Snapshot(Map()) }))),
  }

  // REQ-56/REQ-59：list 的 Failure 是 engine defect，运行项保持无 end。自然收束时闭包过程随之结束；
  // 为停机收束时停机过程停在原处（同 closeFailsForHalt），之后从尚无 end 的运行项继续。
  action listFails(rt: str): bool = all {
    dmn.proc.get(rt) == "Running" or dmn.proc.get(rt) == "Ending",
    dmn.phase.get(rt) == "Closed",
    not(dmn.crashed),
    sched' = sched, bnd' = bnd,
    ghost' = { ...ghost, listFailed: true },
    dmn' = if (dmn.proc.get(rt) == "Ending")
             { ...dmn, phase: dmn.phase.set(rt, "HaltClose"), defect: dmn.defect.set(runOfRt(rt), true) }
           else endedByDefect(rt),
    commit(soroi_workspace(Ws::list({ h: handle(rt), result: Ws::List_Result_Failure(failure) }))),
  }

  // REQ-34/REQ-55：运行项的结束只由它的闭包过程在 close 返回、现场取得之后一次发布。
  // 自然结束的异常是否被线接住由工作流决定，记进 sched.caught。
  action publishEnd(rt: str, natural: str): bool = all {
    dmn.phase.get(rt) == "Listed",
    dmn.proc.get(rt) == "Running" or dmn.proc.get(rt) == "Ending",
    natural.in(NATURAL_KINDS),
    not(dmn.crashed),
    val kind = if (dmn.proc.get(rt) == "Ending") "Halted" else natural
    all {
      sched' = if (kind == "Caught") { ...sched, caught: sched.caught.union(Set(rt)) } else sched,
      bnd' = bnd, ghost' = ghost,
      dmn' = { ...dmn, proc: dmn.proc.set(rt, "Done"), phase: dmn.phase.set(rt, "Done") },
      commit(soroi_store(Store::writeEnd({ rt: rt, e: endOf(kind) }))),
    }
  }

  // ---------- 停机过程 ----------
  // REQ-54/REQ-55：等已发出的开始全部返回之后，请每个未结束运行项的闭包过程为停机收束；
  // 本进程没有它的闭包过程时（daemon 重启后），为它启动一个只做收束的闭包过程。
  action windDown(rt: str): bool = all {
    rt.in(allocated),
    endTag(rt) == "Open",
    stopping(runOfRt(rt)),
    dmn.pendingStarts.get(runOfRt(rt)) == 0,
    dmn.proc.get(rt) != "Ending",
    not(dmn.crashed),
    val p = dmn.phase.get(rt)
    val running = dmn.proc.get(rt) == "Running"
    val keep = running and (p == "Closing" or p == "Closed" or p == "Listed")
    val wasOpened = running and (p == "Opened" or p == "Injecting" or p == "Injected" or p == "Launched" or p == "Collected" or p == "Verified")
    all {
      sched' = sched, bnd' = bnd, ghost' = ghost,
      dmn' = { ...dmn, window: dmn.window.set(rt, false),
                       proc: dmn.proc.set(rt, "Ending"),
                       phase: dmn.phase.set(rt, if (keep) p else if (wasOpened) "HaltClose" else "Reattach") },
      commit(NoCall),
    }
  }

  // REQ-23：收束用的闭包过程以同一配置重新附着同一闭包（闭包已关闭时也一样）。
  action reattach(rt: str): bool = all {
    dmn.proc.get(rt) == "Ending",
    dmn.phase.get(rt) == "Reattach",
    not(dmn.crashed),
    sched' = sched, bnd' = bnd,
    dmn' = { ...dmn, phase: dmn.phase.set(rt, "HaltClose") },
    ghost' = { ...ghost, reattached: true },
    commit(soroi_workspace(Ws::open({ c: "cfg", rt: rt, result: Ws::Open_Result_Handle(handle(rt)) }))),
  }

  // REQ-55：停机不等执行自行结束，直接请执行边界关闭闭包，闭包中的执行由执行边界一并结束。
  action closeForHalt(rt: str): bool = all {
    dmn.proc.get(rt) == "Ending",
    dmn.phase.get(rt) == "HaltClose",
    not(dmn.crashed),
    sched' = sched, bnd' = bnd, ghost' = ghost,
    dmn' = { ...dmn, phase: dmn.phase.set(rt, "Closing") },
    commit(NoCall),
  }

  // REQ-57：全部运行项都有 end 之后，按记录判断：已 Finished 则不写 halt。
  action haltFindsFinished(r: str): bool = all {
    stopping(r),
    dmn.pendingStarts.get(r) == 0,
    allEndedRun(r),
    finishedByRecords(r),
    not(dmn.crashed),
    sched' = sched, bnd' = bnd, ghost' = ghost,
    dmn' = { ...dmn, halting: dmn.halting.set(r, NONE), defect: dmn.defect.set(r, false),
                     finished: dmn.finished.union(Set(r)) },
    commit(NoCall),
  }

  // REQ-57：否则写下运行的结束锚点，触发为最先受理的那个。
  // 全部运行项已结束是 writeHalt 的 pre，由回放检查；这里的守卫是停机过程自己的等待。
  action haltAnchor(r: str): bool = all {
    stopping(r),
    dmn.pendingStarts.get(r) == 0,
    allEndedRun(r),
    not(finishedByRecords(r)),
    not(dmn.crashed),
    sched' = sched, bnd' = bnd, ghost' = ghost,
    dmn' = { ...dmn, halting: dmn.halting.set(r, NONE), defect: dmn.defect.set(r, false) },
    commit(soroi_store(Store::writeHalt({ r: r, t: triggerOf(dmn.halting.get(r)) }))),
  }

  // ---------- daemon 崩溃与重启 ----------
  // 进程内的闭包过程、停机过程、受理窗口、在途请求随进程消失；事实源头、执行边界与已发出的在途 launch 保留。
  action crash = all {
    not(dmn.crashed),
    store.runs.keys() != Set(),
    sched' = sched, bnd' = bnd,
    dmn' = { ...dmn, crashed: true,
             proc: ALL_RTS.mapBy(rt => if (Set("Running", "Ending", "Defect").contains(dmn.proc.get(rt))) "Lost" else dmn.proc.get(rt)),
             phase: ALL_RTS.mapBy(rt => if (dmn.proc.get(rt) == "Running" or dmn.proc.get(rt) == "Ending") NONE else dmn.phase.get(rt)),
             window: ALL_RTS.mapBy(_rt => false),
             tool: ALL_RTS.mapBy(_rt => NONE),
             recorded: ALL_RTS.mapBy(_rt => 0),
             replied: ALL_RTS.mapBy(_rt => 0),
             pendingStarts: RUNS.mapBy(_r => 0),
             halting: RUNS.mapBy(_r => NONE),
             defect: RUNS.mapBy(_r => false),
             stopWaiting: RUNS.mapBy(_r => false),
             startState: if (dmn.startState == "Bundled" or dmn.startState == "Published") "Lost" else dmn.startState,
             derive: if (dmn.derive == "Replied" or dmn.derive == NONE) dmn.derive else "Lost" },
    ghost' = { ...ghost, firstTrigger: RUNS.mapBy(r => if (haltTag(r) != NONE) ghost.firstTrigger.get(r) else NONE) },
    commit(NoCall),
  }

  action restart = all {
    dmn.crashed,
    sched' = sched, bnd' = bnd, ghost' = ghost,
    dmn' = { ...dmn, crashed: false },
    commit(NoCall),
  }

  // 重启后对每个尚未结束的运行以 DaemonLost 开始停机过程，不 resume。
  action daemonLost(r: str): bool = all {
    not(dmn.crashed),
    published(r),
    RT_IDS.foldl(false, (acc, rt) => acc or dmn.proc.get(rt) == "Lost"),
    not(stopping(r)),
    not(over(r)),
    not(finishedByRecords(r)),
    sched' = sched, bnd' = bnd,
    dmn' = beginOrJoin(r, "DaemonLost"),
    ghost' = noteTrigger(r, "DaemonLost"),
    commit(NoCall),
  }

  // 外部事件（Stop、Derive、崩溃）与失败用 roll 调频率，让轨迹能走到工具调用、自然完成与派生。
  // 执行边界对 launch 的回复也经 roll 放慢：已退出进程发出的在途 launch 可以在任意之后才得到回复（REQ-24），
  // 回复不放慢时，“关闭之后才回复”的交错在模拟里几乎走不到。执行边界的 Failure（open、inject、list）
  // 再以 flag 减半：它们让闭包过程以 engine defect 结束，过于频繁时自然结束与派生的路径很少走完。
  // 以运行或运行项为参数的动作只对已发布的运行、已分配的运行项可能启用，所以 r、rt 只从这些里取
  // （可达状态不变，只改采样分布）。
  action step = {
    nondet roll = 1.to(16).oneOf()
    nondet r = (if (store.runs.keys() == Set()) RUNS else store.runs.keys()).oneOf()
    nondet rt = (if (allocated == Set()) ALL_RTS else allocated).oneOf()
    nondet c = CAPTURES.oneOf()
    nondet natural = NATURAL_KINDS.oneOf()
    nondet flag = Set(true, false).oneOf()
    nondet p = bnd.inflight.union(Set(("", ""))).oneOf()
    any {
      publishStartBundle, publishStartRun, replyStart, issueInject(rt),
      replyStop(r), replyStopDefect(r), replyDeriveRejected, replyDeriveDefect,
      publishDerivedBundle, publishDerivedRun, planDerive, appendDerivedRef(rt), replyDerive,
      admit(r), recordStart(r), naturalFinish(r), haltOnUncaught(r),
      haltFindsFinished(r), haltAnchor(r), daemonLost(r),
      readOwnStart(rt), openClosure(rt), issueBodyLaunch(rt), toolCalled(rt), toolCollected(rt, flag),
      toolRecorded(rt), toolReplied(rt), toolDropped(rt), bodyReturned(rt), bodyThrew(rt),
      collectBody(rt), captureItem(rt, c), verifyOutputs(rt),
      closeNatural(rt), closeReturns(rt), listRoot(rt), publishEnd(rt, natural),
      windDown(rt), reattach(rt), closeForHalt(rt),
      restart,
      all { roll == 1, requestStop(r) },
      all { roll >= 11, answerLaunch(p._1, p._2) },
      // 介入以更低频率到来，派生多在旧运行项自然结束之后；编辑准入按 2:1 通过（被拒绝的介入不再重试）。
      all { roll == 2, flag, requestDerive(c == "c1" or natural == "Out") },
      all { roll == 3, crash },
      all { roll == 4, startFailed(r) },
      all { roll == 5, launchFails(p._1, p._2) },
      all { roll == 6, closeFailsForHalt(rt) },
      all { roll == 8, rejectStart },
      all { roll != 9, answerInject(rt, true) },
      all { roll == 9, flag, answerInject(rt, false) },
      all { roll == 10, flag, listFails(rt) },
      all { roll == 12, flag, openFails(rt) },
    }
  }

  // ---------- 不变式 ----------
  // 只写 VDM pre/post 表达不了的次序事实；“只向无 end 的运行项追加”“end 只写一次”
  // “halt 只在全部运行项结束后”是 appendBucket/writeEnd/writeHalt 的 pre，由回放检查，不在这里复述。
  // REQ-53
  val noAdmitWhileHalting = not(ghost.admittedWhileHalting)
  val triggerIsFirst = RUNS.forall(r => haltTag(r) != NONE implies haltTag(r) == ghost.firstTrigger.get(r))
  // REQ-11
  val commandsInsideWindow = not(ghost.cmdOutsideWindow)
  // REQ-12/REQ-28
  val capturesAfterBody = not(ghost.captureBeforeBody)
  // REQ-13：回复的工具结果都已先记录；记录的工具结果都来自取回的工具输出。
  val replyAfterRecord = ALL_RTS.forall(rt => dmn.replied.get(rt) <= dmn.recorded.get(rt))
  val recordOnlyObserved = not(ghost.recordedUnobserved)
  // REQ-15
  val noRecordAfterWindow = not(ghost.recordedOutsideWindow)
  // REQ-29
  val verifyAfterAllCaptures = not(ghost.verifiedEarly)
  // REQ-34/REQ-39/REQ-55：运行项的 end 只在 close 返回之后写下（writeEnd 的 pre 不要求关闭）。
  val endAfterClose = ALL_RTS.forall(rt =>
    Set("Out", "Thrown", "RuntimeFault", "Halted").contains(endTag(rt)) implies rt.in(ws.closed))
  // REQ-7
  val finishedIsQuiescent = RUNS.forall(r => r.in(dmn.finished) implies finishedByRecords(r))
  // REQ-57
  val finishedHasNoHalt = RUNS.forall(r => r.in(dmn.finished) implies haltTag(r) == NONE)
  // REQ-42
  val rejectedDeriveHasNoEffect = ghost.deriveRejected implies (not(dmn.haltByDerive) and not(published("r2")))
  // REQ-44
  val deriveAfterOldRunStopped = published("r2") implies over("r1")

  val safety = and {
    noAdmitWhileHalting, triggerIsFirst, commandsInsideWindow, capturesAfterBody, replyAfterRecord,
    recordOnlyObserved, noRecordAfterWindow,
    verifyAfterAllCaptures, endAfterClose, finishedIsQuiescent, finishedHasNoHalt,
    rejectedDeriveHasNoEffect, deriveAfterOldRunStopped,
  }

  // ---------- 见证：说明这些路径确实被模拟到 ----------
  val witnessHaltWritten = RUNS.exists(r => haltTag(r) != NONE)
  val witnessNaturalFinish = RUNS.exists(r => r.in(dmn.finished))
  val witnessDerived = "r2".in(sched.handedOver)
  val witnessDaemonLostHalt = RUNS.exists(r => haltTag(r) == "DaemonLost")
  val witnessUncaughtHalt = RUNS.exists(r => haltTag(r) == "Uncaught")
  // 路径要走完一个运行项的整个闭包（含 inject）再停机，约 30 步，放宽定向模拟的步数。
  pure val maxSteps_witnessUncaughtHalt = 45
  val witnessReattached = ghost.reattached
  val witnessToolReplied = ALL_RTS.exists(rt => dmn.replied.get(rt) > 0)
  val witnessDefectReplied = ghost.defectReplied
  // REQ-24：已退出进程发出的在途 launch，在它的闭包已关闭（VDM closed）之后才得到回复。
  val witnessLateLaunchAnswered = ghost.lateLaunchAnswered
  // REQ-24：已退出进程发出的在途 inject，在它的闭包已关闭之后才得到回复，被拒绝。
  val witnessLateInjectAnswered = ghost.lateInjectAnswered
  // REQ-56：现场取得失败时运行项保持无 end（list 只在 close 返回后的一步里可调用，随机模拟难以走到）。
  val witnessListFailed = ghost.listFailed
  // REQ-43：并入的介入在停机过程停在 engine defect 上时得到 engine defect。
  val witnessDeriveDefectReplied = ghost.deriveDefectReplied
  // REQ-49：派生运行至少为一个旧记录追加了 Ref（让 appendRef 的 pre 被回放）。路径要先走完一个运行项
  // 的自然结束再派生，最短也要近 30 步，随机走到时更长，超过默认步数，所以单独放宽定向模拟的步数。
  val witnessRefAppended = referenceSources != Set()
  pure val maxSteps_witnessRefAppended = 70
}
