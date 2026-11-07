// 由 ssot gen 从 contract/*.vdmsl 生成；只读，不要手改。
module Vdm {
  type Opt[a] = | Nil | Some(a)
}
module checkout_ledger {
  type ItemId = str
  type OrderId = str
  type Outcome = | Outcome_Cancelled | Outcome_Fulfilled
  type Trigger = str
  type Records = { orders: Set[OrderId], items: ItemId -> OrderId, outcomes: ItemId -> Outcome, cancels: OrderId -> Trigger }
  pure val initial: Records = { orders: Set(), items: Map(), outcomes: Map(), cancels: Map() }
  type Call =
    | writeOrder({ o: OrderId })
    | writeItem({ o: OrderId, result: ItemId })
    | writeOutcome({ it: ItemId, out: Outcome })
    | writeCancel({ o: OrderId, t: Trigger })
}
module checkout_inventory {
  import checkout_ledger as checkout_ledger
  type HoldId = str
  type Rejected = | Rejected_Rejected
  type Reservations = { released: Set[checkout_ledger::ItemId], held: HoldId -> checkout_ledger::ItemId }
  pure val initial: Reservations = { released: Set(), held: Map() }
  type Reserve_Result = | Reserve_Result_HoldId(HoldId) | Reserve_Result_Rejected(Rejected)
  type Call =
    | reserve({ it: checkout_ledger::ItemId, h: HoldId, result: Reserve_Result })
    | commitHold({ it: checkout_ledger::ItemId, h: HoldId })
    | release({ it: checkout_ledger::ItemId })
}
module contract {
  import checkout_inventory as checkout_inventory
  import checkout_ledger as checkout_ledger
  type Call =
    | NoCall
    | checkout_inventory(checkout_inventory::Call)
    | checkout_ledger(checkout_ledger::Call)
}
