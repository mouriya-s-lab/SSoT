# 出处

本节区分文献原则与本 skill 的工程选择。文献支持设计写法，不声称这些作者规定了本 DSL 的具体类型或检查算法。设计作者不需要按来源组织文档。

## 设计与实现

- Brooks, F. *The Mythical Man-Month*, ch. 4：架构说明发生什么，实现说明怎样让它发生。这个区分支持省略兑现接口的可替换做法；把组合根与逐情形处理排除在本 skill 的设计交付之外，是本 skill 的边界选择。
- Parnas, D. L. (1972). “On the Criteria To Be Used in Decomposing Systems into Modules.” *CACM* 15(12)：模块隐藏的决定可以在接口不变时改变。本 skill 以“连接不变时可替换”划分设计与实现。
- Lamport, L. (2015). “Who Builds a Skyscraper without Drawing Blueprints?” *CACM* 58(4)：规格在实现之上描述抽象，省略实现细节。
- Parnas, D. L., Clements, P. C. (1986). “A Rational Design Process: How and Why to Fake It.” *IEEE TSE* SE-12(2)：文档呈现当前设计，不记录试错历史。

## 骨架与两条轴

- Perry, D. E., Wolf, A. L. (1992). “Foundations for the Study of Software Architecture.” *ACM SIGSOFT SEN* 17(4)：Elements、Form、Rationale 支持骨架的组成、连接与理由三问。
- Kruchten, P. (1995). “The 4+1 View Model of Architecture.” *IEEE Software* 12(6)：模块、进程、物理结构是不同投影，关键场景用来走查架构。本 skill 用独立 Scope 表达包含，不将目录树当成部署或存续分组。
- Booch, G. (2006). “On Architecture.” *IEEE Software*：架构的重要决定需要保持可见；本 skill 据此优先展示骨架，而非把业务细节混入其中。
- Parnas (1972)：按隐藏的困难或可变决定划分模块。本 skill 将模块分成外部连接、核心材料、内部设计，不按篇幅或步骤分块。
- Parnas (1979). “Designing Software for Ease of Extension and Contraction.” *IEEE TSE* SE-5(2)，以及 Parnas、Clements、Weiss (1985). “The Modular Structure of Complex Systems.”：模块指南与 uses 层次支持抽象分解与清晰依赖。只检查已声明组合的同层绑定环、不枚举未绑定候选组合，是本工具对可判定范围的明确选择。

## 类型语言与语义读取

- Fowler, M. (2010). *Domain-Specific Languages*：内部 DSL 可以借宿主语法与检查器。本 skill 借 TypeScript 约束局部类型构造，不再自行解释 TS 表面语法。
- Minsky, Y. “Effective ML”：使非法状态不可表达。本 skill 用闭合和类型、必填说明、显式 Fact/Follow/Selection 与规格键约束表达局部不变量；跨文件关系仍需独立检查。
- Yallop, J., White, L. (2014). “Lightweight Higher-Kinded Polymorphism.” *FLOPS*，以及 [Effect HKT](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/HKT.ts)：类型构造器编码提供 TypeLambda/this 参数写法的先例。显式 Apply 描述符与先投影参数、只应用一次 HKT 是本 DSL 的选择。
- [TypeScript Project References](https://www.typescriptlang.org/docs/handbook/project-references.html)：项目引用、composite 与 declaration 支持方向检查。本工具打开根 analysis 项目及所有 leaf 项目，直接读取 source redirect，不调用 build 或 emitter。
- [TypeScript native API](https://github.com/microsoft/typescript-go/tree/main/internal/api)：当前安装的 TypeScript 包通过 `typescript/unstable/async` 提供 API、snapshot、program、checker。包根入口不暴露 compiler API，不意味着 native API 不存在。实现按实际安装的声明与运行验证使用 async 入口；不固定版本，API 不支持则明确 CompilerUnavailable。

Compiler 负责别名、泛型、HKT、tuple 与项目诊断；resolver 使用其语义 Symbol/Type，拷贝成领域值后释放 session。Babel、打印类型解析与按 import 路径猜身份都不是本工具的语义来源。六类诊断全部收集，semantic 为空不能掩盖 program/config 错误。

## 连接、事实与走查

- Parnas (1972). “A Technique for Software Module Specification with Examples.” *CACM* 15(5)：接口只提供使用者需要的信息。
- Parnas、Clements (1986)：接口规格包含使用者可观察的不希望发生的事件。本 skill 用 Outcome 表达这些结局，用 Next/Later/Duty 区分下一次调用与最终责任。
- Liskov, B., Wing, J. (1994). “A Behavioral Notion of Subtyping.” *ACM TOPLAS* 16(6)：可替换性取决于行为规格，不只是签名。本 skill 的 Carrier 与连接定律属于人工语义边界，类型相容不等于允许接入。
- Cockburn, A. (2000). *Writing Effective Use Cases*：失败扩展与主流程共同说明交互。本 skill 要求正常、失败、中断场景，但有限事实匹配不证明现实覆盖性。

Returned/Occurred、最大义务匹配、静态 Lifecycle、Role 与可选 Binding、一次内存 Graph 均是本 skill 的工程契约，不归因于某篇文献。它们分别避免把发起调用当成功、贪心错配责任、模拟运行值、隐式选提供者与持久派生副本。

## 依据、需求与理由

- Jackson, M. (2001). *Problem Frames*：区分世界的性质与机器行为；需求是问题域中期望成立的性质，不是机器功能列表。
- Barbacci, M. et al. (2003). *Quality Attribute Workshops (QAWs), Third Edition*. CMU/SEI-2003-TR-016：环境、刺激、响应与响应度量支持可观察质量要求。
- Nygard, M. (2011). “Documenting Architecture Decisions.”：决定与背景、后果放在一起。
- Ubl, M. [“Design Docs at Google”](https://www.industrialempathy.com/posts/design-docs-at-google/)：可信替代与取舍是设计说明的一部分。本 skill 只在有真实替代时要求说明，而不制造固定模板的虚假选项。

## Markdown 与运行时视图

[CommonMark](https://spec.commonmark.org/) 与 [mdast-util-from-markdown](https://github.com/syntax-tree/mdast-util-from-markdown) 提供真实 Markdown 语法树。工具只检查节点结构、链接与符号引用，不从正则片段推断语义，也不把代码/HTML 当正文规则。

Graph 子 skill 复用父验证结果，使用本次调用的 Map 与有向邻接表，提供 view/search/neighbors/path。stdout 不是持久设计输入，结构路径不是运行证明。自动五阶段成功与 ManualReviewRequired 分开，是本工具的检查边界。
