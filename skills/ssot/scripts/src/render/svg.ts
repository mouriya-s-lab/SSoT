import type { ElkExtendedEdge, ElkNode, ElkPort } from "elkjs/lib/elk-api";
import type { Browser } from "playwright-core";
import { assertNever } from "../diag";
import { loadDiagramTools } from "../install";
import type { BoxDiagram } from "./box";
import type { C4Diagram, C4DiagramNode, C4NodeKind } from "./c4";
import type { CompositionDiagram, CompositionNode } from "./composition";
import { type LayerTier, type LayersDiagram, TIER_ORDER } from "./layers";

export interface DiagramSvg { readonly width: number; readonly height: number; readonly svg: string }
const INK = "#20252b", MUTED = "#59636e", BEHAVIOR = "#2a78d6", CONTRACT = "#eb6834";
const esc = (value: string): string => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const widthOf = (value: string): number => [...value].reduce((width, char) => width + (char.codePointAt(0)! > 255 ? 15 : 8.5), 0);

function wrap(value: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const token of value.split(/(\s+)/)) {
    if (line && widthOf(line + token) > maxWidth) { lines.push(line.trimEnd()); line = ""; }
    const next = line ? token : token.trimStart();
    for (const char of next) {
      if (line && widthOf(line + char) > maxWidth) { lines.push(line); line = ""; }
      line += char;
    }
  }
  if (line) lines.push(line.trimEnd());
  return lines.length > 0 ? lines : [""];
}
function text(x: number, y: number, lines: readonly string[], anchor: "start" | "middle" | "end" = "start", size = 14, weight = "normal", fill = INK): string {
  const lead = Math.round(size * 1.36);
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" font-weight="${weight}" fill="${fill}">${lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lead}">${esc(line)}</tspan>`).join("")}</text>`;
}
const sizedWidth = (value: string, size: number): number => widthOf(value) * size / 14;
const sizedWrap = (value: string, maxWidth: number, size: number): string[] => wrap(value, maxWidth * 14 / size);
type Point = { readonly x: number; readonly y: number };
/** 折线在拐点处用半径 r 的圆角连接；r 不超过相邻两段各自长度的一半。 */
function roundedPath(points: readonly Point[], r = 10): string {
  if (points.length < 2) return "";
  let d = `M${points[0]!.x},${points[0]!.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!, at = points[i]!, next = points[i + 1]!;
    const inLen = Math.hypot(at.x - prev.x, at.y - prev.y), outLen = Math.hypot(next.x - at.x, next.y - at.y);
    const k = Math.min(r, inLen / 2, outLen / 2);
    if (k < 0.5) { d += ` L${at.x},${at.y}`; continue; }
    const a = { x: at.x - ((at.x - prev.x) / inLen) * k, y: at.y - ((at.y - prev.y) / inLen) * k };
    const b = { x: at.x + ((next.x - at.x) / outLen) * k, y: at.y + ((next.y - at.y) / outLen) * k };
    d += ` L${a.x},${a.y} Q${at.x},${at.y} ${b.x},${b.y}`;
  }
  const last = points[points.length - 1]!;
  return `${d} L${last.x},${last.y}`;
}
function sectionPoints(edge: ElkExtendedEdge): Point[][] {
  if (!edge.sections?.length) throw new Error(`ELK 没有布置连线 ${edge.id}`);
  return edge.sections.map((section) => [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]);
}
function frame(title: string, subtitle: string, width: number, height: number, body: string, legend: string): DiagramSvg {
  const w = Math.ceil(Math.max(width, 860)), h = Math.ceil(height);
  return { width: w, height: h, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" font-family="Arial, sans-serif" font-size="14"><defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto-start-reverse"><path d="M0,0 L9,4.5 L0,9 z" fill="${MUTED}"/></marker></defs><rect width="100%" height="100%" fill="#fff"/>${text(28, 34, [title], "start", 21, "bold")}${text(28, 59, [subtitle], "start", 14)}${body}<line x1="28" x2="${w - 28}" y1="${h - 65}" y2="${h - 65}" stroke="#dde1e5"/>${legend}</svg>` };
}
function flowPath(edge: ElkExtendedEdge, kind: "flow" | "update"): string {
  const markers = kind === "update" ? 'marker-start="url(#arrow)" marker-end="url(#arrow)"' : 'marker-end="url(#arrow)"';
  return sectionPoints(edge).map((points) => `<path d="${roundedPath(points, 8)}" fill="none" stroke="${MUTED}" stroke-width="1.7" ${markers}/>`).join("")
    + (edge.junctionPoints ?? []).map((point) => `<circle cx="${point.x}" cy="${point.y}" r="3.5" fill="${MUTED}"/>`).join("");
}

