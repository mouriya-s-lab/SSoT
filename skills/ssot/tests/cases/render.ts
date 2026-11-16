import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileBehavior } from "../../scripts/src/compile/quint";
import { compileVdm } from "../../scripts/src/compile/vdm";
import { format, global } from "../../scripts/src/diag";
import { generateContract } from "../../scripts/src/gen/contract";
import { projectBox, vdmTypeName } from "../../scripts/src/render/box";
import { projectComposition } from "../../scripts/src/render/composition";
import { compileLikeC4 } from "../../scripts/src/compile/likec4";
import { elementOfModule } from "../../scripts/src/model";
import { projectC4View, projectDeploymentView } from "../../scripts/src/render/c4";
import { projectLayers } from "../../scripts/src/render/layers";
import { type Point, type Rect, routeEdges } from "../../scripts/src/render/route";
import { c4Svg } from "../../scripts/src/render/svg";

const C4_FIXTURE = `specification {
  element actor { notation 'Person' style { shape person } }
  element system { notation 'Software System' }
  element container { notation 'Container' }
  element store { notation 'Container: Data Store' style { shape storage } }
  element component { notation 'Component' }
  tag contract
  tag business
  tag external
  tag untrusted
  deploymentNode host
}
model {
  user = actor 'User'
  pay = system 'Pay' { #external }
  shop = system 'Shop' {
    web = container 'Web' { metadata { group 'Edge' } }
    api = container 'API' {
      #business #contract
      technology 'HTTP'
      metadata { group 'Edge' }
    }
    ledger = store 'Ledger' { #contract }
    web -> api 'forwards'
    api -> ledger 'writes'
    api -> pay 'charges'
  }
  user -> shop.web 'browses'
}
deployment {
  host core 'Core' {
    instanceOf shop.api
    instanceOf shop.ledger
    host edge 'Edge' {
      instanceOf shop.web
    }
  }
  host partner 'Partner' {
    #untrusted
    description 'outside the trust boundary'
    instanceOf pay
  }
}
views {
  view index { include * }
  view shopView of shop { include * }
  deployment view deployed {
    include core.**
    include partner.**
  }
}
`;

