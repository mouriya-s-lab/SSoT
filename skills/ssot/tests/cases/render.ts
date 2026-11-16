import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileBehavior } from "../../scripts/src/compile/quint";
import { type ProofObligation, type VdmDefinition, type VdmModule, type VdmType, compileVdm } from "../../scripts/src/compile/vdm";
import { projectAccess } from "../../scripts/src/render/access";
import { projectTypes } from "../../scripts/src/render/types";
import { format, global } from "../../scripts/src/diag";
import { generateContract } from "../../scripts/src/gen/contract";
import { bareExpression, projectBox, vdmTypeName, vdmValueText } from "../../scripts/src/render/box";
import { projectComposition } from "../../scripts/src/render/composition";
import { compileLikeC4 } from "../../scripts/src/compile/likec4";
import { elementOfModule } from "../../scripts/src/model";
import { projectC4View, projectDeploymentView } from "../../scripts/src/render/c4";
import { projectLayers } from "../../scripts/src/render/layers";
import { type Point, type Rect, routeEdges } from "../../scripts/src/render/route";
import { c4Svg } from "../../scripts/src/render/svg";
import { nodeIcon } from "../../scripts/src/render/icon";
import type { C4DiagramNode } from "../../scripts/src/render/c4";

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

/** 节点图标：写明的 icon 优先，其次 technology 里最先出现的技术（按词匹配），最后按种类。 */
function verifyIcons(): void {
  const node = (kind: C4DiagramNode["kind"], technology: string | null, icon: string | null = null): C4DiagramNode =>
    ({ id: "n", element: null, title: "n", kind, technology, icon, tags: [], description: "", parent: null, group: null, boundary: false });
  const url = (n: C4DiagramNode) => { const i = nodeIcon(n, "Container"); return `${i.source} ${i.url}`; };
  assert.equal(url(node("container", "Go daemon", "aws:lambda")), "declared aws:lambda");
  assert.equal(url(node("container", "NSH 应用（Rust），macOS 原生与 web")), "technology tech:rust");
  assert.equal(url(node("container", "无头 omp（RPC 模式）与 TypeScript 插件")), "technology tech:typescript-icon");
  assert.equal(url(node("container", "Google Cloud Run")), "kind bootstrap:box-seam");
  assert.equal(url(node("container", "JavaScript SPA")), "technology tech:javascript");
  assert.equal(url(node("container", "GitHub 仓库")), "technology tech:github-icon");
  assert.equal(url(node("container", "Volume")), "technology bootstrap:hdd");
  assert.equal(url(node("store", null)), "kind bootstrap:database");
  assert.equal(url(node("deploymentNode", "stack")), "kind bootstrap:stack");
  assert.equal(url(node("container", "Go daemon", "none")), "technology tech:go");
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

/** 类型图、读写表与值、表达式的写法：用手写的投影，不经 VDMJ。 */
function verifyVdmViews(): void {
  const at = { file: "a.vdmsl", module: "a", line: 1, col: 1 };
  const ref = (module: string, name: string): VdmType => ({ kind: "ref", module, name });
  const typeDef = (name: string, type: VdmType): VdmDefinition => ({ category: "type", name, location: at, type, inv: null, invSample: null });
  const op = (name: string, ext: { rd: string[]; wr: string[] } | null, reads: string[], writes: string[]): VdmDefinition =>
    ({ category: "operation", kind: "implicit", name, location: at, params: [], result: { name: null, type: { kind: "void" } }, pre: null, post: null, imperative: [], preSample: null, postSample: null, ext, reads, writes });
  const base = { location: at, exports: [{ kind: "all" } as const], references: [], fieldReads: [] };
  const b: VdmModule = { ...base, name: "b", file: "b.vdmsl", imports: [], definitions: [typeDef("T", { kind: "token" }), typeDef("Imported", { kind: "nat" }), typeDef("Unused", { kind: "nat" })] };
  const a: VdmModule = {
    ...base, name: "a", file: "a.vdmsl",
    imports: [{ module: "b", items: [{ kind: "type", name: "T", renamed: null }, { kind: "type", name: "Imported", renamed: null }] }],
    definitions: [
      typeDef("A", { kind: "nat" }),
      typeDef("R", { kind: "record", module: "a", name: "R", fields: [
        { name: "x", type: ref("b", "T") },
        { name: "y", type: { kind: "seq", element: ref("a", "R") } },
        { name: "z", type: { kind: "map", from: ref("a", "A"), to: ref("b", "T") } },
      ] }),
      typeDef("U", { kind: "union", types: [{ kind: "quote", value: "X" }, ref("a", "R")] }),
      { category: "state", name: "S", location: at, fields: [{ name: "n", type: ref("a", "A") }, { name: "m", type: { kind: "nat" } }], inv: null, init: null, invReads: [], invSample: null, initial: null },
      op("both", { rd: ["n", "m"], wr: ["m"] }, [], []),
      op("derived", null, ["n"], ["m"]),
    ],
  };
  const types = projectTypes({ modules: [a, b] }, "a", []);
  // 同一目标的多个字段并成一条线；自引用不成线；非记录的引用没有字段名；引入的类型画出来并带来源模块，没被引用也画。
  assert.deepEqual(types.edges, [
    { source: "a`R", target: "b`T", fields: ["x", "z"] },
    { source: "a`R", target: "a`A", fields: ["z"] },
    { source: "a`U", target: "a`R", fields: [] },
    { source: "a`S", target: "a`A", fields: ["n"] },
  ]);
  assert.deepEqual(types.nodes.map((n) => [n.id, n.module, n.category, n.shape.kind]), [
    ["a`A", "a", "type", "alias"], ["a`R", "a", "type", "record"], ["a`U", "a", "type", "union"], ["a`S", "a", "state", "record"],
    ["b`T", "b", "type", "alias"], ["b`Imported", "b", "type", "alias"],
  ]);
  assert.deepEqual(types.nodes.find((n) => n.id === "a`U")!.shape, { kind: "union", alternatives: ["<X>", "R"] });
  assert.throws(() => projectTypes({ modules: [a] }, "a", []), /b`T/);

  const table = projectAccess(a);
  // ext 子句优先；没有 ext 子句的操作按体求出的读写；写覆盖读。
  assert.deepEqual(table, {
    module: "a", element: "a", state: "S", fields: ["n", "m"],
    rows: [{ operation: "both", source: "ext", exported: true, cells: ["rd", "wr"] }, { operation: "derived", source: "body", exported: true, cells: ["rd", "wr"] }],
  });
  assert.equal(projectAccess(b), null);

  assert.equal(vdmValueText({ kind: "record", module: "a", name: "S", fields: [{ name: "n", value: { kind: "map", entries: [] } }, { name: "m", value: { kind: "map", entries: [[{ kind: "int", v: "1" }, { kind: "quote", v: "X" }]] } }] }), "mk_S({|->}, {1 |-> <X>})");
  assert.equal(bareExpression("((a) and (b))"), "(a) and (b)");
  assert.equal(bareExpression("(a) and (b)"), "(a) and (b)");
}

export async function verifyRenderProjections(): Promise<number> {
  const fixture = join(import.meta.dir, "..", "render");
  const stage = mkdtempSync("/tmp/ssot-render-fixture-");
  try {
    const vdm = await compileVdm([join(fixture, "contract", "shop.worker.vdmsl")], () => global, new Set());
    assert.equal(vdm.kind, "ok", vdm.diagnostics.map(format).join("\n"));
    if (vdm.kind !== "ok") throw new Error("VDM fixture compilation failed");
    const module = vdm.project.modules[0]!;
    // 义务按名字的第一段归属：`increment; post_increment` 归 increment，`Store` 归状态，别的模块的同名义务不算。
    const po = (number: number, name: string, status: ProofObligation["status"], owner = "shop_worker"): ProofObligation =>
      ({ number, kind: "TOTAL_FUNCTION", name, module: owner, status, location: { file: "f", module: owner, line: 1, col: 1 }, counterexample: {}, message: null, qualifier: null, checkable: true });
    const box = projectBox(module, [po(1, "Store", "PROVABLE"), po(2, "increment; post_increment", "MAYBE"), po(3, "increment", "FAILED"), po(4, "increment", "PROVABLE", "other")]);
    assert.deepEqual(box, {
      module: "shop_worker", element: "shop.worker",
      ports: [
        { name: "describe", kind: "function", inputs: ["seq of nat", "[bool]"], output: "seq of nat", ext: null, pre: null, post: null, obligations: [] },
        {
          name: "increment", kind: "operation", inputs: ["nat"], output: "nat", ext: { rd: [], wr: ["count"] }, pre: null,
          post: { text: "(count = (count~ + n)) and (result = count)", sample: null },
          obligations: [{ number: 2, kind: "TOTAL_FUNCTION", status: "MAYBE" }, { number: 3, kind: "TOTAL_FUNCTION", status: "FAILED" }],
        },
      ],
      state: { name: "Store", fields: ["count: nat"], inv: null, init: { clause: "s == s = mk_Store(0)", value: "mk_Store(0)" }, obligations: [{ number: 1, kind: "TOTAL_FUNCTION", status: "PROVABLE" }] },
    });
    assert.equal(vdmTypeName({ kind: "map", from: { kind: "ref", module: "shop_worker", name: "Input" }, to: { kind: "optional", type: { kind: "union", types: [{ kind: "quote", value: "Yes" }, { kind: "quote", value: "No" }] } } }), "map Input to [<Yes> | <No>]");
    assert.equal(vdmTypeName({ kind: "seq", element: { kind: "product", types: [{ kind: "nat" }, { kind: "bool" }] } }), "seq of (nat * bool)");
    assert.equal(vdmTypeName({ kind: "function", partial: false, params: [{ kind: "token" }], result: { kind: "set", element: { kind: "char" } } }), "(token +> set of char)");
    assert.equal(projectBox({ ...module, exports: [{ kind: "all" }] }, []).ports.some((port) => port.name === "hidden"), true);
    assert.equal(projectBox({ ...module, definitions: module.definitions.filter((def) => def.category !== "state") }, []).state, null);

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
    verifyIcons();
    verifyVdmViews();
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
    return 27;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
