# soroi 需求

- REQ-1 **输入**是已保存的边文件、所引用的 preset bundle、逐属性的任务输入原始值和运行时环境；**前置条件**是调用方已经选定工作流，且运行前检查可以读取完整工作流与 bundle。
- REQ-2 同一个 parser 必须用于起任务输入、`soroi-closure` 参数（`run`、`return`、`throw`）、程序 stdout 的结构解析和介入改值，调用方不得绕开 `Parsed` 产物直接构造值。
- REQ-3 解析并固化输入文件，durable 写入 bundle，再以 `writeRun` 发布以 `RunId` 为键的完整 `RunRecord`，并在同一发布中记录 `RequestId → RunId`；在该发布完成前，RunId 不出现在读取结果中。
- REQ-4 `writeStart` durable 先于该 RuntimeId 的 `Workspace.open`。
- REQ-5 `P` 的每个输入属性都有一个 `Present` 来源；来源只能是任务输入、Bind 的源值（普通产出或被接住的异常）或介入编辑值。
- REQ-6 所有就绪候选可以并发启动，调度顺序不属于语义；一个候选的启动不得等待与其没有值消费关系的候选。
- REQ-7 运行完成当且仅当以下两个条件同时成立：

  1. 没有未 settled 的激活。
  2. 没有可启动的候选。
- REQ-8 调用方与引擎之间只有启动、停下、派生三种操作
- REQ-9 一次函数调用就是一个闭包：preset 定义函数，闭包是这个定义绑定了当前位置上可见的值之后的一次运行。闭包有明确的边界：开始时拿到输入，结束时交出返回值、捕获值或异常。
- REQ-10 副作用不需要全部处理。preset 预先声明“我能处理的副作用范围”——捕获集：约定路径上的文件、capture 程序的测量、闭包内经 `soroi-closure run` 调用声明工具留下的记录；范围内的在闭包结束时由闭包捕获，范围外的是盲区，引擎不看、不承诺、不传递。返回值只是捕获集中的一个特权项。
- REQ-11 `soroi-closure` 是 body 运行中与闭包交互的唯一途径：交回结果、调用工具、查询接口都经过它；约定路径上的文件、capture 的测量与 Program 体的 stdout 由闭包在出口自行取得，不经过它。

  闭包入口只在该 runtime 的受理窗口内受理这三个命令：从闭包过程发出 body 的 `launch` 起，到 body 的 `launch` 以 Failure 返回、body 的 `collect` 返回，或闭包过程开始为停机或 engine defect 结束本 runtime 为止，以先到者为准；窗口由闭包过程这一处打开与关闭，受理与关闭窗口在它这里依次发生；本进程没有该 runtime 的闭包过程时窗口不开。
- REQ-12
  - **返回值**是 body 交出的结果：Agent 体的返回值是经 `return` 写进返回槽的值，写进什么就是什么，soroi 只检查结构、不追问来源，通常就是 agent 的声称；Program 体的返回值是作者程序的 stdout。
  - **capture** 是作者程序在出口的一次测量：body 结束后由闭包运行，运行时机不由 body 决定。
  - **tool** 是作者程序在 body 中途的操作或测量：调用者（通常是 body）决定何时调用、带什么参数，可以调用多次，结果当场回给它，供它据此继续工作；程序由闭包启动，stdout 由闭包按声明结构解析并记录，所以闭包拿到的是程序的输出，不是调用者对输出的转述。
  - **`[files]`** 是约定路径上的文件：body 与程序直接读写，闭包在出口按路径带出。
