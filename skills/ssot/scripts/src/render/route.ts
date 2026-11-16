// 正交连线路由：节点位置由 ELK 定，连线在这里重新走。ELK 跨层级（INCLUDE_CHILDREN）的连线在每道框边上
// 断成几段再拼起来，留下小错位、沿框边走的线和绕圈；这里在整张图的网格上一次找完整条线，代价里同时算
// 长度、拐弯、穿框次数、与已走好的线交叉或重叠，线自然取最直、最少穿越的走法。
export type Point = { readonly x: number; readonly y: number };
export type Rect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

/** 节点框线不能穿过；边界与分组框线可以穿进穿出，但每穿一次都有代价，也不贴着框边走。两种框都可以是线的端点。 */
export type RouteBox = { readonly kind: "node"; readonly rect: Rect } | { readonly kind: "frame"; readonly rect: Rect };

export interface RouteRequest {
  readonly boxes: readonly RouteBox[];
  /** 框标题的底：线从标题后面过会被盖住，尽量绕开。 */
  readonly headers: readonly Rect[];
  /** 每条线连接 boxes 里的两个下标。 */
  readonly edges: readonly { readonly source: number; readonly target: number }[];
}

const STEP = 8;
/** 线与节点框之间至少留的空。 */
const CLEARANCE = 12;
/** 线离开或进入节点时先垂直走的长度：箭头总是正对着框边。 */
const STUB = 20;
/** 同一条框边上两个线头之间的最小距离。 */
const PORT_GAP = 32;
/** 线头离框角的最小距离。 */
const PORT_INSET = 24;
/** 两次拐弯之间短于这个长度的一段是错位，平移拉直。 */
const MIN_JOG = 24;
const BEND = 40, FRAME_CROSS = 300, EDGE_CROSS = 160, SHARED = 60, NEAR = 3, HUG = 3, HEADER = 30, OFF_CENTER = 0.3, PORT_CLASH = 1000;
/** 离框边这么近的平行线段算贴着框边走；要小于框的内边距减去 CLEARANCE，框与节点之间才留得出不算贴边的通道。 */
const HUG_DISTANCE = 14;

/** 方向：0 上 1 右 2 下 3 左。 */
type Dir = 0 | 1 | 2 | 3;
const DX = [0, 1, 0, -1] as const, DY = [-1, 0, 1, 0] as const;
/** 一条线连在节点哪条边上：出发的方向，即离开框边的方向。 */
type Side = Dir;

function sorted(values: readonly number[]): number[] {
  const out = [...new Set(values.map((v) => Math.round(v * 2) / 2))].sort((a, b) => a - b);
  return out;
}

class Heap {
  private keys: number[] = [];
  private values: number[] = [];
  get size(): number { return this.keys.length; }
  push(key: number, value: number): void {
    const keys = this.keys, values = this.values;
    let i = keys.length;
    keys.push(key); values.push(value);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent]! <= key) break;
      keys[i] = keys[parent]!; values[i] = values[parent]!;
      i = parent;
    }
    keys[i] = key; values[i] = value;
  }
  pop(): number {
    const keys = this.keys, values = this.values, top = values[0]!;
    const lastKey = keys.pop()!, lastValue = values.pop()!;
    if (keys.length > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        if (l >= keys.length) break;
        const c = r < keys.length && keys[r]! < keys[l]! ? r : l;
        if (keys[c]! >= lastKey) break;
        keys[i] = keys[c]!; values[i] = values[c]!;
        i = c;
      }
      keys[i] = lastKey; values[i] = lastValue;
    }
    return top;
  }
}

/** 线头在节点框边上的一段可用范围，以及从框边伸出 STUB 后落在网格上的那条线。 */
interface Terminal { readonly node: number; readonly side: Side; readonly lo: number; readonly hi: number; readonly center: number; readonly line: number; readonly face: number }