const BOX_LABEL_GAP = 14;
export async function boxSvg(diagram: BoxDiagram): Promise<DiagramSvg> {
  const { ELK } = await loadDiagramTools();
  const rowHeight = 64, boxWidth = Math.max(320, ...diagram.ports.map((port) => widthOf(port.name) + 48));
  const boxHeight = Math.max(100, diagram.ports.length * rowHeight + 30);
  const graph: ElkNode = {
    id: "root", layoutOptions: { "elk.algorithm": "layered", "elk.direction": "RIGHT", "elk.edgeRouting": "ORTHOGONAL", "elk.spacing.nodeNode": "28", "elk.layered.spacing.nodeNodeBetweenLayers": "64", "elk.padding": "[top=12,left=12,bottom=12,right=12]" },
    children: [{ id: "box", width: boxWidth, height: boxHeight, layoutOptions: { "elk.portConstraints": "FIXED_POS" }, ports: diagram.ports.flatMap((_, index) => [
      { id: `in${index}`, x: 0, y: 35 + index * rowHeight, width: 0, height: 0, layoutOptions: { "elk.port.side": "WEST" } },
      { id: `out${index}`, x: boxWidth, y: 35 + index * rowHeight, width: 0, height: 0, layoutOptions: { "elk.port.side": "EAST" } },
    ]) }, ...diagram.ports.flatMap((port, index) => [
      { id: `input${index}`, width: Math.min(300, widthOf(port.inputs.join(" * ") || "()")) + BOX_LABEL_GAP, height: wrap(port.inputs.join(" * ") || "()", 300).length * 19 + 8 },
      { id: `output${index}`, width: Math.min(300, widthOf(port.output)) + BOX_LABEL_GAP, height: wrap(port.output, 300).length * 19 + 8 },
    ])],
    edges: diagram.ports.flatMap((_, index) => [
      { id: `incoming${index}`, sources: [`input${index}`], targets: [`in${index}`] },
      { id: `outgoing${index}`, sources: [`out${index}`], targets: [`output${index}`] },
    ]),
  };
  const laid = await new ELK().layout(graph);
  const box = laid.children?.find((node) => node.id === "box");
  if (!box || box.x === undefined || box.y === undefined || !laid.width || !laid.height) throw new Error(`ELK 没有布置盒子 ${diagram.module}`);
  const stateLines = diagram.state ? [diagram.state.name, ...diagram.state.fields.flatMap((field) => wrap(field, boxWidth - 80))] : [];
  const feedbackHeight = stateLines.length * 19 + 35;
  const top = 100 + (diagram.state ? feedbackHeight : 0);
  let body = `<g transform="translate(28,${top})">`;
  for (const edge of laid.edges ?? []) body += flowPath(edge, "flow");
  body += `<rect x="${box.x}" y="${box.y}" width="${boxWidth}" height="${boxHeight}" rx="9" fill="#f2eff8" stroke="${CONTRACT}" stroke-width="2"/>`;
  if (diagram.state) {
    const x = box.x, y = box.y;
    body += `<path d="M${x + boxWidth - 24},${y} V${y - feedbackHeight} H${x + 24} V${y}" fill="none" stroke="${MUTED}" stroke-width="1.7" marker-end="url(#arrow)"/>`;
    body += `<rect x="${x + 36}" y="${y - feedbackHeight - 10}" width="${boxWidth - 72}" height="${stateLines.length * 19 + 12}" fill="#fff"/>`;
    body += text(x + boxWidth / 2, y - feedbackHeight + 5, stateLines, "middle");
  }
  diagram.ports.forEach((port, index) => {
    const y = box.y! + 35 + index * rowHeight;
    body += text(box.x! + 16, y - 6, [`${port.name}  · ${port.kind === "operation" ? "op" : "fn"}`], "start", 14, "bold");
    if (port.ext) body += text(box.x! + 16, y + 15, wrap(`rd ${port.ext.rd.join(", ") || "—"}  |  wr ${port.ext.wr.join(", ") || "—"}`, boxWidth - 32), "start", 12);
    body += `<circle cx="${box.x}" cy="${y}" r="4" fill="${CONTRACT}"/><circle cx="${box.x! + boxWidth}" cy="${y}" r="4" fill="${CONTRACT}"/>`;
    // 参数类型靠右贴着线起点，结果类型隔开箭头尖；两者都与线留出 BOX_LABEL_GAP。
    for (const [id, label, side] of [[`input${index}`, port.inputs.join(" * ") || "()", "input"], [`output${index}`, port.output, "output"]] as const) {
      const node = laid.children!.find((node) => node.id === id)!, lines = wrap(label, 300);
      const baseline = node.y! + node.height! / 2 + 5 - (lines.length - 1) * 19 / 2;
      body += side === "input" ? text(node.x! + node.width! - BOX_LABEL_GAP, baseline, lines, "end") : text(node.x! + BOX_LABEL_GAP, baseline, lines);
    }
  });
  if (diagram.ports.length === 0) body += text(box.x + boxWidth / 2, box.y + 54, ["No exported operations / functions"], "middle");
  body += "</g>";
  const height = top + laid.height + 110;
  const legend = `<circle cx="35" cy="${height - 37}" r="4" fill="${CONTRACT}"/>${text(48, height - 32, ["Port · exported operation / function"], "start", 12)}<path d="M340,${height - 37} h38" stroke="${MUTED}" marker-end="url(#arrow)"/>${text(390, height - 32, ["Wire · parameter / result type"], "start", 12)}<path d="M640,${height - 32} v-14 h30 v14" fill="none" stroke="${MUTED}" marker-end="url(#arrow)"/>${text(685, height - 32, ["Feedback · state"], "start", 12)}`;
  return frame(`Contract box · ${diagram.module}`, diagram.element, laid.width + 56, height, body, legend);
}

