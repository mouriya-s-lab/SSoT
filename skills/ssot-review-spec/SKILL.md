---
name: ssot-review-spec
description: SSoT 审查阶段三：形式化规格严密性、证明义务与字面用词审查。运行 ssot check 与 jev 模型审查（review.py），通过三张对齐表（未定证明义务→上下文守卫推导表、说明注释承诺→谓词与帧条件对齐表、标识符/注释字面含义→规格函数值定义对齐表），完成规格严密性与词汇卫生验收。在完成 ssot-review-arch 与 ssot-review-flow 后调用。
---

# ssot-review-spec：形式化规格严密性、证明义务与字面用词审查

## 这个阶段解决什么问题

在架构边界（`ssot-review-arch`）与值流转及场景走通（`ssot-review-flow`）推导完毕后，通过工具检查与三张对齐表，核验 VDM-SL 规格的形式化严密性与用词准确性。

```text
ssot check + review.py → [步骤 1：工具验收] → [步骤 2：未定义务→守卫推导表] → [步骤 3：说明承诺→谓词与帧条件对齐表] → [步骤 4：字面含义→函数值定义对齐表]
```

---

## 步骤 1：运行 `ssot check` 与 `jev` 模型审查

1. 运行确定性检查与 QuickCheck 反例搜索：
   ```sh
   ssot check <design>
   ```
   确认 8 个阶段（`layout`、`parse`、`structure`、`antipattern`、`form`、`prose`、`typecheck`、`quickcheck`）全部通过，退出码为 0，无 Warning。记录输出末尾的正文形式统计（规格行、说明注释行、文字行、图与文法行）及全部 `未定` / `未评估` 证明义务。
2. 在 omp 的 Python `eval` 中运行 `jev` 语义反模式审查：
   ```python
   %load skill://ssot/scripts/review.py
   findings = await review("/path/to/repo/design")
   ```
   确认 12 类语义反模式检出数为 0；若有检出，按输出的 `文件:行号` 与反模式类别逐条列入待修项。

---

## 步骤 2：构建「未定证明义务 $\to$ 上下文守卫」推导表

对步骤 1 中 `ssot check` 输出的每一条 `未定` 或 `未评估` 证明义务，定位到对应 Markdown 文件的行列，填写守卫推导表：

| 证明义务位置与种类 | VDMJ 要求成立的条件 | 上下文中的前置守卫 / 不变量（`文件:行号`） | 推导结论 |
|---|---|---|---|
| 例：`architecture/run.md:79:44` (`Recover`: subtype obligation) | `Finish(found)` 要求 `found` 属于 `RunId`（而非 `<Absent>`） | 第 79 行 `if found <> <Absent> then Finish(found)`，且 `StatusOutcome = RunId \| <Absent>` | **已保证** |
| 例：`business/workflow/composition.md` (`ClosureAffected`: measure / recursive obligation) | 递归调用时 `next subset candidates` 且 `card (candidates \ next) < card (candidates \ current)` | `StepAffected` 只从 `candidates` 中并入元素，且 `if next = current` 已排除相等情形 | **已保证** |

- 若某条义务在上下文中找不到能推出它的 `pre`、`inv` 或 `if`/`cases` 守卫（例如直接访问 `m(k)` 却未保证 `k in set dom m`），则该行推导结论为**缺失前置条件或守卫**。

---

## 步骤 3：构建「`--` 说明承诺 $\to$ 谓词与帧条件」对齐表

逐模块核对每个类型、状态、函数与隐式操作的 `--` 说明注释与它的 `inv` / `pre` / `post` 谓词，填写对齐表：

