---
name: software-design-graph
description: software-design 的运行时设计图、轻量搜索、邻域和有向最短路径。每次从设计源码经过父 skill 的五阶段检查构建只读内存 Graph，命令结束即释放，不保存图、索引或跨调用缓存。用于阅读与走查已描述的结构，不用于定义另一套 DSL、绕过检查、选择提供方或模拟系统执行。
---

# software-design-graph

## 输入与生命周期

先读 `skill://software-design`，使用父 skill 的 DSL、目录与检查契约。本子 skill 不定义领域规则，不自行读取/解释 TypeScript，也不接受旧 Graph JSON 当输入。

每次命令都调用父 skill 的 `loadValidated`：有界源码、native compiler、完整领域解析、关系与 Markdown 检查全部成功后，才把 ValidatedDesign 投影为内存节点与有向邻接表。compiler snapshot/API 在领域读取后已经释放；查询结束后 Graph 也结束。没有数据库、服务、监听器、索引文件、Graph manifest 或跨调用缓存。

设计的 TypeScript/Markdown 是持久输入。stdout 的 JSON、Mermaid 与表格只代表这一次读取，不写回设计，不作为以后查询的来源；修改源码后下一次命令重新检查、重新构图。

## 运行

将本 skill 与 `software-design` 安装在同一 skills 根目录。首次使用前，在父 skill 的 scripts 目录执行 `bun install --no-save`；本 skill 复用父验证通道及依赖，不安装另一份 compiler。

以下命令相对本 skill 目录：

|命令|结果|
|---|---|
|`bun scripts/graph.ts view <design> [--json] [--composition <selector>]`|完整设计的临时 Mermaid/表格，或稳定节点/边/上下文 JSON|
|`bun scripts/graph.ts search <design> <text> [--kind <kind>] [--composition <selector>]`|名称、说明与路径的大小写不敏感子串匹配，按稳定 id 排序|
|`bun scripts/graph.ts neighbors <design> <selector> [--direction out\|in\|both] [--depth <positive-int>] [--composition <selector>]`|有界 BFS 邻域，默认 out、深度 1|
|`bun scripts/graph.ts path <design> <from> <to> [--composition <selector>]`|有向结构最短路径或 NoPath，不是可运行调用链|

selector 是完整声明/成员 id 或唯一可见名称。具名声明 id 为 `相对文件路径#声明名`，成员 id 由所属节点、成员种类与具名位置组成。同名时必须用完整 id，工具会列出候选，不任意挑一个。Composition selector 只在已验证的 Composition 中查找。

search 的 kind 必须来自闭合节点分类：Data、Family、Carrier、Connection、Module、Unit、External、Event、Lifecycle、Scope、Scenario、Composition、Auxiliary，以及 Operation、Field、Case、Variant、Duty、Fact、Step、Application、Expose、Binding、Role、Completion、CarrierMember。

## 契约与组合视图

默认 Contracts 视图陈述公开契约、提供能力与使用角色。Role 保留零、一或多个候选；候选边不表示已经选择，即使只有一个候选也不自动变成绑定。

`--composition` 显式选择一个局部组合。只有该 Composition 的 Binding 产生 bound-to，未填写的使用仍是 Role；上一条命令选过的组合不影响下一条命令。默认图仍可搜索组合声明，但不会把其他组合的 Binding 当成本次选择。

图保留拥有、提供、使用、公开/转交、组成、字段/参数/结果、HKT 应用与参数、分支、后继、义务、事实锚点、生命周期嵌套、范围、场景步骤和真实语义引用。静态 Lifecycle 不因查看某组合而获得一个虚构的确认提供方。父模块自提供的能力与子模块使用角色来自同一份已验证关系，不以“最深 provider”隐藏父模块。

最短路径使用有向 BFS；等长路径按 relation、to、from 的字典序决定。StructuralPath 保留经过的 Role/Bound 与上下文。存在路径只证明图上可达，不证明现实中发生调用、组合已完整或义务已兑现。

## 阅读方式

先用 view 观察模块树、组成与范围，再用 search 定位定义，用 neighbors 看有限边界，用 path 回答具体结构可达问题。长说明与载体定律保留在表格与 typed details，图标签只保留名称与角色。

真实关联值、时序、履责、依据、说明含义、需求覆盖与未绑定选择仍在父报告的 ManualReviewRequired 中。JSON 保留同一报告，不把这些事项丢弃、打分或缓存成“已审查”。语义解释写回所属 README/主题文件，不提交生成图。

## 失败与退出

- 设计任一自动阶段失败时，诊断只到 stderr，退出 1；工具不产生半张 Mermaid 或部分成功 JSON。
- selector 缺失/歧义时，stderr 给 Missing/Ambiguous 和候选，退出 1；不存在的 Composition 不回退到默认。
- 参数错误、非法 depth/direction/kind 与环境不可用退出 2；参数在打开 compiler 前拒绝。
- NoPath 是正常结构结果，退出 0。
- 所有成功结果只到 stdout；工具不提供“允许部分图”选项，也不通过另一套解释器降级。