type StepCall = { readonly kind: "call" | "read"; readonly text: string };

/**
 * 契约调用与读取写进发起它的步骤框，不画成连到契约节点的线：每个步骤都连向同一两个契约节点，
 * 这些线横穿整张变量连线图，交叉数由契约节点决定而不由组合本身决定。
 * 变量是总线：每个变量只有左侧一个写入端口、右侧一个读出端口，同一变量的线在端口处汇成一束。
 * 步骤侧每条线独占端口（读入在左，写出与 update 在右）；步骤若也共用端口，ELK 会把经过同一步骤的
 * 不同变量的线并进同一条竖线，读图时分不清哪条线去哪个变量。update 按“步骤 → 变量”参与分层，
 * 与 put 同向，双向箭头表示步骤也读它。
 */
export async function compositionSvg(diagram: CompositionDiagram): Promise<DiagramSvg> {
  const { ELK } = await loadDiagramTools();
  const key = (kind: CompositionNode["kind"], id: string): string => `${kind}:${id}`;
  const calls = new Map<string, StepCall[]>();
  const callsOf = (step: string): StepCall[] => calls.get(step) ?? calls.set(step, []).get(step)!;
  const flows: { readonly source: string; readonly target: string; readonly kind: "flow" | "update" }[] = [];
  const stepPorts = new Map<string, ElkPort[]>();
  const stepPort = (step: string, side: "WEST" | "EAST"): string => {
    const ports = stepPorts.get(step) ?? stepPorts.set(step, []).get(step)!, id = `${key("step", step)}.${ports.length}`;
    ports.push({ id, layoutOptions: { "elk.port.side": side } });
    return id;
  };
  for (const edge of diagram.edges) {
    switch (edge.kind) {
      case "take": flows.push({ source: `${key("wire", edge.wire)}.out`, target: stepPort(edge.step, "WEST"), kind: "flow" }); break;
      case "put": flows.push({ source: stepPort(edge.step, "EAST"), target: `${key("wire", edge.wire)}.in`, kind: "flow" }); break;
      case "update": flows.push({ source: stepPort(edge.step, "EAST"), target: `${key("wire", edge.wire)}.in`, kind: "update" }); break;
      case "call": callsOf(edge.step).push({ kind: "call", text: `${edge.contract}.${edge.operations.join(", ")}` }); break;
      case "read": callsOf(edge.step).push({ kind: "read", text: `${edge.contract}` }); break;
      default: assertNever(edge);
    }
  }
  const callLines = (step: string): { readonly kind: StepCall["kind"]; readonly line: string }[] =>
    (calls.get(step) ?? []).flatMap((call) => sizedWrap(`${call.kind === "call" ? "calls" : "reads"} ${call.text}`, 300, 12).map((line) => ({ kind: call.kind, line })));
  const typeLines = (node: CompositionNode): string[] => node.kind === "wire" ? wrap(node.type, 260) : [];
  const children: ElkNode[] = [];
  for (const node of diagram.nodes) {
    switch (node.kind) {
      case "step": {
        const lines = callLines(node.id);
        children.push({ id: key("step", node.id), width: Math.max(150, widthOf(node.id) + 40, ...lines.map(({ line }) => sizedWidth(line, 12) + 28)), height: lines.length ? 44 + lines.length * 16 : 52, layoutOptions: { "elk.portConstraints": "FIXED_SIDE" }, ports: stepPorts.get(node.id) ?? [] });
        break;
      }
      case "wire":
        children.push({ id: key("wire", node.id), width: Math.max(widthOf(node.id) + 32, ...typeLines(node).map((line) => widthOf(line) * 0.9 + 32)), height: 30 + typeLines(node).length * 17, layoutOptions: { "elk.portConstraints": "FIXED_SIDE" }, ports: [{ id: `${key("wire", node.id)}.in`, layoutOptions: { "elk.port.side": "WEST" } }, { id: `${key("wire", node.id)}.out`, layoutOptions: { "elk.port.side": "EAST" } }] });
        break;
      case "contract": break;
      default: assertNever(node);
    }
  }
  const graph: ElkNode = {
    id: "root",
    layoutOptions: { "elk.algorithm": "layered", "elk.direction": "RIGHT", "elk.edgeRouting": "ORTHOGONAL", "elk.layered.thoroughness": "100", "elk.spacing.nodeNode": "28", "elk.layered.spacing.nodeNodeBetweenLayers": "60", "elk.spacing.edgeNode": "18", "elk.spacing.edgeEdge": "12", "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX", "elk.padding": "[top=20,left=20,bottom=20,right=20]" },
    children,
    edges: flows.map((flow, index) => ({ id: `flow${index}`, sources: [flow.source], targets: [flow.target] })),
  };
  const laid = await new ELK().layout(graph);
  if (laid.width === undefined || laid.height === undefined) throw new Error(`ELK 没有布置组合图 ${diagram.module}`);
  let body = '<g transform="translate(28,95)">';
  for (const [index, edge] of (laid.edges ?? []).entries()) body += flowPath(edge, flows[index]!.kind);
  const placed = new Map((laid.children ?? []).map((child) => [child.id, child]));
  for (const node of diagram.nodes) {
    if (node.kind === "contract") continue;
    const at = placed.get(key(node.kind, node.id));
    if (!at || at.x === undefined || at.y === undefined || at.width === undefined || at.height === undefined) throw new Error(`ELK 没有布置 ${node.kind} ${node.id}`);
    const { x, y, width, height } = at;
    switch (node.kind) {
      case "step": {
        const lines = callLines(node.id);
        body += `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="8" fill="#eef4fa" stroke="${BEHAVIOR}" stroke-width="2"/>`;
        if (lines.length === 0) { body += text(x + width / 2, y + height / 2 + 5, [node.id], "middle", 14, "bold"); break; }
        body += text(x + width / 2, y + 22, [node.id], "middle", 14, "bold") + `<line x1="${x}" x2="${x + width}" y1="${y + 32}" y2="${y + 32}" stroke="${BEHAVIOR}" stroke-opacity="0.35"/>`;
        lines.forEach(({ kind, line }, i) => { body += text(x + 14, y + 50 + i * 16, [line], "start", 12, kind === "call" ? "bold" : "normal", CONTRACT); });
        break;
      }
      case "wire":
        body += `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${Math.min(15, height / 2)}" fill="#fff" stroke="${MUTED}" stroke-width="1.4"/>${text(x + width / 2, y + 19, [node.id], "middle", 13, "bold")}`;
        body += `<text x="${x + width / 2}" y="${y + 36}" text-anchor="middle" font-size="11" fill="${MUTED}">${typeLines(node).map((line, i) => `<tspan x="${x + width / 2}" dy="${i === 0 ? 0 : 17}">${esc(line)}</tspan>`).join("")}</text>`;
        break;
      default: assertNever(node);
    }
  }
  if (children.length === 0) body += text(20, 30, ["No steps or wires"]);
  body += "</g>";
  const height = Math.max(laid.height + 210, 330);
  const legend = `<rect x="28" y="${height - 48}" width="20" height="16" rx="4" fill="#eef4fa" stroke="${BEHAVIOR}"/>${text(58, height - 34, ["Step · action in step"], "start", 12)}`
    + `<rect x="230" y="${height - 48}" width="26" height="16" rx="8" fill="#fff" stroke="${MUTED}"/>${text(266, height - 34, ["Wire · var : type"], "start", 12)}`
    + `<path d="M420,${height - 40} h35" stroke="${MUTED}" marker-end="url(#arrow)"/>${text(465, height - 34, ["Take / Put"], "start", 12)}`
    + `<path d="M560,${height - 40} h35" stroke="${MUTED}" marker-start="url(#arrow)" marker-end="url(#arrow)"/>${text(605, height - 34, ["Update · reads and writes"], "start", 12)}`
    + `<circle cx="800" cy="${height - 40}" r="3.5" fill="${MUTED}"/>${text(812, height - 34, ["Shared wire"], "start", 12)}`
    + text(920, height - 34, ["calls box.operation"], "start", 12, "bold", CONTRACT) + text(1060, height - 34, ["reads box · feedback"], "start", 12, "normal", CONTRACT);
  return frame(`Composition · ${diagram.module}`, "Steps as boxes, behavior variables as wires; contract calls and reads listed in the step that makes them", Math.max(laid.width + 56, 1240), height, body, legend);
}