/** C4 投影：可见父元素、分组只在同一可见父下合并、元素种类到 C4 记法；分层图：业务在上、存储最深、import 名字。 */
async function verifyC4AndLayerProjections(stage: string, fixture: string): Promise<void> {
  mkdirSync(join(stage, "c4", "structure"), { recursive: true });
  writeFileSync(join(stage, "c4", "structure", "model.c4"), C4_FIXTURE);
  const c4 = await compileLikeC4(join(stage, "c4", "structure"));
  assert.equal(c4.kind, "ok", c4.diagnostics.map(format).join("\n"));
  const view = (id: string) => c4.structure.views.find((v) => v.id === id)!;
  const summary = (id: string) => {
    const d = projectC4View(c4.structure, view(id));
    return {
      nodes: Object.fromEntries(d.nodes.map((n) => [n.id, { kind: n.kind, parent: n.parent, group: n.group, boundary: n.boundary }])),
      groups: d.groups,
      edges: d.edges.map((e) => `${e.source} -> ${e.target} ${e.label}`).sort(),
    };
  };
  assert.deepEqual(summary("shopView"), {
    nodes: {
      user: { kind: "person", parent: null, group: null, boundary: false },
      pay: { kind: "external", parent: null, group: null, boundary: false },
      shop: { kind: "system", parent: null, group: null, boundary: true },
      "shop.web": { kind: "container", parent: "shop", group: "group:shop:Edge", boundary: false },
      "shop.api": { kind: "container", parent: "shop", group: "group:shop:Edge", boundary: false },
      "shop.ledger": { kind: "store", parent: "shop", group: null, boundary: false },
    },
    groups: [{ id: "group:shop:Edge", name: "Edge", parent: "shop" }],
    edges: ["shop.api -> pay charges", "shop.api -> shop.ledger writes", "shop.web -> shop.api forwards", "user -> shop.web browses"],
  });
  const index = summary("index");
  assert.deepEqual(Object.keys(index.nodes).sort(), ["pay", "shop", "user"]);
  assert.equal(index.nodes["shop"]!.boundary, false);
  assert.deepEqual(index.groups, []);
  const deployed = projectDeploymentView(c4.structure, view("deployed"));
  assert.deepEqual(Object.fromEntries(deployed.nodes.map((n) => [n.id, { element: n.element, kind: n.kind, technology: n.technology, tags: n.tags, parent: n.parent, boundary: n.boundary }])), {
    core: { element: null, kind: "deploymentNode", technology: "host", tags: [], parent: null, boundary: true },
    "core.api": { element: "shop.api", kind: "container", technology: "HTTP", tags: [], parent: "core", boundary: false },
    "core.ledger": { element: "shop.ledger", kind: "store", technology: null, tags: [], parent: "core", boundary: false },
    // 只装一个实例的部署节点被 LikeC4 折叠后仍是边界，实例画在它里面。
    "core.edge": { element: null, kind: "deploymentNode", technology: "host", tags: [], parent: "core", boundary: true },
    "core.edge.web": { element: "shop.web", kind: "container", technology: null, tags: [], parent: "core.edge", boundary: false },
    partner: { element: null, kind: "deploymentNode", technology: "host", tags: ["untrusted"], parent: null, boundary: true },
    "partner.pay": { element: "pay", kind: "external", technology: null, tags: [], parent: "partner", boundary: false },
  });
  assert.deepEqual(deployed.edges.map((e) => `${e.source} -> ${e.target} ${e.label}`).sort(), ["core.api -> core.ledger writes", "core.api -> partner.pay charges", "core.edge.web -> core.api forwards"]);
  // 各框分开排版（nested）时，节点画在自己的框里，并排的框互不重叠。
  const nested = (await c4Svg(deployed, ["nested"])).svg;
  const drawn = (id: string): Rect => {
    const m = new RegExp(`<g data-node="${id.replaceAll(".", "\\.")}"[^>]*><rect x="([-\\d.]+)" y="([-\\d.]+)" width="([\\d.]+)" height="([\\d.]+)"`).exec(nested);
    assert.ok(m, `图上没有画出 ${id}`);
    return { x: Number(m[1]), y: Number(m[2]), width: Number(m[3]), height: Number(m[4]) };
  };
  const within = (inner: string, outer: string): void => {
    const a = drawn(inner), b = drawn(outer);
    assert.ok(a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height, `${inner} ${JSON.stringify(a)} 不在 ${outer} ${JSON.stringify(b)} 里`);
  };
  within("core.api", "core");
  within("core.edge", "core");
  within("core.edge.web", "core.edge");
  within("partner.pay", "partner");
  const [core, partner] = [drawn("core"), drawn("partner")];
  assert.ok(core.x + core.width <= partner.x || partner.x + partner.width <= core.x || core.y + core.height <= partner.y || partner.y + partner.height <= core.y, "core 与 partner 两个框重叠");

  const contracts = await compileVdm(["shop.api.vdmsl", "shop.ledger.vdmsl"].map((f) => join(fixture, "..", "base", "contract", f)), () => global, new Set());
  assert.equal(contracts.kind, "ok", contracts.diagnostics.map(format).join("\n"));
  assert.deepEqual(projectLayers(c4.structure, contracts.project, elementOfModule(c4.structure)), {
    modules: [
      { module: "shop_api", element: "shop.api", title: "API", tier: "business" },
      { module: "shop_ledger", element: "shop.ledger", title: "Ledger", tier: "store" },
    ],
    imports: [{ from: "shop_api", to: "shop_ledger", names: ["OrderId"] }],
  });
}

/**
 * 连线路由：对齐的两个框连成一条直线；线不穿过别的节点；线头落在框边上；离开一个框只穿一次框边；两条线不共用一段。
 * A、B 同在框 F 里且上下对齐，C 在 F 外，O 挡在 A 与 C 之间。
 */
