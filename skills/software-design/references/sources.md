# 出处

按 SKILL.md 各节列出所依据的来源，供核对论据。这里只说明每条规则从哪里来；设计文档不需要引用这些来源，也不按来源组织。

## 设计是什么

- Brooks, F. *The Mythical Man-Month*, ch. 4：架构说明发生什么，实现说明怎样让它发生（"architecture tells what happens, implementation tells how it is made to happen"）。据此把边界情况与组合成整体划给实现。
- Lamport, L. (2015). "Who Builds a Skyscraper without Drawing Blueprints?" *CACM* 58(4)：规格写在代码之上的抽象层，省略实现细节。
- Parnas, D. L., Clements, P. C. (1986). "A Rational Design Process: How and Why to Fake It." *IEEE TSE* SE-12(2)：文档呈现当前的设计，不记录试错过程。

## 骨架与优先级

- Perry, D. E., Wolf, A. L. (1992). "Foundations for the Study of Software Architecture." *ACM SIGSOFT SEN* 17(4)：`Architecture = {Elements, Form, Rationale}`，对应骨架的三问：由什么组成、用什么组成、为什么。
- Kruchten, P. (1995). "The 4+1 View Model of Architecture." *IEEE Software* 12(6)：沿用同一公式。
- Booch, G. (2006). "On Architecture." *IEEE Software*：架构是一组重要决定，必须保持可见。据此把骨架与业务分开写。

## 两条轴

- Parnas, D. L. (1972). "On the Criteria To Be Used in Decomposing Systems into Modules." *CACM* 15(12)：按难的或会变的决定划分模块，模块向外只暴露接口。据此划出内部设计、外部连接、核心代码。
- Parnas, D. L. (1979). "Designing Software for Ease of Extension and Contraction." *IEEE TSE* SE-5(2)：uses 关系必须无环、分层，依赖只指向接口。据此规定 import 方向与无环。
- Parnas, Clements, Weiss (1985). "The Modular Structure of Complex Systems."：模块指南按层级组织，与抽象层级这条轴对应。

## 连接

- Parnas, D. L. (1972). "A Technique for Software Module Specification with Examples." *CACM* 15(5)：接口只给出使用者需要的信息。
- Liskov, B., Wing, J. (1994). "A Behavioral Notion of Subtyping." *ACM TOPLAS* 16(6)：可替换性取决于行为规格，不只取决于签名。据此规定准入规则包含类型强制不了的定律，签名相容不等于可以接入。

## 类型

- TypeScript Handbook：泛型、条件类型、索引访问类型、`Extract`。
- Yallop, J., White, L. (2014). "Lightweight Higher-Kinded Polymorphism." *FLOPS*：在没有原生高阶类型的语言中编码类型构造器。
- Effect 的 `HKT` 模块以 `TypeLambda` 加 `this` 取参的方式编码高阶类型，是本 skill 所用写法的先例。
- `scripts/design.ts` 用 Babel 解析器（`@babel/parser` 的 TypeScript 插件）读取 import 与注释，用 TypeScript 编译器检查类型。npm 上 TypeScript 7 的包不再提供 JavaScript 编译器 API，所以语法树改由 Babel 提供。

## 依据与理由

- Jackson, M. (2001). *Problem Frames*：区分世界中系统不能设计的性质与系统本身。依据中的外部事实沿用这一区分；依据中的给定约束来自用户或环境，不来自 Jackson。
- Nygard, M. (2011). "Documenting Architecture Decisions."：决定与其背景、后果写在一起。
- Ubl, M. "Design Docs at Google." industrialempathy.com：可信替代与取舍是设计文档的必要内容。据此规定确实存在可信替代时写一句为什么不选。