/** 一组走好的线的代价，与路由用的代价同一把尺：长度、拐弯、线与线交叉、线与线重叠。用来在几种布局里挑一种。 */
export function routeCost(routes: readonly (readonly Point[])[]): number {
  type Seg = { readonly route: number; readonly a: Point; readonly b: Point };
  const segs: Seg[] = routes.flatMap((points, route) => points.slice(1).map((b, k): Seg => ({ route, a: points[k]!, b })));
  let cost = 0;
  for (const points of routes) cost += Math.max(0, points.length - 2) * BEND;
  for (const { a, b } of segs) cost += Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const vertical = (s: Seg): boolean => s.a.x === s.b.x;
  for (let m = 0; m < segs.length; m++) {
    for (let n = m + 1; n < segs.length; n++) {
      const p = segs[m]!, q = segs[n]!;
      if (p.route === q.route) continue;
      if (vertical(p) !== vertical(q)) {
        const v = vertical(p) ? p : q, h = vertical(p) ? q : p;
        const x = v.a.x, y = h.a.y;
        if (x > Math.min(h.a.x, h.b.x) && x < Math.max(h.a.x, h.b.x) && y > Math.min(v.a.y, v.b.y) && y < Math.max(v.a.y, v.b.y)) cost += EDGE_CROSS;
      } else if (vertical(p) ? p.a.x === q.a.x : p.a.y === q.a.y) {
        const span = (s: Seg): [number, number] => vertical(s) ? [Math.min(s.a.y, s.b.y), Math.max(s.a.y, s.b.y)] : [Math.min(s.a.x, s.b.x), Math.max(s.a.x, s.b.x)];
        const [p0, p1] = span(p), [q0, q1] = span(q);
        cost += Math.max(0, Math.min(p1, q1) - Math.max(p0, q0)) * SHARED;
      }
    }
  }
  return cost;
}

/** 去掉重合的点和直线中间的点，只留端点与拐点。 */
function simplify(points: readonly Point[]): Point[] {
  const distinct = points.filter((p, n) => n === 0 || p.x !== points[n - 1]!.x || p.y !== points[n - 1]!.y);
  return distinct.filter((p, n) => {
    const a = distinct[n - 1], b = distinct[n + 1];
    return !a || !b || !((a.x === p.x && p.x === b.x) || (a.y === p.y && p.y === b.y));
  });
}