function verifyRouting(): void {
  const A: Rect = { x: 0, y: 0, width: 248, height: 150 }, B: Rect = { x: 0, y: 400, width: 248, height: 150 };
  const C: Rect = { x: 600, y: 760, width: 248, height: 150 }, O: Rect = { x: 320, y: 300, width: 248, height: 150 };
  const F: Rect = { x: -40, y: -60, width: 328, height: 650 };
  const boxes = [A, B, C, O].map((rect) => ({ kind: "node" as const, rect }));
  const edges = [{ source: 0, target: 1 }, { source: 0, target: 2 }, { source: 1, target: 2 }];
  const routes = routeEdges({ boxes: [...boxes, { kind: "frame", rect: F }], headers: [], edges }, "full");
  const rects = [A, B, C, O];
  const inside = (r: Rect, p: Point): boolean => p.x > r.x && p.x < r.x + r.width && p.y > r.y && p.y < r.y + r.height;
  const segments = (points: readonly Point[]): [Point, Point][] => points.slice(1).map((b, i) => [points[i]!, b]);
  assert.deepEqual(routes[0], [{ x: 124, y: 150 }, { x: 124, y: 400 }], "上下对齐的两个框应连成正中一条直线");
  for (const [k, route] of routes.entries()) {
    const { source, target } = edges[k]!, s = rects[source]!, t = rects[target]!;
    assert.equal(route[0]!.y, s.y + s.height, `第 ${k} 条线应从源框下边出发`);
    assert.equal(route.at(-1)!.y, t.y, `第 ${k} 条线应进入目标框上边`);
    for (const [a, b] of segments(route)) {
      assert.ok(a.x === b.x || a.y === b.y, `第 ${k} 条线有斜段`);
      // 线段上每隔 4 个单位取样，不应落在别的节点里。
      const steps = Math.max(1, Math.ceil((Math.abs(a.x - b.x) + Math.abs(a.y - b.y)) / 4));
      for (let n = 0; n <= steps; n++) {
        const p = { x: a.x + (b.x - a.x) * n / steps, y: a.y + (b.y - a.y) * n / steps };
        rects.forEach((r, m) => assert.ok(m === source || m === target || !inside(r, p), `第 ${k} 条线穿过了节点 ${m}`));
      }
    }
  }
  const flips = segments(routes[1]!).filter(([a, b]) => inside(F, a) !== inside(F, b)).length;
  assert.equal(flips, 1, "从框里连到框外的线应只穿一次框边");
  const all = routes.flatMap((route, k) => segments(route).map(([a, b]) => ({ k, a, b })));
  for (const p of all) for (const q of all) {
    if (p.k >= q.k) continue;
    const vertical = p.a.x === p.b.x && q.a.x === q.b.x && p.a.x === q.a.x;
    const horizontal = p.a.y === p.b.y && q.a.y === q.b.y && p.a.y === q.a.y;
    const [lo, hi] = vertical ? [Math.max(Math.min(p.a.y, p.b.y), Math.min(q.a.y, q.b.y)), Math.min(Math.max(p.a.y, p.b.y), Math.max(q.a.y, q.b.y))]
      : horizontal ? [Math.max(Math.min(p.a.x, p.b.x), Math.min(q.a.x, q.b.x)), Math.min(Math.max(p.a.x, p.b.x), Math.max(q.a.x, q.b.x))] : [0, 0];
    assert.ok(hi <= lo, `第 ${p.k} 与第 ${q.k} 条线共用了一段`);
  }
}

