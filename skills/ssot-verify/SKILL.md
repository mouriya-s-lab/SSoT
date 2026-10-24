---
name: ssot-verify
description: SSoT独立验证：由未参与设计的上下文，从需求独立写出应有的约束与应有长相，再在design/的规格里逐条找违反情形，逐项审查元素、场景、调用、文字与模块；只报告不修改。先读ssot再读本skill；用户未明确指定验证块时禁读。
---

# ssot-verify：独立验证设计

验证只报告结论与证据，不修改 `design/`，也不替作者重写设计。每一步的判断写进验证方自己的台账 `.tmp/ssot-verify/<验证方>/`，由 `ssot verify <子命令> <design> --as <验证方>` 枚举这一步要判断的每一项，核对每一项都判了、证据找得到、反例求值成立（台账的共用规则见 `ssot` 总纲第四节）。工具不替验证者下结论。

| 步骤 | 子命令 | 台账（`.tmp/ssot-verify/<验证方>/` 下） | 逐项判断的对象 |
|---|---|---|---|
| 工具检查 | `check` | 无 | `ssot check` 的错误与 VDMJ 的警告 |
| 第一步 | `expect` | `materials.yaml`、`expect/` | 应有长相与 README 初判；每个需求块；写下的每条应有约束 |
| 第一步 | `gaps` | `gaps/` | 每条应有约束的遗漏、过强、误当必需 |
| 第二步 | `attack` | `attack/` | 每条应有约束的五种违反情形；生命周期约束另判四问 |
| 第三步 | `elements`、`scenarios`、`flows` | `elements/`、`scenarios/`、`flows/` | 每个规格元素；每个场景与场景体里每处调用、先后、分支与挑选；显式体里每处调用的值流 |
| 第四步 | `prose`、`modules` | `prose/`、`modules/` | 每条正文（段落、列表项、表格行，含主题文件）；每个设计目录的每个问题；整份设计 |
| 第五步 | `owner` | `owner/` | 每条应有约束的归属 |
| 第六步 | `po`、`review` | `po/`、`review/`、`review.json` | 每条未定或未评估的证明义务；模型审查报出的每个反模式 |
| 结论 | `verdict` | `verdict/` | 每条应有约束成立、不成立或未能判定 |
| 汇总 | `status`、`report` | 无 | 以上全部；`report` 把台账排成交付视图 |

第三、四步的每个问题单独一槽，结论是 `ok`、`problem`（有问题，报警告）、`not_applicable`（写明为什么不适用）或 `undecided`（看过但判定不了，报警告），附 `reason`。判为 `problem` 时必须给出 `at`（设计里的位置：规格元素或 `路径.md:行`）与 `fix`（修法，交给作者）；其余结论的 `at` 可选。`at` 写规格元素时，工具在问题里补上它的 `文件:行号`。工具在缺判骨架里给出每一槽要问的问题；一槽 `ok` 只说明这一问看过了。

## 一、谁来验证

验证必须有 `fable`（`claude-fable-5-1`）与 `argon`（`gemini-4-argon`）两方同时参加：`fable` 擅长从依赖方向看出视角倒置、有判定无主人的悬空责任与只写在文字里的生命周期缺口；`argon` 擅长顺着“谁观察值结构”看出过度展开、多来源积压与信任边界失守，并用模块类型可见性筛掉不成立的提议。两方长处正交，结论合拢才完整。主 agent 把 `ssot` skill 目录下的 `agents/ssot-fable.md` 与 `agents/ssot-argon.md` 原样拷入当前项目的 `.omp/agents/`（直接拷贝现成文件，不在运行时手写或修改内容）。主 agent 本身是 `fable` 或 `argon` 时，自己担任这一方，只派发另一方；都不是时同时派发 `ssot:fable` 与 `ssot:argon`。派发时只告诉它们“用 ssot skill 做 ssot-verify 的验证”、`design/` 与需求材料的位置，以及它们的 `--as` 名字（`fable`、`argon`），不另加规则、步骤或预设结论。验证范围大时分批：每个验证方先不分范围完成第一步的 `expect`（它只读需求材料、`README.md` 与依赖图，给出应有长相与全部应有约束及其持有目录，后面的分批靠它）；之后按 `--dir <目录>` 或 `--constraint <编号>` 分批派发 `gaps` 及以后的子命令，同一验证方的各批写各自的台账文件；整份设计的各项（`modules` 里以 `design#` 开头的）只在不带范围时判。被派发的代理从第二节开始执行，不再派发。

主 agent 只汇总，不加自己的结论：两方的 `ssot verify status` 与 `ssot verify report` 完整列出，标明出自哪一方；两方判断相反时并列，不裁决。交付前删掉拷入的 `.omp/agents/ssot-*.md`。

