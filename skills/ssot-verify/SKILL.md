---
name: ssot-verify
description: SSoT独立验证：由未参与设计的上下文，从需求独立写出应有的约束，再在design/的规格里逐条找违反情形，并核对每个元素与归属；只报告不修改。先读ssot再读本skill；用户未明确指定验证块时禁读。
---

# ssot-verify：独立验证设计

验证只报告结论与证据，不修改 `design/`，也不替作者重写设计。每一步的判断写进验证方自己的台账 `.tmp/ssot-verify/<验证方>/`，由 `ssot verify <子命令> <design> --as <验证方>` 枚举这一步要判断的每一项，核对每一项都判了、证据找得到、反例求值成立（台账的共用规则见 `ssot` 总纲第四节）。工具不替验证者下结论。

| 步骤 | 子命令 | 台账（`.tmp/ssot-verify/<验证方>/` 下） | 逐项判断的对象 |
|---|---|---|---|
| 工具检查 | `check` | 无 | `ssot check` 的全部诊断 |
| 第一步 | `expect` | `materials.yaml`、`expect/` | 每个需求块；写下的每条应有约束 |
| 第一步 | `gaps` | `gaps/` | 每条应有约束的遗漏、过强、误当必需 |
| 第二步 | `attack` | `attack/` | 每条应有约束的五种违反情形 |
| 第三步 | `elements`、`scenarios` | `elements/`、`scenarios/` | 每个规格元素；场景体里每处调用、先后、分支与挑选 |
| 第四步 | `owner` | `owner/` | 每条应有约束的归属 |
| 第五步 | `po`、`review` | `po/`、`review/`、`review.json` | 每条未定或未评估的证明义务；模型审查报出的每个反模式 |
| 结论 | `verdict` | `verdict/` | 每条应有约束成立、不成立或未能判定 |
| 汇总 | `status` | 无 | 以上全部 |

## 一、谁来验证

主 agent 按总纲把 `agents/ssot-fable.md` 与 `agents/ssot-argon.md` 拷入当前项目的 `.omp/agents/`，同时派发 `ssot:fable` 与 `ssot:argon`。派发时只告诉它们“用 ssot skill 做 ssot-verify 的验证”、`design/` 与需求材料的位置，以及它们的 `--as` 名字（`fable`、`argon`）。验证范围大时分批：每个验证方先不分范围完成第一步的 `expect`（它只读需求材料、`README.md` 与依赖图，并给出全部应有约束及其持有目录，后面的分批靠它）；之后按 `--dir <目录>` 或 `--constraint <编号>` 分批派发 `gaps` 及以后的子命令，同一验证方的各批写各自的台账文件。被派发的代理从第二节开始执行，不再派发。

主 agent 只汇总，不加自己的结论：两方的 `ssot verify status` 完整列出，标明出自哪一方；两方判断相反时并列，不裁决。交付前删掉拷入的 `.omp/agents/ssot-*.md`。

## 二、依据

只用需求材料、`design/`、`ssot` 与本 skill。作者的草稿、设计台账、推理与“检查通过”的汇报都不作依据，也不向作者询问。一条约束要靠作者另外解释才成立，按“不成立”处理。

## 三、第一步：不看规格，写出应有的约束（`expect`、`gaps`）

在 `materials.yaml` 列出需求材料（`materials: [路径]`，路径相对仓库根）。先只读需求材料、`design/README.md` 与各模块、单元的 `README.md`，并运行 `ssot graph <design>`，不读任何含 VDM 的文件。`ssot verify expect` 把需求材料切成需求块，每块要写出它要求的应有约束，或说明它不约束任何对象的理由（`none`）；每条应有约束包括：约束哪个对象、对象种类、允许什么变化、什么关系不变、一个违反情形、类别、应由哪个目录持有。

