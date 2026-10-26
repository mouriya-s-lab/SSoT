# 出处

按 SKILL.md 各节列出所依据的来源，供核对论据。这里只说明每条规则从哪里来；设计文档不需要引用这些来源，也不按来源组织。

## 设计是什么

- Brooks, F. *The Mythical Man-Month*, ch. 4：架构说明发生什么，实现说明怎样让它发生（"architecture tells what happens, implementation tells how it is made to happen"）。据此把组合成整体与逐情形的处理划给实现。
- Parnas, D. L. (1972). "On the Criteria To Be Used in Decomposing Systems into Modules." *CACM* 15(12)：模块隐藏的决定可以在接口不变时改变。据此把“在连接不变时可以替换的做法”定为实现。
- Lamport, L. (2015). "Who Builds a House without Drawing Blueprints?" *CACM* 58(4)：规格写在代码之上的抽象层，省略实现细节；规格是检验实现的参照。（"Who Builds a Skyscraper…" 是他 2014 年的同题演讲。）
- Parnas, D. L., Clements, P. C. (1986). "A Rational Design Process: How and Why to Fake It." *IEEE TSE* SE-12(2)：文档呈现当前的设计，不记录试错过程。

## 架构与优先级

- Perry, D. E., Wolf, A. L. (1992). "Foundations for the Study of Software Architecture." *ACM SIGSOFT SEN* 17(4)：`Architecture = {Elements, Form, Rationale}`，对应架构的三问：由什么组成、用什么组成、为什么。
- Kruchten, P. (1995). "The 4+1 View Model of Architecture." *IEEE Software* 12(6)：进程视图与物理视图中部件运行在哪里、随谁部署，是与模块分解不同的投影。据此把包含关系与模块树分开写。
- Booch, G. (2006). "On Architecture." *IEEE Software*，DOI 10.1109/MS.2006.52：架构是一组重要决定，必须保持可见。把架构与业务分成两个桶是本项目自己的划分，这篇文章不给出它。

## 两条轴与依赖方向

- Parnas, D. L. (1972)，出处见「设计是什么」：按难的或会变的决定划分模块，模块向外只暴露接口。据此划出外部连接、核心代码、内部设计，并只按抽象划分模块。
- Parnas, D. L. (1979). "Designing Software for Ease of Extension and Contraction." *IEEE TSE* SE-5(2)：uses 关系必须无环、分层，依赖只指向接口。据此规定目录之间的 import 不成环。
- Parnas, Clements, Weiss (1985). "The Modular Structure of Complex Systems."：模块指南把模块按职责组织成树，并说明模块树、uses 关系与运行期进程结构是三种不同的结构。本项目把模块树当作抽象层级这条轴、规定父模块不依赖子模块，是自己的约定，不是这篇文章推出的结论。

## 规格：VDM-SL

- Jones, C. B. (1990). *Systematic Software Development using VDM*, 2nd ed. Prentice Hall：以类型、不变式、前置与后置条件写规格，隐式规格说明做到什么而不说明怎么做。据此先写隐式规格，只在计算本身是设计决定时写显式体。
- Fitzgerald, J., Larsen, P. G. (2009). *Modelling Systems: Practical Tools and Techniques in Software Engineering*, 2nd ed. Cambridge University Press：用 VDM-SL 的模块、状态与操作为系统建模并以工具验证。据此用模块的 `exports` 表达连接、用状态不变式表达连接面共享的规则。
- ISO/IEC 13817-1:1996, *Vienna Development Method — Specification Language — Part 1: Base language*：VDM-SL 的语法与语义。
- Overture, *VDM-10 Language Manual* (TR-001)：Overture 与 VDMJ 实现的语言版本，包括模块的 imports/exports 与 `struct` 导出。据此用不带 `struct` 的导出表达不承诺结构。
- Minsky, Y. "Effective ML."（"make illegal states unrepresentable"）：用类型排除不可能的组合。据此把规则先写进类型与不变式，写不进的才进文字。
- Liskov, B., Wing, J. (1994). "A Behavioral Notion of Subtyping." *ACM TOPLAS* 16(6)：可替换性取决于行为规格，不只取决于签名。据此把准入定律写成前置条件、后置条件与不变式，签名相容不等于可以接入。
- Parnas, D. L., Clements, P. C. (1986)，出处见「设计是什么」：接口规格包含 undesired events，即使用方能观察到的失败。据此要求可观察的失败是结局中的一支。

## 判据：充分与无偏差

