# 出处

按 SKILL.md 各节列出所依据的来源，供核对论据。这里只说明每条规则从哪里来；设计文档不需要引用这些来源，也不按来源组织。

## 设计是什么

- Brooks, F. *The Mythical Man-Month*, ch. 4：架构说明发生什么，实现说明怎样让它发生（"architecture tells what happens, implementation tells how it is made to happen"）。据此把组合成整体与逐情形的处理划给实现。
- Parnas, D. L. (1972). "On the Criteria To Be Used in Decomposing Systems into Modules." *CACM* 15(12)：模块隐藏的决定可以在接口不变时改变。据此把"在连接不变时可以替换的做法"定为实现。
- Lamport, L. (2015). "Who Builds a Skyscraper without Drawing Blueprints?" *CACM* 58(4)：规格写在代码之上的抽象层，省略实现细节。
- Parnas, D. L., Clements, P. C. (1986). "A Rational Design Process: How and Why to Fake It." *IEEE TSE* SE-12(2)：文档呈现当前的设计，不记录试错过程。

## 骨架与优先级

- Perry, D. E., Wolf, A. L. (1992). "Foundations for the Study of Software Architecture." *ACM SIGSOFT SEN* 17(4)：`Architecture = {Elements, Form, Rationale}`，对应骨架的三问：由什么组成、用什么组成、为什么。
- Kruchten, P. (1995). "The 4+1 View Model of Architecture." *IEEE Software* 12(6)：沿用同一公式；进程视图与物理视图中部件运行在哪里、随谁部署，是与模块分解不同的投影。据此用 `Scope` 单独表达包含，模块树不代表任何包含。
- Booch, G. (2006). "On Architecture." *IEEE Software*：架构是一组重要决定，必须保持可见。据此把骨架与业务分开写。

## 两条轴

- Parnas, D. L. (1972)，出处见「设计是什么」：按难的或会变的决定划分模块，模块向外只暴露接口。据此划出外部连接、核心代码、内部设计，并只按抽象划分模块。
- Parnas, D. L. (1979). "Designing Software for Ease of Extension and Contraction." *IEEE TSE* SE-5(2)：uses 关系必须无环、分层，依赖只指向接口。据此规定模块只使用自己与祖先的核心元素、模块依赖不成环。
- Parnas, Clements, Weiss (1985). "The Modular Structure of Complex Systems."：模块指南按层级组织，与抽象层级这条轴对应。

## DSL

- Fowler, M. (2010). *Domain-Specific Languages*：内部 DSL 借用宿主语言的语法与检查器。据此把设计元素写成 TypeScript 类型构造器，由 `tsc` 执行约束。
- Minsky, Y. "Effective ML."（"make illegal states unrepresentable"）：用类型排除不可能的组合。据此让说明成为必填的类型参数，让成员只能是 DSL 元素。
- Yallop, J., White, L. (2014). "Lightweight Higher-Kinded Polymorphism." *FLOPS*：在没有原生高阶类型的语言中编码类型构造器。Effect 的 `HKT` 模块以 `TypeLambda` 加 `this` 取参的方式编码高阶类型，是 DSL 载体写法的先例。
- TypeScript Handbook，"Project References"：一个项目只能看到自己的文件与被引用项目的输出。据此由项目引用强制架构不引用业务。

## 连接

- Parnas, D. L. (1972). "A Technique for Software Module Specification with Examples." *CACM* 15(5)：接口只给出使用者需要的信息。
- Parnas, D. L., Clements, P. C. (1986)，出处见「设计是什么」：接口规格包含 undesired events，即使用方能观察到的失败。据此要求失败结局是 `Outcome` 中的一支，并由 `Then` 指出恢复要走的操作。
- Liskov, B., Wing, J. (1994). "A Behavioral Notion of Subtyping." *ACM TOPLAS* 16(6)：可替换性取决于行为规格，不只取决于签名。据此规定准入定律，签名相容不等于可以接入。

## 场景

- Kruchten, P. (1995)，出处见「骨架与优先级」：以关键场景走查架构，走不通就修改架构。
- Cockburn, A. (2000). *Writing Effective Use Cases*：主流程之外，每个失败分支都是一条扩展。据此要求每种失败结局都有场景。

## 依据与理由

- Jackson, M. (2001). *Problem Frames*：区分世界中系统不能设计的性质与系统本身；需求是期望在问题域中成立的性质，不是机器的功能列表。依据中的外部事实与业务单元的「需求」沿用这一区分。
- Barbacci, M. et al. (2003). *Quality Attribute Workshops (QAWs), Third Edition*. CMU/SEI-2003-TR-016：质量场景由刺激、环境、响应与响应度量等要素组成。依据中的质量要求沿用其中的环境、刺激、响应、度量四项。
- Nygard, M. (2011). "Documenting Architecture Decisions."：决定与其背景、后果写在一起。
- Ubl, M. "Design Docs at Google." industrialempathy.com：可信替代与取舍是设计文档的必要内容。据此规定确实存在可信替代时写一句为什么不选。

## 脚本

- `scripts/design.ts` 用 Babel 解析器（`@babel/parser` 的 TypeScript 插件）读取设计类型、抽取设计图，用 TypeScript 编译器构建项目。npm 上 TypeScript 7 的包不再提供 JavaScript 编译器 API，所以语法树由 Babel 提供。