```yaml
requirements:                              # expect/*.yaml
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

写对象时分清定义、执行、事实与索引：两份内容相同的它算一个还是两个，答案不同就是不同的对象。`expect` 有错误时，后面的子命令拒绝往下核对。

写下之后再读规格，读完对照第一步，`ssot verify gaps` 要求每条应有约束回答三问，每问写 `found`、`at`（规格里的位置）与 `reason`：

- **遗漏（`missing`）：** 需求要求的约束，规格里没有。判为没有遗漏时，`at` 要指出规格里写着它的位置；
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

## 五、第三步：逐个元素反查（`elements`、`scenarios`）

反过来，`ssot verify elements` 对规格里的每个类型、字段、函数、操作与场景，要求判为守着第一步里的哪条约束（`guards`）、是哪条约束所需的连接（`connection`），或不该进 VDM（`extraneous`）。`ssot verify scenarios` 对场景体里的每处调用、先后、分支与挑选，要求判为对应哪条应有约束（`constraint`），或是在模拟业务怎样运行（`simulation`）。

## 六、第四步：核对归属（`owner`）

对每条约束问：连接的提供方无论服务哪个合法使用方都必须保证它吗？还是某项业务在连接之上加的条件、选择或组合？按答案核对它实际写在哪里（`actual`），判为 `match`、`misplaced`、`duplicated` 或 `absent`。下面几种都判为 `misplaced` 或 `duplicated`：

- 写在架构里、却只为某一项业务存在的约束；
- 因为写成 `pre` 更方便、事实存放在架构里、业务没有 `state` 或架构不能导入业务，而被放进架构的业务判定；
- 同一个东西在两处展开。

## 七、第五步：工具（`check`、`po`、`review`）

`ssot verify check` 运行 `ssot check`，只报它的错误。`ssot verify po` 对每条未定或未评估的证明义务，要求找出守住它的东西：`pre`、`inv`、分支条件，或使它必然成立的类型与 `post`。找到就判 `guarded`，在 `guards` 写出位置，并在 `reason` 说明怎样守住；找不到就判 `missing_guard`，即缺了前置条件或分支守卫。

在 omp 的 Python `eval` 里运行语义反模式审查，把每条材料的判断存进台账根：

```python
%load skill://ssot/scripts/review.py
await review("/path/to/repo/design", save="/path/to/repo/.tmp/ssot-verify/<验证方>/review.json")
```

`ssot verify review` 核对当前设计的每条材料都判过（设计改了就要重跑），并要求对每个反模式判为采纳（`accept`，交回作者修改）或驳回（`reject`，写出理由）。工具通过不代表约束成立；工具报出的问题也不由验证者修改。

## 八、结论（`verdict`、`status`）

`ssot verify verdict` 要求每条约束在 `gaps`、`attack` 与 `owner` 都判完之后，给出三种结论之一，附证据：

- **成立（`holds`）：** `by` 列出排除违反情形的元素；`attack` 里有反例时不能判为成立；
- **不成立（`fails`）：** `counterexample` 指出 `attack` 里的反例槽，或 `contradiction` 写出规格内部的矛盾；
- **未能判定（`undecided`）：** `reason` 写出缺少的定义、依据或需求。

`ssot verify status <design> --as <验证方>` 汇总全部子命令。错误是没判完：缺判、槽位没填、证据找不到、反例求值不成立、记录过期或没盖章。警告就是验证报出的问题：不成立与未能判定的约束，第三步的遗漏、过强与误当必需，第四步的归属问题，第五步不该进 VDM 的元素与模拟运行的场景节点，缺守卫的证明义务，以及采纳或驳回的模型审查。不带范围运行、没有错误，才算整份验证完；带 `--dir` 或 `--constraint` 只说明那一批判完。问题交回 `ssot-design` 或 `ssot-draft` 修改。

修改后的设计不必从头重判：依据变了的记录会过期，新出现的元素、场景节点与证明义务会缺判，重判这些即可；没过期的记录仍然有效。某个问题只有在新一轮 `status` 里不再出现，才算解决。两方的 `status` 都没有错误、也没有问题交回作者时，删除 `.tmp/ssot-draft/`、`.tmp/ssot-design/` 与 `.tmp/ssot-verify/`；还有问题交回作者时保留它们，供下一轮只重判变了的部分。