- REQ-13 **声明工具的调用** `run <tool> [<json>]` 不是让调用者自己执行程序：调用者只给出调用时机与参数，核心以 Tool 角色的闭包参数启动作者声明的程序，按声明结构解析它的 stdout，先记录再回复。回给调用者的值与出口折叠用的值是同一条 `ToolRecord`，不经调用者转述。
- REQ-14 闭包参数按角色闭合：`Prepare = inputs`；`Body = Tool = inputs + prepared`（Tool 另加解析后的调用输入）；`Capture = inputs + prepared + body 结果`；`Verify = Capture + 全部出口捕获产出`。
- REQ-15 声明工具的失败不写成功 `ToolRecord`，也不形成 `ThrowFault`；调用者看到拒绝后怎么做是它自己的事。

  | 工具 | `Workspace.launch` 或 `collect` Failure | `CallRejected{…, call, reason:{kind:"Infra", message}}` | 不形成 `ThrowFault`；交互已被要求结束时不记录。 |
- REQ-16 `soroi-closure` 是 Agent 体唯一的业务值通道；harness 自带的结构化输出、最终回复和其他返回值最多进入 agent trace，永远不进入返回槽或产出。
- REQ-17 槽为空且正常结束时，返回按 `Absent` 进入 §6.8，缺值由 verify 的 required 判断，soroi 不为 agent 兜底
- REQ-18 prepare 在 body 之前、在同一工作根上运行（`01-definition.md` §3.5）；它对工作根的改动原地留给 body，不被捕获。prepare 成功产生的派生值进入闭包参数的 `prepared`，也可供模板的 `Prepared` 根使用；无 prepare 时该部分为空。
- REQ-19 Workspace 是一个 runtime 的闭包边界，也是核心唯一的执行契约。它维持闭包的工作根并作为该根的唯一文件权威；执行 Program 体与闭包内的 preset 程序；经它的 harness 插槽启动 agent；让 `soroi-closure` 出现在闭包内执行环境（含 agent）的 PATH 中，并把调用连同 `RuntimeId` 路由回核心的闭包入口。harness 插槽放什么由实现者决定；核心从不写 agent 的调用方式，也不接触 harness 的配置文件。
- REQ-20 `Placed.path`、user prompt 中的 `File` 路径文字、`[files]` 约定路径与 settle 快照的 `Workspace.list`，以及 agent 的工作目录，都指向同一个工作根。preset 程序无论在哪个执行环境运行，工作根对它们是同一份，`Placed.path` 指向同一内容。
- REQ-21 文件在约定好的路径上读写。进入闭包时，闭包把输入文件放进工作根；agent 与程序直接读改；闭包结束时，闭包按 `[files]` 声明的路径捕获文件并带出。拷贝与捕获由闭包做，不由 agent 做。
- REQ-22 运行前检查的 (b) 项（`02-workflow.md` §4.7.4）把每个 preset 的 `[workspace]`、`[harness]` 原始表连同配置表中的同名全局表交给注入的 Workspace 实现者，调用 `Workspace.parseConfig(preset, global)`；它只负责诊断和构造 Config，诊断以 `PresetError.ConfigRejected` 报告，未知键忽略，合并策略由实现者决定。该前置阶段不探测外部可达性，也不创建运行时资源。
- REQ-23 `open(config, runtimeId)` 对同一 RuntimeId 幂等：首次返回 Handle 开始闭包的生命周期，之后任一 daemon 进程都能以同一 Config 重新附着同一闭包并请求 `close`，闭包已经关闭时也一样。
- REQ-24 关闭由接纳 `inject` 与 `launch` 的一方记下，与接纳互斥：记下之后 Workspace 拒绝该 RuntimeId 的 `inject` 与 `launch`，任一 daemon 进程（包括已退出的）发出的在途 `launch` 要么在关闭之前被接纳，要么被拒绝。`close(handle)` 返回即闭包生命周期结束：该 RuntimeId 下被接纳的全部执行——包括 agent 与它调用的工具，以及已退出的 daemon 进程发出的调用所启动的执行——都已终止，`soroi-closure` 的调用也不再路由到核心；重新附着后的 `close` 同样如此，再次 `close` 照样成功。
- REQ-25 body 只启动一次。Program 非成功结束或 Agent `AgentEnd.Failed` 且返回槽为空时，闭包以 `Runtime{Body}` 结束；引擎不重起。agent 启动失败时是否由 harness 重试，属于 Workspace 的 harness 插槽的实现选择，核心看到的仍是一次 `launch` 与一次结束。
- REQ-26 agent trace 由 Workspace 在 `collect` 中一次性给出完整内容，核心原样记录为 `Stored` 或 `Unavailable`；trace 的获取方式属于 harness 插槽的实现选择，核心不猜测、不补造 trace，也不把 harness 消息写入 Outcome。
- REQ-27 **capture**：每个 capture 程序以 Capture 角色的闭包参数运行，它可以测量工作根和外部；stdout 按该 capture 声明的结构 parse。
- REQ-28 出口捕获的各项互不可见、没有先后，可以并发执行：capture 程序看不到其他 capture、`[files]` 或 tool 折叠的结果。全部完成后，`captured[]` 按 `OutputName` 字节序排列。
- REQ-29 全部出口捕获完成后才执行 verify：它是本节点内的后置判断。required 产出为 `Absent` 时形成 `Runtime{reason: Verify{output, rule: Required}}`；verify 程序绑定的产出为 `Absent` 且非 required 时跳过；有值时以 Verify 角色的闭包参数启动 verify 程序，正常结束表示通过，非正常结束形成 `Runtime{reason: Verify{output, rule: Script{file}}}`。坏结果因此停在本节点，不流到下游；这个 runtime 异常由谁消费按 `02-workflow.md` §4.9 决定。
- REQ-30 **tool 折叠**：`fold=last` 选择该工具 `ToolRecord` 中最高 `Seq` 的值，`fold=all` 按 `Seq` 升序形成 List；没有对应 `ToolRecord` 时为 `AbsentCapture`，不伪造值。
- REQ-31 所有出口捕获和 verify 通过时，闭包的 `Outcome` 为 `Out{captured[]}`；`AbsentCapture` 保留在本次计算中但不加入环境。
- REQ-32 派生运行取得全新的 `RunId`，其 runtime array 的前缀 `Ref` entries 指向源 `RuntimeId`；已有 RunRecord 与已有 runtime entries 不可变。
- REQ-33 `appendBucket` 只向仍无 end 的 runtime 追加一条已观察的事实
- REQ-34 `writeEnd` 以一次原子发布同时写入结束时间、`Outcome` 和 `Snapshot`；一个 runtime 至多成功一次，snapshot 没有单独的发布。
- REQ-35
  - **自有记录**：soroi 作为源头写下的事实——`RunRecord`、runtime entry 的位置与 `InputRecord`、Ref、rendered、闭包入口受理并判定的 `SlotWrite` 与不带 `call` 的 `CallRejected`、`Seq`、每个 runtime 的 `Outcome` 与 run 的 `halt`。
  - **对端副本**：从 Workspace 取回的结果，只代表取回那一刻，一次取回、不刷新——`BodyRun` 与 `ProgramRun` 中的结束事实与 trace、`ToolRecord` 与带 `call` 的 `CallRejected` 所依据的工具结束事实与 stdout、`Snapshot`、materialized 中的 `Placed.path`。
  - **索引与意图**：start 事实中的 `Exec` 指向 Workspace 中的一次执行，`ToolCall` 记录调用意图。它们不表示执行状态；缺少对应的完成事实只说明没有取回结果（§10.4）。