| 定义（`文件:行号`） | `--` 说明注释中的承诺子句 | 对应的 `inv` / `pre` / `post` 谓词子句 | `ext wr` 状态分量的帧条件（每个分支是否写全未变分量的 `x = x~`） | 对齐结论 |
|---|---|---|---|---|
| 例：`Closure`Place` (`boundary.md:109`) | “向尚未关闭的闭包放置输入文件与程序；闭包已关闭时必定拒绝放置” | `closure in set rng openByCall and closure not in set closed and (placements = {} or placements <> {})` | 无 `wr` 分量 | **恒真子句**：`placements = {} or placements <> {}` 是只为挂住参数名的恒真式 |

通过这张表直接识别四类规格缺口（注：跨操作的调用次序如“先 `Close` 后 `ObserveRoot`”已由编排场景规定时，不要求在单个被调操作里重复加防御乱序调用的守卫）：
1. **说明与签名/字段自相矛盾**：`--` 说明里声称携带某载荷、接收某参数、区分某几种状态或调用某连接，但记录字段、函数形参或布尔字段中根本没有对应项（如注释写“携带载荷”而记录无载荷字段、注释写“支持原子改单或拆成两单”而形参无改单意图、用一个 `closed : bool` 混装“获批交出”与“依据失效被拒”）；
2. **无约束恒真子句**：形如 `x = {} or x <> {}`、只为挂住参数名而不排除任何取值的子句；
3. **漏写帧条件（Frame Condition）**：隐式操作声明了 `ext wr x`，但在某个 `or` 分支中既未写出 `x` 的新值，也未写 `x = x~`（在 VDM-SL 中这代表该分支允许 `x` 变为任意满足状态不变量的值）；或声明了 `ext rd/wr x` 却在谓词中完全未出现 `x`；
4. **无状态隐式 `operations` 伪装纯函数**：不读写任何 `state` 分量（无 `ext rd/wr`）却写成隐式 `operations`（`Op(x) r post r = ...`），用以逃避对显式纯函数体的审查。

---

## 步骤 4：构建「字面日常含义 $\to$ 规格函数值定义」用词对齐表

将规格中的标识符、`--` 说明注释及 `README.md` 正文里的核心用词，与阶段一、阶段二还原出的**函数与值定义**并列对比，找出字面日常含义与规格实际定义发生偏移的词项：

| 规格标识符 / 文中用词（出处） | 规格中的实际定义（函数与值语义） | 日常字面含义容易引发的偏离 | 对齐修正方式 |
|---|---|---|---|
| 例：`ReusedCall`、`PublishReuse`、“复用”（`publication.md:73,200`） | 派生运行在该位置的 `Call`（定义 + 绑定值）与源运行已结束的 `OwnCall` 满足 `SameCall` 等价，直接引用该条已发布事实，不打开新闭包 | 字面“复用”易让人以为从旧执行实例拷贝了状态或复用了执行环境 | 在持有模块改名（并同步全部 `imports` 与双反引号引用），或在定义处 `--` 说明注释中写明“因 `SameCall` 等价即为同一次调用，直接采用该次已发布事实，不涉及实例或环境复用” |
| 例：`RerunDecision`、“重跑 / 从头执行”（`affected.md:59`） | 该位置的输入被编辑、上游结局变化或源运行未得出有效结论，因此在派生运行中作为一次新的自有调用执行 | 字面“重跑”易让人以为把同一个调用实例再执行第二遍 | 改名（如改为表示新自有调用的名字），或在 `--` 说明注释中写明“构成新的自有调用” |
| 例：“不存储结构副本”“制造存储中的双源同步负担”“不作为可变字段存储”（`facts/README.md:13` 等） | 单一展开原则与源头事实上的纯函数投影 | 字面用存储介质、内存字段与写盘同步成本来解释抽象设计 | 将句子改为源头事实与纯函数投影的表述，去掉“存储/可变字段”等实现措辞 |

---

## 输出结构

本阶段审查报告直接输出以上四步的结果：

1. **工具检查与形式统计**：`ssot check` 与 `review.py` 的输出及规格/注释/文字/图表行数占比。
2. **未定证明义务守卫推导表**（步骤 2）。
3. **说明承诺与谓词/帧条件对齐缺口表**（步骤 3）。
4. **字面含义与函数值定义对齐表及修改方案**（步骤 4）。
