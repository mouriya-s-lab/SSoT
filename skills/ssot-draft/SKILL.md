---
name: ssot-draft
description: SSoT 草稿阶段说明：写任何载体之前，为一条需求写出论证与领域性质，并把它拆成结构、契约、次序三面的落点。先读 ssot；具体工作只在叶子 ssot-draft-requirement 里做。
---

# ssot-draft：草稿阶段

本阶段回答“一条需求由设计里的哪些东西兑现”，不写任何载体的正文。只有一个叶子：

| 叶子 | 切片 | 产出 |
|---|---|---|
| `ssot-draft-requirement` | 一条需求 | 需求的论证与领域性质（只在本次调用里用，不落盘）；结构、契约、次序三面各一个落点；落点元素 metadata 里的 `req` |

与别的阶段的关系：

- 需求能落在已有元素上，本阶段就写好 `req` 并交付；需要新元素时，下一项前沿是该元素父元素的 `ssot-write-level`。
- 契约面与次序面的落点由 `ssot-write-contract`、`ssot-write-behavior` 落实；本阶段只指出落点，不写 VDM 或 Quint。
- 写作阶段发现需求的论证推不出时，回到本阶段的叶子重做这一条需求。