- REQ-36 `end = Open` 只表示这个 Own runtime 的结束锚点 `writeEnd` 尚未写下，不表示 Workspace 中的执行是否还在进行。
- REQ-37 `Ref` 以 `readActivation(source)` 读取 source entry 一次，校验它是 `Own`、bundle digest 相同且有非 `Halted` 的 durable end，返回 source 的记录；不执行旧 runtime，不修改任何 run。
- REQ-38 派生 run 的环境由压平后的记录重建，与 `03-runtime.md` §5.5 相同：`Out` 的 `Captured` 进入 `values`；被消费的 `Thrown` 以变体、payload 和记录的 `start.input.values` 进入 `caught`；被消费的 `Runtime` 以原因的用户词文本（`05-cli.md` §12.13）和 `start.input.values` 进入 `caught`。重建只读记录，不执行程序。
- REQ-39 Snapshot 是闭包关闭后工作根的现场观察，留给回放看，不是产出。
- REQ-40 时间轴只把运行项的开始、结束和位置投影成区间；回放读取某个运行项已经发布的输入、渲染文本、结果、bucket 和快照，没有结束记录的部分原样显示为无结束记录（runtime 为 `Open`），不作推断；对比按语义位置对齐两个 run。三者都不执行闭包。
- REQ-41 停机、人工暂停、daemon 崩溃恢复和介入是同一件事：run 停下来，之后用户从它派生一个新 run 继续——可以带编辑，也可以不带。旧 run 的记录永不改写；受影响的节点和被停机结束的节点在新 run 里、新的闭包中从头运行，其余已完成的节点以 Ref 复用。
- REQ-42 介入的输入是一个旧 `RunId`、零个或多个编辑，以及可选的新并发上限。每个编辑是 `{at: RuntimeId, attr: AttrName, value}`：`at` 必须属于旧 run，`attr` 必须属于该 runtime 所在节点 preset 的 `[inputs]`，同一 `(at, attr)` 至多出现一次。编辑值沿用运行入口的输入文件边界（文件路径以请求携带的命令当前目录为根），再按该属性的结构交给 parser，结果必须为 `Present`。这些校验在任何停机之前完成；任一条件不满足时介入被拒绝，旧 run 不变，不建立新 run。
- REQ-43 **停下旧 run。** 旧 run 尚未写 halt 且状态不是 `Finished` 时，daemon 以 `Manual{client, at}` 开始停机过程（`03-runtime.md` §9），或并入进行中的停机过程，并等待它结束。已写 halt 或已经 `Finished` 的 run 跳过这一步；停机过程结束时 run 已按记录 `Finished`（不写 halt）同样继续派生。停机过程某一步以 engine defect 失败时，介入报告 engine defect，不派生；停机过程停在原处，之后的 `soroi stop` 或介入并入它继续。
- REQ-44 **建立新 run。** 生成新的 DerivationId 与 RunId；复制旧 run 的 bundle、`task`、`workflow`、`inputs`、全局 `workspace` 与 `harness` 表；`startedAt` 取新时间；`parallel` 取请求给出的值，否则沿用旧值。以 `derivedFrom = Derived{from: 旧 RunId, edits}` 通过 `writeBundle`、`writeRun` 发布。编辑值不回写旧 run 的 inputs。
- REQ-45 受影响位置和旧 run 中从未启动但候选规则允许启动的位置，都作为新的 Own 激活启动。被编辑位置的新 `InputRecord` 中，编辑属性的来源记为 `Edit`。
- REQ-46 Ref 表示派生 run 在该位置直接采用旧 run 中同一次调用——同一定义绑定同一组值——已经发布的结果，不重跑它。介入只改值、不改定义，未受影响的位置绑定的值与旧 run 相同，因此是同一次调用。
- REQ-47 起点 `A₀` 是以下位置的并集：

  - 每个编辑的 `at` 所在位置；
  - 所有不可引用的记录的位置（§10.5）：`Halted`、没有线消费的 `E`，以及无 end 的记录。
