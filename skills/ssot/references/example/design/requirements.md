# checkout 需求

- REQ-1 买家提交的订单经 `API` 入口校验后，由 `Pricing` 计算商品金额、优惠与税费，再在 `Ledger` 中以 `writeOrder` 登记唯一 `OrderId`；未完成登记前，`OrderId` 不出现在查询结果中。
- REQ-2 买家直接从 `Ledger` 查询订单、订单项及其结算结局，读取路径不触发任何库存变更或支付调用。
- REQ-3 支付扣款统一经外部 `Payment Gateway` 发起，核心内网不保存买家的支付卡密凭据。
- REQ-4 订单项成交或整单取消完成后，由 `Notifier` 汇总结果并生成买家通知；通知失败不回滚已写下的 `Ledger` 事实。
- REQ-5 `Inventory` 是订单项库存预占与扣减的唯一契约边界：接纳 `reserve` 锁库请求、执行 `commitHold` 扣减，并在 `release` 时关闭该订单项的锁库窗口并清空未扣减的锁库。
- REQ-6 订单项的释放（`release`）与锁库（`reserve`）互斥：一旦 `release(it)` 记下该订单项已释放，`Inventory` 拒绝该 `ItemId` 后续到达的一切 `reserve`（包括已崩溃退出的旧 `Order Service` 进程发出的在途 `reserve`）；`release(it)` 返回即该 `ItemId` 下未扣减的锁库全部清空，再次调用 `release` 照样成功。
- REQ-7 `commitHold(it, h)` 确认扣减该订单项已锁定的库存 `h`，同时将该 `ItemId` 记入已关闭锁库窗口，防止重复锁库。
- REQ-8 `writeOutcome(it, out)` 为订单项写下不可变的最终结算结局（`Fulfilled` 或 `Cancelled`），每个 `ItemId` 至多成功写下一次。
- REQ-9 订单进入取消过程后不再为该订单登记新的订单项；`writeItem` 返回的 `ItemId` 进入履约过程的第一条输入线。
- REQ-10 结束任一订单项时，先在 `Inventory` 中完成扣减或释放以关闭其锁库窗口，最后写下它在 `Ledger` 中的结算结局：自然履约在 `commitHold` 确认扣减之后写 `Fulfilled`；取消过程不等待在途锁库自行完成，直接调用 `release` 关闭锁库窗口并清空锁库后再写 `Cancelled`。结算结局写下时，该订单项在 `Inventory` 中不得残留任何未释放的锁库，且其锁库窗口必须已关闭。
- REQ-11 整单取消锚点 `writeCancel(order, trigger)` 只在属于该订单的全部已登记订单项都已写下结算结局之后写下，且每个订单至多写下一次。
- REQ-12 `Order Service` 崩溃重启后不恢复半途的内存状态：下一次启动时，对每个尚未写下 `writeCancel` 锚点的订单，若存在尚未写下结局且无进程内履约步骤持有的订单项，或已存在记为 `Cancelled` 的订单项，以 `ServiceLost` 启动取消过程收束到底。