## 二、依据

只用需求材料、`design/`、`ssot` 与本 skill。作者的草稿、设计台账、推理与“检查通过”的汇报都不作依据，也不向作者询问。一条约束要靠作者另外解释才成立，按“不成立”处理。

VDM 只是设计的一种写法，不按 VDM 的字面去审：先想清需求要满足什么、设计本来应该长什么样，再看规格；不把审查退化成在既有规格里找“删哪个变量、接哪根参数、抽哪个辅助函数”。

## 三、第一步：不看规格，写出应有长相与应有约束（`expect`、`gaps`）

在 `materials.yaml` 列出需求材料（`materials: [路径]`，路径相对仓库根）。先只读需求材料、`design/README.md` 与各模块、单元的 `README.md`，并运行 `ssot graph <design>`，不读任何含 VDM 的文件。读完立刻写下应有长相（`shape`），想清楚之前不读规格：

- `requirements`：这个系统面对什么外部约束，在问题域里要达成什么效果、满足什么需求；
- `perspectives`：为了自然地满足这些需求，要站在哪几个视角看问题，需要定义哪几样核心概念；
- `modules`：各模块的职责边界应该是什么样；
- `readme`：各 `README.md` 自身的初判——每条依据是否有真实外部来源、“所以……”能否推出结论；改变形状的决定是否在「为什么」里写了理由与不选的替代；包含关系是否写进了「语义」。读规格之后在第四步逐条复核。

`ssot verify expect` 要求有这份 `shape`，并把需求材料切成需求块，每块写出它要求的应有约束，或说明它不约束任何对象的理由（`none`）。每条应有约束包括：约束哪个对象、对象种类、允许什么变化、什么关系不变、一个违反情形、类别、应由哪个目录持有。

```yaml
shape:                                     # expect/*.yaml 里写一处
  requirements: …
  perspectives: …
  modules: …
  readme: …
requirements:
  - block: {path: request.md, heading: [需求], text: …}
    constraints: [E1]
constraints:
  - id: E1
    object: …
    kind: index                            # definition | execution | fact | index
    varies: …
    invariant: …
    violation: …
    category: transition                   # invariant | admission | transition | lifecycle
    owner: {dir: architecture, connection: …}   # dir 是设计里的目录
```

写对象时分清定义、执行、事实与索引：两份内容相同的它算一个还是两个，答案不同就是不同的对象。失败结局是 `transition`；只有需求要求失败之后的恢复次序或生命周期中断的收尾时，才另写 `lifecycle` 约束。`expect` 有错误（包括没写 `shape`）时，后面的子命令拒绝往下核对。

写下之后再读规格：按 `design/README.md` 的阅读次序逐个模块读，每读完一个模块就拿它对照 `shape` 与应有约束。读完后 `ssot verify gaps` 要求每条应有约束回答三问，每问写 `found`、`at`（规格里的位置）与 `reason`：

- **遗漏（`missing`）：** 需求要求的约束，规格里没有。判为没有遗漏时，`at` 要指出规格里写着它的位置；规格写不清、本该写进「语义」却没写的，也算遗漏；
- **过强（`overstrong`）：** 规格写了需求没要求的更强约束，例如把本应独立的多次执行当成同一个；
- **误当必需（`misnecessary`）：** 规格把怎样运行写成了约束。判定方法：换一种实现或调用先后，需求仍然满足，规格却不再满足。

## 四、第二步：逐条找违反情形（`attack`）

对每条应有约束，先找出规格里排除违反情形的类型或谓词，再试着构造一个规格允许、却违反这条约束的情况。`ssot verify attack` 给每条约束五个槽，每个槽都要判，并列出这条约束所在目录的状态、操作（带 `ext`）与导入它的模块作为候选：

- `initial`：一个初始状态；
- `call`：一次满足 `pre` 的调用，以及它的 `post` 允许的一个结果，尤其看 `post` 没约束到的分量；没列进 `ext wr` 的分量必须保持不变；
- `compose`：两个连接先后组合出来的状态；
- `bypass`：不经场景、直接调用连接的使用方；
- `import`：一条导入路径，让不该触达的模块触达了。

每个槽的 `verdict` 是 `excluded`（`by` 列出排除它的元素）、`not_applicable`、`counterexample` 或 `undecided`，并写 `reason`。能构造出来，这条约束就不成立，把构造出的情况写成反例 `witness`。场景能走通，只说明那一条路没有违反，不说明约束成立：只拿场景作 `by` 时工具给出警告。