const C4_STYLE: Readonly<Record<C4NodeKind, { readonly notation: string; readonly fill: string; readonly stroke: string; readonly ink: string; readonly sub: string }>> = {
  person: { notation: "Person", fill: "#08427b", stroke: "#052e56", ink: "#ffffff", sub: "#cfe0f1" },
  system: { notation: "Software System", fill: "#1168bd", stroke: "#0b4884", ink: "#ffffff", sub: "#d6e6f6" },
  external: { notation: "External Software System", fill: "#8b8f94", stroke: "#6b6f74", ink: "#ffffff", sub: "#eef0f2" },
  container: { notation: "Container", fill: "#438dd5", stroke: "#2e6faf", ink: "#ffffff", sub: "#e6f0fa" },
  store: { notation: "Container: Data Store", fill: "#438dd5", stroke: "#2e6faf", ink: "#ffffff", sub: "#e6f0fa" },
  component: { notation: "Component", fill: "#85bbf0", stroke: "#5d9bd6", ink: "#0b2540", sub: "#1f4468" },
};
const C4_NODE_WIDTH = 248, C4_PERSON_HEAD = 30, C4_STORE_CAP = 12;

interface C4NodeText { readonly title: string[]; readonly type: string; readonly description: string[]; readonly height: number }
function c4NodeText(node: C4DiagramNode): C4NodeText {
  const style = C4_STYLE[node.kind];
  const title = sizedWrap(node.title, C4_NODE_WIDTH - 28, 15);
  const type = `[${style.notation}${node.technology ? `: ${node.technology}` : ""}]`;
  const description = node.description ? sizedWrap(node.description, C4_NODE_WIDTH - 28, 13) : [];
  return { title, type, description, height: c4Head(node.kind) + 22 + title.length * 20 + 18 + (description.length ? 8 + description.length * 18 : 0) + 14 + (node.kind === "store" ? C4_STORE_CAP : 0) };
}