export function routeEdges(request: RouteRequest): Point[][] {
  const { boxes, headers, edges } = request;
  if (edges.length === 0) return [];
  const all = boxes.map((box) => box.rect);
  const nodes = boxes.flatMap((box) => box.kind === "node" ? [box.rect] : []), frames = boxes.flatMap((box) => box.kind === "frame" ? [box.rect] : []);
  const minX = Math.min(...all.map((r) => r.x)) - 48, maxX = Math.max(...all.map((r) => r.x + r.width)) + 48;
  const minY = Math.min(...all.map((r) => r.y)) - 48, maxY = Math.max(...all.map((r) => r.y + r.height)) + 48;

  const sideOf = (from: Rect, to: Rect): Side =>
    to.y >= from.y + from.height ? 2 : to.y + to.height <= from.y ? 0 : to.x >= from.x + from.width ? 1 : 3;
  const terminal = (node: number, side: Side): Terminal => {
    const r = all[node]!;
    const vertical = side === 0 || side === 2;
    const lo = (vertical ? r.x : r.y) + PORT_INSET, hi = (vertical ? r.x + r.width : r.y + r.height) - PORT_INSET;
    const face = side === 0 ? r.y : side === 2 ? r.y + r.height : side === 1 ? r.x + r.width : r.x;
    return { node, side, lo, hi, center: (lo + hi) / 2, face, line: face + (side === 0 || side === 3 ? -STUB : STUB) };
  };
  const ends = edges.map(({ source, target }) => {
    const out = sideOf(all[source]!, all[target]!);
    return { from: terminal(source, out), to: terminal(target, ((out + 2) % 4) as Side) };
  });

  // 网格：每 STEP 一条线，再加上每个线头伸出后的那条线和框边正中那条线：线头落在格点上，对齐的两个框能连成一条直线。
  const terminals = ends.flatMap(({ from, to }) => [from, to]);
  const xs = sorted([...Array.from({ length: Math.ceil((maxX - minX) / STEP) + 1 }, (_, i) => minX + i * STEP),
    ...terminals.map((t) => t.side === 1 || t.side === 3 ? t.line : t.center)]);
  const ys = sorted([...Array.from({ length: Math.ceil((maxY - minY) / STEP) + 1 }, (_, i) => minY + i * STEP),
    ...terminals.map((t) => t.side === 0 || t.side === 2 ? t.line : t.center)]);
  const nx = xs.length, ny = ys.length, points = nx * ny;
  const at = (i: number, j: number): number => i * ny + j;

  // 框四周留空不能走线；上下两边留到线头伸出的那条线为止，线头那一小段竖线不会被别的线横穿或贴着走。
  const blocked = new Uint8Array(points);
  for (const r of nodes) {
    for (let i = 0; i < nx; i++) {
      const x = xs[i]!;
      if (x <= r.x - CLEARANCE || x >= r.x + r.width + CLEARANCE) continue;
      for (let j = 0; j < ny; j++) {
        const y = ys[j]!;
        if (y > r.y - STUB && y < r.y + r.height + STUB) blocked[at(i, j)] = 1;
      }
    }
  }
  const inside = (r: Rect, x: number, y: number): boolean => x > r.x && x < r.x + r.width && y > r.y && y < r.y + r.height;
  // 每一步的固定代价：穿框、贴着框边走、从标题底下过。step[at(i,j)*2] 是向右一步，*2+1 是向下一步。
  const fixed = new Float64Array(points * 2);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const x = xs[i]!, y = ys[j]!, p = at(i, j);
      if (i + 1 < nx) {
        const x2 = xs[i + 1]!, len = x2 - x;
        let cost = 0;
        for (const f of frames) {
          if (inside(f, x, y) !== inside(f, x2, y)) cost += FRAME_CROSS;
          if (Math.abs(y - f.y) < HUG_DISTANCE || Math.abs(y - f.y - f.height) < HUG_DISTANCE) if (Math.max(x, x2) > f.x && Math.min(x, x2) < f.x + f.width) cost += HUG * len;
        }
        for (const h of headers) if (inside(h, x, y) || inside(h, x2, y)) cost += HEADER * len;
        fixed[p * 2] = cost;
      }
      if (j + 1 < ny) {
        const y2 = ys[j + 1]!, len = y2 - y;
        let cost = 0;
        for (const f of frames) {
          if (inside(f, x, y) !== inside(f, x, y2)) cost += FRAME_CROSS;
          if (Math.abs(x - f.x) < HUG_DISTANCE || Math.abs(x - f.x - f.width) < HUG_DISTANCE) if (Math.max(y, y2) > f.y && Math.min(y, y2) < f.y + f.height) cost += HUG * len;
        }
        for (const h of headers) if (inside(h, x, y) || inside(h, x, y2)) cost += HEADER * len;
        fixed[p * 2 + 1] = cost;
      }
    }
  }

  // 已走好的线占用的格段与格点：横着经过、竖着经过分开记，重叠与交叉都靠它算。
  const useH = new Int16Array(points), useV = new Int16Array(points), segH = new Int16Array(points), segV = new Int16Array(points);
  const ports = new Map<string, number[]>();
  const portKey = (t: Terminal): string => `${t.node}:${t.side}`;
  const index = (values: readonly number[], v: number): number => {
    let lo = 0, hi = values.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (values[mid]! < v) lo = mid + 1; else hi = mid; }
    return lo;
  };

  type Path = { readonly cells: number[]; readonly from: number; readonly to: number };
  const apply = (path: Path, sign: 1 | -1): void => {
    const { cells } = path;
    for (let k = 1; k < cells.length; k++) {
      const p = cells[k - 1]!, q = cells[k]!, low = Math.min(p, q);
      const [seg, use] = Math.abs(q - p) >= ny ? [segH, useH] : [segV, useV];
      seg[low] = seg[low]! + sign; use[p] = use[p]! + sign; use[q] = use[q]! + sign;
    }
  };
  const claim = (key: string, value: number, sign: 1 | -1): void => {
    const list = ports.get(key) ?? [];
    if (sign === 1) list.push(value); else list.splice(list.indexOf(value), 1);
    ports.set(key, list);
  };

  // 一条线的搜索：起点是出发框边伸出后那条线上的任一格点，终点是目标框边伸出后那条线上的任一格点。
  const g = new Float64Array(points * 4), parent = new Int32Array(points * 4), seen = new Uint32Array(points * 4);
  let epoch = 0;
  const search = (from: Terminal, to: Terminal): Path => {
    epoch++;
    const heap = new Heap();
    const vertical = (t: Terminal): boolean => t.side === 0 || t.side === 2;
    const toLine = vertical(to) ? index(ys, to.line) : index(xs, to.line);
    const heuristic = (i: number, j: number): number => {
      const x = xs[i]!, y = ys[j]!;
      if (vertical(to)) return Math.max(0, to.lo - x, x - to.hi) + Math.abs(y - to.line);
      return Math.max(0, to.lo - y, y - to.hi) + Math.abs(x - to.line);
    };
    const clash = (t: Terminal, v: number): number => (ports.get(portKey(t)) ?? []).some((u) => Math.abs(u - v) < PORT_GAP) ? PORT_CLASH : 0;
    const visit = (state: number, cost: number, from: number, i: number, j: number): void => {
      if (seen[state] === epoch && g[state]! <= cost) return;
      seen[state] = epoch; g[state] = cost; parent[state] = from;
      heap.push(cost + heuristic(i, j), state);
    };
    const fromLine = vertical(from) ? index(ys, from.line) : index(xs, from.line);
    const span = vertical(from) ? xs : ys;
    for (let k = 0; k < span.length; k++) {
      const v = span[k]!;
      if (v < from.lo || v > from.hi) continue;
      const i = vertical(from) ? k : fromLine, j = vertical(from) ? fromLine : k;
      if (blocked[at(i, j)]) continue;
      visit(at(i, j) * 4 + from.side, STUB + OFF_CENTER * Math.abs(v - from.center) + clash(from, v), -1, i, j);
    }
    const arrive = ((to.side + 2) % 4) as Dir;
    let best = -1, bestCost = Infinity;
    while (heap.size > 0) {
      const state = heap.pop();
      const cost = g[state]!;
      if (cost >= bestCost) break;
      const cell = state >> 2, dir = (state & 3) as Dir, i = Math.floor(cell / ny), j = cell % ny;
      const onLine = vertical(to) ? j === toLine : i === toLine;
      if (onLine) {
        const v = vertical(to) ? xs[i]! : ys[j]!;
        if (v >= to.lo && v <= to.hi) {
          const end = cost + STUB + (dir === arrive ? 0 : BEND) + OFF_CENTER * Math.abs(v - to.center) + clash(to, v);
          if (end < bestCost) { bestCost = end; best = state; }
        }
      }
      for (const next of [0, 1, 2, 3] as const) {
        if (next === ((dir + 2) & 3)) continue;
        const i2 = i + DX[next], j2 = j + DY[next];
        if (i2 < 0 || j2 < 0 || i2 >= nx || j2 >= ny) continue;
        const q = at(i2, j2);
        if (blocked[q]) continue;
        const horizontal = next === 1 || next === 3;
        const low = Math.min(cell, q);
        const len = horizontal ? Math.abs(xs[i2]! - xs[i]!) : Math.abs(ys[j2]! - ys[j]!);
        let step = len + fixed[low * 2 + (horizontal ? 0 : 1)]!;
        if (next !== dir) step += BEND;
        // 与别的线贴着平行（隔一条格线）也要付代价：并排的线至少隔开两格。
        if (horizontal) {
          step += segH[low]! * SHARED * len + ((low % ny > 0 ? segH[low - 1]! : 0) + (low % ny < ny - 1 ? segH[low + 1]! : 0)) * NEAR * len;
          if (useV[q]! > 0) step += EDGE_CROSS;
        } else {
          step += segV[low]! * SHARED * len + ((low >= ny ? segV[low - ny]! : 0) + (low + ny < points ? segV[low + ny]! : 0)) * NEAR * len;
          if (useH[q]! > 0) step += EDGE_CROSS;
        }
        visit(q * 4 + next, cost + step, state, i2, j2);
      }
    }
    if (best < 0) throw new Error(`连线路由没有找到路径：节点 ${from.node} → ${to.node}`);
    const cells: number[] = [];
    for (let s = best; s >= 0; s = parent[s]!) cells.push(s >> 2);
    cells.reverse();
    const coord = (cell: number, t: Terminal): number => vertical(t) ? xs[Math.floor(cell / ny)]! : ys[cell % ny]!;
    return { cells, from: coord(cells[0]!, from), to: coord(cells[cells.length - 1]!, to) };
  };

  const polyline = (path: Path, k: number): Point[] => {
    const { from, to } = ends[k]!;
    const grid = path.cells.map((c): Point => ({ x: xs[Math.floor(c / ny)]!, y: ys[c % ny]! }));
    const face = (t: Terminal, v: number): Point => t.side === 0 || t.side === 2 ? { x: v, y: t.face } : { x: t.face, y: v };
    return simplify([face(from, path.from), ...grid, face(to, path.to)]);
  };
  // 网格上的线为了躲标题、躲邻线会留下小错位：两次拐弯夹着一小段。把错位一侧的那段平移过去对齐另一侧，
  // 只要平移后的线不穿节点、不压在别的线上，线头也还在框边的可用范围里。
  const straighten = (routes: readonly Point[][]): Point[][] => {
    const out = routes.map((r) => [...r]);
    const cut = (r: Rect, a: Point, b: Point): boolean => a.x === b.x
      ? a.x > r.x && a.x < r.x + r.width && Math.max(a.y, b.y) > r.y && Math.min(a.y, b.y) < r.y + r.height
      : a.y > r.y && a.y < r.y + r.height && Math.max(a.x, b.x) > r.x && Math.min(a.x, b.x) < r.x + r.width;
    const presses = (k: number, a: Point, b: Point): boolean => out.some((other, m) => m !== k && other.slice(1).some((d, n) => {
      const c = other[n]!;
      if (a.x === b.x && c.x === d.x) return Math.abs(a.x - c.x) < STEP && Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) > Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
      if (a.y === b.y && c.y === d.y) return Math.abs(a.y - c.y) < STEP && Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) > Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x));
      return false;
    }));
    const set = (p: Point, vertical: boolean, v: number): Point => vertical ? { x: v, y: p.y } : { x: p.x, y: v };
    for (const [k, pts] of out.entries()) {
      const { from, to } = ends[k]!;
      let changed = true;
      while (changed) {
        changed = false;
        for (let i = 1; i + 2 < pts.length && !changed; i++) {
          const a = pts[i]!, b = pts[i + 1]!;
          if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) >= MIN_JOG) continue;
          // 错位两侧的段是竖段时平移 x，是横段时平移 y。
          const vertical = pts[i - 1]!.x === a.x;
          // 两种平移：把前一段挪到 b 的位置，或把后一段挪到 a 的位置。
          for (const [lo, hi, v] of [[i - 1, i, vertical ? b.x : b.y], [i + 1, i + 2, vertical ? a.x : a.y]] as const) {
            const moved = [...pts];
            moved[lo] = set(moved[lo]!, vertical, v); moved[hi] = set(moved[hi]!, vertical, v);
            const end = lo === 0 ? from : hi === pts.length - 1 ? to : null;
            if (end && (v < end.lo || v > end.hi)) continue;
            const touched = [lo - 1, lo, hi].filter((n) => n >= 0 && n + 1 < moved.length);
            if (touched.some((n) => nodes.some((r) => cut(r, moved[n]!, moved[n + 1]!)) || presses(k, moved[n]!, moved[n + 1]!))) continue;
            pts.splice(0, pts.length, ...simplify(moved));
            changed = true;
            break;
          }
        }
      }
    }
    return out;
  };
  // 按给定顺序走一遍，再把每条线拆掉按其余线重走两遍：先走的线不知道后面的线，重走时让出位置。
  const run = (order: readonly number[]): Point[][] => {
    useH.fill(0); useV.fill(0); segH.fill(0); segV.fill(0); ports.clear();
    const paths: (Path | null)[] = edges.map(() => null);
    for (let pass = 0; pass < 3; pass++) {
      for (const k of order) {
        const { from, to } = ends[k]!, old = paths[k];
        if (old) { apply(old, -1); claim(portKey(from), old.from, -1); claim(portKey(to), old.to, -1); }
        const path = search(from, to);
        apply(path, 1); claim(portKey(from), path.from, 1); claim(portKey(to), path.to, 1);
        paths[k] = path;
      }
    }
    return straighten(paths.map((path, k) => polyline(path!, k)));
  };
  // 先走短线还是先走长线结果不同，两种都走，取代价小的。
  const span = (k: number): number => { const s = all[edges[k]!.source]!, t = all[edges[k]!.target]!; return Math.abs(s.x + s.width / 2 - t.x - t.width / 2) + Math.abs(s.y + s.height / 2 - t.y - t.height / 2); };
  const shortFirst = edges.map((_, k) => k).sort((a, b) => span(a) - span(b));
  const results = [run(shortFirst), run([...shortFirst].reverse())];
  return results.reduce((best, next) => routeCost(next) < routeCost(best) ? next : best);
}
