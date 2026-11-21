# checkout 示例

`design/` 是一个处在演进中途的订单交易系统（`checkout`）设计，用来演示 `ssot` 的三层按需建模，不是写满的模板。

**热点溯源（高频改动文件 → commit → issue）。** 容器划分已经稳定；`ssot hotspots` 对代码历史的分析显示，改动次数与修复提交高度集中在履约（`Fulfillment`）、取消（`Cancellation`）与仓储库存边界（`Inventory`）的协同改动对上，反推到关键修复 commit 与关联 issue 共指向三类反复出现的边界故障：

1. `Order Service` 进程崩溃重启：崩溃前发出的 `reserve` 锁库请求，在进程重启之后才被 `Inventory` 回复。
2. 并发取消与崩溃恢复中，同一个订单项的结算结局被写下两次，或尚有订单项未释放库存时整单取消锚点就已写下。
3. 部署在合作方网络的 `Inventory` 在订单项调用 `release` 释放库存之后，仍接纳旧进程晚到的在途 `reserve`，造成已取消订单永久残留死锁库存。

其余模块在 git 历史中仅为常规功能演进，无反复修补的问题热点。

**结构。** 上下文图（`index`）与容器图（`checkoutView`）是默认的导航图。`Order Service` 画了组件图（`serviceView`），因为上述热点都落在 `Order Service` 内部：读图的人需要看清履约（`Fulfillment`）与取消（`Cancellation`）是 `Order Service` 里的哪两块、各自连接哪些容器（`structure/checkout.c4`）。五个组件按职责分成 `Request entry`（`API`、`Pricing`）与 `Order lifecycle`（`Fulfillment`、`Cancellation`）两组，`Notifier` 独立：分组写在元素的 `metadata group` 上，三张逻辑图按这一处声明画出同一组。

**往下写的位置只有两个盒子和一张接线图**，深入三问的回答与支撑精度的热点溯源如下：

| 位置 | 具体的担心 | C4 与编译检查能否定位 | 模型会揭露的错误 | 支撑精度的热点溯源 |
|---|---|---|---|---|
| 取消收束接线 `behavior/cancellation.qnt` | 取消或进程崩溃之后，订单项的结局在库存尚未释放时就被写下；已退出的旧进程发出的在途 `reserve` 在订单项释放之后仍被接纳 | 不能：它取决于进程崩溃、取消接管与晚到网络回复之间的交错 | 仓储边界在 `release` 之后仍接纳 `reserve`，或取消过程不调 `release` 就直接写 `Cancelled`，都会让 `safety` 失败；崩溃落在写完订单项 `Cancelled`、写整单取消锚点之前时，覆盖目标 `witnessCrashBeforeAnchor` 走到它，重启后由 `serviceLost` 接管 | 1、2 |
| 账本事实源头盒子 `contract/checkout.ledger.vdmsl` | 同一个订单项的结算结局写下两次；整单取消锚点早于订单项结局写下 | 不能：写入方有履约过程与取消过程两处 | 接线里履约过程与取消过程争写同一订单项结局，或在尚有未决订单项时写下整单取消锚点，回放按 `writeOutcome`、`writeCancel` 的 `pre` 报错 | 2 |
| 仓储库存边界盒子 `contract/checkout.inventory.vdmsl` | 库存释放（`release`）与在途锁库（`reserve`）的互斥 | 不能：互斥发生在仓储边界内部 | 仓储边界在 `release` 之后仍接纳 `reserve`（接线里它的回复给出 `HoldId`）时，取消收束接线的 `safety` 失败，回放按本盒子的 `inv` 报错 | 3 |

两个盒子的精度严格停在这些性质：商品明细、金额、支付卡密、库位与内部失败分支保持不透明（`token`）；`commitHold` 只写接线所需的最小前后关系。

**其余位置保持不可见。** `API`、`Pricing`、`Notifier` 与外部 `Payment Gateway` 没有 `#contract`，也不出现在接线图里：它们属于标准范式，在提交历史中无反复修补的问题热点。`Fulfillment` 与 `Cancellation` 只作为接线图里的顺接步骤与取消收束过程出现，不单独立 VDM 盒子：它们的隐患在跨边界交错上，不在自身某一个端口的数据契约上。`requirements.md` 中的 `REQ-1` 至 `REQ-4` 没有附着到 VDM 或 Quint，它们由 C4 结构回答或留给代码实现。

**渲染。** `ssot render design` 导出 4 张 C4 视图（`index` → `checkoutView` → `serviceView` → `deployed`）、1 张契约分层图（`layers`，两个契约模块 `checkout_ledger` 与 `checkout_inventory` 的 import 关系）、两个契约模块各 1 张 VDM 盒子图、承诺图、类型图与读写表（`box:`、`promises:`、`types:`、`access:` 后接 `checkout_inventory` 或 `checkout_ledger`）与 1 张接线索引（`wirings`）及它下面的 Quint 组合图（`composition:cancellation`）和性质图（`properties:cancellation`）。
