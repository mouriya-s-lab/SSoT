# 出处

按 SKILL.md 各阶段列出所依据的来源，供核对方法与论据。这里的归组及来源采用的文档形式，不要求设计文档按阶段拆分或另建对应产物。

## 设计是什么

- IEEE Std 1016-2009, *Software Design Descriptions*, §3.1 设计定义；§4.1 SDD 必需内容（stakeholders、concerns、viewpoints、views、overlays、rationale）；§3.2.2 可追溯性与验证。
- ISO/IEC/IEEE 42010:2022, *Architecture description*：stakeholders / concerns / viewpoints / views / rationale 本体；明确不规定方法与格式。
- Kruchten, P. (1995). "The 4+1 View Model of Architecture." *IEEE Software* 12(6). `Architecture = {Elements, Forms, Rationale/Constraints}`；场景视图；场景驱动迭代。
- Brooks, F. *The Mythical Man-Month*, ch. 4–5：概念完整性；"architecture tells what happens, implementation tells how it is made to happen"。
- Booch, G. (2006). "On Architecture." *IEEE Software*：架构是重要决定的集合，必须保持可见。

## 阶段 1 问题域

- Jackson, M. (1995/2001). *Software Requirements & Specifications*; *Problem Frames*. 域、机器、共享现象；`机器规格 + 域性质 ⇒ 需求`。MIT 讲义 "Problem Analysis and Problem Structures"。

## 阶段 2 驱动

- Barbacci et al. (2003). *Quality Attribute Workshops (QAWs), Third Edition*. CMU/SEI-2003-TR-016. 六要素场景（source / stimulus / artifact / environment / response / response measure）。
- Wojcik et al. (2006). *Attribute-Driven Design (ADD), Version 2.0*. CMU/SEI-2006-TR-023. 架构驱动 = 功能需求 + 约束 + 质量属性；输入必须已优先级化。
- Kazman, Klein, Clements (2000). *ATAM: Method for Architecture Evaluation*. CMU/SEI-2000-TR-004. Utility tree 的两维优先级；"vague claims are not operationally refutable"。

## 阶段 3 模型

- Parnas, D. L. (1972). "On the Criteria To Be Used in Decomposing Systems into Modules." *CACM* 15(12). 按"难的或会变的决定"分解；每个模块隐藏一个决定。
- Evans, E. (2015). *Domain-Driven Design Reference*. Part IV Context Mapping：有界上下文、上下文图、翻译与共享。
- Brooks，同上，概念完整性。

## 阶段 4 结构

- Parnas, D. L., Clements, P. C. (1986). "A Rational Design Process: How and Why to Fake It." *IEEE TSE* SE-12(2). 模块指南（树状）、接口规格（含 undesired events）、uses hierarchy、模块设计文档与验证论证。
- Parnas, Clements, Weiss (1985). "The Modular Structure of Complex Systems." A-7E 模块指南实例。
- ADD 2.0，§3.2 输出：roles / responsibilities / properties / relationships；p. 25 接口不只是签名。
- Brown, S. *C4 Model*：context / container / component / code 四层，只画有价值的层。
- Kruchten 4+1：逻辑 / 进程 / 开发 / 物理 + 场景。

## 阶段 5 走查

- Kruchten 4+1，"A scenario-driven approach"：挑关键场景、strawman 架构、脚本走查、原型、下一轮。
- Cockburn, A. *Writing Effective Use Cases*；Jacobson et al. *Use-Case 2.0*：主流程 + 扩展（失败路径）；用例切片连到测试。
- Lamport, L. (2015). "Who Builds a Skyscraper without Drawing Blueprints?"；Newcombe et al. (2015). "How Amazon Web Services Uses Formal Methods." *CACM* 58(4)：先规格后实现，模型检查找交错与失败。
- Jackson, D. *Software Abstractions* (Alloy)：模拟 vs 检查，反例。

## 阶段 6 评估

- ATAM，§7：risks / non-risks / sensitivity points / tradeoff points；输出是风险清单不是"通过"。
- Ubl, M. "Design Docs at Google." industrialempathy.com：`Alternatives considered` 的地位；"an implementation manual with no trade-offs or alternatives is a sign that a design doc may not be worthwhile"；原型与微基准。
- Rust RFC 模板：`Rationale and alternatives` / `Drawbacks` / `Prior art` / `Unresolved questions`。
- Kubernetes KEP 模板：`Non-Goals` / `Drawbacks` / `Alternatives` / Production Readiness Review。
- Keeling, M. *Design It!*：设计活动中的选项比较与风险暴露。

## 阶段 7 维护

- Parnas & Clements §VI–VII：文档按问题组织、每个事实一处、失效即更新。

## 行业模板（文档形态）

- Google：Ubl 结构（Context and scope / Goals and non-goals / The actual design / Alternatives considered / Cross-cutting concerns）；*Software Engineering at Google* ch. 10；Ziftci & Greenberg "Improving Design Reviews at Google"（approver 与 action item）。
- Amazon：PR/FAQ 与 6-pager 叙事，静读后逐行讨论。
- Lyft tech spec（Summary / Background / Goals / Non-Goals / Measuring Impact）；Oxide RFD；Python PEP 1；Chromium design doc template。
