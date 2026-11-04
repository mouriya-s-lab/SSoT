# SSoT

把软件的结构、连接契约与跨连接次序写成三种可编译的原生文件，作为独立于实现代码的设计真源。方法与规则在 [`skills/ssot`](skills/ssot/SKILL.md)，本文件只是概览。

## 三种载体的分工

每类事实只有一个载体能写：

| 载体 | 文件 | 持有的事实 |
|---|---|---|
| LikeC4 | `design/structure/*.c4` | 元素与嵌套、依赖方向、部署与信任边界、依据与理由、需求落点（metadata `req`） |
| VDM-SL | `design/contract/<元素 fqn>.vdmsl` | 连接点（exports）、类型、状态与 `inv`、操作的 `pre`/`post`、不透明身份；一个带 `#contract` 的元素一个模块 |
| Quint | `design/behavior/<模块名>.qnt` | 跨连接的先后与交错、窗口、停机与崩溃收束、覆盖目标 |

需求清单 `design/requirements.md` 不是载体：每条需求以 `REQ-<编号>` 开头，原文由用户给出，只编号、不改原文。`design/.gen/` 由 `ssot gen` 生成，只读。

## 权威顺序

```text
LikeC4 模型 ──gen──▶ .gen/structure.json（元素树、依赖、每个元素允许 import 的模块）
VDM 模块（手写，import 只落在 LikeC4 授予的范围里）
VDM 投影 ──gen──▶ .gen/contract.qnt（类型、Call 变体、状态类型、initial）
Quint 行为（手写，契约调用只用生成的 Call，初态只用生成的 initial）
Quint 轨迹 ──回放──▶ 在定义该操作的 VDM 模块里求 pre/post/inv 与 frame
```

只顺着这个方向写：下游缺了什么，回到上游去改，不在下游另写一份上游的事实。

## skill 树：阶段 × 切片

一次调用只处理一个有界切片。`ssot status <design>` 从三种载体与检查结果派生出下一项前沿 `{skill, scope, reason}`；不保存“已确认”或“已评审”的记录。

| 阶段 | 叶子 | 切片 |
|---|---|---|
| 总纲 [`ssot`](skills/ssot/SKILL.md) | — | 方法、分工、权威顺序、切片模型、命令 |
| [`ssot-draft`](skills/ssot-draft/SKILL.md) | [`ssot-draft-requirement`](skills/ssot-draft-requirement/SKILL.md) | 一条需求：编号、论证与领域性质、三面落点、写 `req` |
| [`ssot-write`](skills/ssot-write/SKILL.md) | [`ssot-write-level`](skills/ssot-write-level/SKILL.md) | 一个元素的一层（LikeC4） |
| | [`ssot-write-deploy`](skills/ssot-write-deploy/SKILL.md) | 一个部署视图显示的部署节点（LikeC4） |
| | [`ssot-write-contract`](skills/ssot-write-contract/SKILL.md) | 一个带 `#contract` 的元素的模块（VDM-SL） |
| | [`ssot-write-behavior`](skills/ssot-write-behavior/SKILL.md) | 一个可运行的 Quint 模块 |
| [`ssot-verify`](skills/ssot-verify/SKILL.md) | [`ssot-verify-structure`](skills/ssot-verify-structure/SKILL.md)、[`ssot-verify-contract`](skills/ssot-verify-contract/SKILL.md)、[`ssot-verify-behavior`](skills/ssot-verify-behavior/SKILL.md) | 与对应写作叶子相同的切片；由写作叶子在末尾派评审者执行，或由用户直接指定 |
| [`ssot-migration`](skills/ssot-migration/SKILL.md) | [`ssot-migrate-read`](skills/ssot-migrate-read/SKILL.md) | 旧文档的一个区域：由代读者只交出概念与原文明说的需求 |

评审者 `ssot:reviewer` 与代读者 `ssot:reader` 是 omp 的 agent 定义，在 [`skills/ssot/agents/`](skills/ssot/agents/)。

## 安装

```sh
npx skills add mouriya-s-lab/SSoT --skill ssot ssot-draft ssot-draft-requirement ssot-write ssot-write-level ssot-write-deploy ssot-write-contract ssot-write-behavior ssot-verify ssot-verify-structure ssot-verify-contract ssot-verify-behavior ssot-migration ssot-migrate-read --global --agent codex claude-code --yes
```

装好后运行一次 `ssot setup`（第一次还没有 `ssot` 命令时，运行 `bun ~/.agents/skills/ssot/scripts/ssot.ts setup`）。它准备检查所需的工具，并把 `ssot` 装进 PATH；细节见 [`setup.md`](skills/ssot/references/setup.md)。

## 命令

| 命令 | 作用 |
|---|---|
| `ssot setup` | 准备检查所需的工具，把 `ssot` 装进 PATH |
| `ssot gen <design>` | 重新生成 `.gen/` |
| `ssot check <design>` | 全量检查：编译三种载体、生成链新鲜度、跨载体规则、模拟、覆盖目标、回放、证明义务 |
| `ssot check <design> --scope <视图 id>` | 仍编译全部内容，模拟、回放、QuickCheck 只在该视图的切片闭包内运行，只报告该切片的诊断 |
| `ssot check <design> --scope <视图 id> --base <rev>` | 另列出 `<rev>` 之后落在该作用域之外的改动，提示应交给哪个叶子 |
| `ssot view <design> <视图 id>` | 输出本层评审包 |
| `ssot eval <design> <模块> '<表达式>' [--bind …]` | 在原样规格里求一个 VDM 表达式，用来构造违反实例 |
| `ssot status <design> [--deadline 秒]` | 运行一次全量 `check`，派生一项前沿 `{skill, scope, reason}`；没有前沿时输出“没有前沿” |

`check` 的退出码：`0` 通过，`1` 有 error，`3` 验证没有做完（`resource.deadline`），不是设计被拒绝。
