# SSoT

本仓库维护 [`software-design`](skills/software-design/SKILL.md) skill：设计文档的写法与检查。骨架先于业务、连接是一等概念；连接、数据、不变量与状态写成 VDM-SL 规格，规格说不清的语义写成同一个文学式 LaTeX 文件里的文字。`scripts/design.ts` 生成目录，用 VDMJ 检查类型与反例，并核对目录、依赖方向、说明注释与文字引用。

[旧版归档](old/README.md) 完整保存最早的 `software-design`，文件位于 `old/software-design/`；它不参与当前实现的检查或默认安装。旧版采用独立的两层目录，避免 `old/SKILL.md` 与当前同名 skill 在安装发现时发生遮蔽。

## 安装

通过 GitHub 来源安装；按实际使用的 agent 调整 `--agent`：

```sh
npx skills add mouriya-s-lab/SSoT --skill software-design --global --agent claude-code codex --yes
```

检查需要 Java 11 以上与 Bun。安装后取一次 VDMJ 与 QuickCheck 的最新正式版：

```sh
bun ~/.agents/skills/software-design/scripts/design.ts setup
```

之后按 skill 名称更新：

```sh
npx skills update software-design --global
```

## 本地运行

在仓库根目录：

```sh
bun skills/software-design/scripts/design.ts setup
bun skills/software-design/scripts/design.ts init /path/to/repo
bun skills/software-design/scripts/design.ts module /path/to/repo/design queue
bun skills/software-design/scripts/design.ts unit /path/to/repo/design billing
bun skills/software-design/scripts/design.ts check /path/to/repo/design
bun skills/software-design/scripts/design.ts graph /path/to/repo/design
```

`init`、`module`、`unit` 只生成目录、`README.tex` 与阅读次序；作者仍须写负责范围、规格与语义。`check` 通过表示规格类型正确、结构与方向成立、文字引用的名字都存在、QuickCheck 没有找到反例；未定的证明义务、说明、依据与理由仍按审查清单人工判断。

## 验证

测试用真实 VDMJ 运行 CLI，只在自有 `/tmp/software-design-check-*` 工作区写设计夹具：

```sh
bun test skills/software-design/tests/check.test.ts
```
