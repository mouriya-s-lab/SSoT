// 由 ssot gen 从 contract/*.vdmsl 生成；只读，不要手改。
module Vdm {
  type Opt[a] = | Nil | Some(a)
}
module soroi_store {
  type RunId = str
  type RuntimeId = str
  type Outcome = | Outcome_Halted | Outcome_Settled
  type Trigger = str
  type Records = { runs: Set[RunId], runtimes: RuntimeId -> RunId, ends: RuntimeId -> Outcome, halts: RunId -> Trigger }
  pure val initial: Records = { runs: Set(), runtimes: Map(), ends: Map(), halts: Map() }
  type Call =
    | writeRun({ r: RunId })
    | writeStart({ r: RunId, result: RuntimeId })
    | writeEnd({ rt: RuntimeId, o: Outcome })
    | writeHalt({ r: RunId, t: Trigger })
}
module soroi_workspace {
  import soroi_store as soroi_store
  type ExecRef = str
  type Rejected = | Rejected_Rejected
  type Closures = { opened: Set[soroi_store::RuntimeId], closed: Set[soroi_store::RuntimeId], running: ExecRef -> soroi_store::RuntimeId }
  pure val initial: Closures = { opened: Set(), closed: Set(), running: Map() }
  type Launch_Result = | Launch_Result_ExecRef(ExecRef) | Launch_Result_Rejected(Rejected)
  type Call =
    | open({ rt: soroi_store::RuntimeId })
    | launch({ rt: soroi_store::RuntimeId, x: ExecRef, result: Launch_Result })
    | collect({ rt: soroi_store::RuntimeId, x: ExecRef })
    | close({ rt: soroi_store::RuntimeId })
}
module contract {
  import soroi_store as soroi_store
  import soroi_workspace as soroi_workspace
  type Call =
    | NoCall
    | soroi_store(soroi_store::Call)
    | soroi_workspace(soroi_workspace::Call)
}
