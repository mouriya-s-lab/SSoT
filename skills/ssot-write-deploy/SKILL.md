---
name: ssot-write-deploy
description: SSoT 写一个部署视图显示的部署节点（LikeC4 部署模型）：节点里运行哪些容器、信任边界在哪里，交出渲染图供结构评审；scope 是部署视图 id，检查用 --scope index。与 ssot-c4 一起读，先读 ssot。
---

# ssot-write-deploy：写一个部署视图的节点

写法与样式在 `ssot-c4`「五、部署」，本 skill 只给步骤。

`scope` 是 `views` 块里一个部署视图 D 的 id。本切片是 D 显示的部署节点（D 的 `include` 列出的节点）及其中嵌套的全部内容，下文记作 N。部署模型回答“容器运行在哪里、信任边界在哪里”，与元素树是两种不同的投影：它不改变元素的嵌套与关系。

| 项 | 内容 |
|---|---|
| 输入 | D 的 id；交给本切片的 `reason`（如评审的发现） |
| 可读 | `structure/*.c4` 的 `deployment` 块与部署视图 D；逻辑模型里全部元素的 fqn、种类、标题与描述；`ssot check`、`ssot render` 的输出 |
| 可改 | `structure/*.c4` 里 N 的定义块及其中嵌套的全部内容：节点的标题、描述、标签（含信任边界标签）、子节点与实例；部署视图 D 的 `include`、`exclude`、`style`、`title` 与 `description`。不改 D 之外的节点、别的视图、逻辑模型、`contract/`、`behavior/`、`.gen/` |
| 可运行 | `ssot gen <design>`；`ssot check <design> --scope index`（交付前加 `--base <开始时的提交>`）；`ssot render <design>` |
| 输出 | 改了哪些节点与实例；`check` 的结果；交给结构评审的材料：`ssot render` 列出的 C4 图片路径与顺序（评审的 `scope` 为 D 的 id） |
| 上抛 | 第三步的情形 |

## 一、写节点

1. **实例。** N 里运行的每个容器写一个实例（外部系统也可以放进它运行的节点）。只部署已经存在的逻辑元素。
2. **子节点。** 只有运行位置确实不同（不同主机、不同信任域）时才拆子节点；不为一个容器单独套一层进程节点。
3. **信任边界。** 画在真实的信任差异上（谁能触达谁、谁持有哪些凭据），用节点标签标出，并在 D 里给该节点写样式与 `notation`，让图例说出它是什么边界。
4. **描述。** 一句话写这个节点是什么运行位置，不写操作、类型、字段、时序或依据。
5. **视图。** D 的 `include` 显示 N 的全部节点（`include <节点>.**`），排除组件一层的关系，给图上每个实例写样式与 `notation`，写 `title` 与 `description`。

## 二、检查与自查

运行 `ssot gen <design>`，再运行 `ssot check <design> --scope index`。N 的 `compile.c4`、`struct.*`、`vocab.slots` 诊断在本切片内修。然后运行 `ssot render <design>` 看 D 的图：只看图，能不能知道每个节点是什么、里面运行什么、信任边界在哪里。

## 三、上抛

- 要部署的逻辑元素不存在，或部署揭示某个容器混着两个必须分开运行的职责：交回事实，给 `ssot-write-level` 与该元素的父元素的视图 id；
- N 中的某个节点应属于 D 之外的节点 Q：交回事实，给 `ssot-write-deploy` 与显示 Q 的部署视图 id。

## 四、交付

1. 运行 `ssot check <design> --scope index --base <开始时的提交>`，撤回 N 的定义块与 D 之外的改动。
2. 运行 `ssot render <design>`。
3. 按「输出」交付。