反例由工具用 VDMJ 求值核对，有两种写法：

```yaml
witness:                                   # 一次调用：工具拼出 pre_Op、post_Op 与 violates，并核对帧条件
  operation: "Run`Finish"
  args: ["mk_token(1)"]
  result: …                                # 有返回值时
  before: "mk_Runs({1 |-> mk_token(1)}, {mk_token(1)})"
  after: "mk_Runs({1 |-> mk_token(1)}, {})"
  violates: "…"                            # 用 before、after、result 写出违反的关系
witness: {module: Run, expression: "…"}    # 其余情形：以 module 为默认模块，表达式要求值为 true
```

调用式反例里，`pre_Op` 与 `post_Op` 由工具按操作有没有写 `pre`、`post` 拼出；`post_Op` 返回 `true` 才说明规格允许这次变化。`post_Op` 不检查 `ext`，工具另外核对没列进 `ext wr` 的状态分量前后相同。`mk_` 构造状态时会检查 `inv`，违反 `inv` 的状态构造不出来，求值报错。求值出错、为 false 或改了帧外分量，都不算反例。类型在默认模块里不可见、构造不出值时，判 `undecided` 并写明原因。

`lifecycle` 类约束另判四问：`anchors`（由哪个连接开始、哪个连接结束、由谁确认）、`nesting`（内层在外层开始之后才开始）、`evidence`（外层结束锚点在内层全部关闭并取回证据之后才写下）、`failure_close`（内层关闭或取回证据失败时，没有伪造外层结束锚点）。

## 五、第三步：逐个元素、场景与调用反查（`elements`、`scenarios`、`flows`）

`ssot verify elements` 对规格里的每个类型、字段、函数、操作与场景，要求判为守着第一步里的哪条约束（`guards`）、是哪条约束所需的连接（`connection`），或不该进 VDM（`extraneous`；常变的业务内容本身写进了规格也判这一项）。每个元素再问：

- 定义与字段都问：`comment_meaning`（说明写它是什么、承诺什么，不只复述类型形状）、`signature`（说明里提到的参数、载荷字段、要区分的结局或状态都在签名与字段里真实存在，没有用一个 `bool` 混掉要区分的结局）、`wording`（不会让人误解成实例、指针、成员变量、缓存或存储）、`action_words`（动作与状态词与实际定义一致：按等价引用已发布事实不叫“拷贝/复用”，输入变了构成新调用不叫“原地重跑”）；
- 定义另问：`predicate_promise`（说明里的行为承诺有 `inv`、`pre` 或 `post` 的合取项真正排除违规情形；跨操作的先后由场景规定）、`nonvacuous`（没有为挂住参数名而写恒真子句）、`design_reason`（写出的理由是设计层面的，不拿“不存储副本、避免同步负担”这类存储或实现优化当理由）；
- 类型另问 `observation`（只有观察者要分支或读字段才展开，只原样传递的保持 `token`）、`struct_exposure`（导出带不带 `struct` 与使用方是否读结构一致）、`outcomes`（作为结局时只列合法调用方必须区分处理的分支，不逐项列失败原因）、`recovery`（可观察的失败分支写明改走哪个连接恢复）、`consumption`（导出后下游确有消费：写出使用位置，或系统外调用方的契约与依据）；
- 函数另问 `decision_form`（结果本身是约束、两个独立实现对同一输入必须得出同一结果时写显式体；结果用性质刻画、允许多个合格结果或不想绑定算法时只写签名与 `post`；`reason` 写明属于哪一种）与 `consumption`（导出的判定在下游确有消费，没有导出时判 `not_applicable`）；
- 状态另问 `minimality`（只放连接面要守住的事实）、`surface_invariant`（共享状态的操作共守同一条 `inv`，`inv` 简单）、`projection`（能由事实算出的上层状态写成纯函数投影，没有重复存储）；
- 有 `ext wr` 的隐式操作另问 `frame`：每个 `or` 分支都写齐了这一支没改的 `wr` 分量（`x = x~`）。

不读写任何状态的隐式操作，工具直接警告应写成函数，并给出它的 `文件:行号`。

`ssot verify scenarios` 对每个场景问 `result`（交给调用方的结果区分了正常推进与故障）；对场景体里的每处调用、先后、分支与挑选，要求判为对应哪条应有约束（`constraint`）或是在模拟业务怎样运行（`simulation`）。为闭合被调连接的结局而写的分支，对应它所服务的那条约束。每处调用另问 `outcomes`（被调连接返回的每一支可观察结局在本场景或配套的恢复场景里都有处理）与 `admission`（会产生持久状态或外部动作的调用之前已完成合法性校验），先后另问 `order`（先后与需求一致；后面要用的参数在需求所说的时点已经存在）。调用记录依据被调连接的契约，契约改了就过期重判。

`ssot verify flows` 对显式函数与场景体里的每处调用问四件事：`responsibility`（参数多或传固定空值时，先判断那个参数代表的事是否本属另一个视角或模块；是就该拆回原处，而不是要求上游一路透传）、`inputs`（决定结果的关键值都传了进去，没有半路丢掉、传旧值或类型没接上）、`result`（这次调用的产出在下游被实际消费）、`timing`（实参在需求所说的时点已经存在）。实参是字面空值（`{|->}`、`{}`、`[]`）时工具在骨架里标出来；架构模块导出的判定（函数）没有任何模块导入时，工具直接警告并给出 `文件:行号`；导出的类型与判定有没有被消费，不论有没有调用点，都在元素的 `consumption` 槽里判。

## 六、第四步：文字与模块（`prose`、`modules`）

`ssot verify prose` 对每条正文（`README.md` 与主题文件里的每个段落、列表项、表格行）逐条提问。每条都问受控文字：`restates`（没有复述规格已经表达清楚的内容，复述一部分也算）、`atomic`（一句一条，规则用“必须、不得、可以、只”）、`quantities`（数量写数值、单位与条件，常量定义在 `values` 里再引用）、`references`（提到规格元素时用双反引号写限定名，不另造同义词）、`current`（只写当前设计：没有状态标记、新旧并列、变更历史）、`wording`、`action_words`。`README.md` 的正文再按所在小节提问：

- 首段：`scope`（负责什么、不负责什么与规格实际承担的一致）；
- 「依据」：`source`（有真实的外部来源，不是结论复述自己，也不拿当前实现或技术选型当理由）、`implication`（“所以……”能推出它让设计多了或少了什么）、`quality`（质量要求写成“在〈环境〉下，〈刺激〉发生时，〈响应〉满足〈度量〉”且数值有出处）、`design_reason`；
- 「需求」：`source`（写出了来源，且真实对应需求材料）、`observable`（是问题域里可以观察到的结果，不是机器的功能列表）、`walk`（从它引用的规格元素一路走到需求所说的结果）、`collection`（涉及集合时，全集由显式纯函数算出，场景接收单个代表元走通单步调用，两者配合完整）；
- 「为什么」：`alternatives`（理由引用了依据；存在可信替代时写了为什么不选）、`design_reason`；
- 「语义」：`belongs`（写的是规格说不清的语义，不是规格已有的内容）。

主题文件的正文问 `belongs`；第一条另问 `expands`（开头说明它展开 README 的哪一节，拆出来的理由成立，没有拆散同一个不变量、生命周期或失败窗口）。

`ssot verify modules` 对每个设计目录逐个问，每个问题是一项义务，只依据它要读的原文：

- 架构目录：`partition`（按抽象划分，不按篇幅或执行步骤；拆出子模块的理由写进了 README；并列底座彼此正交）、`rationale_coverage`（每个改变架构形状的决定都在「为什么」里写了理由并引用依据，存在可信替代时写了为什么不选；`reason` 列出核对过的决定）、`containment`（适用的同进程、同部署、同信任范围、同存续期等包含关系写进了「语义」或它展开的主题文件，模块树不代表运行期包含；没有适用的包含关系时判 `not_applicable`）、`cross_semantics`（定时与重试、进程边界、崩溃后由谁按哪份事实接管等跨连接规律交代完整）、`boundary`（没有只服务单一业务的规则或可替换的实现做法写进架构）、`accumulation`（没有哪里积压了多个来源或视角的值与结构，没有整片定义脱离当前要观察的视角）、`files`（一起变化的元素放一个文件、按内容命名，独立变化的分开，不按篇幅拆，不拆散同一个不变量、生命周期或失败窗口）、`shape`（实际长相与第一步的应有长相对得上，没有拧巴或没想通的设计思路）；
- 业务单元：`composition`（只经导出的连接单向组合：点对点调用一个连接点，或点对面接入一个连接面，依赖单向无环）、`business_state`（不持有持久 `state`）、`token_origin`（不承诺结构的 `token` 只取自连接、原样传给别的连接，不自行制造）、`token_structure`（不读导出时没有承诺的结构）、`convergence`（结果在本单元边界收敛：在架构的一般规律内取子集或定细化策略，不越出架构的规律）、`containment`、`boundary`（常变的业务内容本身没有写进规格）、`cross_semantics`、`accumulation`、`files`、`shape`；
- 整份设计：`design#overall`（整个设计的长相能自然立住需求，需要定义的核心概念都定义了，值与动作的位置对；`reason` 讲清现有设计整体长什么样）、`design#forms`（按形式统计，规格没有退化成文字）、`design#navigation`（`design/README.md` 只列阅读次序，不写规则）。

