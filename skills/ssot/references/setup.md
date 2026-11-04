# 安装

`ssot` 不在 PATH 上，或者命令报告某个依赖尚未安装时，运行一次 `bun ~/.agents/skills/ssot/scripts/ssot.ts setup`（路径换成本 skill 所在的位置）。安装输出报告缺少 Java 或 Bun，或者 `ssot` 没有出现在 PATH 上时读这一篇。

## 依赖

- **Bun**，`bun` 在 PATH 上：运行 `ssot`，也用来执行 Quint。没有时按 <https://bun.sh> 的说明安装，`bun --version` 能报出版本号即可。
- **Java 21 或更高版本**，`java` 在 PATH 上：运行 VDMJ。没有时用系统的包管理器安装，例如 `brew install openjdk` 或 `mise use -g java`，按包管理器的提示把 `java` 放进 PATH；`java -version` 报出 21 或更高的版本号即可。装好之后重新运行 `setup`。

## 装了什么、装在哪

`setup` 每次都取各依赖的最新发布：

| 内容 | 位置 |
|---|---|
| VDMJ 与 QuickCheck 的 jar（Maven Central） | `${XDG_DATA_HOME:-~/.local/share}/ssot/` |
| LikeC4、Quint、TypeScript（npm） | 同一目录下的 `node_modules/` |
| Quint 模拟用的 rust 求值器（版本由所装的 Quint 决定） | `~/.quint/rust-evaluator-<版本>/`；设了 `QUINT_HOME` 时在它下面 |
| `ssot` 命令 | `~/.local/bin/ssot`，运行本 skill 的 `scripts/ssot.ts` |

想换到更新的版本，再运行一次 `ssot setup`。

## 怎么确认

`setup` 最后检查 PATH 上的 `ssot` 是不是 `~/.local/bin/ssot`，不是时打印要加进 shell 启动文件的 `export PATH=…`。照做之后在新 shell 里运行 `command -v ssot`，应当输出 `~/.local/bin/ssot` 的完整路径；再对一个设计目录运行 `ssot check <design>`，能输出诊断与 `PASS`、`FAIL` 或 `INCOMPLETE` 的结论行即装好了。