/** 形状在文字上方占去的高度：人的头、数据存储圆柱的顶面。 */
function c4Head(kind: C4NodeKind): number {
  return kind === "person" ? C4_PERSON_HEAD : kind === "store" ? 2 * C4_STORE_CAP : 0;
}

function cylinder(x: number, y: number, width: number, height: number, cap: number, paint: string): string {
  const rx = width / 2;
  return `<path d="M${x},${y + cap} A${rx},${cap} 0 0 1 ${x + width},${y + cap} V${y + height - cap} A${rx},${cap} 0 0 1 ${x},${y + height - cap} Z" ${paint}/><ellipse cx="${x + rx}" cy="${y + cap}" rx="${rx}" ry="${cap}" ${paint}/>`;
}

function c4Shape(node: C4DiagramNode, x: number, y: number, width: number, height: number): string {
  const style = C4_STYLE[node.kind];
  const paint = `fill="${style.fill}" stroke="${style.stroke}" stroke-width="1.5"`;
  switch (node.kind) {
    case "person": {
      const bodyTop = y + C4_PERSON_HEAD;
      return `<rect x="${x}" y="${bodyTop}" width="${width}" height="${height - C4_PERSON_HEAD}" rx="22" ${paint}/><circle cx="${x + width / 2}" cy="${y + 17}" r="17" ${paint}/>`;
    }
    case "system": case "external": case "container":
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="8" ${paint}${node.kind === "external" ? ' stroke-dasharray="6 3"' : ""}/>`;
    case "store":
      return cylinder(x, y, width, height, C4_STORE_CAP, paint);
    case "component":
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="4" ${paint}/>`;
    default: return assertNever(node.kind);
  }
}

function c4NodeBody(node: C4DiagramNode, x: number, y: number, width: number): string {
  const style = C4_STYLE[node.kind], content = c4NodeText(node), cx = x + width / 2;
  let top = y + c4Head(node.kind) + (node.kind === "person" ? 4 : 0) + 24;
  let out = text(cx, top, content.title, "middle", 15, "bold", style.ink);
  top += (content.title.length - 1) * 20 + 19;
  out += text(cx, top, [content.type], "middle", 11.5, "normal", style.sub);
  if (content.description.length) out += text(cx, top + 24, content.description, "middle", 13, "normal", style.ink);
  return out;
}

type Rect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
const overlaps = (a: Rect, b: Rect, gap = 3): boolean => a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;

/**
 * ELK 把居中标签放在线旁，标签与线的对应靠目测。这里把每个标签压到它自己那段竖线的正中；
 * 与已放好的标签或节点相撞时沿这段竖线上下滑动，整段都放不下才退回 ELK 给的线旁位置。
 */
function placeLabels(edges: readonly ElkExtendedEdge[], obstacles: readonly Rect[]): (Rect | null)[][] {
  const placed: Rect[] = [];
  return edges.map((edge) => (edge.labels ?? []).map((label) => {
    if (label.x === undefined || label.y === undefined || label.width === undefined || label.height === undefined) return null;
    const width = label.width, height = label.height, mid = label.y + height / 2;
    const free = (r: Rect): boolean => !placed.some((p) => overlaps(p, r)) && !obstacles.some((o) => overlaps(o, r, 0));
    let chosen: Rect | null = null;
    for (const points of sectionPoints(edge)) {
      for (let i = 1; i < points.length && !chosen; i++) {
        const a = points[i - 1]!, b = points[i]!;
        if (Math.abs(a.x - b.x) >= 0.5 || mid < Math.min(a.y, b.y) || mid > Math.max(a.y, b.y)) continue;
        const top = Math.min(a.y, b.y) + 6, bottom = Math.max(a.y, b.y) - height - 16, step = height + 6;
        for (let k = 0; k <= 8 && !chosen; k++) {
          for (const y of k === 0 ? [label.y] : [label.y - k * step, label.y + k * step]) {
            const r = { x: a.x - width / 2, y, width, height };
            if (y >= top && y <= bottom && free(r)) { chosen = r; break; }
          }
        }
      }
    }
    chosen ??= { x: label.x, y: label.y, width, height };
    placed.push(chosen);
    return chosen;
  }));
}

