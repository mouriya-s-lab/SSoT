# 出处

按各 skill 的规则列出所依据的来源，供核对论据。这里只说明每条规则从哪里来；设计文档不需要引用这些来源，也不按来源组织。

## SSoT 是什么：逐步建模的机会

- Brown, S. (2024)，出处见「架构与优先级」：多数组织只画上下文与容器两层，第三、四层有价值时再画；四层抽象保留是为了“落地”，即能从高层追溯到代码，不等于每层都要画出来。据此一个位置默认停在图上的框，往下写只在有理由时发生，C4 的上下文与容器是默认基线。
- Moreira, G. 访谈 "Can We Trust AI-Written Code?"（仓库 `articles/can-we-trust-ai-written-code.blog.md`）：正确性用行为定义，规格要运行而不是阅读；模型是更抽象而不是更简单的版本，不担心的部分（如排序）只写输入输出；好模型的判据是足以捕获某一类 bug，因而要建出对抗它的环境；先让错误的版本打破性质，并确认模型确实在做事；行为的粒度取“足够小、又值得研究”的状态机；没有理解就没有信心。据此规定深入三问、不担心的盒子只留签名、性质写在可观察的线上并配覆盖目标、评审追问“换掉一个盒子会怎样”，以及一个接线模块只围绕一个担心。
- 规格本身可能是错的、早期没有运行观测时形式化证明没有意义、精度随使用者声明的阶段增加，是本项目使用者给出的方法，不来自上述作者。

## String Diagram：盒子、接线与反馈

