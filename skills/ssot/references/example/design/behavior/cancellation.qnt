// 担心：取消订单或 Order Service 崩溃重启之后，某个订单项的结局在它的库存尚未释放时就被写下（REQ-9），
// 或者已退出的旧进程发出的在途 reserve 在订单项释放之后才到达仓储边界、却仍被接纳锁库（REQ-6）。
// 盒子：买家 buyer、取消收束过程 cancelling、进程崩溃环境 epoch，契约盒子 checkout_ledger、checkout_inventory；
// 履约过程是一串顺接的步骤（startItem → sendReserve → answerReserve → fulfillCommit → fulfillSettle），
// 每一步从输入线取值、调用端口、把凭据放到下一步的输入线上。每个 var 是一条带延迟的线；先后只来自线上的值，不记“走到哪一步”。
module cancellation {
  import contract.* from "../.gen/contract"
  import Vdm.* from "../.gen/contract"
  import checkout_ledger as Ledger from "../.gen/contract"
  import checkout_inventory as Inv from "../.gen/contract"

  pure val ORDERS = Set("o1", "o2")
  pure val ITEM_IDS = Set("i1", "i2", "i3")
  pure val HOLD_IDS = Set("h1", "h2", "h3")

  // 买家只认得自己创建的 OrderId。
  type Buyer = { orders: Set[Ledger::OrderId], cancels: Set[Ledger::OrderId] }

  var ledger: Ledger::Records
  var inv: Inv::Reservations
  var buyer: Buyer
  var cancelling: Ledger::OrderId -> Ledger::Trigger
  // Order Service 的第几次运行；崩溃重启让它加一。
  var epoch: int
  // 在途的 reserve 锁库请求：带上发出它的进程代次，跨崩溃保留。
  var inflight: Set[(Ledger::ItemId, Inv::HoldId, int)]
  // 履约过程各步之间的传递线（Order Service 进程内，崩溃时清空）。
  var toReserve: Set[Ledger::ItemId]
  var awaiting: Set[(Ledger::ItemId, Inv::HoldId)]
  var toCommit: Set[(Ledger::ItemId, Inv::HoldId)]
  var toSettle: Set[Ledger::ItemId]
  var lastCall: Call

  pure def without(m: str -> a, k: str): str -> a = m.keys().exclude(Set(k)).mapBy(j => m.get(j))
  pure def dropPair(s: Set[(str, str)], it: str): Set[(str, str)] = s.filter(p => p._1 != it)

  def orderOf(it: Ledger::ItemId): Ledger::OrderId = ledger.items.get(it)
  def settled(it: Ledger::ItemId): bool = it.in(ledger.outcomes.keys())
  def isCancelling(o: Ledger::OrderId): bool = o.in(cancelling.keys())
  def active(it: Ledger::ItemId): bool = not(isCancelling(orderOf(it)))
  // 该订单项在当前 Order Service 进程内仍有履约步骤持有它的凭据。
  def heldInProcess(it: Ledger::ItemId): bool =
    it.in(toReserve.union(toSettle)) or
    awaiting.exists(p => p._1 == it) or toCommit.exists(p => p._1 == it)
  def busyHolds: Set[Inv::HoldId] = inv.held.keys().union(inflight.map(p => p._2))

  // ---------- 契约盒子的反馈线按 VDM post 前进 ----------
  pure def ledgerAfter(s: Ledger::Records, call: Call): Ledger::Records = match call {
    | checkout_ledger(op) => match op {
        | writeOrder(a) => { ...s, orders: s.orders.union(Set(a.o)) }
        | writeItem(a) => { ...s, items: s.items.put(a.result, a.o) }
        | writeOutcome(a) => { ...s, outcomes: s.outcomes.put(a.it, a.out) }
        | writeCancel(a) => { ...s, cancels: s.cancels.put(a.o, a.t) }
      }
    | _ => s
  }

