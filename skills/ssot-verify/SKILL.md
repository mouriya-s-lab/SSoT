---
name: ssot-verify
description: SSoT 独立评审阶段说明：由 ssot status 因诊断或提示派出、或由写作叶子在末尾发起的切片评审；评审者没看过设计，只评一个切片，只报告不修改。先读 ssot；具体工作只在 ssot-verify-* 叶子里做。
---

# ssot-verify：独立评审阶段

本阶段的叶子是评审清单，每个只评一个切片：

| 叶子 | 切片 | 输入 |
|---|---|---|
| `ssot-verify-structure` | 一个视图（一个元素的一层），或一个部署节点 | `ssot view` 的评审包、`check --scope` 的诊断 |
| `ssot-verify-contract` | 一个带 `#contract` 的元素的 VDM 模块 | 该模块、它 import 的模块的导出签名、`check --scope` 的诊断（含 `hint.*`） |
| `ssot-verify-behavior` | 一个可运行的 Quint 模块 | 该模块、`.gen/contract.qnt`、`check --scope` 的诊断（含 `replay.outcome`） |

两种用法，评审者都是一个新派的 `ssot:reviewer`（没看过设计），清单相同：

- **写作叶子的末尾评审：** 写作叶子派 `ssot:reviewer` 执行对应的 verify 叶子，评审结论回到写作叶子，由它在可改范围内处理。
- **`ssot status` 派出的独立评审：** 切片有 info 提示、未解决的证明义务或未覆盖的结局时，`status` 派出 verify 叶子。拿到这项前沿的会话按 verify 叶子的「派发」一节派 `ssot:reviewer`，原样交付它的发现：本次不修改任何文件；需要修改的，交付里写明应交给的写作叶子与 `scope`，作为下一项前沿。

评审结论不保存。同一切片下次再被评审，从头评。
