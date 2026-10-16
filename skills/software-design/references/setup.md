# 安装

`software-design` 或 `vdmj` 不在 PATH 上，或者命令报告缺少 Java、VDMJ 时读这一篇。

## 依赖

- **Bun**：运行 `software-design`。
- **Java 11 或更高版本**，`java` 在 PATH 上：运行 VDMJ。没有时用系统的包管理器安装，例如 `brew install openjdk` 或 `mise use -g java`，按包管理器的提示把 `java` 放进 PATH；`java -version` 报出 11 或更高的版本号即可。

## 安装命令

在本 skill 目录运行一次（omp 的 bash 里可以写成 `bun skill://software-design/scripts/design.ts setup`）：

```sh
bun scripts/design.ts setup
```

`setup` 依次：

1. 检查 PATH 上的 `java` 是 11 或更高版本，不是就停下并报告。
2. 从 Maven Central 取 VDMJ 与 QuickCheck 的最新正式版，放在 `${XDG_DATA_HOME:-~/.local/share}/vdmj/`。
3. 在 `~/.local/bin` 建立 `software-design`（指向本 skill 的 `scripts/design.ts`）与 `vdmj`（带 QuickCheck 插件的 VDMJ）。
4. 确认 PATH 上这两个名字解析到 `~/.local/bin` 里刚建立的文件。不是时退出码为 1，并打印要加进 shell 启动文件的 `export PATH=…`；照做之后在新的 shell 里运行 `software-design setup`。

想换到更新的 VDMJ，或者 skill 换了安装位置，再运行一次 `software-design setup`。
