---
name: ssot-draft
description: SSoT 草稿阶段说明：写任何载体之前，为一条需求写出论证与领域性质，并定下它由哪个契约定义、哪个行为声明兑现。先读 ssot；具体工作只在叶子 ssot-draft-requirement 里做。
---

# ssot-draft：草稿阶段

本阶段回答“一条需求由设计里的哪些东西兑现”，不写任何载体。只有一个叶子：

| 叶子 | 切片 | 产出 |
|---|---|---|
| `ssot-draft-requirement` | 一条需求 | 需求原文原样编号进 `<design>/requirements.md`（`REQ-<编号>`）；需求的论证与领域性质（只在本次调用里用，不落盘）；契约面与次序面的落点；交给写作叶子的下一项前沿 |

与别的阶段的关系：

- 需求的落点是兑现它的契约定义与行为声明，由 `ssot-write-contract`、`ssot-write-behavior` 写下定义并附上需求编号；本阶段只指出落点，不写 VDM、Quint 或 LikeC4。
- 落点所在的底层元素还不存在、或还没有 `#contract` 时，下一项前沿是该元素父元素的 `ssot-write-level`。
- 写作阶段发现需求的论证推不出时，回到本阶段的叶子重做这一条需求。
