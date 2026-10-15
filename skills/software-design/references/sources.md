# 出处

按 SKILL.md 各节列出所依据的来源，供核对论据。这里只说明每条规则从哪里来；设计文档不需要引用这些来源，也不按来源组织。

## 设计是什么

- Brooks, F. *The Mythical Man-Month*, ch. 4：架构说明发生什么，实现说明怎样让它发生（"architecture tells what happens, implementation tells how it is made to happen"）。据此把组合成整体与逐情形的处理划给实现。
- Parnas, D. L. (1972). "On the Criteria To Be Used in Decomposing Systems into Modules." *CACM* 15(12)：模块隐藏的决定可以在接口不变时改变。据此把“在连接不变时可以替换的做法”定为实现。
- Lamport, L. (2015). "Who Builds a Skyscraper without Drawing Blueprints?" *CACM* 58(4)：规格写在代码之上的抽象层，省略实现细节；规格是检验实现的参照。
- Parnas, D. L., Clements, P. C. (1986). "A Rational Design Process: How and Why to Fake It." *IEEE TSE* SE-12(2)：文档呈现当前的设计，不记录试错过程。

## 骨架与优先级

- Perry, D. E., Wolf, A. L. (1992). "Foundations for the Study of Software Architecture." *ACM SIGSOFT SEN* 17(4)：`Architecture = {Elements, Form, Rationale}`，对应骨架的三问：由什么组成、用什么组成、为什么。
- Kruchten, P. (1995). "The 4+1 View Model of Architecture." *IEEE Software* 12(6)：进程视图与物理视图中部件运行在哪里、随谁部署，是与模块分解不同的投影。据此把包含关系与模块树分开写。
- Booch, G. (2006). "On Architecture." *IEEE Software*：架构是一组重要决定，必须保持可见。据此把骨架与业务分开写。

## 两条轴与依赖方向

- Parnas, D. L. (1972)，出处见「设计是什么」：按难的或会变的决定划分模块，模块向外只暴露接口。据此划出外部连接、核心代码、内部设计，并只按抽象划分模块。
- Parnas, D. L. (1979). "Designing Software for Ease of Extension and Contraction." *IEEE TSE* SE-5(2)：uses 关系必须无环、分层，依赖只指向接口。据此规定父模块不依赖子模块、目录之间的 import 不成环。
- Parnas, Clements, Weiss (1985). "The Modular Structure of Complex Systems."：模块指南按层级组织，与抽象层级这条轴对应。

## 规格：VDM-SL

- Jones, C. B. (1990). *Systematic Software Development using VDM*, 2nd ed. Prentice Hall：以类型、不变式、前置与后置条件写规格，隐式规格说明做到什么而不说明怎么做。据此先写隐式规格，只在计算本身是设计决定时写显式体。
- Fitzgerald, J., Larsen, P. G. (2009). *Modelling Systems: Practical Tools and Techniques in Software Engineering*, 2nd ed. Cambridge University Press：用 VDM-SL 的模块、状态与操作为系统建模并以工具验证。据此用模块的 `exports` 表达连接、用状态不变式表达连接面共享的规则。
- ISO/IEC 13817-1:1996, *Vienna Development Method — Specification Language — Part 1: Base language*：VDM-SL 的语法与语义。
- Overture, *VDM-10 Language Manual* (TR-001)：Overture 与 VDMJ 实现的语言版本，包括模块的 imports/exports 与 `struct` 导出。据此用不带 `struct` 的导出表达不承诺结构。
- Minsky, Y. "Effective ML."（"make illegal states unrepresentable"）：用类型排除不可能的组合。据此把规则先写进类型与不变式，写不进的才进文字。
- Liskov, B., Wing, J. (1994). "A Behavioral Notion of Subtyping." *ACM TOPLAS* 16(6)：可替换性取决于行为规格，不只取决于签名。据此把准入定律写成前置条件、后置条件与不变式，签名相容不等于可以接入。
- Parnas, D. L., Clements, P. C. (1986)，出处见「设计是什么」：接口规格包含 undesired events，即使用方能观察到的失败。据此要求可观察的失败是结局中的一支。

## 文字与文学式规格

- Knuth, D. E. (1984). "Literate Programming." *The Computer Journal* 27(2)：程序与解释它的文字写在同一份文档里。据此把规格块与文字放在同一个 `.tex` 文件里。
- Overture, *Overture VDM-10 Tool Support: User Guide* 与 [VDM-VSCode Translation](https://github.com/overturetool/vdm-vscode/wiki/Translation)：`vdm_al` 环境里的内容是规格，其余是 LaTeX 文字，VDM 解析器只读规格块。
- [CTAN vdmlisting](https://ctan.org/pkg/vdmlisting)：排版 VDM ASCII 语法的 LaTeX 宏包，定义 `vdm_al` 环境。

## 场景

- Kruchten, P. (1995)，出处见「骨架与优先级」：以关键场景走查架构，走不通就修改架构。
- Cockburn, A. (2000). *Writing Effective Use Cases*：主流程之外，每个失败分支都是一条扩展。据此要求每种失败结局都有场景。

## 依据与理由

- Jackson, M. (2001). *Problem Frames*：区分世界中系统不能设计的性质与系统本身；需求是期望在问题域中成立的性质，不是机器的功能列表。
- Barbacci, M. et al. (2003). *Quality Attribute Workshops (QAWs), Third Edition*. CMU/SEI-2003-TR-016：质量场景由刺激、环境、响应与响应度量等要素组成。
- Nygard, M. (2011). "Documenting Architecture Decisions."：决定与其背景、后果写在一起。
- Ubl, M. ["Design Docs at Google"](https://www.industrialempathy.com/posts/design-docs-at-google/)：可信替代与取舍是设计文档的必要内容。

## 脚本

- [VDMJ](https://github.com/nickbattle/vdmj)：VDM-SL 的解析器、类型检查器、证明义务生成器与解释器；`scripts/Outline.java` 用它的解析器读出模块、定义、字段与 import，`check` 用它做类型检查与证明义务。
- Battle, N., Ellyton, M. (2024). ["QuickCheck for VDM"](https://arxiv.org/abs/2410.02046). *Proceedings of the 22nd Overture Workshop*：为证明义务寻找反例或证明；`check` 把反例当作违规，把未定的义务交给人判断。