模块里有 `from … all` 整体导入时，工具直接警告：`imports` 逐项列出用到的名字。

判 `accumulation` 时追问背后的原因：为什么这么多来源或视角的事堆到一处，按各自的视角责任本来应该怎么分；判 `problem` 时在 `fix` 写出拆回各处的建议。

## 七、第五步：核对归属（`owner`）

对每条约束问：连接的提供方无论服务哪个合法使用方都必须保证它吗？还是某项业务在连接之上加的条件、选择或组合？按答案核对它实际写在哪里（`actual`），判为 `match`、`misplaced`、`duplicated` 或 `absent`。下面几种都判为 `misplaced` 或 `duplicated`：

- 写在架构里、却只为某一项业务存在的约束；
- 因为写成 `pre` 更方便、事实存放在架构里、业务没有 `state` 或架构不能导入业务，而被放进架构的业务判定；
- 同一个东西在两处展开。

## 八、第六步：工具（`check`、`po`、`review`）

`ssot verify check` 运行 `ssot check`：它的错误是错误，VDMJ 的警告（例如没用到的参数）原样报成警告，逐条看过。`ssot verify po` 对每条未定或未评估的证明义务，要求找出守住它的东西：`pre`、`inv`、分支条件，或使它必然成立的类型与 `post`。找到就判 `guarded`，在 `guards` 写出位置，并在 `reason` 说明怎样守住；找不到就判 `missing_guard`，即缺了前置条件或分支守卫。

