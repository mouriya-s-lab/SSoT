module wiring {
  import contract.* from "../.gen/contract"
  import shop_worker as Api from "../.gen/contract"

  var left: int
  var right: int
  var observer: int
  var payload: Api::Input
  var store: Api::Store
  var last: Call

  val via = right
  def from(v: int): int = v + via
  pure def bump(right: int): int = right + 1

  action init = all {
    left' = 0, right' = 0, observer' = 0, payload' = 0,
    store' = Api::initial, last' = NoCall,
  }
  action move = all {
    left' = from(left), right' = right, observer' = observer, payload' = payload,
    store' = store, last' = shop_worker(Api::increment({ n: 1, result: 1 })),
  }
  action hold = all { observer' = observer, payload' = payload, store' = store }
  action local = all {
    left' = bump(3), right' = right, hold, last' = NoCall,
  }
  action sync = all {
    left' = right, right' = left, observer' = observer, payload' = payload,
    store' = store, last' = NoCall,
  }
  action idle = all {
    left' = left, right' = right, observer' = observer, payload' = payload,
    store' = store, last' = NoCall,
  }
  action step = any { move, local, sync, idle }
}