- REQ-48 Aᵢ₊₁ = Aᵢ ∪ {
    Q.position |
    Q 属于旧 run，且 Sources(Q) 中存在 Bound、Judge 或 Continue，
    且该来源的 position 属于 Aᵢ
  }

  `TaskInput` 与 `Edit` 没有位置，不参与传播；`Bound`、`Judge`、`Continue` 传播值或容器控制，都参与。旧 run 有限，每个位置至多加入一次，到达不动点时得到 `Affected`。
- REQ-49
  - **Refs**：不在 `Affected` 中的旧记录。它们按定义都可引用，新 run 为每个追加 `Ref{source: 旧 RuntimeId}`。
  - **重跑**：`Affected` 中的位置。新 run 不为它们写 Ref；它们和旧 run 中从未启动的位置一样，由普通调度在候选条件满足时启动为新的 Own 激活。
- REQ-50 没有编辑时，这就是“原样继续”：被停机结束的节点、没有线消费的异常所在的节点，以及它们的下游在新闭包里从头运行。旧 run 的闭包现场不被复用，新激活总是新的闭包。
- REQ-51 引擎只看闭包结束了没有。它不重试、不 memo、不 resume、不回退。
- REQ-52 没有线接住的异常按工作流的 `uncaught` 处理（`02-workflow.md` §4.9）：`Halt` 触发 §9 停机，这个 end 欠下的停机在 halt 写下之前使 run 保持未结束（`04-records.md` §10.6）；`Continue` 不触发停机，这条依赖路径上的候选按上一段变得不可达，异常作为叶子保留在该激活的 end 中。

  `Manual{client, at}`：客户端 `Stop` 请求，或介入对尚未结束的 run 的前置停机（`04-records.md` §11.1）。

  `DaemonLost{at}`：daemon 启动时发现 run 尚未结束（§9.4）。

  | runtime 异常 | 引擎产生：执行出错、body 失败、verify 判为坏结果、抛出不符合声明的异常 | 在边文件里把 `E.Runtime` 接到下游节点 |
