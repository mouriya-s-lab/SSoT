---
name: ssot-migration
description: SSoT 迁移阶段说明：把旧设计文档迁进三种载体时，由 ssot:reader 逐个区域代读，只转交概念与原文明说的需求，再交给对应的写作叶子写。先读 ssot；具体工作只在叶子 ssot-migrate-read 里做。
---

# ssot-migration：迁移阶段

旧设计文档里绝大多数内容是字段、记录形状、处理先后、校验与错误处理这些实现细节。直接读它写设计，会被细节带着走。所以迁移不搬运原文：旧文档由 `ssot:reader` 代读，只把概念与原文明说的需求交出来，设计照常由写作叶子按 `ssot` 的方法写。

| 叶子 | 切片 | 产出 |
|---|---|---|
| `ssot-migrate-read` | 旧文档的一个区域 | 代读者写的概念备忘与需求摘录，交给 `ssot-draft-requirement` |

一个区域交出之后，代读者交出的需求与概念只交给 `ssot-draft-requirement`：它为每条需求定落点，需要新元素时派出 `ssot-write-level`。之后按 `ssot status` 的前沿照常写结构、契约与行为。写作叶子不读旧文档，也不读代读者的文件；它们只读设计与需求原文。

`.tmp/ssot-migrate/regions.md` 里每个区域都有输出目录 `.tmp/ssot-migrate/<区域编号>/`，且 `ssot status` 不再报没有落点的 `req`，迁移就结束；旧文档的去留由用户决定。