  pure def inventoryAfter(s: Inv::Reservations, call: Call): Inv::Reservations = match call {
    | checkout_inventory(op) => match op {
        | reserve(a) => match a.result {
            | Reserve_Result_HoldId(h) => { ...s, held: s.held.put(h, a.it) }
            | Reserve_Result_Rejected(_) => s
          }
        | commitHold(a) => { ...s, released: s.released.union(Set(a.it)),
            held: s.held.keys().filter(h => s.held.get(h) != a.it).mapBy(h => s.held.get(h)) }
        | release(a) => { ...s, released: s.released.union(Set(a.it)),
            held: s.held.keys().filter(h => s.held.get(h) != a.it).mapBy(h => s.held.get(h)) }
      }
    | _ => s
  }

  action commit(call: Call): bool = all {
    lastCall' = call,
    ledger' = ledgerAfter(ledger, call),
    inv' = inventoryAfter(inv, call),
  }

  action processWiresUnchanged = all {
    toReserve' = toReserve, awaiting' = awaiting, toCommit' = toCommit, toSettle' = toSettle,
  }

  action init = all {
    ledger' = Ledger::initial,
    inv' = Inv::initial,
    buyer' = { orders: Set(), cancels: Set() },
    cancelling' = Map(),
    epoch' = 0,
    inflight' = Set(),
    toReserve' = Set(), awaiting' = Set(), toCommit' = Set(), toSettle' = Set(),
    lastCall' = NoCall,
  }

  // ---------- 买家 ----------
  action placeOrder(o: Ledger::OrderId): bool = all {
    not(o.in(ledger.orders)),
    buyer' = { ...buyer, orders: buyer.orders.union(Set(o)) },
    cancelling' = cancelling, epoch' = epoch, inflight' = inflight, processWiresUnchanged,
    commit(checkout_ledger(Ledger::writeOrder({ o: o }))),
  }

  action requestCancel(o: Ledger::OrderId): bool = all {
    o.in(buyer.orders),
    not(o.in(buyer.cancels)),
    buyer' = { ...buyer, cancels: buyer.cancels.union(Set(o)) },
    cancelling' = cancelling, epoch' = epoch, inflight' = inflight, processWiresUnchanged,
    commit(NoCall),
  }

  // ---------- 履约过程：顺接的四步 ----------
  // REQ-9：取消开始后不再为该订单登记新订单项；writeItem 返回的 ItemId 进入履约过程的第一条线。
  action startItem(o: Ledger::OrderId, it: Ledger::ItemId): bool = all {
    o.in(ledger.orders),
    not(o.in(ledger.cancels.keys())),
    not(isCancelling(o)),
    not(it.in(ledger.items.keys())),
    toReserve' = toReserve.union(Set(it)),
    awaiting' = awaiting, toCommit' = toCommit, toSettle' = toSettle,
    buyer' = buyer, cancelling' = cancelling, epoch' = epoch, inflight' = inflight,
    commit(checkout_ledger(Ledger::writeItem({ o: o, result: it }))),
  }

  // 发出锁库请求：进入在途网络线，带上发出它的进程代次 epoch。
  action sendReserve(it: Ledger::ItemId, h: Inv::HoldId): bool = all {
    it.in(toReserve),
    active(it),
    not(h.in(busyHolds)),
    toReserve' = toReserve.exclude(Set(it)),
    awaiting' = awaiting.union(Set((it, h))),
    inflight' = inflight.union(Set((it, h, epoch))),
    toCommit' = toCommit, toSettle' = toSettle,
    buyer' = buyer, cancelling' = cancelling, epoch' = epoch,
    commit(NoCall),
  }

  // REQ-7：确认扣减已锁定的库存并关闭该订单项的锁库窗口。
  action fulfillCommit(it: Ledger::ItemId, h: Inv::HoldId): bool = all {
    (it, h).in(toCommit),
    active(it),
    toCommit' = toCommit.exclude(Set((it, h))),
    toSettle' = toSettle.union(Set(it)),
    toReserve' = toReserve, awaiting' = awaiting,
    buyer' = buyer, cancelling' = cancelling, epoch' = epoch, inflight' = inflight,
    commit(checkout_inventory(Inv::commitHold({ it: it, h: h }))),
  }

