# SSoT

本仓库维护 [`software-design`](skills/software-design/SKILL.md) skill：设计文档的写法与检查。骨架先于业务、连接是一等概念；连接、数据、不变量与状态写成 VDM-SL 规格，规格说不清的语义写成同一个文学式 LaTeX 文件里的文字。`scripts/design.ts` 生成目录，用 VDMJ 检查类型与反例，并核对目录、依赖方向、说明注释、文字引用与语法树上的反模式；`scripts/review.py` 在 omp 的 eval 里用 jev 审查需要理解含义的反模式。skill 附带一份通过检查的示例设计、本地的 VDM 文档与多 agent 并行编写的指令表。

[`design-migration`](skills/design-migration/SKILL.md) 讲怎样把内容多、但有价值的旧语义设计文档搬进这种设计目录：只搬运，不判断对错、不改动原意，重复的内容合并，能当场判断的不同叫法统一成更先进的那个；先勘察旧文档、找出每个概念的定义处，读够之前不搬；先搬骨架，再逐区域搬运；每条陈述整条搬完就从旧文档删掉，旧文档剩下的就是进度；冲突时先判断是不是放错了地方。它没有脚本，检查沿用 `software-design`。

[旧版归档](old/README.md) 完整保存最早的 `software-design`，文件位于 `old/software-design/`；它不参与当前实现的检查或默认安装。旧版采用独立的两层目录，避免 `old/SKILL.md` 与当前同名 skill 在安装发现时发生遮蔽。

## 安装

通过 GitHub 来源安装；按实际使用的 agent 调整 `--agent`：

```sh
npx skills add mouriya-s-lab/SSoT --skill software-design design-migration --global --agent claude-code codex --yes
```

检查需要 Java 11 以上与 Bun。安装后取一次 VDMJ 与 QuickCheck 的最新正式版：

```sh
bun ~/.agents/skills/software-design/scripts/design.ts setup
```

之后按 skill 名称更新：

```sh
npx skills update software-design design-migration --global
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

`init`、`module`、`unit` 只生成目录、`README.tex` 与阅读次序；作者仍须写负责范围、规格与语义。`check` 通过表示规格类型正确、结构与方向成立、文字引用的名字都存在、语法树上没有反模式、QuickCheck 没有找到反例。需要理解含义的反模式在 omp 的 eval 里审查：

```python
%load skills/software-design/scripts/review.py
await review("/path/to/repo/design")
```

未定的证明义务、说明里的承诺是否写进了规格、场景是否走通需求，仍按审查清单人工判断。

## 验证

测试用真实 VDMJ 运行 CLI，只在自有 `/tmp/software-design-check-*` 工作区写设计夹具：

```sh
bun test skills/software-design/tests/check.test.ts
```

模型审查的问题措辞与阈值用 `skills/software-design/scripts/review-calibration.json` 校准，改动后在 omp 的 eval 里运行 `await calibrate()`，每个问题零误判才算通过。
