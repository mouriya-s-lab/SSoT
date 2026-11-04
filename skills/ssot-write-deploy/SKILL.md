---
name: ssot-write-deploy
description: SSoT 写一个部署视图显示的部署节点（LikeC4 部署模型）：节点里运行哪些容器、信任边界在哪里；末尾派只看渲染图的结构评审。由用户指定，或由 ssot status 因部署视图上的 error 派出；scope 是部署视图 id，检查用 --scope index。先读 ssot。
---

# ssot-write-deploy：写一个部署视图的节点

开始前完整读 `ssot` 总纲第二节「LikeC4：逐层放大的架构图」（含「部署」）与 `../ssot-write/references/structure.md` 的「二、部署」。

`scope` 是 `views` 块里一个部署视图 D 的 id（`deployment view <id> { … }`）。本切片是 D 显示的部署节点（D 的 `include` 列出的节点）及其中嵌套的全部内容，下文记作 N。部署模型回答“容器运行在哪里、随谁部署、信任边界在哪里”，与元素树是两种不同的投影：它不改变元素的嵌套与关系。

## 五项

| 项 | 内容 |
|---|---|
| 可读 | `structure/*.c4` 的 `deployment` 块与部署视图 D（找出 N、N 的祖先节点与 N 的现有内容）；逻辑模型里全部元素的 fqn、种类、标题与描述；`ssot check`、`ssot render` 的输出 |
| 可改 | `structure/*.c4` 里 N 的定义块及其中嵌套的全部内容：节点的标题、描述、标签（含信任边界标签）、子节点与实例（`instanceOf`）；部署视图 D 的 `include` 与 `title`。不改 D 之外的节点、别的视图、逻辑模型（元素与关系）、`contract/`、`behavior/`、`.gen/` |
| 工具工作集 | `ssot gen <design>`；`ssot check <design> --scope index`（部署模型不在任何逻辑视图里，它的诊断按全局报告）；`ssot render <design>` |
| 末尾评审 | 派 `ssot:reviewer` 执行 `ssot-verify-structure`，`scope` 为 D 的 id，材料只有渲染图 |
| 向上修正 | 第三步列出的情形 |

## 一、写节点

1. **实例。** N 里运行的每个容器写一个实例（外部系统也可以放进它运行的节点）。只部署已经存在的逻辑元素；需要的元素不存在，属于第三步。
2. **子节点。** 只有运行位置确实不同（不同进程、不同主机、不同信任域）时才拆子节点。
3. **信任边界。** 信任边界画在真实的信任差异上（谁能触达谁、谁持有哪些凭据），用节点标签标出；标签需要在图例里能读懂时，用全局样式给它 `notation`。
4. **描述。** 一句话写这个节点是什么运行位置，不写操作、类型、字段、时序或依据。
5. **视图。** D 的 `include` 显示 N 的全部节点（`include <节点>.**`），写 `title`。

## 二、检查与自查

运行 `ssot gen <design>`，再运行 `ssot check <design> --scope index`。N 的 `compile.c4`、`struct.*`、`vocab.slots` 诊断在本切片内修。然后运行 `ssot render <design>` 看 D 的图：只看图，能不能知道每个节点是什么、里面运行什么、信任边界在哪里。

## 三、向上修正

遇到下面任何一种，立即停止：

- 要部署的逻辑元素不存在，或部署揭示某个容器混着两个必须分开运行的职责：写明 `{skill: ssot-write-level, scope: <该元素的父元素的视图 id>, reason: …}`；
- N 中的某个节点应属于 D 之外的节点 Q：搬动它要改 Q 的定义块，不在本切片内。写明 `{skill: ssot-write-deploy, scope: <显示 Q 的部署视图 id>, reason: …}`。

## 四、末尾评审与交付

1. 运行 `ssot check <design> --scope index --base <开始时的提交>`（开始时的提交见 `ssot` 第四节），撤回 N 的定义块与 D 之外的改动。
2. 运行 `ssot render <design>`，按 `ssot` 第七节派 `ssot:reviewer`：交给它 `ssot-verify-structure`、D 的 id，以及 `ssot render` 列出的全部图片路径与顺序。不给设计目录路径、诊断或说明。
3. 评审的发现在可改范围内修，修完重跑第二步；指向逻辑模型的，按第三步处理。
4. 交付：改了哪些节点与实例、`check` 的结果、评审的发现与处理、下一项前沿（如有）。
