# SSoT

SSoT 给一个系统一个机会：随着代码落地，从宏观到微观逐步建模。它不证明设计完美无缺，也不保证系统没有 bug。一个位置默认停在架构图上的一个框；只有对 AI 来说不轻松、且使用者声明的阶段支持时，才往下写它的盒子或接线。方法与规则在 [`skills/ssot`](skills/ssot/SKILL.md)，本文件只是概览。

## 三层

| 层 | 载体 | 文件 | 回答什么 |
|---|---|---|---|
| 结构 | LikeC4 | `design/structure/*.c4` | 按 C4 逐层放大的架构图：人、系统、容器、组件，谁调用谁，部署与信任边界 |
| 盒子 | VDM-SL | `design/contract/<元素 fqn>.vdmsl` | 一个决定深入的底层元素：端口、线上的类型、反馈线（state）与端口上的承诺 |
| 接线 | Quint | `design/behavior/<模块名>.qnt` | 围绕一个担心，把盒子接在一起：反馈、跨盒子的先后与收束、性质与覆盖目标 |

下层只在写下时存在，存在时只对照上层检查：

```text
LikeC4 ──gen──▶ .gen/structure.json
VDM 盒子 ──gen──▶ .gen/contract.qnt（类型、Call 变体、状态类型、initial）
Quint 接线 ──回放──▶ 轨迹里出现的每次契约调用，在 VDM 里求 pre/post/inv 与 frame
```

需求清单 `design/requirements.md` 不是载体：每条需求以 `REQ-<编号>` 开头，原文由用户给出；需求编号只附在确实兑现它的定义或声明上，不要求每条都附着，不进 LikeC4。结构只看 C4 渲染图评审；盒子与接线先看盒子图、组合图再读源文件。

## skill 树

| 层 | skill | 是什么 |
|---|---|---|
| 核心 | [`ssot`](skills/ssot/SKILL.md) | SSoT 是什么、默认不可见、深度与精度两条轴、skill 怎样组合、命令 |
| 核心 | [`ssot-judge`](skills/ssot-judge/SKILL.md) | 一个位置或一份观测要不要往下写 |
| 核心 | [`ssot-requirement`](skills/ssot-requirement/SKILL.md) | 收下一条需求，并在同一次调用里判断它由哪里回答 |
| 载体 | [`ssot-c4`](skills/ssot-c4/SKILL.md)、[`ssot-vdm`](skills/ssot-vdm/SKILL.md)、[`ssot-quint`](skills/ssot-quint/SKILL.md) | 三种载体各自的写法、惯用法与禁止项 |
| 操作 | [`ssot-write-level`](skills/ssot-write-level/SKILL.md)、[`ssot-write-deploy`](skills/ssot-write-deploy/SKILL.md)、[`ssot-write-contract`](skills/ssot-write-contract/SKILL.md)、[`ssot-write-behavior`](skills/ssot-write-behavior/SKILL.md) | 写一个切片，与对应的载体 skill 一起读 |
| 操作 | [`ssot-verify-structure`](skills/ssot-verify-structure/SKILL.md)、[`ssot-verify-contract`](skills/ssot-verify-contract/SKILL.md)、[`ssot-verify-behavior`](skills/ssot-verify-behavior/SKILL.md) | 评一个切片 |
| 操作 | [`ssot-migrate-read`](skills/ssot-migrate-read/SKILL.md) | 由代读者读旧文档的一个区域 |

每个 skill 开头写明输入、可读、可改、可运行、输出与上抛；skill 之间不互相调用，由会话按 `ssot` 第五节的接法组合。评审者 `ssot:reviewer` 与代读者 `ssot:reader` 是 omp 的 agent 定义，在 [`skills/ssot/agents/`](skills/ssot/agents/)。

## 安装

```sh
npx skills add mouriya-s-lab/SSoT --skill ssot ssot-judge ssot-requirement ssot-c4 ssot-vdm ssot-quint ssot-write-level ssot-write-deploy ssot-write-contract ssot-write-behavior ssot-verify-structure ssot-verify-contract ssot-verify-behavior ssot-migrate-read --global --agent codex claude-code --yes
```

装好后运行一次 `ssot setup`（第一次还没有 `ssot` 命令时，运行 `bun ~/.agents/skills/ssot/scripts/ssot.ts setup`）。它准备检查与渲染所需的工具，并把 `ssot` 装进 PATH；细节见 [`setup.md`](skills/ssot/references/setup.md)。

## 命令

| 命令 | 作用 |
|---|---|
| `ssot setup` | 准备检查与渲染所需的工具，把 `ssot` 装进 PATH |
| `ssot gen <design>` | 重新生成 `.gen/` |
| `ssot check <design>` | 全量检查：编译三种载体、生成链新鲜度、跨载体规则、模拟、覆盖目标、回放、证明义务 |
| `ssot check <design> --scope <视图 id>` | 仍编译全部内容，模拟、回放、QuickCheck 只在该视图的切片闭包内运行，只报告该切片的诊断 |
| `ssot check <design> --scope <视图 id> --base <rev>` | 另列出 `<rev>` 之后落在该作用域之外的改动 |
| `ssot render <design> [--out <目录>]` | 导出 C4 视图、每个契约模块的盒子图、每个 Quint 模块的组合图，按宏观到微观的顺序列出 |
| `ssot eval <design> <模块> '<表达式>' [--bind …]` | 在原样规格里求一个 VDM 表达式，用来构造违反实例 |
| `ssot status <design> [--deadline 秒]` | 只报已写下内容里的 error，以及带 `#contract` 却没有模块的元素；都没有时输出“没有前沿” |

`check` 的退出码：`0` 通过，`1` 有 error，`3` 验证没有做完（`resource.deadline`），不是设计被拒绝。