- Di Lavore, E., Gianola, A., Román, M., Sabadini, N., Sobociński, P. (2020). "Span(Graph): a Canonical Feedback Algebra of Open Transition Systems." [arXiv:2010.10069](https://arxiv.org/abs/2010.10069)：Span(Graph) 是 Span(Set) 上自由的反馈范畴——“Theory of Processes + Feedback = Theory of Stateful Processes”；Span(Set) 是谓词的代数，加反馈得到开放迁移系统的代数；开放迁移系统沿共同边界同步组合。据此把 VDM 模块读成一个盒子（端口上的谓词，`state` 是它自己的反馈线），把 Quint 模块读成接线（每个 `var` 是一条带延迟的线：盒子的反馈或盒子之间在途的值；顺接的步骤写成一串盒子），不直接写全局状态图，也不为实体记进度。
- Piedeleu, R., Zanasi, F. (2023). "An Introduction to String Diagrams for Computer Scientists." [arXiv:2305.08768](https://arxiv.org/abs/2305.08768)：把 string diagram 当作带语义的语法，盒子、线、顺序与并行组合。据此渲染盒子图与组合图。

## 设计是什么

- Brooks, F. *The Mythical Man-Month*, ch. 4：架构说明发生什么，实现说明怎样让它发生（"architecture tells what happens, implementation tells how it is made to happen"）。据此把组合成整体与逐情形的处理划给实现。
- Parnas, D. L. (1972). "On the Criteria To Be Used in Decomposing Systems into Modules." *CACM* 15(12)：模块隐藏的决定可以在接口不变时改变。据此把“在连接不变时可以替换的做法”定为实现。
- Lamport, L. (2015). "Who Builds a House without Drawing Blueprints?" *CACM* 58(4)：规格写在代码之上的抽象层，省略实现细节；规格是检验实现的参照。（"Who Builds a Skyscraper…" 是他 2014 年的同题演讲。）
- Parnas, D. L., Clements, P. C. (1986). "A Rational Design Process: How and Why to Fake It." *IEEE TSE* SE-12(2)：文档呈现当前的设计，不记录试错过程。

## 架构与优先级

- Perry, D. E., Wolf, A. L. (1992). "Foundations for the Study of Software Architecture." *ACM SIGSOFT SEN* 17(4)：`Architecture = {Elements, Form, Rationale}`。本项目的载体只写元素与形式；理由不进设计，见「设计只呈现结果」。
- Kruchten, P. (1995). "The 4+1 View Model of Architecture." *IEEE Software* 12(6)：进程视图与物理视图中部件运行在哪里、随谁部署，是与模块分解不同的投影。据此把部署与信任边界写成 LikeC4 的部署模型，与元素树分开。
- Booch, G. (2006). "On Architecture." *IEEE Software*，DOI 10.1109/MS.2006.52：架构是一组重要决定，必须保持可见。把架构与业务用 `#business` 标签分开是本项目自己的划分，这篇文章不给出它。
- Brown, S. *The C4 model for visualising software architecture*（[c4model.com](https://c4model.com)）：person、software system、container、component 四种抽象与逐级放大的图；container 是必须运行起来系统才能工作的应用或数据存储，component 是 container 内、在明确接口后面的一组功能，不能单独运行；每个元素写类型、技术与一句职责，每张图带标题与图例、能离开旁白独立读懂（[notation](https://c4model.com/diagrams/notation)、[review checklist](https://c4model.com/diagrams/checklist)）。据此用 LikeC4 只画这四种元素、逐层视图，并以渲染图评审结构。
- Brown, S. (2024). "The C4 Model – Misconceptions, Misuses & Mistakes." GOTO 2024（仓库 `articles/c4-model-misconceptions.blog.md` 有整理）：组件不再嵌套组件；子系统、分层等是组织结构，用分组表达，不是新的抽象层级；外部系统与别的团队的容器不画进自己的图；上下文图与容器图通常就够；图不表达决策。据此规定严格的 C4 层级、外部不展开、逻辑分组用视图 `group`、不强制展开到底、C4 里不写依据。
- LikeC4 官方示例 [likec4/template](https://github.com/likec4/template)：`specification` 里给元素种类写 `notation` 与形状，视图用样式突出焦点。据此规定示例与总纲里的 LikeC4 写法。

## 两条轴与依赖方向

- Parnas, D. L. (1972)，出处见「设计是什么」：按难的或会变的决定划分模块，模块向外只暴露接口。据此区分元素的对外连接与内部划分，每一层只说这一层。
- C4 的箭头表示运行期由谁发起调用，不表示 Parnas 意义上的 uses 依赖，所以结构不做依赖无环检查。契约模块之间的 import 无环，是因为生成的 Quint 模块不允许循环引用，与结构无关。

## 规格：VDM-SL

- Jones, C. B. (1990). *Systematic Software Development using VDM*, 2nd ed. Prentice Hall：以类型、不变式、前置与后置条件写规格，隐式规格说明做到什么而不说明怎么做。据此先写隐式规格，只在计算本身是设计决定时写显式体。
- Fitzgerald, J., Larsen, P. G. (2009). *Modelling Systems: Practical Tools and Techniques in Software Engineering*, 2nd ed. Cambridge University Press：用 VDM-SL 的模块、状态与操作为系统建模并以工具验证。据此用模块的 `exports` 表达连接、用状态不变式表达连接面共享的规则。
- ISO/IEC 13817-1:1996, *Vienna Development Method — Specification Language — Part 1: Base language*：VDM-SL 的语法与语义。
- Overture, *VDM-10 Language Manual* (TR-001)：Overture 与 VDMJ 实现的语言版本，包括模块的 imports/exports 与 `struct` 导出。据此用不带 `struct` 的导出表达不承诺结构。
- Minsky, Y. "Effective ML."（"make illegal states unrepresentable"）：用类型排除不可能的组合。本项目只在观察者确实要按分支或读字段时才这样做，其余先写进 `inv` 与 `pre`/`post`。
- Liskov, B., Wing, J. (1994). "A Behavioral Notion of Subtyping." *ACM TOPLAS* 16(6)：可替换性取决于行为规格，不只取决于签名。据此把准入定律写成前置条件、后置条件与不变式，签名相容不等于可以接入。
- Parnas, D. L., Clements, P. C. (1986)，出处见「设计是什么」：接口规格包含 undesired events，即使用方能观察到的失败。据此要求可观察的失败是结局中的一支。

## 判据：充分与无偏差

- Jackson, M. (2000). "Problem Analysis and Structure." NATO Summer School, Marktoberdorf（[作者手稿](https://people.csail.mit.edu/dnj/teaching/6898/papers/mj-marktoberdorf.pdf)）；Jackson, M. (2005). "Problem frames and software engineering." *Information and Software Technology* 47, 903–912, DOI 10.1016/j.infsof.2005.08.004：需求、领域性质与机器规格是三份描述，要论证“规格 ∧ 领域性质 ⇒ 需求”。据此 `ssot-requirement` 为每条需求写领域性质与论证。机器与环境只经共享现象交互，环境一方只能观察机器交出的现象；据此要求参与者每一步用的值，都是它本来知道的或前一个连接交给它的。他在 *Software Requirements & Specifications*（1995）“The Fudge Factor” 一条记录了把环境目标写成不变式、让系统的本职工作消失的错误，据此规定领域性质不写成不变式。
- Jones, C. B. (1990)，出处见「规格：VDM-SL」，§9.3：一个模型有偏差（bias），当且仅当存在两个不同的状态，任何一串可用的操作都区分不了它们；无偏差的模型只保留操作观察得到的区分。据此把“观察者需要才展开”落成无偏差判据，由 `ssot-verify-contract` 判断。§3.1：确定的函数也可以隐式规定，显式体是一种设计选择，不由“结果唯一”推出。
- Wing, J. M. (1990). "A Specifier's Introduction to Formal Methods." *Computer* 23(9), 8–22，DOI 10.1109/2.58215：规格要排除不可接受的实现，同时不带实现偏差（implementation bias）。据此要求每条约束的违反情形被规格拒绝，体与谓词只写约束要求的承诺。
- 工具的落地是本项目自己的近似，不是上述作者的方法：`ssot eval` 求出的违反实例只证明规格拒绝或接受了写下的那一个值；`hint.*` 只认得出语法上确定的迹象（没有 importer、没有读字段者、没有被读写的状态分量），是否构成偏差由评审判断。

## 次序：Quint

- Lamport, L. (2002). *Specifying Systems*. Addison-Wesley：用状态与时序性质描述并发系统，在要检验的性质涉及崩溃与交错时对它们建模。据此把跨连接的先后、交错、停机与崩溃收束写成 Quint 接线，不写进 VDM。
- Newcombe, C. et al. (2015). "How Amazon Web Services Uses Formal Methods." *CACM* 58(4)：对设计做有界的模型检验，能找出测试难以触发的交错。据此用模拟与覆盖目标（`witness…`）检验少见的交错。
- Cockburn, A. (2000). *Writing Effective Use Cases*：主流程之外，每个失败分支都是一条扩展。据此要求被调连接返回的每一支可观察结局，调用方都有处理。

## 设计只呈现结果

- Parnas, D. L., Clements, P. C. (1986)，出处见「设计是什么」：文档呈现当前的设计，不记录试错过程。
- Brown, S. (2024)，出处见「架构与优先级」：架构图展示决策的结果，不表达决策本身。本项目不另设决策记录，依据、来源与被放弃的方案不写进任何载体。
- Jackson, M. (2001). *Problem Frames*：区分世界中系统不能设计的性质与系统本身；需求是期望在问题域中成立的性质，不是机器的功能列表。据此需求由结构回答、由盒子或接线兑现，或留给代码；需求的论证在 `ssot-requirement` 里只用来做深入判断。

## 工具

- [LikeC4](https://likec4.dev)：元素、关系、标签、逐层视图与部署模型的建模语言与模型 API；`check` 用它的进程内模型读出元素树与关系，`render` 用它自己的渲染导出每个视图的图片。
- [VDMJ](https://github.com/nickbattle/vdmj)：VDM-SL 的解析器、类型检查器、证明义务生成器与解释器；`check` 用它做类型检查、证明义务与回放时的求值，`ssot eval` 用它在原样规格里求值。
- Battle, N., Ellyton, M. (2024). ["QuickCheck for VDM"](https://arxiv.org/abs/2410.02046). *Proceedings of the 22nd Overture Workshop*：为证明义务寻找反例或证明；`check` 把反例当作错误，把未定的义务作为提示交给评审。
- [Quint](https://quint-lang.org)：基于 TLA 的规格语言；`check` 用它的类型检查、模拟与 ITF 轨迹输出。
