# 旧版 software-design

`software-design/` 完整保存本轮重写之前的技能，包括原始 `SKILL.md`、来源说明、DSL 模板、五个脚本、依赖声明和脚本目录的忽略规则，共十个文件。

归档来自本仓库保留历史中的 [`76beea9`](https://github.com/mouriya-s-lab/SSoT/tree/76beea9/skills/software-design)，其文件内容和执行权限保持一致。该版本使用 Babel 提取类型表面语法，并通过 `tsc -b` 检查类型；其中的说明和行为作为历史原样保留，不作为当前版本的使用指导，也不是当前实现的兼容层或备用解释器。

- [旧版技能说明](software-design/SKILL.md)
- [旧版来源说明](software-design/references/sources.md)
- [旧版脚本入口](software-design/scripts/design.ts)
- [旧版 DSL](software-design/templates/dsl.ts)

归档不直接在 `old/` 放置 `SKILL.md`，以免安装器先发现同名旧版并遮蔽 `skills/software-design/`。默认从仓库安装时仍选择当前的 `software-design` 与 `software-design-graph`；本次归档不改变已安装技能。

## 本地复现

以下命令在仓库根目录执行，测试仓库必须是自有临时目录：

```sh
bun install --no-save --cwd old/software-design/scripts
bun old/software-design/scripts/design.ts init /path/to/test-repo
bun old/software-design/scripts/design.ts check /path/to/test-repo/design
bun old/software-design/scripts/design.ts graph /path/to/test-repo/design --json
```

`init` 后仍须按旧版 DSL 写入真实 Module 定义与 README。旧版 `check` 会产生 `.design-build` 声明与构建信息；不要将这种行为套用到当前版本。依赖仍使用历史 package.json 声明，不为归档另外钉住版本。
