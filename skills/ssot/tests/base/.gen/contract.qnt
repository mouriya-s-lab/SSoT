// 由 ssot gen 从 contract/*.vdmsl 生成；只读，不要手改。
module Vdm {
  type Opt[a] = | Nil | Some(a)
}
module shop {
  type OrderId = str
}
module shop_api {
  import shop as shop
  type Reply = | Reply_Accepted | Reply_Rejected
  type Call =
    | place({ o: shop::OrderId, amount: int, result: Reply })
}
module shop_ledger {
  import shop as shop
  type Closed = | Closed_Closed
  type Ledger = { entries: shop::OrderId -> int, closed: Set[shop::OrderId] }
  pure val initial: Ledger = { entries: Map(), closed: Set() }
  type Call =
    | record({ o: shop::OrderId, amount: int })
    | close({ o: shop::OrderId, result: Closed })
}
module contract {
  import shop_api as shop_api
  import shop_ledger as shop_ledger
  type Call =
    | NoCall
    | shop_api(shop_api::Call)
    | shop_ledger(shop_ledger::Call)
}