- REQ-53 停机过程是本进程内的生命周期：从开始到结束（§9.2），调度器不为该 run 准入候选，同一 run 后到的停机请求并入它，在它结束后按请求种类得到它的结局（§9.2；它停在 engine defect 上时得到 engine defect），触发保持为最先受理的那个。
- REQ-54 停机过程先停止为该 run 准入候选，并等调度器已经发出的 `writeStart` 返回：返回 `RuntimeId` 的为其启动闭包过程，返回 Failure 的没有 runtime entry（§5.2）。之后的 Own runtime 集合只由 runtime 数组给出，不再增长；然后对 run 中每个没有 end 的 Own runtime，请 Workspace 关闭它的闭包，再写它的 end：
- REQ-55 结束任一生命周期时，先由内向外结束它嵌套的生命周期——向确认者发出请求并等待返回——最后写它自己的结束锚点。自然收束等执行自行结束，再关闭闭包；停机直接请 Workspace 关闭闭包，闭包中的执行由 Workspace 一并结束。核心不进入闭包内部挑选执行，也不维护与这些锚点并行的中间状态。
- REQ-56 `close`、`list` 或 `writeEnd` 任一 Failure 都保持无 end，作为 engine defect 报告，闭包过程随之结束；这个 runtime 之后由停机过程按“本进程没有它的闭包过程”收束（§9.2）。`writeEnd` 成功后 Own runtime 的生命周期结束。
- REQ-57 所有 Own runtime 都有 end 之后，停机过程按 `04-records.md` §10.6 从记录判断 run：已是 `Finished`——全部 runtime 自然结束、没有欠下的停机、没有可启动候选——时不写 halt，停机过程随之结束，并入的 `Stop` 得到用户错误“run 已完成”，并入的介入照常派生（`04-records.md` §11.1）；否则以 `Store.writeHalt(run, trigger)` 写下结束锚点，并回复所有并入的请求。
- REQ-58 引擎不 resume：下一次 daemon 启动时，对每个尚未结束的 run——`halt = None`，且存在无 end 的 Own runtime、存在 end 为 `Halted` 的 Own runtime、存在欠下停机的 end（`uncaught = "halt"` 下没有线消费的异常），或按 §5.4 仍有可启动候选——以 `DaemonLost{at}` 开始停机过程。
- REQ-59 任一步的 Workspace 或 Store Failure——包括重新附着时 `parseConfig` 的诊断与 `open` 的 Failure——是 engine defect：该 runtime 保持无 end，等待中的请求得到 engine defect；停机过程不结束，停在原处，调度器仍不为该 run 准入候选。之后的停机请求并入它，从尚无 end 的 runtime 继续；daemon 退出后由下一次启动重新开始。
- REQ-60 C9 就是「数据在 Store 与闭包之间直接进出」那一条