export async function c4Svg(diagram: C4Diagram): Promise<DiagramSvg> {
  const { ELK } = await loadDiagramTools();
  const byId = new Map(diagram.nodes.map((node) => [node.id, node]));
  const childrenOf = (container: string | null): ElkNode[] => [
    ...diagram.groups.filter((group) => group.parent === container).map((group): ElkNode => ({
      id: group.id,
      layoutOptions: { "elk.padding": "[top=44,left=22,bottom=22,right=22]" },
      children: diagram.nodes.filter((node) => node.group === group.id).map(elkNode),
    })),
    ...diagram.nodes.filter((node) => node.parent === container && node.group === null).map(elkNode),
  ];
  function elkNode(node: C4DiagramNode): ElkNode {
    const partition: Record<string, string> = node.parent === null ? { "elk.partitioning.partition": node.kind === "person" ? "0" : "1" } : {};
    if (node.boundary) return { id: node.id, layoutOptions: { ...partition, "elk.padding": "[top=52,left=26,bottom=26,right=26]" }, children: childrenOf(node.id) };
    return { id: node.id, width: C4_NODE_WIDTH, height: c4NodeText(node).height, layoutOptions: partition };
  }
  const labelLines = diagram.edges.map((edge) => edge.label ? sizedWrap(edge.label, 150, 12) : ["[...]"]);
  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered", "elk.direction": "DOWN", "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeRouting": "ORTHOGONAL", "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.partitioning.activate": "true", "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.spacing.nodeNode": "56", "elk.layered.spacing.nodeNodeBetweenLayers": "72", "elk.spacing.edgeNode": "26",
      "elk.spacing.edgeEdge": "16", "elk.layered.spacing.edgeNodeBetweenLayers": "26", "elk.layered.spacing.edgeEdgeBetweenLayers": "14",
      "elk.spacing.edgeLabel": "4", "elk.edgeLabels.placement": "CENTER", "elk.edgeLabels.inline": "true",
      "elk.json.shapeCoords": "ROOT", "elk.json.edgeCoords": "ROOT", "elk.padding": "[top=10,left=10,bottom=10,right=10]",
    },
    children: childrenOf(null),
    edges: diagram.edges.map((edge, index) => {
      const lines = labelLines[index]!;
      return { id: `edge${index}`, sources: [edge.source], targets: [edge.target], labels: [{ id: `label${index}`, text: lines.join("\n"), width: Math.max(...lines.map((line) => sizedWidth(line, 12))) + 14, height: lines.length * 16 + 8 }] };
    }),
  };
  const laid = await new ELK().layout(graph);
  if (laid.width === undefined || laid.height === undefined) throw new Error(`ELK 没有布置视图 ${diagram.view}`);
  const placed = new Map<string, ElkNode>();
  const collect = (node: ElkNode): void => { placed.set(node.id, node); for (const child of node.children ?? []) collect(child); };
  collect(laid);
  const box = (id: string): { x: number; y: number; width: number; height: number } => {
    const at = placed.get(id);
    if (!at || at.x === undefined || at.y === undefined || at.width === undefined || at.height === undefined) throw new Error(`ELK 没有布置 ${id}`);
    return { x: at.x, y: at.y, width: at.width, height: at.height };
  };
  let frames = "", edges = "", nodes = "", labels = "";
  const depth = (id: string): number => { let d = 0, p = byId.get(id)?.parent ?? null; while (p !== null) { d++; p = byId.get(p)?.parent ?? null; } return d; };
  for (const node of [...diagram.nodes].filter((n) => n.boundary).sort((a, b) => depth(a.id) - depth(b.id))) {
    const { x, y, width, height } = box(node.id);
    frames += `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="10" fill="#f6f9fc" stroke="#5b6b7c" stroke-width="1.6" stroke-dasharray="9 5"/>`;
    frames += text(x + 16, y + 26, [node.title], "start", 15, "bold", "#26323f") + text(x + 16 + sizedWidth(node.title, 15) + 10, y + 26, [`[${C4_STYLE[node.kind].notation}${node.technology ? `: ${node.technology}` : ""}]`], "start", 12, "normal", MUTED);
  }
  for (const group of diagram.groups) {
    const { x, y, width, height } = box(group.id);
    frames += `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="8" fill="#eef2f6" fill-opacity="0.65" stroke="#7d8b99" stroke-width="1.3" stroke-dasharray="3 4"/>`;
    frames += text(x + 14, y + 24, [group.name], "start", 13, "bold", "#3b4754") + text(x + 14 + sizedWidth(group.name, 13) + 8, y + 24, ["[Group]"], "start", 11.5, "normal", MUTED);
  }
  const leaves = diagram.nodes.filter((n) => !n.boundary);
  const labelBoxes = placeLabels(laid.edges ?? [], leaves.map((n) => box(n.id)));
  for (const [index, edge] of (laid.edges ?? []).entries()) {
    for (const points of sectionPoints(edge)) edges += `<path d="${roundedPath(points, 12)}" fill="none" stroke="#5d6b78" stroke-width="1.6" stroke-dasharray="7 4" marker-end="url(#arrow)"/>`;
    for (const r of labelBoxes[index] ?? []) {
      if (!r) continue;
      labels += `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="4" fill="#ffffff" stroke="#c9d1d9"/>`;
      labels += text(r.x + r.width / 2, r.y + 16, labelLines[index]!, "middle", 12, "normal", "#2b3640");
    }
  }
  for (const node of leaves) {
    const { x, y, width, height } = box(node.id);
    nodes += c4Shape(node, x, y, width, height) + c4NodeBody(node, x, y, width);
  }
  const height = laid.height + 95 + 110;
  const kinds = [...new Set(diagram.nodes.filter((n) => !n.boundary).map((n) => n.kind))];
  let legendX = 28, legend = "";
  const legendItem = (swatch: string, label: string): void => {
    legend += swatch + text(legendX + 30, height - 32, [label], "start", 12);
    legendX += 30 + sizedWidth(label, 12) + 34;
  };
  for (const kind of kinds) {
    const swatchPaint = `fill="${C4_STYLE[kind].fill}" stroke="${C4_STYLE[kind].stroke}"`;
    const swatch = kind === "store"
      ? cylinder(legendX, height - 47, 22, 20, 4, swatchPaint)
      : `<rect x="${legendX}" y="${height - 45}" width="22" height="16" rx="3" ${swatchPaint}${kind === "external" ? ' stroke-dasharray="4 2"' : ""}/>`;
    legendItem(swatch, C4_STYLE[kind].notation);
  }
  if (diagram.nodes.some((n) => n.boundary)) legendItem(`<rect x="${legendX}" y="${height - 45}" width="22" height="16" rx="3" fill="#f6f9fc" stroke="#5b6b7c" stroke-dasharray="4 2"/>`, "Boundary · element opened in this view");
  if (diagram.groups.length) legendItem(`<rect x="${legendX}" y="${height - 45}" width="22" height="16" rx="3" fill="#eef2f6" stroke="#7d8b99" stroke-dasharray="2 2"/>`, "Group");
  legendItem(`<path d="M${legendX},${height - 37} h22" stroke="#5d6b78" stroke-width="1.6" stroke-dasharray="5 3" marker-end="url(#arrow)"/>`, "Call · initiator → callee");
  return frame(diagram.title, diagram.description, Math.max(laid.width + 56, legendX + 28), height, `<g transform="translate(28,95)">${frames}${edges}${nodes}${labels}</g>`, legend);
}

