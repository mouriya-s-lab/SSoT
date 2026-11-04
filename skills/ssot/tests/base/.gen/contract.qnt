// 由 ssot gen 从 contract/*.vdmsl 生成；只读，不要手改。
module Vdm {
  type Opt[a] = | Nil | Some(a)
}
module shop_ledger {
  type OrderId = str
  type Closed = | Closed_Closed
  type Ledger = { entries: OrderId -> int, closed: Set[OrderId] }
  pure val initial: Ledger = { entries: Map(), closed: Set() }
  type Call =
    | record({ o: OrderId, amount: int })
    | close({ o: OrderId, result: Closed })
}
module shop_api {
  import shop_ledger as shop_ledger
  type Reply = | Reply_Accepted | Reply_Rejected
  type Call =
    | place({ o: shop_ledger::OrderId, amount: int, result: Reply })
}
module contract {
  import shop_api as shop_api
  import shop_ledger as shop_ledger
  type Call =
    | NoCall
    | shop_api(shop_api::Call)
    | shop_ledger(shop_ledger::Call)
}