在 omp 的 Python `eval` 里运行语义反模式审查，把每条材料的判断存进台账根：

```python
%load skill://ssot/scripts/review.py
await review("/path/to/repo/design", save="/path/to/repo/.tmp/ssot-verify/<验证方>/review.json")
```

`ssot verify review` 核对当前设计的每条材料都判过（设计改了就要重跑），并要求对每个反模式判为采纳（`accept`，交回作者修改）或驳回（`reject`，写出理由）。工具通过不代表约束成立；工具报出的问题也不由验证者修改。

## 九、结论（`verdict`、`status`、`report`）

`ssot verify verdict` 要求每条约束在 `gaps`、`attack` 与 `owner` 都判完之后，给出三种结论之一，附证据：

- **成立（`holds`）：** `by` 列出排除违反情形的元素；`attack` 里有反例时不能判为成立；
- **不成立（`fails`）：** `counterexample` 指出 `attack` 里的反例槽，或 `contradiction` 写出规格内部的矛盾；
- **未能判定（`undecided`）：** `reason` 写出缺少的定义、依据或需求。

`ssot verify status <design> --as <验证方>` 汇总全部子命令。错误是没判完：缺判、槽位没填、证据找不到、判为有问题却没有位置或修法、反例求值不成立、记录过期或没盖章。警告就是验证报出的问题：不成立与未能判定的约束，遗漏、过强与误当必需，有反例或未能判定的攻击与生命周期问题，不该进 VDM 的元素、模拟运行的场景节点，元素、场景、调用、文字与模块上判为 `problem` 或 `undecided` 的每一问（带位置与修法），归属问题，缺守卫的证明义务，采纳或驳回的模型审查，以及工具直接给出的警告。不带范围运行、没有错误，才算整份验证完；带 `--dir` 或 `--constraint` 只说明那一批判完。

交付用 `ssot verify report <design> --as <验证方>`：它把台账排成交付视图，依次给出第一步写下的应有长相与 README 初判、`design#overall` 对现有设计整体长相的判断、形式统计与占比、证明义务核验表（每条的位置、要求成立的条件、结论、守卫与理由）、全部问题以及还没判完的项。每个问题都带设计源文的 `文件:行号`（判断者写的元素引用由工具补上行号，模型审查的采纳与驳回带上检出处的行号）与修法。它不加结论，只排列台账里已有的判断。问题交回 `ssot-design` 或 `ssot-draft` 修改。

修改后的设计不必从头重判：依据变了的记录会过期，新出现的元素、场景节点、调用、段落与证明义务会缺判，重判这些即可；没过期的记录仍然有效。某个问题只有在新一轮 `status` 里不再出现，才算解决。两方的 `status` 都没有错误、也没有问题交回作者时，删除 `.tmp/ssot-draft/`、`.tmp/ssot-design/` 与 `.tmp/ssot-verify/`；还有问题交回作者时保留它们，供下一轮只重判变了的部分。
