# SSoT

本仓库维护两项配套 skill：

- [`software-design`](skills/software-design/SKILL.md) 使用带说明的 TypeScript 类型描述架构、连接、数据、事实与有限场景，并检查源码、类型、解析、关系和 Markdown。
- [`software-design-graph`](skills/software-design-graph/SKILL.md) 复用检查结果，每次调用重新构建只读内存 Graph，提供视图、搜索、邻域与有向最短路径，不持久化图或索引。

两个 skill 保持同级安装，Graph 脚本通过相对路径使用父 skill 的领域模型与验证通道。

## 实施计划与旧版

- [完整实施计划](PLAN.md) 包含当前实现的契约、十三个实施步骤、十九项交付对照和完整验收规范；计划中的放行要求不等于已经全部完成最终验收。
- [旧版归档](old/README.md) 完整保存重写前的 `software-design`，文件位于 `old/software-design/`。归档保持历史内容，不参与当前实现的验证通道或默认安装。

旧版采用独立的两层目录，避免 `old/SKILL.md` 与当前同名 skill 在安装发现时发生遮蔽。

## 安装

通过 GitHub 来源安装两个 skill；按实际使用的 agent 调整 `--agent`：

```sh
npx skills add mouriya-s-lab/SSoT --skill software-design software-design-graph --global --agent claude-code codex --yes
```

检查与 Graph 使用 Bun。安装后在父 skill 的脚本目录安装依赖：

```sh
bun install --no-save --cwd ~/.agents/skills/software-design/scripts
```

后续按 skill 名称分别更新：

```sh
npx skills update software-design --global
npx skills update software-design-graph --global
```

## 本地运行

在仓库根目录安装检查依赖：

```sh
bun install --no-save --cwd skills/software-design/scripts
```

父脚本提供 `init`、`module`、`unit`、`upgrade` 和 `check`。生成命令不预先加载 compiler 或 Markdown parser；检查不会 build 或 emit。

```sh
bun skills/software-design/scripts/design.ts init /path/to/repo
bun skills/software-design/scripts/design.ts check /path/to/repo/design --json
bun skills/software-design-graph/scripts/graph.ts view /path/to/repo/design --json
bun skills/software-design-graph/scripts/graph.ts search /path/to/repo/design Store
bun skills/software-design-graph/scripts/graph.ts neighbors /path/to/repo/design Worker --depth 2
bun skills/software-design-graph/scripts/graph.ts path /path/to/repo/design Worker StoreOne --composition Local
```

`init` 只生成目录、导航、DSL 和项目配置；作者仍须写真实定义与语义。自动成功为 `AutomaticallyChecked`，始终保留 `ManualReviewRequired`；结构路径不证明系统已经组装或现实义务已经兑现。

## 验证

两组测试通过真实 native compiler 与实际 CLI 检查投影、边界、组合、场景、升级、文件不变性和 native 进程自然退出。测试只在自有 `/tmp/software-design-accept-*` 工作区写设计夹具。

```sh
bun test skills/software-design/tests/projection.test.ts
bun test skills/software-design/tests/runtime.test.ts
```

安装入口可以用同一套 runtime 测试验证：

```sh
SOFTWARE_DESIGN_PARENT_ENTRY="$HOME/.agents/skills/software-design/scripts/design.ts" \
SOFTWARE_DESIGN_GRAPH_ENTRY="$HOME/.agents/skills/software-design-graph/scripts/graph.ts" \
bun test skills/software-design/tests/runtime.test.ts
```