  // REQ-10：订单项的成交结局在库存扣减并关闭锁库窗口之后写下。
  action fulfillSettle(it: Ledger::ItemId): bool = all {
    it.in(toSettle),
    active(it),
    toSettle' = toSettle.exclude(Set(it)),
    toReserve' = toReserve, awaiting' = awaiting, toCommit' = toCommit,
    buyer' = buyer, cancelling' = cancelling, epoch' = epoch, inflight' = inflight,
    commit(checkout_ledger(Ledger::writeOutcome({ it: it, out: Ledger::Outcome_Fulfilled }))),
  }

  // ---------- 在途 reserve：仓储边界随时给出回复；发出它的进程可能已经崩溃退出 ----------
  // REQ-6：订单项已记入 released 时回复 Rejected；未释放时仓储也可因缺货拒绝，缺货触发整单取消收束。
  action answerReserve(it: Ledger::ItemId, h: Inv::HoldId, e: int, accept: bool): bool = all {
    (it, h, e).in(inflight),
    val res = if (it.in(inv.released) or not(accept)) Inv::Reserve_Result_Rejected(Inv::Rejected_Rejected)
              else Inv::Reserve_Result_HoldId(h)
    val waiting = e == epoch and (it, h).in(awaiting)
    val o = orderOf(it)
    all {
      inflight' = inflight.exclude(Set((it, h, e))),
      awaiting' = if (waiting) awaiting.exclude(Set((it, h))) else awaiting,
      toCommit' = if (waiting and res == Inv::Reserve_Result_HoldId(h)) toCommit.union(Set((it, h))) else toCommit,
      cancelling' = if (waiting and res != Inv::Reserve_Result_HoldId(h) and not(isCancelling(o)) and not(o.in(ledger.cancels.keys())))
                      cancelling.put(o, "OutOfStock")
                    else cancelling,
      toReserve' = toReserve, toSettle' = toSettle,
      buyer' = buyer, epoch' = epoch,
      commit(checkout_inventory(Inv::reserve({ it: it, h: h, result: res }))),
    }
  }

  // ---------- 取消与崩溃恢复收束过程 ----------
  action beginCancel(o: Ledger::OrderId): bool = all {
    o.in(buyer.cancels),
    not(isCancelling(o)),
    not(o.in(ledger.cancels.keys())),
    cancelling' = cancelling.put(o, "BuyerCancel"),
    buyer' = { ...buyer, cancels: buyer.cancels.exclude(Set(o)) },
    epoch' = epoch, inflight' = inflight, processWiresUnchanged,
    commit(NoCall),
  }

  // REQ-12：崩溃重启之后，尚未写下取消锚点的订单若有无人推进的未决订单项，或已有 Cancelled 结局，由 ServiceLost 收束。
  action serviceLost(o: Ledger::OrderId): bool = all {
    o.in(ledger.orders),
    not(isCancelling(o)),
    not(o.in(ledger.cancels.keys())),
    ledger.items.keys().exists(it => orderOf(it) == o and (
      (not(settled(it)) and not(heldInProcess(it))) or
      (settled(it) and ledger.outcomes.get(it) == Ledger::Outcome_Cancelled))),
    cancelling' = cancelling.put(o, "ServiceLost"),
    buyer' = buyer, epoch' = epoch, inflight' = inflight, processWiresUnchanged,
    commit(NoCall),
  }

  action dropFromProcess(it: Ledger::ItemId): bool = all {
    toReserve' = toReserve.exclude(Set(it)),
    awaiting' = dropPair(awaiting, it),
    toCommit' = dropPair(toCommit, it),
    toSettle' = toSettle.exclude(Set(it)),
  }

  // REQ-10：取消过程先调用 release 关闭该订单项的锁库窗口并释放库存；进程内履约步骤随之撤下。
  action cancelRelease(it: Ledger::ItemId): bool = all {
    it.in(ledger.items.keys()),
    isCancelling(orderOf(it)),
    not(settled(it)),
    not(it.in(inv.released)),
    dropFromProcess(it),
    buyer' = buyer, cancelling' = cancelling, epoch' = epoch, inflight' = inflight,
    commit(checkout_inventory(Inv::release({ it: it }))),
  }

