---
name: ssot-write
description: SSoT 写作阶段说明：按权威顺序 LikeC4→VDM→Quint，一次写一个有界切片（一层、一个部署视图显示的部署节点、一个契约模块、一个行为模块），并在末尾评审本切片。先读 ssot；具体工作只在 ssot-write-* 叶子里做。
---

# ssot-write：写作阶段

本阶段的叶子各写一种载体里的一个切片，并在同一次调用的末尾派 `ssot:reviewer` 评审这个切片：

| 叶子 | 切片 | 载体 | 末尾评审的清单 |
|---|---|---|---|
| `ssot-write-level` | 一个元素的一层 | LikeC4 | `ssot-verify-structure` |
| `ssot-write-deploy` | 一个部署视图显示的部署节点 | LikeC4 | `ssot-verify-structure` |
| `ssot-write-contract` | 一个带 `#contract` 的元素 | VDM-SL | `ssot-verify-contract` |
| `ssot-write-behavior` | 一个可运行的 Quint 模块 | Quint | `ssot-verify-behavior` |

写法参考在本 skill 的 `references/` 下：`structure.md`（LikeC4）、`contract.md`（VDM-SL）、`behavior.md`（Quint）。每个叶子只读它那一种载体的参考。

切片之间只有可派生的先后，没有“必须先通过某次评审”的依赖：

- `ssot-write-contract` 要求元素已在结构里，并带 `#contract`；
- `ssot-write-behavior` 要求它用到的 `Call` 模块在 `check --scope` 下没有错误；
- 下游写不下去，说明上游缺了或错了：停止，交给上游的叶子（`ssot` 第四节「向上修正」），不在下游补一份上游的事实。
