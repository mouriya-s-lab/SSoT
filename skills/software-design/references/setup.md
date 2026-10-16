# 安装

加载本 skill 时，`SKILL.md` 里的 `` !`…` `` 行检查 `software-design` 与 `vdmj` 是否在 PATH 上，缺了就运行 `scripts/design.ts setup` 安装，把安装输出放进 skill 正文；已经安装时没有输出。Claude Code 在加载 skill 时执行这一行；不执行它的 agent，在本 skill 目录运行一次 `bun scripts/design.ts setup`。安装输出报告缺少 Java，或者两个命令没有出现在 PATH 上时读这一篇。

## 依赖

- **Bun**：运行 `software-design`。
- **Java 11 或更高版本**，`java` 在 PATH 上：运行 VDMJ。没有时用系统的包管理器安装，例如 `brew install openjdk` 或 `mise use -g java`，按包管理器的提示把 `java` 放进 PATH；`java -version` 报出 11 或更高的版本号即可。装好之后重新加载本 skill。

## 安装做了什么

`setup` 依次：

1. 检查 PATH 上的 `java` 是 11 或更高版本，不是就停下并报告。
2. 从 Maven Central 取 VDMJ 与 QuickCheck 的最新正式版，放在 `${XDG_DATA_HOME:-~/.local/share}/vdmj/`。
3. 在 `~/.local/bin` 建立 `software-design`（指向本 skill 的 `scripts/design.ts`）与 `vdmj`（带 QuickCheck 插件的 VDMJ）。
4. 确认 PATH 上这两个名字解析到 `~/.local/bin` 里刚建立的文件；不是时打印要加进 shell 启动文件的 `export PATH=…`。照做之后重新加载本 skill。

想换到更新的 VDMJ，运行 `software-design setup`。