export async function verifyRenderProjections(): Promise<number> {
  const fixture = join(import.meta.dir, "..", "render");
  const stage = mkdtempSync("/tmp/ssot-render-fixture-");
  try {
    const vdm = await compileVdm([join(fixture, "contract", "shop.worker.vdmsl")], () => global, new Set());
    assert.equal(vdm.kind, "ok", vdm.diagnostics.map(format).join("\n"));
    if (vdm.kind !== "ok") throw new Error("VDM fixture compilation failed");
    const module = vdm.project.modules[0]!;
    const box = projectBox(module);
    assert.deepEqual(box, {
      module: "shop_worker", element: "shop.worker",
      ports: [
        { name: "describe", kind: "function", inputs: ["seq of nat", "[bool]"], output: "seq of nat", ext: null },
        { name: "increment", kind: "operation", inputs: ["nat"], output: "nat", ext: { rd: [], wr: ["count"] } },
      ],
      state: { name: "Store", fields: ["count: nat"] },
    });
    assert.equal(vdmTypeName({ kind: "map", from: { kind: "ref", module: "shop_worker", name: "Input" }, to: { kind: "optional", type: { kind: "union", types: [{ kind: "quote", value: "Yes" }, { kind: "quote", value: "No" }] } } }), "map Input to [<Yes> | <No>]");
    assert.equal(vdmTypeName({ kind: "seq", element: { kind: "product", types: [{ kind: "nat" }, { kind: "bool" }] } }), "seq of (nat * bool)");
    assert.equal(vdmTypeName({ kind: "function", partial: false, params: [{ kind: "token" }], result: { kind: "set", element: { kind: "char" } } }), "(token +> set of char)");
    assert.equal(projectBox({ ...module, exports: [{ kind: "all" }] }).ports.some((port) => port.name === "hidden"), true);
    assert.equal(projectBox({ ...module, definitions: module.definitions.filter((def) => def.category !== "state") }).state, null);

    const generated = generateContract(vdm.project, new Set([module.name]), () => global);
    assert.deepEqual(generated.diagnostics, []);
    mkdirSync(join(stage, ".gen"));
    mkdirSync(join(stage, "work"));
    cpSync(join(fixture, "behavior"), join(stage, "behavior"), { recursive: true });
    writeFileSync(join(stage, ".gen", "contract.qnt"), generated.text);
    const quint = await compileBehavior(join(stage, "behavior", "wiring.qnt"), "wiring", new Set(["contract", module.name]), join(stage, "work"), (path) => path, { origins: generated.origins, subjectOf: () => global });
    assert.equal(quint.kind, "ok", quint.diagnostics.map(format).join("\n"));
    if (quint.kind !== "ok") throw new Error("Quint fixture compilation failed");
    const input: unknown = await Bun.file(quint.module.typecheckOut).json();
    const composition = projectComposition(input, quint.module, vdm.project);
    assert.deepEqual(composition, {
      module: "wiring",
      nodes: [
        { kind: "step", id: "idle" }, { kind: "step", id: "local" }, { kind: "step", id: "move" }, { kind: "step", id: "sync" },
        { kind: "wire", id: "left", type: "int" },
        { kind: "wire", id: "observer", type: "int" },
        { kind: "wire", id: "payload", type: "Api::Input" },
        { kind: "wire", id: "right", type: "int" },
        { kind: "contract", id: "shop_worker" },
      ],
      edges: [
        { kind: "put", step: "local", wire: "left" },
        { kind: "put", step: "move", wire: "left" },
        { kind: "take", wire: "right", step: "move" },
        { kind: "call", step: "move", contract: "shop_worker", operations: ["increment"] },
        { kind: "update", wire: "left", step: "sync" },
        { kind: "update", wire: "right", step: "sync" },
      ],
    });

    writeFileSync(join(stage, "behavior", "peek.qnt"), `module peek {
  import contract.* from "../.gen/contract"
  import shop_worker as Api from "../.gen/contract"
  var flag: bool
  var store: Api::Store
  var last: Call
  def seenCount: int = store.count
  action init = all { flag' = false, store' = Api::initial, last' = NoCall }
  action callAndRead = all {
    seenCount >= 0,
    flag' = flag,
    store' = { ...store, count: store.count + 1 },
    last' = shop_worker(Api::increment({ n: 1, result: 1 })),
  }
  action peekFeedback = all {
    seenCount > 0,
    flag' = true,
    store' = store,
    last' = NoCall,
  }
  action peekCall = all {
    last != NoCall,
    flag' = false,
    store' = store,
    last' = NoCall,
  }
  action step = any { callAndRead, peekFeedback, peekCall }
}
`);
    const peekCompiled = await compileBehavior(join(stage, "behavior", "peek.qnt"), "peek", new Set(["contract", module.name]), join(stage, "work"), (path) => path, { origins: generated.origins, subjectOf: () => global });
    assert.equal(peekCompiled.kind, "ok", peekCompiled.diagnostics.map(format).join("\n"));
    if (peekCompiled.kind !== "ok") throw new Error("peek.qnt compilation failed");
    const peekIr: unknown = await Bun.file(peekCompiled.module.typecheckOut).json();
    await verifyC4AndLayerProjections(stage, fixture);
    verifyRouting();
    const peekDiagram = projectComposition(peekIr, peekCompiled.module, vdm.project);
    assert.deepEqual(peekDiagram, {
      module: "peek",
      nodes: [
        { kind: "step", id: "callAndRead" }, { kind: "step", id: "peekCall" }, { kind: "step", id: "peekFeedback" },
        { kind: "wire", id: "flag", type: "bool" },
        { kind: "wire", id: "last", type: "Call" },
        { kind: "contract", id: "shop_worker" },
      ],
      edges: [
        { kind: "put", step: "callAndRead", wire: "last" },
        { kind: "call", step: "callAndRead", contract: "shop_worker", operations: ["increment"] },
        { kind: "put", step: "peekCall", wire: "flag" },
        { kind: "update", wire: "last", step: "peekCall" },
        { kind: "put", step: "peekFeedback", wire: "flag" },
        { kind: "put", step: "peekFeedback", wire: "last" },
        { kind: "read", contract: "shop_worker", step: "peekFeedback" },
      ],
    });
    return 26;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
