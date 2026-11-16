// 担心：左右两条线交换之后失去同步（REQ-1），
// 或者移动时工人计数没有前进。
// 盒子：契约盒子 shop_worker；行为一侧：左右两条线。
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

  // ---------- 性质 ----------
  // REQ-2：右线不为负。
  val rightNonNegative = right >= 0
  // REQ-1：左线不为负。
  val leftNonNegative = left >= 0
  val safety = leftNonNegative and rightNonNegative
  val witnessMoved = left > 0
  // REQ-1：两条线交换过，
  // 且左线已经前进。
  val witnessSwapped = left > 0 and
    right > 0
  pure val maxSteps_witnessSwapped = 12
}
