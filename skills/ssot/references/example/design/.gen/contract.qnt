// 由 ssot gen 从 contract/*.vdmsl 生成；只读，不要手改。
module Vdm {
  type Opt[a] = | Nil | Some(a)
}
module soroi_engine_values {
  type Shape = str
  type Raw = str
  type Parsed = { shape: Shape, raw: Raw }
  type ParseError = { shape: Shape, raw: Raw }
  type ParseResult = | ParseResult_ParseError(ParseError) | ParseResult_Parsed(Parsed)
}
module soroi_store {
  import Vdm as Vdm
  import soroi_engine_values as soroi_engine_values
  type AttrName = str
  type Byte = int
  type OutputName = List[Byte]
  type Path = str
  type Digest = str
  type FileRef = { path: Path, digest: Digest }
  type ListValue = { items: List[soroi_engine_values::Parsed] }
  type CapturedValue = | CapturedValue_AbsentCapture | CapturedValue_Parsed(soroi_engine_values::Parsed) | CapturedValue_FileRef(FileRef) | CapturedValue_ListValue(ListValue)
  type ToolName = str
  type CallId = str
  type RejectKind = | RejectKind_Infra | RejectKind_Invalid
  type RejectReason = { kind: RejectKind, message: str }
  type CallRejected = { call: Vdm::Opt[CallId], reason: RejectReason }
  type SlotWrite = { value: soroi_engine_values::Parsed }
  type Thrown = { label: str, payload: soroi_engine_values::Parsed }
  type ToolRecord = { call: CallId, tool: ToolName, seqNo: int, value: soroi_engine_values::Parsed }
  type Fact = | Fact_CallRejected(CallRejected) | Fact_SlotWrite(SlotWrite) | Fact_ToolRecord(ToolRecord)
  type ThrownFault = { label: str }
  type VerifyRule = | VerifyRule_Required | VerifyRule_Path(Path)
  type VerifyFault = { output: OutputName, rule: VerifyRule }
  type RuntimeReason = | RuntimeReason_Body | RuntimeReason_Exec | RuntimeReason_ThrownFault(ThrownFault) | RuntimeReason_VerifyFault(VerifyFault)
  type RuntimeFault = { reason: RuntimeReason }
  type RequestId = str
  type RunId = str
  type RuntimeId = str
  type Edit = { at: RuntimeId, attr: AttrName, value: soroi_engine_values::Parsed }
  type Position = str
  type BoundKind = | BoundKind_Caught | BoundKind_Produced
  type Bound = { at: Position, kind: BoundKind }
  type ValueSource = | ValueSource_Edit | ValueSource_TaskInput | ValueSource_Bound(Bound)
  type Sourced = { value: soroi_engine_values::Parsed, source: ValueSource }
  type ControlKind = | ControlKind_Continue | ControlKind_Judge
  type ControlSource = { kind: ControlKind, at: Position }
  type InputRecord = { attrs: AttrName -> Sourced, controls: Set[ControlSource] }
  type Time = int
  type Start = { position: Position, declared: Set[AttrName], input: InputRecord, at: Time, rendered: str }
  type Captured = { name: OutputName, value: CapturedValue }
  type Out = { captured: List[Captured] }
  type Outcome = | Outcome_Halted | Outcome_Out(Out) | Outcome_RuntimeFault(RuntimeFault) | Outcome_Thrown(Thrown)
  type Snapshot = Path -> Digest
  type End = { at: Time, outcome: Outcome, snapshot: Snapshot }
  type Own = { start: Start, buckets: List[Fact], fin: Vdm::Opt[End] }
  type BundleDigest = str
  type RefEntry = { source: RuntimeId }
  type Entry = | Entry_Own(Own) | Entry_RefEntry(RefEntry)
  type DerivationId = str
  type Derived = { id: DerivationId, source: RunId, edits: List[Edit] }
  type RunRecord = { bundle: BundleDigest, task: str, workflow: str, inputs: AttrName -> soroi_engine_values::Parsed, workspace: str, harness: str, startedAt: Time, parallel: int, derivedFrom: Vdm::Opt[Derived] }
  type Trigger = | Trigger_DaemonLost | Trigger_Manual | Trigger_Uncaught
  type PublishedEnd = | PublishedEnd_Open | PublishedEnd_End(End)
  type Published = { start: Start, buckets: List[Fact], fin: PublishedEnd }
  type StartFailed = | StartFailed_StartFailed
  type Interval = { position: Position, runtime: RuntimeId, startAt: Time, endAt: Vdm::Opt[Time] }
  type Aligned = { left: Vdm::Opt[RuntimeId], right: Vdm::Opt[RuntimeId] }
  type Records = { bundles: Set[BundleDigest], runs: RunId -> RunRecord, runtimes: RuntimeId -> Entry, order: RunId -> List[RuntimeId], halts: RunId -> Trigger, requests: RequestId -> RunId }
  pure val initial: Records = { bundles: Set(), runs: Map(), runtimes: Map(), order: Map(), halts: Map(), requests: Map() }
  type WriteStart_Result = | WriteStart_Result_RuntimeId(RuntimeId) | WriteStart_Result_StartFailed(StartFailed)
  type Call =
    | writeBundle({ b: BundleDigest })
    | writeRun({ r: RunId, q: Vdm::Opt[RequestId], rec: RunRecord })
    | writeStart({ r: RunId, s: Start, result: WriteStart_Result })
    | readStart({ rt: RuntimeId, result: Start })
    | appendBucket({ rt: RuntimeId, f: Fact })
    | writeEnd({ rt: RuntimeId, e: End })
    | writeHalt({ r: RunId, t: Trigger })
    | appendRef({ r: RunId, src: RuntimeId, result: RuntimeId })
    | readActivation({ src: RuntimeId, b: BundleDigest, result: Own })
    | replay({ rt: RuntimeId, result: Published })
    | timeline({ r: RunId, result: List[Interval] })
    | compare({ left: RunId, right: RunId, result: Position -> Aligned })
}
module soroi_engine_closure {
  import Vdm as Vdm
  import soroi_engine_values as soroi_engine_values
  import soroi_store as soroi_store
  type Inputs = soroi_store::AttrName -> soroi_engine_values::Parsed
  type Prepared = soroi_store::AttrName -> soroi_engine_values::Parsed
  type BodyResult = | BodyResult_Absent | BodyResult_Parsed(soroi_engine_values::Parsed)
  type PrepareArgs = { inputs: Inputs }
  type BodyArgs = { inputs: Inputs, prepared: Prepared }
  type ToolArgs = { base: BodyArgs, call: soroi_engine_values::Parsed }
  type CaptureArgs = { base: BodyArgs, returned: BodyResult }
  type VerifyArgs = { capture: CaptureArgs, captured: soroi_store::OutputName -> soroi_store::CapturedValue }
  type RoleArgs = | RoleArgs_BodyArgs(BodyArgs) | RoleArgs_CaptureArgs(CaptureArgs) | RoleArgs_PrepareArgs(PrepareArgs) | RoleArgs_ToolArgs(ToolArgs) | RoleArgs_VerifyArgs(VerifyArgs)
  type ReturnCmd = { raw: soroi_engine_values::Raw }
  type ThrowCmd = { label: str, raw: soroi_engine_values::Raw }
  type ToolCmd = { tool: soroi_store::ToolName, input: soroi_engine_values::Raw }
  type Command = | Command_ReturnCmd(ReturnCmd) | Command_ThrowCmd(ThrowCmd) | Command_ToolCmd(ToolCmd)
  type FoldMode = | FoldMode_All | FoldMode_Last
  type ToolDecl = { inShape: soroi_engine_values::Shape, outShape: soroi_engine_values::Shape, foldMode: FoldMode }
  type BodyKind = | BodyKind_Agent | BodyKind_Program
  type VerifyDecl = { output: soroi_store::OutputName, required: bool, script: Vdm::Opt[soroi_store::Path] }
  type ClosureDecl = { body: BodyKind, returnShape: soroi_engine_values::Shape, throwShapes: str -> soroi_engine_values::Shape, tools: soroi_store::ToolName -> ToolDecl, captureShapes: soroi_store::OutputName -> soroi_engine_values::Shape, files: soroi_store::OutputName -> soroi_store::Path, toolOutputs: soroi_store::OutputName -> soroi_store::ToolName, verifies: Set[VerifyDecl] }
  type ToolCall = { tool: soroi_store::ToolName, args: soroi_engine_values::Parsed }
  type Accepted = | Accepted_ToolCall(ToolCall) | Accepted_CallRejected(soroi_store::CallRejected) | Accepted_SlotWrite(soroi_store::SlotWrite) | Accepted_Thrown(soroi_store::Thrown)
  type Reply = | Reply_CallRejected(soroi_store::CallRejected) | Reply_ToolRecord(soroi_store::ToolRecord)
  type ToolStep = { recorded: Vdm::Opt[soroi_store::Fact], reply: Reply }
  type VerifyStep = | VerifyStep_RunScript | VerifyStep_Skip | VerifyStep_RuntimeFault(soroi_store::RuntimeFault)
}
module soroi_engine_derivation {
  import soroi_engine_values as soroi_engine_values
  import soroi_store as soroi_store
  type EditReq = { at: soroi_store::RuntimeId, attr: soroi_store::AttrName, raw: soroi_engine_values::Raw }
  type RejectedEdit = | RejectedEdit_BadValue | RejectedEdit_DuplicateEdit | RejectedEdit_ForeignRuntime | RejectedEdit_UnknownAttr
  type Rejected = { reason: RejectedEdit }
  type InputDecls = soroi_store::RuntimeId -> soroi_store::AttrName -> soroi_engine_values::Shape
  type Admitted = { edits: List[soroi_store::Edit] }
  type Validation = | Validation_Admitted(Admitted) | Validation_Rejected(Rejected)
  type Flat = soroi_store::RuntimeId -> soroi_store::Own
  type Partition = { refs: Set[soroi_store::RuntimeId], rerun: Set[soroi_store::Position] }
  type CaughtRuntime = { text: str, inputs: soroi_store::AttrName -> soroi_store::Sourced }
  type CaughtThrown = { label: str, payload: soroi_engine_values::Parsed, inputs: soroi_store::AttrName -> soroi_store::Sourced }
  type CaughtValue = | CaughtValue_CaughtRuntime(CaughtRuntime) | CaughtValue_CaughtThrown(CaughtThrown)
  type Env = { outputs: soroi_store::Position -> soroi_store::OutputName -> soroi_store::CapturedValue, caught: soroi_store::Position -> CaughtValue }
  type Call =
    | plan({ f: Flat, consumed: Set[soroi_store::RuntimeId], es: List[soroi_store::Edit], result: Partition })
}
module soroi_engine_control {
  import Vdm as Vdm
  import soroi_engine_derivation as soroi_engine_derivation
  import soroi_engine_values as soroi_engine_values
  import soroi_store as soroi_store
  type StartReq = { request: soroi_store::RequestId, workflow: str, inputs: soroi_store::AttrName -> soroi_engine_values::Raw }
  type StartReply = | StartReply_InputRejected | StartReply_RunId(soroi_store::RunId)
  type StopReply = | StopReply_AlreadyFinished | StopReply_EngineDefect | StopReply_Stopped
  type DeriveReq = { source: soroi_store::RunId, cwd: soroi_store::Path, edits: List[soroi_engine_derivation::EditReq], parallel: Vdm::Opt[int] }
  type DeriveReply = | DeriveReply_EngineDefect | DeriveReply_Rejected(soroi_engine_derivation::Rejected) | DeriveReply_RunId(soroi_store::RunId)
  type Call =
    | Start({ req: StartReq, result: StartReply })
    | Stop({ target: soroi_store::RunId, result: StopReply })
    | Derive({ req: DeriveReq, result: DeriveReply })
}
module soroi_workspace {
  import soroi_store as soroi_store
  type Config = str
  type ConfigTables = str
  type ConfigRejected = | ConfigRejected_ConfigRejected
  type ClosureId = str
  type Handle = { runtime: soroi_store::RuntimeId, closure: ClosureId }
  type ExecRef = str
  type Exec = { program: str, args: str }
  type Exit = | Exit_NonSuccess | Exit_Success
  type Collected = { status: Exit, stdout: str }
  type Failure = { message: str }
  type Rejected = | Rejected_Rejected
  type Closed = | Closed_Closed
  type Injected = | Injected_Injected
  type Closures = { closures: soroi_store::RuntimeId -> ClosureId, configs: soroi_store::RuntimeId -> Config, closed: Set[soroi_store::RuntimeId], running: ExecRef -> soroi_store::RuntimeId, routing: Set[soroi_store::RuntimeId], roots: soroi_store::RuntimeId -> soroi_store::Snapshot }
  pure val initial: Closures = { closures: Map(), configs: Map(), closed: Set(), running: Map(), routing: Set(), roots: Map() }
  type Open_Result = | Open_Result_Failure(Failure) | Open_Result_Handle(Handle)
  type Inject_Result = | Inject_Result_Failure(Failure) | Inject_Result_Injected(Injected) | Inject_Result_Rejected(Rejected)
  type Launch_Result = | Launch_Result_ExecRef(ExecRef) | Launch_Result_Failure(Failure) | Launch_Result_Rejected(Rejected)
  type Collect_Result = | Collect_Result_Collected(Collected) | Collect_Result_Failure(Failure)
  type Close_Result = | Close_Result_Closed(Closed) | Close_Result_Failure(Failure)
  type List_Result = | List_Result_Failure(Failure) | List_Result_Snapshot(soroi_store::Snapshot)
  type Call =
    | open({ c: Config, rt: soroi_store::RuntimeId, result: Open_Result })
    | inject({ h: Handle, files: soroi_store::Path -> soroi_store::Digest, result: Inject_Result })
    | launch({ h: Handle, x: Exec, result: Launch_Result })
    | collect({ h: Handle, x: ExecRef, result: Collect_Result })
    | close({ h: Handle, result: Close_Result })
    | list({ h: Handle, result: List_Result })
}
module contract {
  import soroi_engine_control as soroi_engine_control
  import soroi_engine_derivation as soroi_engine_derivation
  import soroi_store as soroi_store
  import soroi_workspace as soroi_workspace
  type Call =
    | NoCall
    | soroi_engine_control(soroi_engine_control::Call)
    | soroi_engine_derivation(soroi_engine_derivation::Call)
    | soroi_store(soroi_store::Call)
    | soroi_workspace(soroi_workspace::Call)
}