const TIER_STYLE: Readonly<Record<LayerTier, { readonly name: string; readonly band: string; readonly fill: string; readonly stroke: string }>> = {
  business: { name: "Business", band: "#fff7ec", fill: "#fde9cf", stroke: "#c9761f" },
  architecture: { name: "Architecture", band: "#f2f7fd", fill: "#dfeaf8", stroke: "#2e6faf" },
  store: { name: "Data store", band: "#f0f8f2", fill: "#dcefe2", stroke: "#2f7d4f" },
};

export async function layersSvg(diagram: LayersDiagram): Promise<DiagramSvg> {
  const { ELK } = await loadDiagramTools();
  const width = 260, height = 74, gutter = 150;
  const labelLines = diagram.imports.map((i) => sizedWrap(i.names.join(", "), 170, 12));
  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered", "elk.direction": "DOWN", "elk.edgeRouting": "ORTHOGONAL", "elk.partitioning.activate": "true",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX", "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.spacing.nodeNode": "48", "elk.layered.spacing.nodeNodeBetweenLayers": "84", "elk.spacing.edgeNode": "24", "elk.spacing.edgeEdge": "14",
      "elk.edgeLabels.placement": "CENTER", "elk.padding": "[top=26,left=20,bottom=26,right=20]",
    },
    children: diagram.modules.map((m) => ({ id: m.module, width, height, layoutOptions: { "elk.partitioning.partition": String(TIER_ORDER.indexOf(m.tier)) } })),
    edges: diagram.imports.map((i, index) => {
      const lines = labelLines[index]!;
      return { id: `import${index}`, sources: [i.from], targets: [i.to], labels: [{ id: `names${index}`, text: lines.join("\n"), width: Math.max(...lines.map((line) => sizedWidth(line, 12))) + 14, height: lines.length * 16 + 8 }] };
    }),
  };
  const laid = await new ELK().layout(graph);
  if (laid.width === undefined || laid.height === undefined) throw new Error("ELK 没有布置契约分层图");
  const placed = new Map((laid.children ?? []).map((child) => [child.id, child]));
  const at = (module: string): Rect => {
    const n = placed.get(module);
    if (!n || n.x === undefined || n.y === undefined) throw new Error(`ELK 没有布置模块 ${module}`);
    return { x: n.x + gutter, y: n.y, width, height };
  };
  const totalWidth = laid.width + gutter;
  let bands = "", edges = "", nodes = "", labels = "";
  for (const tier of TIER_ORDER) {
    const members = diagram.modules.filter((m) => m.tier === tier).map((m) => at(m.module));
    if (members.length === 0) continue;
    const top = Math.min(...members.map((r) => r.y)) - 18, bottom = Math.max(...members.map((r) => r.y + r.height)) + 18;
    bands += `<rect x="0" y="${top}" width="${totalWidth}" height="${bottom - top}" rx="8" fill="${TIER_STYLE[tier].band}" stroke="${TIER_STYLE[tier].stroke}" stroke-opacity="0.35"/>`;
    bands += text(16, top + 26, [TIER_STYLE[tier].name], "start", 14, "bold", TIER_STYLE[tier].stroke);
  }
  const shifted = (laid.edges ?? []).map((edge) => ({
    ...edge,
    sections: (edge.sections ?? []).map((s) => ({ ...s, startPoint: { x: s.startPoint.x + gutter, y: s.startPoint.y }, endPoint: { x: s.endPoint.x + gutter, y: s.endPoint.y }, bendPoints: s.bendPoints?.map((p) => ({ x: p.x + gutter, y: p.y })) })),
    labels: (edge.labels ?? []).map((l) => ({ ...l, x: (l.x ?? 0) + gutter })),
  }));
  const labelBoxes = placeLabels(shifted, diagram.modules.map((m) => at(m.module)));
  for (const [index, edge] of shifted.entries()) {
    for (const points of sectionPoints(edge)) edges += `<path d="${roundedPath(points, 12)}" fill="none" stroke="#5d6b78" stroke-width="1.6" marker-end="url(#arrow)"/>`;
    for (const r of labelBoxes[index] ?? []) {
      if (!r) continue;
      labels += `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="4" fill="#ffffff" stroke="#c9d1d9"/>`;
      labels += text(r.x + r.width / 2, r.y + 16, labelLines[index]!, "middle", 12, "normal", "#2b3640");
    }
  }
  for (const m of diagram.modules) {
    const r = at(m.module), style = TIER_STYLE[m.tier];
    nodes += `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="8" fill="${style.fill}" stroke="${style.stroke}" stroke-width="1.6"/>`;
    nodes += text(r.x + r.width / 2, r.y + 28, [m.module], "middle", 14, "bold");
    nodes += text(r.x + r.width / 2, r.y + 50, [`${m.title} · ${m.element}`], "middle", 12, "normal", MUTED);
  }
  if (diagram.modules.length === 0) nodes += text(20, 30, ["No contract modules"]);
  const height2 = laid.height + 95 + 110;
  let legendX = 28, legend = "";
  for (const tier of TIER_ORDER) {
    legend += `<rect x="${legendX}" y="${height2 - 45}" width="22" height="16" rx="3" fill="${TIER_STYLE[tier].fill}" stroke="${TIER_STYLE[tier].stroke}"/>` + text(legendX + 30, height2 - 32, [TIER_STYLE[tier].name], "start", 12);
    legendX += 30 + sizedWidth(TIER_STYLE[tier].name, 12) + 34;
  }
  legend += `<path d="M${legendX},${height2 - 37} h22" stroke="#5d6b78" stroke-width="1.6" marker-end="url(#arrow)"/>` + text(legendX + 30, height2 - 32, ["Import · importer → imported, names imported"], "start", 12);
  return frame("Contract layers", "Who imports whose definitions: imported modules sit lower; business above architecture; data stores deepest", totalWidth + 56, height2, `<g transform="translate(28,95)">${bands}${edges}${nodes}${labels}</g>`, legend);
}

export async function screenshotSvg(browser: Browser, image: DiagramSvg, path: string): Promise<void> {
  const page = await browser.newPage({ viewport: { width: image.width, height: image.height }, deviceScaleFactor: 2 });
  try {
    await page.setContent(`<html><body style="margin:0">${image.svg}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path, fullPage: true });
  } finally {
    await page.close();
  }
}