- Jackson, M. (2000). "Problem Analysis and Structure." NATO Summer School, Marktoberdorf（[作者手稿](https://people.csail.mit.edu/dnj/teaching/6898/papers/mj-marktoberdorf.pdf)）；Jackson, M. (2005). "Problem frames and software engineering." *Information and Software Technology* 47, 903–912, DOI 10.1016/j.infsof.2005.08.004：需求、领域性质与机器规格是三份描述，要论证“规格 ∧ 领域性质 ⇒ 需求”。据此在草稿里写领域性质与每块需求的论证，不在任何论证里的约束是多余的。机器与环境只经共享现象交互，环境一方只能观察机器交出的现象；据此要求论证里参与者每一步用的值，都是它本来知道的或前一个连接交给它的。他在 *Software Requirements & Specifications*（1995）“The Fudge Factor” 一条记录了把环境目标写成不变式、让系统的本职工作消失的错误，据此规定领域性质不写成不变式。
- Jones, C. B. (1990)，出处见「规格：VDM-SL」，§9.3：一个模型有偏差（bias），当且仅当存在两个不同的状态，任何一串可用的操作都区分不了它们；无偏差的模型只保留操作观察得到的区分。据此把“观察者需要才展开”落成无偏差判据，并由验证判 `bias`。§3.1：确定的函数也可以隐式规定，显式体是一种设计选择，不由“结果唯一”推出。
- Wing, J. M. (1990). "A Specifier's Introduction to Formal Methods." *Computer* 23(9), 8–22，DOI 10.1109/2.58215：规格要排除不可接受的实现，同时不带实现偏差（implementation bias）。据此要求每条约束的违反情形被规格拒绝，体与谓词只写约束要求的承诺。
- 工具的两种落地是本项目自己的近似，不是上述作者的方法：违反情形的实例交给 VDMJ 求值，只证明落点拒绝了写下的那一个违反情形，不证明实例真违反了需求；静态检查只认得出“没有任何定义读到”的状态分量，读到了不等于能区分，记录字段与其余情形由验证判断。

## 文字与文学式规格

- Knuth, D. E. (1984). "Literate Programming." *The Computer Journal* 27(2)：程序与解释它的文字写在同一份文档里。据此把规格块与文字放在同一个 Markdown 文件里。
- Battle, N. *VDMJ Tool Support: User Guide*（本地版 [`vdm/vdmj-user-guide.md`](vdm/vdmj-user-guide.md)）：文学式源文件里规格块之外的行按空行处理，报错的行号因此与原文件一致。`check` 照这个办法从 Markdown 生成同样行数的 `.vdmsl` 文件交给 VDMJ。

## 场景

- Kruchten, P. (1995)，出处见「架构与优先级」：以关键场景走查架构，走不通就修改架构；在他的方法里场景也用来发现架构。本项目只为生命周期约束写场景操作，并把时钟、进程崩溃与调度写进「语义」而不建模，这是自己的选择；Lamport（*Specifying Systems*，2002）与 Newcombe 等（"How Amazon Web Services Uses Formal Methods," *CACM* 58(4), 2015）在要检验的性质涉及崩溃与交错时会对它们建模。
- Cockburn, A. (2000). *Writing Effective Use Cases*：主流程之外，每个失败分支都是一条扩展。据此要求需求关心的每种失败都是调用方能区分的结局，并且场景里被调连接返回的每一支结局都有处理；失败之后的恢复次序只有需求要求时才写成场景。

## 依据与理由

- Jackson, M. (2001). *Problem Frames*：区分世界中系统不能设计的性质与系统本身；需求是期望在问题域中成立的性质，不是机器的功能列表。
- Barbacci, M. et al. (2003). *Quality Attribute Workshops (QAWs), Third Edition*. CMU/SEI-2003-TR-016：质量场景由刺激、环境、响应与响应度量等要素组成。
- Nygard, M. (2011). "Documenting Architecture Decisions."：决定与其背景、后果写在一起。
- Ubl, M. ["Design Docs at Google"](https://www.industrialempathy.com/posts/design-docs-at-google/)：可信替代与取舍是设计文档的必要内容。

## 脚本

- [VDMJ](https://github.com/nickbattle/vdmj)：VDM-SL 的解析器、类型检查器、证明义务生成器与解释器；`scripts/Outline.java` 用它的解析器读出模块、定义、字段与 import，以及每个定义读到的状态分量，并按语法树节点的类别找出反模式与审查对象；`check` 用它做类型检查与证明义务，没人用的顶层定义取自它的 Warning 5000；`ssot design constraints` 用它对违反情形的实例求值，`ssot design attack` 与 `ssot verify attack` 用它对反例求值。
- Battle, N., Ellyton, M. (2024). ["QuickCheck for VDM"](https://arxiv.org/abs/2410.02046). *Proceedings of the 22nd Overture Workshop*：为证明义务寻找反例或证明；`check` 把反例当作违规，把未定的义务交给人判断。
- omp 的 judge（jev 模型）：对给定材料回答校准过的是非问题；`scripts/review.py` 用它审查需要理解含义的反模式，问题与阈值由 `scripts/review-calibration.json` 的正反样本校准。
