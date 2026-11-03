// 下单、记账、关账的次序（方案 a：账本状态用生成的 shop_ledger::Ledger）。
module flow {
  import contract.* from "../.gen/contract"
  import shop_ledger as L from "../.gen/contract"
  import shop_api as A from "../.gen/contract"

  pure val ORDERS = Set("o1", "o2")

  var lastCall: Call
  var ledger: L::Ledger
  var placed: Set[str]

  action init = all {
    lastCall' = NoCall,
    ledger' = L::initial,
    placed' = Set(),
  }

  action doPlace(o: str, amt: int): bool = all {
    not(o.in(placed)),
    lastCall' = shop_api(A::place({ o: o, amount: amt, result: A::Reply_Accepted })),
    ledger' = ledger,
    placed' = placed.union(Set(o)),
  }

  action doRecord(o: str, amt: int): bool = all {
    o.in(placed),
    not(o.in(ledger.entries.keys())),
    lastCall' = shop_ledger(L::record({ o: o, amount: amt })),
    ledger' = { ...ledger, entries: ledger.entries.put(o, amt) },
    placed' = placed,
  }

  action doClose(o: str): bool = all {
    o.in(ledger.entries.keys()),
    not(o.in(ledger.closed)),
    lastCall' = shop_ledger(L::close({ o: o, result: L::Closed_Closed })),
    ledger' = { ...ledger, closed: ledger.closed.union(Set(o)) },
    placed' = placed,
  }

  action step = {
    nondet o = ORDERS.oneOf()
    nondet amt = 1.to(3).oneOf()
    any { doPlace(o, amt), doRecord(o, amt), doClose(o) }
  }

  val safety = ledger.closed.subseteq(ledger.entries.keys())

  // 覆盖目标：两张订单都关账。
  val witnessBothClosed = ledger.closed.size() == 2
}