  action cancelSettle(it: Ledger::ItemId): bool = all {
    it.in(ledger.items.keys()),
    isCancelling(orderOf(it)),
    not(settled(it)),
    it.in(inv.released),
    dropFromProcess(it),
    buyer' = buyer, cancelling' = cancelling, epoch' = epoch, inflight' = inflight,
    commit(checkout_ledger(Ledger::writeOutcome({ it: it, out: Ledger::Outcome_Cancelled }))),
  }

  // REQ-11：该订单的全部订单项都已写下结局之后，写下整单取消锚点。
  action cancelAnchor(o: Ledger::OrderId): bool = all {
    isCancelling(o),
    ledger.items.keys().forall(it => orderOf(it) == o implies settled(it)),
    cancelling' = without(cancelling, o),
    buyer' = buyer, epoch' = epoch, inflight' = inflight, processWiresUnchanged,
    commit(checkout_ledger(Ledger::writeCancel({ o: o, t: cancelling.get(o) }))),
  }

  // ---------- 崩溃环境：Order Service 进程退出并重启。进程内传递线与取消过程消失；账本、仓储与在途请求保留 ----------
  action crash = all {
    epoch' = epoch + 1,
    cancelling' = Map(),
    toReserve' = Set(), awaiting' = Set(), toCommit' = Set(), toSettle' = Set(),
    buyer' = buyer, inflight' = inflight,
    commit(NoCall),
  }

  action step = {
    nondet o = ORDERS.oneOf()
    nondet it = ITEM_IDS.oneOf()
    nondet h = HOLD_IDS.oneOf()
    nondet accept = Set(true, false).oneOf()
    nondet req = inflight.union(Set(("", "", -1))).oneOf()
    nondet roll = 1.to(8).oneOf()
    any {
      placeOrder(o), startItem(o, it),
      sendReserve(it, h), fulfillCommit(it, h), fulfillSettle(it),
      answerReserve(req._1, req._2, req._3, accept),
      beginCancel(o), serviceLost(o), cancelRelease(it), cancelSettle(it), cancelAnchor(o),
      all { roll == 1, requestCancel(o) },
      all { roll == 2, epoch < 2, crash },
    }
  }

  // ---------- 性质：写在对外可观察的线上 ----------
  // REQ-10：一个订单项写下结算结局时，仓储里没有属于它的未释放锁库。
  val noHoldAfterOutcome = inv.held.keys().forall(h => not(settled(inv.held.get(h))))
  // REQ-10：任何已写下结算结局的订单项，它在仓储中的锁库窗口都已关闭（防止晚到的在途 reserve 死锁库存）。
  val outcomeAfterRelease = ledger.outcomes.keys().forall(it => it.in(inv.released))
  val safety = noHoldAfterOutcome and outcomeAfterRelease

  // ---------- 覆盖目标：证明模型确实走到了关键交错 ----------
  val witnessFulfilled = ledger.outcomes.keys().exists(it => ledger.outcomes.get(it) == Ledger::Outcome_Fulfilled)
  val witnessBuyerCancel = ledger.cancels.keys().exists(o => ledger.cancels.get(o) == "BuyerCancel")
  val witnessServiceLostCancel = ledger.cancels.keys().exists(o => ledger.cancels.get(o) == "ServiceLost")
  pure val maxSteps_witnessServiceLostCancel = 40
  // REQ-6：已退出的旧进程发出的 reserve 仍在途，而该订单项的锁库窗口已经释放。
  val witnessLateReserveAfterRelease = inflight.exists(p => p._3 < epoch and p._1.in(inv.released))
  pure val maxSteps_witnessLateReserveAfterRelease = 40
  // REQ-12：取消过程已为每个订单项写下 Cancelled、尚未写整单取消锚点时进程崩溃。
  val witnessCrashBeforeAnchor = ORDERS.exists(o => o.in(ledger.orders) and not(o.in(ledger.cancels.keys())) and not(isCancelling(o)) and
    ledger.items.keys().exists(it => orderOf(it) == o and settled(it) and ledger.outcomes.get(it) == Ledger::Outcome_Cancelled) and
    ledger.items.keys().forall(it => orderOf(it) == o implies settled(it)))
  pure val maxSteps_witnessCrashBeforeAnchor = 40
}
