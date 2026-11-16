import type { ElkExtendedEdge, ElkNode, ElkPort } from "elkjs/lib/elk-api";
import type { Browser } from "playwright-core";
import { assertNever } from "../diag";
import { loadDiagramTools } from "../install";
import type { POStatus, VdmSample } from "../compile/vdm";
import type { Access, AccessRow, AccessTable } from "./access";
import type { BoxDiagram, BoxObligation, BoxPredicate } from "./box";
import type { BoxDrills, CompositionDrills, Drill, DrillKind } from "./drill";
import type { PropertiesDiagram, PropertyCard, WiringSummary } from "./wiring";
import type { TypeNode, TypeShape, TypesDiagram } from "./types";
import type { C4Diagram, C4DiagramNode, C4NodeKind } from "./c4";
import type { CompositionDiagram, CompositionNode } from "./composition";
import { type LayerTier, type LayersDiagram, TIER_ORDER } from "./layers";
import { type Point, type Rect, type RouteBox, type RouteRequest, routeCost, routeEdges } from "./route";
import { type NodeIcon, loadIcons, nodeIcon } from "./icon";

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
/** 图例每行的高度；图例在图底，legendRows 行，最后一行的文字基线在 height - 32。 */
const LEGEND_ROW = 28;
function frame(title: string, subtitle: string, width: number, height: number, body: string, legend: string, legendRows = 1): DiagramSvg {
  const w = Math.ceil(Math.max(width, 860)), h = Math.ceil(height), rule = h - 65 - (legendRows - 1) * LEGEND_ROW;
  return { width: w, height: h, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Arial, sans-serif" font-size="14"><defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto-start-reverse"><path d="M0,0 L9,4.5 L0,9 z" fill="${MUTED}"/></marker></defs><rect width="100%" height="100%" fill="#fff"/>${text(28, 34, [title], "start", 21, "bold")}${text(28, 59, [subtitle], "start", 14)}${body}<line x1="28" x2="${w - 28}" y1="${rule}" y2="${rule}" stroke="#dde1e5"/>${legend}</svg>` };
}
function flowPath(edge: ElkExtendedEdge, kind: "flow" | "update"): string {
  const markers = kind === "update" ? 'marker-start="url(#arrow)" marker-end="url(#arrow)"' : 'marker-end="url(#arrow)"';
  return sectionPoints(edge).map((points) => `<path d="${roundedPath(points, 8)}" fill="none" stroke="${MUTED}" stroke-width="1.7" ${markers}/>`).join("")
    + (edge.junctionPoints ?? []).map((point) => `<circle cx="${point.x}" cy="${point.y}" r="3.5" fill="${MUTED}"/>`).join("");
}

/** 证明义务的状态色：可证（绿）、采样没找到反例但未证（黄）、找到反例（红）、未检查（灰）。 */
const PO_STYLE: Readonly<Record<POStatus, { readonly color: string; readonly name: string }>> = {
  PROVABLE: { color: "#2e9e5b", name: "provable" },
  MAYBE: { color: "#d99a1e", name: "maybe" },
  FAILED: { color: "#d63a3a", name: "failed" },
  UNPROVED: { color: "#8a96a3", name: "unproved" },
  UNCHECKED: { color: "#b9c1c9", name: "unchecked" },
};
const PO_ORDER: readonly POStatus[] = ["FAILED", "MAYBE", "UNPROVED", "UNCHECKED", "PROVABLE"];
/** 证明义务的计数，如 `2 maybe · 1 provable`；没有义务时为 `no obligations`。 */
export function obligationTally(obligations: readonly BoxObligation[]): string {
  const parts = PO_ORDER.flatMap((s) => { const n = obligations.filter((o) => o.status === s).length; return n > 0 ? [`${n} ${PO_STYLE[s].name}`] : []; });
  return parts.length > 0 ? parts.join(" · ") : "no obligations";
}
/** 采样计数，如 `sampled 128: 122 true, 6 false`。 */
export const sampleText = (s: VdmSample): string => `sampled ${s.trueCount + s.falseCount}: ${s.trueCount} true, ${s.falseCount} false`;
const PO_DOT = 13;
const obligationRowWidth = (obligations: readonly BoxObligation[]): number =>
  obligations.length * PO_DOT + (obligations.length > 0 ? 6 : 0) + sizedWidth(obligationTally(obligations), 11.5);
/** 一排状态色点（按义务编号排），每个点悬停显示编号、种类与状态；右端是计数。y 是文字基线。 */
function obligationRow(x: number, y: number, obligations: readonly BoxObligation[]): string {
  const sorted = [...obligations].sort((a, b) => a.number - b.number);
  const dots = sorted.map((o, i) => `<circle cx="${x + 5 + i * PO_DOT}" cy="${y - 4}" r="5" fill="${PO_STYLE[o.status].color}"><title>PO ${o.number} · ${o.kind} · ${o.status}</title></circle>`).join("");
  return dots + text(x + sorted.length * PO_DOT + (sorted.length > 0 ? 6 : 0), y, [obligationTally(obligations)], "start", 11.5, "normal", MUTED);
}

/** 契约文字的一行。label 是行首的粗体标签（pre、post…），text 从 indent 处起；mono 时 text 用等宽字体（VDM 表达式）。 */
interface CodeLine { readonly label: string | null; readonly text: string; readonly size: number; readonly weight: "normal" | "bold"; readonly fill: string; readonly mono: boolean; readonly indent: number }
const plainLine = (text: string, size: number, weight: "normal" | "bold" = "normal", fill = INK): CodeLine => ({ label: null, text, size, weight, fill, mono: false, indent: 0 });
const lineLead = (line: CodeLine): number => Math.round(line.size + 7);
const linesHeight = (lines: readonly CodeLine[]): number => lines.reduce((h, l) => h + lineLead(l), 0);
/** y 是第一行的顶；逐行按各自的行距往下排。 */
function codeLines(x: number, y: number, lines: readonly CodeLine[]): string {
  let svg = "", at = y;
  for (const line of lines) {
    at += lineLead(line);
    if (line.label !== null) svg += text(x, at - 6, [line.label], "start", line.size, "bold", CONTRACT);
    const t = text(x + line.indent, at - 6, [line.text], "start", line.size, line.weight, line.fill);
    svg += line.mono ? `<g font-family="Menlo, Consolas, monospace">${t}</g>` : t;
  }
  return svg;
}
const PREDICATE_LABEL = 54;
/** pre、post、inv 或 initial：标签与等宽折行的表达式同起一行，有采样时下一行是采样计数。 */
function predicateBlock(label: string, p: BoxPredicate, width: number): CodeLine[] {
  return [
    ...sizedWrap(p.text, width - PREDICATE_LABEL, 12).map((t, i): CodeLine => ({ label: i === 0 ? label : null, text: t, size: 12, weight: "normal", fill: INK, mono: true, indent: PREDICATE_LABEL })),
    ...(p.sample !== null ? [{ ...plainLine(sampleText(p.sample), 11, "normal", MUTED), indent: PREDICATE_LABEL }] : []),
  ];
}

const DRILL_STYLE: Readonly<Record<DrillKind, { readonly label: string; readonly fill: string; readonly legend: string }>> = {
  view: { label: "Sub-view", fill: "#1168bd", legend: "opens the element's own view" },
  box: { label: "Contract box", fill: CONTRACT, legend: "opens the element's contract box" },
  promises: { label: "Promises", fill: CONTRACT, legend: "opens pre / post / inv and their checks" },
  types: { label: "Types", fill: CONTRACT, legend: "opens the type diagram" },
  access: { label: "Read / write", fill: CONTRACT, legend: "opens the read / write table" },
  wiring: { label: "Wiring", fill: BEHAVIOR, legend: "opens the wiring diagram" },
  properties: { label: "Properties", fill: BEHAVIOR, legend: "opens safety and coverage targets" },
};
const DRILL_HEIGHT = 20;
const drillWidth = (kind: DrillKind): number => Math.round(sizedWidth(DRILL_STYLE[kind].label, 11) + 30);
/** 下钻标注的外形：带种类名与 ▸ 的圆角牌，左上角在 (x, y)。 */
function drillShape(x: number, y: number, kind: DrillKind): string {
  const style = DRILL_STYLE[kind], w = drillWidth(kind);
  return `<rect x="${x}" y="${y}" width="${w}" height="${DRILL_HEIGHT}" rx="10" fill="${style.fill}" stroke="#fff" stroke-width="1.5"/>`
    + text(x + 10, y + 14, [style.label], "start", 11, "bold", "#fff")
    + `<path d="M${x + w - 15},${y + 6} l4,4 l-4,4" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
}
/** 下钻标注的属性：of 是标注所属的节点；双击节点时打开它 primary 的那一枚。 */
const drillAttrs = (d: Drill, of: string, primary: boolean): string =>
  `class="drill" data-open="${esc(d.diagram)}"${d.node !== null ? ` data-open-node="${esc(d.node)}"` : ""} data-of="${esc(of)}"${primary ? ' data-primary=""' : ""}`;
/** 一枚下钻标注，右缘在 right，竖直居中于 cy。 */
function drillPill(right: number, cy: number, d: Drill, of: string, primary: boolean): string {
  return `<g ${drillAttrs(d, of, primary)}><title>Open ${esc(DRILL_STYLE[d.kind].label)}</title>${drillShape(right - drillWidth(d.kind), cy - DRILL_HEIGHT / 2, d.kind)}</g>`;
}
interface LegendEntry { readonly swatch: number; readonly label: string; readonly draw: (x: number, base: number) => string }
const drillLegend = (kind: DrillKind): LegendEntry => ({ swatch: drillWidth(kind) + 8, label: DRILL_STYLE[kind].legend, draw: (x, base) => drillShape(x, base - 15, kind) });
const linkLegend = (sample: string, label: string): LegendEntry => ({
  swatch: sizedWidth(sample, 13) + 10, label,
  draw: (x, base) => `<text x="${x}" y="${base}" font-size="13" fill="${CONTRACT}" text-decoration="underline">${esc(sample)}</text>`,
});
const typeLinkLegend = linkLegend("Type", "underlined type · opens it in the type diagram");
/** 图例一行排一组项；rows 行里第 r 行的基线在 height - 32 - (rows - 1 - r) * LEGEND_ROW。 */
function legendRow(entries: readonly LegendEntry[], base: number): string {
  let x = 28, svg = "";
  for (const e of entries) { svg += e.draw(x, base) + text(x + e.swatch, base, [e.label], "start", 12); x += e.swatch + sizedWidth(e.label, 12) + 34; }
  return svg;
}
const legendRowWidth = (entries: readonly LegendEntry[]): number => entries.reduce((w, e) => w + e.swatch + sizedWidth(e.label, 12) + 34, 28);

/** 文字里出现的名字（类型、契约模块、端口）画成带下划线的下钻链接；links 给出一个名字的去处，不是链接时为 null。 */
function linkedText(x: number, y: number, lines: readonly string[], anchor: "start" | "end", size: number, links: (name: string) => Drill | null, of: string, weight: "normal" | "bold" = "normal", fill = INK): string {
  const lead = Math.round(size * 1.36);
  const spans = lines.map((line, index) => {
    const inner = line.split(/([A-Za-z_][A-Za-z0-9_]*)/).map((part) => {
      const d = part === "" ? null : links(part);
      return d === null ? esc(part) : `<tspan ${drillAttrs(d, of, false)} fill="${CONTRACT}" text-decoration="underline">${esc(part)}</tspan>`;
    }).join("");
    return `<tspan x="${x}" dy="${index === 0 ? 0 : lead}">${inner}</tspan>`;
  }).join("");
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" font-weight="${weight}" fill="${fill}">${spans}</text>`;
}

const BOX_LABEL_GAP = 14, PORT_HEAD = 30, PORT_EXT = 19, PORT_PAD = 10;
/**
 * 契约盒子图只画盒子这一层：端口、线、反馈线、每个端口读写的分量与证明义务的状态色。
 * 下面一层由标注打开：端口与状态的“Promises”打开承诺图，状态的“Read / write”打开读写表，线上与状态里带下划线的类型名打开类型图。
 */
export async function boxSvg(diagram: BoxDiagram, drills: BoxDrills): Promise<DiagramSvg> {
  const { ELK } = await loadDiagramTools();
  const typeLink = (name: string): Drill | null => {
    const id = drills.typeIds.get(name);
    return id === undefined ? null : { kind: "types", diagram: drills.types, node: id };
  };
  const promises = (node: string): Drill => ({ kind: "promises", diagram: drills.promises, node });
  const portWidth = (port: BoxDiagram["ports"][number]): number =>
    widthOf(`${port.name}  · op`) + 24 + obligationRowWidth(port.obligations) + 12 + drillWidth("promises") + 28;
  const stateDrills: Drill[] = diagram.state ? [...(drills.access !== null ? [{ kind: "access", diagram: drills.access, node: null } as const] : []), promises(`state:${diagram.state.name}`)] : [];
  const panelPills = stateDrills.reduce((w, d) => w + drillWidth(d.kind) + 8, 0);
  const boxWidth = Math.ceil(Math.max(360, ...diagram.ports.map(portWidth), ...(diagram.state ? [...diagram.state.fields.map((f) => widthOf(f) + 96), widthOf(`${diagram.state.name} · state`) + panelPills + 120] : [])));
  const blockHeight = (port: BoxDiagram["ports"][number]): number => PORT_HEAD + (port.ext ? PORT_EXT : 0) + PORT_PAD;
  const offsets = diagram.ports.reduce<number[]>((out, _, i) => [...out, i === 0 ? 8 : out[i - 1]! + blockHeight(diagram.ports[i - 1]!)], []);
  const anchor = (index: number): number => offsets[index]! + 20;
  const boxHeight = Math.max(80, diagram.ports.reduce((h, p) => h + blockHeight(p), 0) + 16);
  const graph: ElkNode = {
    id: "root", layoutOptions: { "elk.algorithm": "layered", "elk.direction": "RIGHT", "elk.edgeRouting": "ORTHOGONAL", "elk.spacing.nodeNode": "28", "elk.layered.spacing.nodeNodeBetweenLayers": "64", "elk.padding": "[top=12,left=12,bottom=12,right=12]" },
    children: [{ id: "box", width: boxWidth, height: boxHeight, layoutOptions: { "elk.portConstraints": "FIXED_POS" }, ports: diagram.ports.flatMap((_, index) => [
      { id: `in${index}`, x: 0, y: anchor(index), width: 0, height: 0, layoutOptions: { "elk.port.side": "WEST" } },
      { id: `out${index}`, x: boxWidth, y: anchor(index), width: 0, height: 0, layoutOptions: { "elk.port.side": "EAST" } },
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
  // 状态画在反馈环上：名字、分量与它的义务；inv 与初值在承诺图里。
  const panelWidth = boxWidth - 72;
  const panelHeight = diagram.state ? 34 + diagram.state.fields.length * 19 + (diagram.state.obligations.length > 0 ? 26 : 0) + 10 : 0;
  const feedbackHeight = panelHeight + 25;
  const top = 100 + (diagram.state ? feedbackHeight : 0);
  let body = `<g transform="translate(28,${top})">`, pills = "";
  // 边按 incoming0, outgoing0, incoming1, … 排列：第 i 条属于第 ⌊i/2⌋ 个端口。
  for (const [index, edge] of (laid.edges ?? []).entries()) {
    const port = esc(diagram.ports[Math.floor(index / 2)]!.name);
    body += `<g data-edge="${index}" data-source="${port}" data-target="${port}">${flowPath(edge, "flow")}</g>`;
  }
  body += `<rect x="${box.x}" y="${box.y}" width="${boxWidth}" height="${boxHeight}" rx="9" fill="#f2eff8" stroke="${CONTRACT}" stroke-width="2"/>`;
  if (diagram.state) {
    const x = box.x, y = box.y, py = y - feedbackHeight - 10, id = `state:${diagram.state.name}`;
    body += `<path d="M${x + boxWidth - 24},${y} V${y - feedbackHeight} H${x + 24} V${y}" fill="none" stroke="${MUTED}" stroke-width="1.7" marker-end="url(#arrow)"/>`;
    body += `<g data-node="${esc(id)}"><rect x="${x + 36}" y="${py}" width="${panelWidth}" height="${panelHeight}" rx="6" fill="#fff" stroke="#d5d9de"/>`;
    body += text(x + 50, py + 24, [`${diagram.state.name} · state`], "start", 14, "bold");
    diagram.state.fields.forEach((field, i) => { body += linkedText(x + 50, py + 46 + i * 19, [field], "start", 13, typeLink, id); });
    if (diagram.state.obligations.length > 0) body += obligationRow(x + 50, py + panelHeight - 14, diagram.state.obligations);
    body += "</g>";
    let right = x + 36 + panelWidth - 10;
    stateDrills.forEach((d, i) => { pills += drillPill(right, py + 18, d, id, i === 0); right -= drillWidth(d.kind) + 8; });
  }
  diagram.ports.forEach((port, index) => {
    const blockTop = box.y! + offsets[index]!, y = box.y! + anchor(index);
    if (index > 0) body += `<line x1="${box.x! + 12}" x2="${box.x! + boxWidth - 12}" y1="${blockTop}" y2="${blockTop}" stroke="#ddd5ea"/>`;
    // 整块都是这个端口的点击范围。
    body += `<g data-node="${esc(port.name)}"><rect x="${box.x}" y="${blockTop}" width="${boxWidth}" height="${blockHeight(port)}" fill="transparent"/>`;
    body += text(box.x! + 16, y + 5, [`${port.name}  · ${port.kind === "operation" ? "op" : "fn"}`], "start", 14, "bold");
    const pillRight = box.x! + boxWidth - 12;
    body += obligationRow(pillRight - drillWidth("promises") - 12 - obligationRowWidth(port.obligations), y + 5, port.obligations);
    if (port.ext) body += text(box.x! + 16, y + 24, [`rd ${port.ext.rd.join(", ") || "—"}  |  wr ${port.ext.wr.join(", ") || "—"}`], "start", 12, "normal", MUTED);
    body += `<circle cx="${box.x}" cy="${y}" r="4" fill="${CONTRACT}"/><circle cx="${box.x! + boxWidth}" cy="${y}" r="4" fill="${CONTRACT}"/>`;
    // 参数类型靠右贴着线起点，结果类型隔开箭头尖；两者都与线留出 BOX_LABEL_GAP。
    for (const [id, label, side] of [[`input${index}`, port.inputs.join(" * ") || "()", "input"], [`output${index}`, port.output, "output"]] as const) {
      const node = laid.children!.find((node) => node.id === id)!, wrapped = wrap(label, 300);
      const baseline = node.y! + node.height! / 2 + 5 - (wrapped.length - 1) * 19 / 2;
      body += side === "input" ? linkedText(node.x! + node.width! - BOX_LABEL_GAP, baseline, wrapped, "end", 14, typeLink, port.name) : linkedText(node.x! + BOX_LABEL_GAP, baseline, wrapped, "start", 14, typeLink, port.name);
    }
    body += "</g>";
    pills += drillPill(pillRight, y, promises(port.name), port.name, true);
  });
  if (diagram.ports.length === 0) body += text(box.x + boxWidth / 2, box.y + 44, ["No exported operations / functions"], "middle");
  body += pills + "</g>";
  // 图例三行：盒子的画法、下钻标注、证明义务的状态色。
  const shapes: LegendEntry[] = [
    { swatch: 20, label: "Port · exported operation / function", draw: (x, base) => `<circle cx="${x + 7}" cy="${base - 5}" r="4" fill="${CONTRACT}"/>` },
    { swatch: 50, label: "Wire · parameter / result type", draw: (x, base) => `<path d="M${x},${base - 5} h38" stroke="${MUTED}" marker-end="url(#arrow)"/>` },
    { swatch: 42, label: "Feedback · state", draw: (x, base) => `<path d="M${x},${base} v-14 h30 v14" fill="none" stroke="${MUTED}" marker-end="url(#arrow)"/>` },
  ];
  const opens = [drillLegend("promises"), ...(drills.access !== null ? [drillLegend("access")] : []), typeLinkLegend];
  const height = top + laid.height + 110 + 2 * LEGEND_ROW;
  const legend = legendRow(shapes, height - 32 - 2 * LEGEND_ROW) + legendRow(opens, height - 32 - LEGEND_ROW) + poLegend(28, height - 32);
  return frame(`Contract box · ${diagram.module}`, diagram.element, Math.max(laid.width + 56, legendRowWidth(opens)), height, body, legend, 3);
}

const CARD_WIDTH = 760, CARD_HEAD = 36, CARD_GAP = 16;
/** 承诺图里一张卡片的正文：签名、读写、pre、post，或状态的分量、inv 与初值。 */
function cardLines(card: { readonly kind: "port"; readonly port: BoxDiagram["ports"][number] } | { readonly kind: "state"; readonly state: NonNullable<BoxDiagram["state"]> }, inner: number): CodeLine[] {
  switch (card.kind) {
    case "port": {
      const p = card.port, arrow = p.kind === "operation" ? "==>" : "->";
      return [
        ...sizedWrap(`${p.inputs.join(" * ") || "()"} ${arrow} ${p.output}`, inner, 12).map((t): CodeLine => ({ label: null, text: t, size: 12, weight: "normal", fill: MUTED, mono: true, indent: 0 })),
        ...(p.ext ? [plainLine(`rd ${p.ext.rd.join(", ") || "—"}  |  wr ${p.ext.wr.join(", ") || "—"}`, 12, "normal", MUTED)] : []),
        ...(p.pre ? predicateBlock("pre", p.pre, inner) : [plainLine("no pre", 12, "normal", MUTED)]),
        ...(p.post ? predicateBlock("post", p.post, inner) : [plainLine("no post", 12, "normal", MUTED)]),
      ];
    }
    case "state": {
      const s = card.state;
      return [
        ...s.fields.map((f): CodeLine => ({ label: null, text: f, size: 12, weight: "normal", fill: INK, mono: true, indent: 0 })),
        ...(s.inv ? predicateBlock("inv", s.inv, inner) : [plainLine("no inv", 12, "normal", MUTED)]),
        ...(s.init ? predicateBlock("initial", { text: s.init.value ?? `? (${s.init.clause})`, sample: null }, inner) : [plainLine("no init", 12, "normal", MUTED)]),
      ];
    }
    default: return assertNever(card);
  }
}
/** 承诺图：契约盒子下面一层，每个端口一张卡片写它的 pre、post、采样计数与证明义务，状态一张卡片写分量、inv 与初值。 */
export function promisesSvg(diagram: BoxDiagram): DiagramSvg {
  const inner = CARD_WIDTH - 32;
  const cards = [
    ...(diagram.state ? [{ id: `state:${diagram.state.name}`, title: `${diagram.state.name} · state`, fill: "#fff3ea", obligations: diagram.state.obligations, lines: cardLines({ kind: "state", state: diagram.state }, inner) }] : []),
    ...diagram.ports.map((port) => ({ id: port.name, title: `${port.name} · ${port.kind === "operation" ? "op" : "fn"}`, fill: "#f2eff8", obligations: port.obligations, lines: cardLines({ kind: "port", port }, inner) })),
  ];
  let y = 0, body = "";
  for (const card of cards) {
    const h = CARD_HEAD + linesHeight(card.lines) + 14;
    body += `<g data-node="${esc(card.id)}"><rect x="0" y="${y}" width="${CARD_WIDTH}" height="${h}" rx="8" fill="${card.fill}" stroke="${CONTRACT}" stroke-width="1.6"/>`;
    body += text(16, y + 24, [card.title], "start", 14, "bold");
    body += obligationRow(CARD_WIDTH - 16 - obligationRowWidth(card.obligations), y + 24, card.obligations);
    body += codeLines(16, y + CARD_HEAD, card.lines) + "</g>";
    y += h + CARD_GAP;
  }
  if (cards.length === 0) body += text(16, 24, ["No exported operations / functions and no state"], "start", 13, "normal", MUTED);
  const height = 95 + Math.max(y, 40) + 100;
  return frame(`Promises · ${diagram.module}`, `${diagram.element} · what each port promises (pre / post) and what the state always keeps (inv)`, CARD_WIDTH + 56, height, `<g transform="translate(28,95)">${body}</g>`, poLegend(28, height - 32));
}
/** 证明义务状态色的图例：每种状态一个色点。 */
const PO_LEGEND = "Proof obligation:";
function poLegend(x: number, y: number): string {
  let svg = text(x, y, [PO_LEGEND], "start", 12), at = x + sizedWidth(PO_LEGEND, 12);
  for (const s of PO_ORDER) {
    svg += `<circle cx="${at + 5}" cy="${y - 4}" r="5" fill="${PO_STYLE[s].color}"/>` + text(at + 16, y, [PO_STYLE[s].name], "start", 12);
    at += 16 + sizedWidth(PO_STYLE[s].name, 12) + 14;
  }
  return svg;
}

type StepCall = { readonly kind: "call" | "read"; readonly contract: string; readonly operations: readonly string[] };

/**
 * 接线这一面的组合图：drills 给出它下面一层的性质图，以及有盒子图的契约模块——步骤里的契约模块名打开它的盒子图，端口名打开该盒子承诺图里的端口。
 * 契约调用与读取写进发起它的步骤框，不画成连到契约节点的线：每个步骤都连向同一两个契约节点，
 * 这些线横穿整张变量连线图，交叉数由契约节点决定而不由组合本身决定。
 * 变量是总线：每个变量只有左侧一个写入端口、右侧一个读出端口，同一变量的线在端口处汇成一束。
 * 步骤侧每条线独占端口（读入在左，写出与 update 在右）；步骤若也共用端口，ELK 会把经过同一步骤的
 * 不同变量的线并进同一条竖线，读图时分不清哪条线去哪个变量。update 按“步骤 → 变量”参与分层，
 * 与 put 同向，双向箭头表示步骤也读它。
 */
export async function compositionSvg(diagram: CompositionDiagram, drills: CompositionDrills): Promise<DiagramSvg> {
  const { ELK } = await loadDiagramTools();
  const key = (kind: CompositionNode["kind"], id: string): string => `${kind}:${id}`;
  const calls = new Map<string, StepCall[]>();
  const callsOf = (step: string): StepCall[] => calls.get(step) ?? calls.set(step, []).get(step)!;
  const flows: { readonly source: string; readonly target: string; readonly from: string; readonly to: string; readonly kind: "flow" | "update" }[] = [];
  const stepPorts = new Map<string, ElkPort[]>();
  const stepPort = (step: string, side: "WEST" | "EAST"): string => {
    const ports = stepPorts.get(step) ?? stepPorts.set(step, []).get(step)!, id = `${key("step", step)}.${ports.length}`;
    ports.push({ id, layoutOptions: { "elk.port.side": side } });
    return id;
  };
  for (const edge of diagram.edges) {
    switch (edge.kind) {
      case "take": flows.push({ source: `${key("wire", edge.wire)}.out`, target: stepPort(edge.step, "WEST"), from: key("wire", edge.wire), to: key("step", edge.step), kind: "flow" }); break;
      case "put": flows.push({ source: stepPort(edge.step, "EAST"), target: `${key("wire", edge.wire)}.in`, from: key("step", edge.step), to: key("wire", edge.wire), kind: "flow" }); break;
      case "update": flows.push({ source: stepPort(edge.step, "EAST"), target: `${key("wire", edge.wire)}.in`, from: key("step", edge.step), to: key("wire", edge.wire), kind: "update" }); break;
      case "call": callsOf(edge.step).push({ kind: "call", contract: edge.contract, operations: edge.operations }); break;
      case "read": callsOf(edge.step).push({ kind: "read", contract: edge.contract, operations: [] }); break;
      default: assertNever(edge);
    }
  }
  const callLines = (step: string): { readonly call: StepCall; readonly line: string }[] =>
    (calls.get(step) ?? []).flatMap((call) => sizedWrap(call.kind === "call" ? `calls ${call.contract}.${call.operations.join(", ")}` : `reads ${call.contract}`, 300, 12).map((line) => ({ call, line })));
  const callLink = (call: StepCall) => (name: string): Drill | null =>
    !drills.boxes.has(call.contract) ? null
    : name === call.contract ? { kind: "box", diagram: `box:${call.contract}`, node: null }
    : call.operations.includes(name) ? { kind: "promises", diagram: `promises:${call.contract}`, node: name }
    : null;
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
  for (const [index, edge] of (laid.edges ?? []).entries()) {
    const flow = flows[index]!;
    body += `<g data-edge="${index}" data-source="${esc(flow.from)}" data-target="${esc(flow.to)}">${flowPath(edge, flow.kind)}</g>`;
  }
  const placed = new Map((laid.children ?? []).map((child) => [child.id, child]));
  for (const node of diagram.nodes) {
    if (node.kind === "contract") continue;
    const at = placed.get(key(node.kind, node.id));
    if (!at || at.x === undefined || at.y === undefined || at.width === undefined || at.height === undefined) throw new Error(`ELK 没有布置 ${node.kind} ${node.id}`);
    const { x, y, width, height } = at;
    body += `<g data-node="${esc(key(node.kind, node.id))}">`;
    switch (node.kind) {
      case "step": {
        const lines = callLines(node.id);
        body += `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="8" fill="#eef4fa" stroke="${BEHAVIOR}" stroke-width="2"/>`;
        if (lines.length === 0) { body += text(x + width / 2, y + height / 2 + 5, [node.id], "middle", 14, "bold"); break; }
        body += text(x + width / 2, y + 22, [node.id], "middle", 14, "bold") + `<line x1="${x}" x2="${x + width}" y1="${y + 32}" y2="${y + 32}" stroke="${BEHAVIOR}" stroke-opacity="0.35"/>`;
        lines.forEach(({ call, line }, i) => { body += linkedText(x + 14, y + 50 + i * 16, [line], "start", 12, callLink(call), key("step", node.id), call.kind === "call" ? "bold" : "normal", CONTRACT); });
        break;
      }
      case "wire":
        body += `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${Math.min(15, height / 2)}" fill="#fff" stroke="${MUTED}" stroke-width="1.4"/>${text(x + width / 2, y + 19, [node.id], "middle", 13, "bold")}`;
        body += `<text x="${x + width / 2}" y="${y + 36}" text-anchor="middle" font-size="11" fill="${MUTED}">${typeLines(node).map((line, i) => `<tspan x="${x + width / 2}" dy="${i === 0 ? 0 : 17}">${esc(line)}</tspan>`).join("")}</text>`;
        break;
      default: assertNever(node);
    }
    body += "</g>";
  }
  if (children.length === 0) body += text(20, 30, ["No steps or wires"]);
  body += "</g>";
  const height = Math.max(laid.height + 210, 330) + LEGEND_ROW;
  const shapes: LegendEntry[] = [
    { swatch: 30, label: "Step · action in step", draw: (x, base) => `<rect x="${x}" y="${base - 14}" width="20" height="16" rx="4" fill="#eef4fa" stroke="${BEHAVIOR}"/>` },
    { swatch: 36, label: "Wire · var : type", draw: (x, base) => `<rect x="${x}" y="${base - 14}" width="26" height="16" rx="8" fill="#fff" stroke="${MUTED}"/>` },
    { swatch: 45, label: "Take / Put", draw: (x, base) => `<path d="M${x},${base - 6} h35" stroke="${MUTED}" marker-end="url(#arrow)"/>` },
    { swatch: 45, label: "Update · reads and writes", draw: (x, base) => `<path d="M${x},${base - 6} h35" stroke="${MUTED}" marker-start="url(#arrow)" marker-end="url(#arrow)"/>` },
    { swatch: 12, label: "Shared wire", draw: (x, base) => `<circle cx="${x + 3.5}" cy="${base - 6}" r="3.5" fill="${MUTED}"/>` },
  ];
  const opens: LegendEntry[] = [
    { swatch: sizedWidth("calls box.port", 12) + 10, label: "the step calls a contract port", draw: (x, base) => text(x, base, ["calls box.port"], "start", 12, "bold", CONTRACT) },
    { swatch: sizedWidth("reads box", 12) + 10, label: "the step reads a box's feedback", draw: (x, base) => text(x, base, ["reads box"], "start", 12, "normal", CONTRACT) },
    linkLegend("box", "opens the contract box"), linkLegend("port", "opens the port's promises"), drillLegend("properties"),
  ];
  const width = Math.max(laid.width + 56, 1240, legendRowWidth(opens));
  // 性质图的标注在标题行右端，属于整张图。
  body += drillPill(width - 28, 30, { kind: "properties", diagram: drills.properties, node: null }, `wiring:${diagram.module}`, false);
  const legend = legendRow(shapes, height - 32 - LEGEND_ROW) + legendRow(opens, height - 32);
  return frame(`Composition · ${diagram.module}`, "Steps as boxes, behavior variables as wires; contract calls and reads listed in the step that makes them", width, height, body, legend, 2);
}

const WIRING_CARD_HEAD = 40;
/** 接线索引里一张卡片的正文：担心、接进来的契约盒子、规模。 */
function wiringCardLines(w: WiringSummary, inner: number): { readonly concern: string[]; readonly boxes: string[]; readonly counts: string } {
  return {
    concern: w.concern.flatMap((line) => sizedWrap(line, inner, 13.5)),
    boxes: sizedWrap(`Boxes: ${w.boxes.join(", ") || "none"}`, inner, 13),
    counts: `${w.steps} steps · ${w.wires} wires · ${w.properties} properties in safety · ${w.targets} coverage targets`,
  };
}
/** 接线索引：接线这一面的入口，每张接线图（可运行的 Quint 模块）一张卡片；boxes：有盒子图的契约模块。 */
export function wiringsSvg(wirings: readonly WiringSummary[], boxes: ReadonlySet<string>): DiagramSvg {
  const inner = CARD_WIDTH - 32, lead = (size: number): number => Math.round(size * 1.36);
  let y = 0, body = "";
  for (const w of wirings) {
    const l = wiringCardLines(w, inner);
    const h = WIRING_CARD_HEAD + l.concern.length * lead(13.5) + 8 + l.boxes.length * lead(13) + 26;
    body += `<g data-node="${esc(w.module)}"><rect x="0" y="${y}" width="${CARD_WIDTH}" height="${h}" rx="8" fill="#eef4fa" stroke="${BEHAVIOR}" stroke-width="1.6"/>`;
    body += text(16, y + 26, [w.module], "start", 16, "bold");
    let at = y + WIRING_CARD_HEAD + 6;
    if (l.concern.length > 0) body += text(16, at, l.concern, "start", 13.5);
    at += l.concern.length * lead(13.5) + 8;
    body += linkedText(16, at, l.boxes, "start", 13, (name) => boxes.has(name) ? { kind: "box", diagram: `box:${name}`, node: null } : null, w.module);
    at += (l.boxes.length - 1) * lead(13) + 22;
    body += text(16, at, [l.counts], "start", 12, "normal", MUTED) + "</g>";
    const right = CARD_WIDTH - 14;
    body += drillPill(right, y + 21, { kind: "wiring", diagram: `composition:${w.module}`, node: null }, w.module, true);
    body += drillPill(right - drillWidth("wiring") - 8, y + 21, { kind: "properties", diagram: `properties:${w.module}`, node: null }, w.module, false);
    y += h + CARD_GAP;
  }
  const opens = [drillLegend("wiring"), drillLegend("properties"), linkLegend("box", "opens the contract box")];
  const height = 95 + Math.max(y, 40) + 100;
  return frame("Wirings", "Each wiring diagram (one Quint module) is drawn around one concern and wires contract boxes together", Math.max(CARD_WIDTH + 56, legendRowWidth(opens)), height, `<g transform="translate(28,95)">${body}</g>`, legendRow(opens, height - 32));
}

/** 性质图里一张卡片的正文：注释（需求编号）与等宽的原文。 */
function propertyLines(p: PropertyCard, inner: number): CodeLine[] {
  return [
    ...p.comment.flatMap((c) => sizedWrap(c, inner, 12)).map((t) => plainLine(t, 12, "normal", MUTED)),
    // SVG 文字不保留行首空白：原文的缩进换成行的起点（等宽 12px 每个字符约 7.2px）。
    ...p.text.split("\n").flatMap((line) => {
      const indent = (line.length - line.trimStart().length) * 7.2;
      return sizedWrap(line.trimStart(), inner - indent, 12).map((t): CodeLine => ({ label: null, text: t, size: 12, weight: "normal", fill: INK, mono: true, indent }));
    }),
  ];
}
/** 性质图：组合图下面一层，写出 safety、它的各个合取项与覆盖目标的原文；模拟与定向模拟的结果由 ssot check 报告。 */
export function propertiesSvg(diagram: PropertiesDiagram): DiagramSvg {
  const inner = CARD_WIDTH - 32;
  const cards = [
    ...(diagram.safety ? [{ id: "safety", title: "safety · property", note: "checked on every simulated state", fill: "#eef4fa", lines: propertyLines(diagram.safety, inner) }] : []),
    ...diagram.conjuncts.map((p) => ({ id: `property:${p.name}`, title: `${p.name} · in safety`, note: "", fill: "#eef4fa", lines: propertyLines(p, inner) })),
    ...diagram.targets.map((t) => ({ id: `target:${t.name}`, title: `${t.name} · coverage target`, note: t.maxSteps !== null ? `max steps ${t.maxSteps}` : "default max steps", fill: "#eef7f1", lines: propertyLines(t, inner) })),
  ];
  let y = 0, body = "";
  for (const card of cards) {
    const h = CARD_HEAD + linesHeight(card.lines) + 14;
    body += `<g data-node="${esc(card.id)}"><rect x="0" y="${y}" width="${CARD_WIDTH}" height="${h}" rx="8" fill="${card.fill}" stroke="${BEHAVIOR}" stroke-width="1.6"/>`;
    body += text(16, y + 24, [card.title], "start", 14, "bold");
    if (card.note) body += text(CARD_WIDTH - 16, y + 24, [card.note], "end", 12, "normal", MUTED);
    body += codeLines(16, y + CARD_HEAD, card.lines) + "</g>";
    y += h + CARD_GAP;
  }
  if (cards.length === 0) body += text(16, 24, ["No safety and no coverage targets"], "start", 13, "normal", MUTED);
  const height = 95 + Math.max(y, 40) + 100;
  const legend: LegendEntry[] = [
    { swatch: 30, label: "safety and its conjuncts · must hold on every simulated state", draw: (x, base) => `<rect x="${x}" y="${base - 14}" width="20" height="16" rx="4" fill="#eef4fa" stroke="${BEHAVIOR}"/>` },
    { swatch: 30, label: "coverage target · a directed simulation must reach it", draw: (x, base) => `<rect x="${x}" y="${base - 14}" width="20" height="16" rx="4" fill="#eef7f1" stroke="${BEHAVIOR}"/>` },
  ];
  return frame(`Properties · ${diagram.module}`, "What the wiring must keep and the situations it must reach; ssot check reports the simulation results", Math.max(CARD_WIDTH + 56, legendRowWidth(legend)), height, `<g transform="translate(28,95)">${body}</g>`, legendRow(legend, height - 32));
}

const C4_STYLE: Readonly<Record<C4NodeKind, { readonly notation: string; readonly fill: string; readonly stroke: string; readonly ink: string; readonly sub: string }>> = {
  person: { notation: "Person", fill: "#08427b", stroke: "#052e56", ink: "#ffffff", sub: "#cfe0f1" },
  system: { notation: "Software System", fill: "#1168bd", stroke: "#0b4884", ink: "#ffffff", sub: "#d6e6f6" },
  external: { notation: "External Software System", fill: "#8b8f94", stroke: "#6b6f74", ink: "#ffffff", sub: "#eef0f2" },
  container: { notation: "Container", fill: "#438dd5", stroke: "#2e6faf", ink: "#ffffff", sub: "#e6f0fa" },
  store: { notation: "Container: Data Store", fill: "#438dd5", stroke: "#2e6faf", ink: "#ffffff", sub: "#e6f0fa" },
  component: { notation: "Component", fill: "#85bbf0", stroke: "#5d9bd6", ink: "#0b2540", sub: "#1f4468" },
  deploymentNode: { notation: "Deployment Node", fill: "#f6f9fc", stroke: "#5b6b7c", ink: "#26323f", sub: MUTED },
};
/** 带标签的部署节点框按标签组合取色，图例逐个列出；没有标签的部署节点与逻辑边界同色。 */
const TAG_TINTS: readonly { readonly fill: string; readonly stroke: string; readonly ink: string }[] = [
  { fill: "#fdf2ef", stroke: "#b5523b", ink: "#7a2e1d" },
  { fill: "#f4f0fb", stroke: "#6f4fb0", ink: "#45307a" },
  { fill: "#eef7f1", stroke: "#2f7d4f", ink: "#1d5233" },
  { fill: "#fdf8e8", stroke: "#a07a12", ink: "#6a510b" },
];
/** C4 记法名（图例与节点里的方括号文字），ssot serve 的详情面板用同一套名字。 */
export const c4Notation = (kind: C4NodeKind): string => C4_STYLE[kind].notation;
const C4_NODE_WIDTH = 248, C4_PERSON_HEAD = 30, C4_STORE_CAP = 12;

interface C4NodeText { readonly icon: NodeIcon | null; readonly title: string[]; readonly type: string[]; readonly description: string[]; readonly height: number }
/** 记法行（种类与技术）字号 11.5，行距 16；技术写得长时折行，不越出框。 */
const C4_TYPE_SIZE = 11.5, C4_TYPE_LEAD = 16;
/** 节点顶部的图标块：白底圆角方块里放 C4_ICON 像素的图标，连同上下留空占 C4_BADGE_BAND 高。 */
const C4_BADGE = 34, C4_ICON = 24, C4_BADGE_BAND = 44;
const c4Icon = (node: C4DiagramNode): NodeIcon => nodeIcon(node, C4_STYLE[node.kind].notation);
function c4NodeText(node: C4DiagramNode): C4NodeText {
  const style = C4_STYLE[node.kind];
  // 人形自带头像：只有写了 icon 或认出了技术才放图标块。
  const found = c4Icon(node), icon = node.kind === "person" && found.source === "kind" ? null : found;
  const title = sizedWrap(node.title, C4_NODE_WIDTH - 28, 15);
  const type = sizedWrap(`[${style.notation}${node.technology ? `: ${node.technology}` : ""}]`, C4_NODE_WIDTH - 28, C4_TYPE_SIZE);
  const description = node.description ? sizedWrap(node.description, C4_NODE_WIDTH - 28, 13) : [];
  return { icon, title, type, description, height: c4Head(node.kind) + (icon ? C4_BADGE_BAND : 0) + 22 + title.length * 20 + 18 + (type.length - 1) * C4_TYPE_LEAD + (description.length ? 8 + description.length * 18 : 0) + 14 + (node.kind === "store" ? C4_STORE_CAP : 0) };
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
    case "deploymentNode":
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="10" ${paint} stroke-dasharray="9 5"/>`;
    case "store":
      return cylinder(x, y, width, height, C4_STORE_CAP, paint);
    case "component":
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="4" ${paint}/>`;
    default: return assertNever(node.kind);
  }
}

/** icon：按 url 取 loadIcons 画好的图标。 */
function c4NodeBody(node: C4DiagramNode, x: number, y: number, width: number, icon: (url: string) => string): string {
  const style = C4_STYLE[node.kind], content = c4NodeText(node), cx = x + width / 2;
  let top = y + c4Head(node.kind) + (node.kind === "person" ? 4 : 0);
  let out = "";
  if (content.icon) {
    const by = top + 10;
    out += `<rect x="${cx - C4_BADGE / 2}" y="${by}" width="${C4_BADGE}" height="${C4_BADGE}" rx="7" fill="#ffffff" stroke="${style.stroke}" stroke-width="1"/>`;
    out += `<g transform="translate(${cx - C4_ICON / 2},${by + (C4_BADGE - C4_ICON) / 2})" color="${style.stroke}">${icon(content.icon.url)}</g>`;
    top += C4_BADGE_BAND;
  }
  top += 24;
  out += text(cx, top, content.title, "middle", 15, "bold", style.ink);
  top += (content.title.length - 1) * 20 + 19;
  out += text(cx, top, content.type, "middle", C4_TYPE_SIZE, "normal", style.sub);
  if (content.description.length) out += text(cx, top + 24 + (content.type.length - 1) * C4_TYPE_LEAD, content.description, "middle", 13, "normal", style.ink);
  return out;
}

const overlaps = (a: Rect, b: Rect, gap = 3): boolean => a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;

type Segment = readonly [Point, Point];
/** 轴对齐线段是否穿过矩形内部。 */
const cuts = (r: Rect, [a, b]: Segment): boolean =>
  Math.abs(a.x - b.x) < 0.5
    ? a.x > r.x && a.x < r.x + r.width && Math.max(a.y, b.y) > r.y && Math.min(a.y, b.y) < r.y + r.height
    : a.y > r.y && a.y < r.y + r.height && Math.max(a.x, b.x) > r.x && Math.min(a.x, b.x) < r.x + r.width;

/**
 * 标签不交给 ELK：ELK 把标签当作层里的占位节点，线为了绕开占位节点会多出拐弯。布局之后，每个标签压在
 * 自己那条线最长的竖段正中，盖住的是自己的线；与已放好的标签、节点、框标题或别的线相撞时沿这段上下滑动，
 * 这段放不下换次长的竖段，再不行换横段；压在线上都放不下，再贴在线的一侧找。哪里都不空，取与别的东西
 * 重叠最少的位置。
 */
function placeLabels(routes: readonly (readonly Point[])[], sizes: readonly ({ readonly width: number; readonly height: number } | null)[], obstacles: readonly Rect[]): (Rect | null)[] {
  const segments = routes.map((points) => points.slice(1).map((b, i): Segment => [points[i]!, b]));
  const length = ([a, b]: Segment): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const placed: Rect[] = [];
  return routes.map((_, index) => {
    const size = sizes[index];
    if (!size) return null;
    const { width, height } = size, own = [...segments[index]!].sort((p, q) => length(q) - length(p));
    const others = segments.flatMap((s, j) => j === index ? [] : s);
    const area = (p: Rect, q: Rect): number => Math.max(0, Math.min(p.x + p.width, q.x + q.width) - Math.max(p.x, q.x)) * Math.max(0, Math.min(p.y + p.height, q.y + q.height) - Math.max(p.y, q.y));
    const clutter = (r: Rect): number => placed.reduce((sum, p) => sum + area(p, r) + (overlaps(p, r) ? 1 : 0), 0)
      + obstacles.reduce((sum, o) => sum + area(o, r), 0) + others.filter((s) => cuts(r, s)).length * 400;
    /** 沿一段线滑动的各个位置：压在线上，或贴在线的两侧。 */
    const along = (segment: Segment, side: "on" | "beside"): Rect[] => {
      const [a, b] = segment, out: Rect[] = [];
      if (Math.abs(a.x - b.x) < 0.5) {
        const top = Math.min(a.y, b.y) + 6, bottom = Math.max(a.y, b.y) - height - 14, mid = (top + bottom) / 2;
        const xs = side === "on" ? [a.x - width / 2] : [a.x + 6, a.x - width - 6];
        for (let k = 0; k <= 16; k++) for (const y of k === 0 ? [mid] : [mid - k * 8, mid + k * 8]) if (y >= top && y <= bottom) for (const x of xs) out.push({ x, y, width, height });
      } else {
        const left = Math.min(a.x, b.x) + 8, right = Math.max(a.x, b.x) - width - 8, mid = (left + right) / 2;
        const ys = side === "on" ? [a.y - height / 2] : [a.y - height - 4, a.y + 4];
        for (let k = 0; k <= 16; k++) for (const x of k === 0 ? [mid] : [mid - k * 10, mid + k * 10]) if (x >= left && x <= right) for (const y of ys) out.push({ x, y, width, height });
      }
      return out;
    };
    const vertical = own.filter(([a, b]) => Math.abs(a.x - b.x) < 0.5), horizontal = own.filter(([a, b]) => Math.abs(a.x - b.x) >= 0.5);
    const ordered = [...vertical, ...horizontal];
    const candidates = [...ordered.flatMap((s) => along(s, "on")), ...ordered.flatMap((s) => along(s, "beside"))];
    const [a, b] = own[0]!;
    let chosen: Rect = { x: (a.x + b.x) / 2 - width / 2, y: (a.y + b.y) / 2 - height / 2, width, height }, least = Infinity;
    for (const r of candidates) {
      const c = clutter(r);
      if (c < least) { chosen = r; least = c; }
      if (c === 0) break;
    }
    placed.push(chosen);
    return chosen;
  });
}

/** 部署节点框在标题下面多写一行描述：信任边界靠它与标签说明。 */
const frameNote = (node: C4DiagramNode): string[] => node.kind === "deploymentNode" && node.description ? sizedWrap(node.description, 420, 12) : [];

/** 一行行标签文字在图上占的框。 */
const labelSize = (lines: readonly string[]): { width: number; height: number } => ({ width: Math.max(...lines.map((line) => sizedWidth(line, 12))) + 14, height: lines.length * 16 + 8 });

/**
 * ELK 只摆节点，连线交给 route.ts 重走。摆法有几种：线头都收在框边正中时，ELK 把相连的框中线对齐；由 ELK 把线头
 * 沿框边分散时，长线更容易各占一列。节点放置用网络单纯形或 Brandes–Köpf。每种摆法都摆一次、走一遍线，取线的
 * 代价（长度、拐弯、交叉、重叠）最小的一种：哪种摆法好取决于图的形状，没有一种总是最好。
 */
const PLACEMENTS = [
  { ports: "center", strategy: "NETWORK_SIMPLEX" },
  { ports: "center", strategy: "BRANDES_KOEPF" },
  { ports: "spread", strategy: "NETWORK_SIMPLEX" },
  { ports: "spread", strategy: "BRANDES_KOEPF" },
] as const satisfies readonly { readonly ports: "center" | "spread"; readonly strategy: "NETWORK_SIMPLEX" | "BRANDES_KOEPF" }[];
type Placement = (typeof PLACEMENTS)[number];

function placed(graph: ElkNode, placement: Placement): ElkNode {
  const leaves = new Set<string>();
  const collect = (node: ElkNode): void => { if (node.children?.length) node.children.forEach(collect); else leaves.add(node.id); };
  (graph.children ?? []).forEach(collect);
  const end = (id: string, port: "in" | "out"): string => placement.ports === "center" && leaves.has(id) ? `${id}\u0000${port}` : id;
  const edges = (list: ElkExtendedEdge[] | undefined): ElkExtendedEdge[] | undefined =>
    list?.map((edge) => ({ ...edge, sources: edge.sources.map((id) => end(id, "out")), targets: edge.targets.map((id) => end(id, "in")) }));
  const visit = (node: ElkNode): ElkNode => {
    if (node.children?.length) return { ...node, children: node.children.map(visit), edges: edges(node.edges) };
    if (placement.ports === "spread") return node;
    const width = node.width ?? 0, height = node.height ?? 0;
    return {
      ...node,
      layoutOptions: { ...node.layoutOptions, "elk.portConstraints": "FIXED_POS" },
      ports: [
        { id: `${node.id}\u0000in`, x: width / 2, y: 0, width: 0, height: 0, layoutOptions: { "elk.port.side": "NORTH" } },
        { id: `${node.id}\u0000out`, x: width / 2, y: height, width: 0, height: 0, layoutOptions: { "elk.port.side": "SOUTH" } },
      ],
    };
  };
  // 节点放置策略要写在每个框上：框各自排版时（nested）不从父框继承。
  const bk: Record<string, string> = placement.strategy === "BRANDES_KOEPF" ? { "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED", "elk.layered.nodePlacement.bk.edgeStraightening": "IMPROVE_STRAIGHTNESS" } : {};
  const strategy = (node: ElkNode): ElkNode => node.children?.length
    ? { ...node, layoutOptions: { ...node.layoutOptions, "elk.layered.nodePlacement.strategy": placement.strategy, ...bk }, children: node.children.map(strategy) }
    : node;
  return strategy({ ...visit(graph), edges: edges(graph.edges) });
}

/**
 * 整图适应一个 FIT_VIEW 大小的窗口（serve 页面在常见笔记本上的图区）时，缩放低于 FIT_SCALE 的摆法，线的代价按
 * FIT_SCALE / 缩放 放大：框沿对角线错开的摆法线不一定更长，但画布又高又空，缩到屏幕上看不清。缩放够大的摆法只比线。
 */
const FIT_VIEW = { width: 1600, height: 1000 }, FIT_SCALE = 0.4;
/**
 * 每张候选图按每种摆法摆一次、快速走一遍线（quick），取代价最小的摆法，再对它完整地走线（full）。request 由框的
 * 位置给出路由要的框、标题与线。
 */
async function bestLayout(graphs: readonly ElkNode[], request: (box: (id: string) => Rect) => RouteRequest): Promise<{ readonly box: (id: string) => Rect; readonly routes: Point[][] }> {
  const { ELK } = await loadDiagramTools();
  const elk = new ELK();
  const tried = await Promise.all(graphs.flatMap((graph) => PLACEMENTS.map((placement) => ({ graph, placement }))).map(async ({ graph, placement }) => {
    const laid = await elk.layout(placed(graph, placement));
    // ELK 给的坐标相对父框（elk.json.shapeCoords 取 ROOT 时，各框分开排版的子节点会换算错），这里逐层累加成绝对坐标。
    // 取整到像素：路由网格把线头所在的线取到 0.5 像素，框边是小数时线头会落进框四周的留空，线就走不出来。
    const at = new Map<string, Rect>();
    const collect = (node: ElkNode, dx: number, dy: number): void => {
      if (node.x === undefined || node.y === undefined || node.width === undefined || node.height === undefined) throw new Error(`ELK 没有布置 ${node.id}`);
      const x = dx + node.x, y = dy + node.y;
      at.set(node.id, { x: Math.round(x), y: Math.round(y), width: Math.round(node.width), height: Math.round(node.height) });
      for (const child of node.children ?? []) collect(child, x, y);
    };
    for (const child of laid.children ?? []) collect(child, 0, 0);
    const box = (id: string): Rect => {
      const r = at.get(id);
      if (!r) throw new Error(`ELK 没有布置 ${id}`);
      return r;
    };
    const fit = Math.min(FIT_VIEW.width / (laid.width ?? 1), FIT_VIEW.height / (laid.height ?? 1));
    return { box, cost: routeCost(routeEdges(request(box), "quick")) * Math.max(1, FIT_SCALE / fit) };
  }));
  const { box } = tried.reduce((best, next) => next.cost < best.cost ? next : best);
  return { box, routes: routeEdges(request(box), "full") };
}

/** 框、线与标签合起来占的范围：线可能绕到 ELK 给的画布之外。 */
function extent(rects: readonly Rect[], routes: readonly (readonly Point[])[]): Rect {
  const xs = [...rects.flatMap((r) => [r.x, r.x + r.width]), ...routes.flat().map((p) => p.x)];
  const ys = [...rects.flatMap((r) => [r.y, r.y + r.height]), ...routes.flat().map((p) => p.y)];
  if (xs.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * 边界与分组框的标题：画在连线之上、垫一块与框内同色的底；路由也要知道它占的地方。icon 是标题前的图标（url），
 * 画成 FRAME_ICON 大小，标题右移 FRAME_ICON_SPACE。
 */
interface FrameHeader { readonly id: string; readonly x: number; readonly y: number; readonly icon: string | null; readonly title: string; readonly titleSize: number; readonly kind: string; readonly kindSize: number; readonly ink: string; readonly backing: string; readonly note: readonly string[]; readonly rect: Rect }
const FRAME_ICON = 18, FRAME_ICON_SPACE = 24;
/** 边界框标题的种类一栏：记法、技术与标签。 */
const boundaryKind = (node: C4DiagramNode): string => `[${C4_STYLE[node.kind].notation}${node.technology ? `: ${node.technology}` : ""}]${node.tags.map((t) => ` #${t}`).join("")}`;
/** 边界框标题放在框内 (16, 26) 处；ink 与 backing 由调用方按标签上色。 */
const boundaryHeader = (node: C4DiagramNode, x: number, y: number, ink: string, backing: string): FrameHeader =>
  frameHeader({ id: node.id, x: x + 16, y: y + 26, icon: c4Icon(node).url, title: node.title, titleSize: 15, kind: boundaryKind(node), kindSize: 12, ink, backing, note: frameNote(node) });
const frameTitleX = (h: Omit<FrameHeader, "rect">): number => h.x + (h.icon ? FRAME_ICON_SPACE : 0);
function frameHeader(spec: Omit<FrameHeader, "rect">): FrameHeader {
  const kindX = frameTitleX(spec) + sizedWidth(spec.title, spec.titleSize) + 10;
  const width = Math.max(kindX - spec.x + sizedWidth(spec.kind, spec.kindSize), ...spec.note.map((line) => sizedWidth(line, 12))) + 12;
  return { ...spec, rect: { x: spec.x - 6, y: spec.y - spec.titleSize - 2, width, height: spec.titleSize + 10 + spec.note.length * 17 } };
}

/**
 * 框里的节点怎样分层。global：所有节点一起分层（ELK 的 INCLUDE_CHILDREN），跨框的线尽量拉直，但一串框按线首尾
 * 相接时，框沿对角线一级级错开，图又高又空。nested：每个框只按框内的线把子节点排好（上下分层），框之间的线提升到
 * 两端所在的那两个兄弟框之间，含有子框的那一层左右排开：调用方在左、框在中、被调方在右，框各自紧凑。
 * 哪种好取决于图，由 bestLayout 按线的代价挑。
 */
export type Hierarchy = "global" | "nested";
/** 没有框时两种分层是同一张图，只摆一次。 */
const hierarchiesOf = (diagram: C4Diagram): readonly Hierarchy[] => diagram.nodes.some((n) => n.boundary) || diagram.groups.length > 0 ? ["global", "nested"] : ["global"];

/**
 * C4 图交给 ELK 的图：嵌套的边界与分组、叶子节点的尺寸与箭头。
 * 同一张图的叶子取同一高度，同一层的框上下边都对齐；标签不进 ELK（见 placeLabels），层距留出放标签的竖段。
 */
function c4Graph(diagram: C4Diagram, hierarchy: Hierarchy): ElkNode {
  const leafHeight = Math.max(0, ...diagram.nodes.filter((node) => !node.boundary).map((node) => c4NodeText(node).height));
  // 间距不会从父框继承：INCLUDE_CHILDREN 下框里的层距、节点距取的是框自己的设置，不写就是 ELK 的默认 20。
  const spacing = {
    // 框里没有线相连的节点各成一个连通分量，ELK 按 componentComponent 把分量拼在一起，默认只隔 20。
    "elk.spacing.nodeNode": "72", "elk.spacing.componentComponent": "72", "elk.layered.spacing.nodeNodeBetweenLayers": "104", "elk.spacing.edgeNode": "26",
    "elk.spacing.edgeEdge": "16", "elk.layered.spacing.edgeNodeBetweenLayers": "26", "elk.layered.spacing.edgeEdgeBetweenLayers": "14",
  };
  // nested 时每个框单独排版，方向、算法同样不继承，每个框都写上。含子框的那一层左右排开。
  const holdsFrames = (frame: string | null): boolean => diagram.groups.some((g) => g.parent === frame) || diagram.nodes.some((n) => n.boundary && n.parent === frame && n.group === null);
  const own = (frame: string | null): Record<string, string> => {
    switch (hierarchy) {
      case "global": return {};
      case "nested": return { "elk.algorithm": "layered", "elk.direction": holdsFrames(frame) ? "RIGHT" : "DOWN", "elk.edgeRouting": "ORTHOGONAL", "elk.layered.thoroughness": "100" };
      default: return assertNever(hierarchy);
    }
  };
  // 每个节点、分组所在的框：分组的框是父元素，节点的框是分组（有分组时）或父元素。null 是图的顶层。
  const container = new Map<string, string | null>([
    ...diagram.groups.map((group): [string, string | null] => [group.id, group.parent]),
    ...diagram.nodes.map((node): [string, string | null] => [node.id, node.group ?? node.parent]),
  ]);
  // 从 id 往外到顶层的一串框，首项是 id 自己，末项是 null。
  const chain = (id: string): (string | null)[] => {
    const out: (string | null)[] = [id];
    let c = container.get(id) ?? null;
    while (c !== null) { out.push(c); c = container.get(c) ?? null; }
    out.push(null);
    return out;
  };
  // nested：线提升到两端最近的公共框里，两端换成该框下包含它们的那两个子框或节点；同一对只留一条。
  const lifted = new Map<string | null, Map<string, ElkExtendedEdge>>();
  for (const [index, edge] of diagram.edges.entries()) {
    if (hierarchy === "global") continue;
    const up = chain(edge.source), down = chain(edge.target);
    const common = up.find((c) => c !== edge.source && down.includes(c)) ?? null;
    const source = up[up.indexOf(common) - 1]!, target = down[down.indexOf(common) - 1]!;
    if (source === null || target === null || source === target) continue;
    const edges = lifted.get(common) ?? new Map<string, ElkExtendedEdge>();
    if (!edges.has(`${source}\u0000${target}`)) edges.set(`${source}\u0000${target}`, { id: `edge${index}`, sources: [source], targets: [target] });
    lifted.set(common, edges);
  }
  const edgesIn = (frame: string | null): ElkExtendedEdge[] => [...(lifted.get(frame)?.values() ?? [])];
  const childrenOf = (frame: string | null): ElkNode[] => [
    ...diagram.groups.filter((group) => group.parent === frame).map((group): ElkNode => ({
      id: group.id,
      layoutOptions: { ...own(group.id), ...spacing, "elk.padding": "[top=60,left=40,bottom=40,right=40]" },
      children: diagram.nodes.filter((node) => node.group === group.id).map(elkNode),
      edges: edgesIn(group.id),
    })),
    ...diagram.nodes.filter((node) => node.parent === frame && node.group === null).map(elkNode),
  ];
  function elkNode(node: C4DiagramNode): ElkNode {
    const partition: Record<string, string> = node.parent === null ? { "elk.partitioning.partition": node.kind === "person" ? "0" : "1" } : {};
    if (node.boundary) {
      // 框至少和标题一样宽，标题的底不伸出框外。
      const header = boundaryHeader(node, 0, 0, "", "").rect, minimum = `(${Math.ceil(header.x + header.width + 16)},0)`;
      const size = { "elk.nodeSize.constraints": "MINIMUM_SIZE", "elk.nodeSize.minimum": minimum };
      return { id: node.id, layoutOptions: { ...own(node.id), ...spacing, ...partition, ...size, "elk.padding": `[top=${70 + frameNote(node).length * 17},left=40,bottom=40,right=40]` }, children: childrenOf(node.id), edges: edgesIn(node.id) };
    }
    return { id: node.id, width: C4_NODE_WIDTH, height: leafHeight, layoutOptions: partition };
  }
  return {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered", "elk.edgeRouting": "ORTHOGONAL", "elk.direction": "DOWN", ...own(null),
      "elk.hierarchyHandling": hierarchy === "global" ? "INCLUDE_CHILDREN" : "SEPARATE_CHILDREN",
      "elk.partitioning.activate": "true", "elk.layered.thoroughness": "100", ...spacing,
      "elk.padding": "[top=10,left=10,bottom=10,right=10]",
    },
    children: childrenOf(null),
    edges: hierarchy === "global" ? diagram.edges.map((edge, index) => ({ id: `edge${index}`, sources: [edge.source], targets: [edge.target] })) : edgesIn(null),
  };
}

/**
 * drills：节点 id → 它的下一层（自己的视图，否则契约盒子），在节点右上角画成下钻标注。
 * hierarchies：参与挑选的分层方式；不给时按图里有没有框决定。
 */
export async function c4Svg(diagram: C4Diagram, drills: ReadonlyMap<string, Drill>, hierarchies: readonly Hierarchy[] = hierarchiesOf(diagram)): Promise<DiagramSvg> {
  const byId = new Map(diagram.nodes.map((node) => [node.id, node]));
  const tagKeys = [...new Set(diagram.nodes.filter((n) => n.boundary && n.tags.length > 0).map((n) => n.tags.map((t) => `#${t}`).join(" ")))].sort();
  const tint = (node: C4DiagramNode) => node.tags.length === 0 ? null : TAG_TINTS[tagKeys.indexOf(node.tags.map((t) => `#${t}`).join(" ")) % TAG_TINTS.length]!;
  const depth = (id: string): number => { let d = 0, p = byId.get(id)?.parent ?? null; while (p !== null) { d++; p = byId.get(p)?.parent ?? null; } return d; };
  const boundaries = diagram.nodes.filter((n) => n.boundary).sort((a, b) => depth(a.id) - depth(b.id)), leaves = diagram.nodes.filter((n) => !n.boundary);
  const headersAt = (box: (id: string) => Rect): FrameHeader[] => [
    ...boundaries.map((node) => {
      const { x, y } = box(node.id), paint = tint(node);
      return boundaryHeader(node, x, y, paint?.ink ?? "#26323f", paint?.fill ?? "#f6f9fc");
    }),
    // 分组框是半透明的 #eef2f6；标题底色取它叠在父框（#f6f9fc）或白底上的结果。
    ...diagram.groups.map((group) => { const { x, y } = box(group.id); return frameHeader({ id: group.id, x: x + 14, y: y + 24, icon: null, title: group.name, titleSize: 13, kind: "[Group]", kindSize: 11.5, ink: "#3b4754", backing: group.parent === null ? "#f4f6f9" : "#f1f4f8", note: [] }); }),
  ];
  const ids = [...leaves.map((n) => n.id), ...boundaries.map((n) => n.id), ...diagram.groups.map((g) => g.id)];
  const indexOf = (id: string): number => { const k = ids.indexOf(id); if (k < 0) throw new Error(`视图 ${diagram.view} 的连线引用了图上没有的 ${id}`); return k; };
  const { box, routes } = await bestLayout(hierarchies.map((h) => c4Graph(diagram, h)), (box) => ({
    boxes: ids.map((id, k): RouteBox => ({ kind: k < leaves.length ? "node" : "frame", rect: box(id) })),
    headers: headersAt(box).map((h) => h.rect),
    edges: diagram.edges.map((edge) => ({ source: indexOf(edge.source), target: indexOf(edge.target) })),
  }));
  const frameHeaders = headersAt(box);
  const leafIcons = leaves.flatMap((n) => { const i = c4NodeText(n).icon; return i ? [{ node: n, icon: i }] : []; });
  const frameIcons = boundaries.map((n) => ({ node: n, icon: c4Icon(n) }));
  const drawn = await loadIcons([...leafIcons, ...frameIcons].map(({ icon }) => icon.url), C4_ICON);
  const icon = (url: string): string => { const markup = drawn.get(url); if (markup === undefined) throw new Error(`图标 ${url} 没有载入`); return markup; };
  // 标题前的小图标与图例里的图标都由 C4_ICON 大小的图标缩放。
  const smallIcon = (url: string, x: number, y: number, size: number, color: string): string => `<g transform="translate(${x},${y}) scale(${size / C4_ICON})" color="${color}">${icon(url)}</g>`;
  // 每个节点、分组与箭头各包在一个带 data-* 的 <g> 里，ssot serve 的页面靠它们做高亮、跳转与详情。
  let frames = "", headers = "", edges = "", nodes = "", labels = "";
  for (const node of boundaries) {
    const { x, y, width, height } = box(node.id), paint = tint(node);
    frames += `<g data-node="${esc(node.id)}" data-frame=""><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="10" fill="${paint?.fill ?? "#f6f9fc"}" stroke="${paint?.stroke ?? "#5b6b7c"}" stroke-width="1.6" stroke-dasharray="9 5"/></g>`;
  }
  for (const group of diagram.groups) {
    const { x, y, width, height } = box(group.id);
    frames += `<g data-group="${esc(group.id)}"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="8" fill="#eef2f6" fill-opacity="0.65" stroke="#7d8b99" stroke-width="1.3" stroke-dasharray="3 4"/></g>`;
  }
  // 穿进框的连线从标题后面经过，标题不被线划穿。
  for (const h of frameHeaders) {
    const titleX = frameTitleX(h), kindX = titleX + sizedWidth(h.title, h.titleSize) + 10;
    headers += `<g data-header="${esc(h.id)}"><rect x="${h.rect.x}" y="${h.rect.y}" width="${h.rect.width}" height="${h.rect.height}" rx="4" fill="${h.backing}"/>`
      + (h.icon ? smallIcon(h.icon, h.x, h.y - h.titleSize + 1, FRAME_ICON, h.ink) : "")
      + text(titleX, h.y, [h.title], "start", h.titleSize, "bold", h.ink) + text(kindX, h.y, [h.kind], "start", h.kindSize, "normal", MUTED)
      + (h.note.length ? text(h.x, h.y + 19, h.note, "start", 12, "normal", MUTED) : "") + "</g>";
  }
  const labelLines = diagram.edges.map((edge) => edge.label ? sizedWrap(edge.label, 150, 12) : ["[...]"]);
  const labelBoxes = placeLabels(routes, labelLines.map(labelSize), [...leaves.map((n) => box(n.id)), ...frameHeaders.map((h) => h.rect)]);
  for (const [index, points] of routes.entries()) {
    const model = diagram.edges[index]!, attrs = `data-edge="${index}" data-source="${esc(model.source)}" data-target="${esc(model.target)}"`;
    const d = roundedPath(points, 12);
    edges += `<g ${attrs}><path d="${d}" fill="none" stroke="transparent" stroke-width="12"/><path d="${d}" fill="none" stroke="#5d6b78" stroke-width="1.6" stroke-dasharray="7 4" marker-end="url(#arrow)"/></g>`;
    const r = labelBoxes[index];
    if (r) {
      labels += `<g ${attrs}><rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="4" fill="#ffffff" stroke="#c9d1d9"/>`;
      labels += text(r.x + r.width / 2, r.y + 16, labelLines[index]!, "middle", 12, "normal", "#2b3640") + "</g>";
    }
  }
  for (const node of leaves) {
    const { x, y, width, height } = box(node.id);
    nodes += `<g data-node="${esc(node.id)}">${c4Shape(node, x, y, width, height)}${c4NodeBody(node, x, y, width, icon)}</g>`;
  }
  // 下钻标注骑在框的上边、靠右；画在最上层，不被线与标签盖住。
  let pills = "";
  for (const node of [...boundaries, ...leaves]) {
    const d = drills.get(node.id);
    if (d === undefined) continue;
    const { x, y, width } = box(node.id);
    pills += drillPill(x + width - (node.boundary ? 14 : 10), y, d, node.id, true);
  }
  const area = extent([...ids.map(box), ...frameHeaders.map((h) => h.rect), ...labelBoxes.filter((r): r is Rect => r !== null)], routes);

  // 图例：一项是一个色块或图标加说明，排不下时换行。draw 的 base 是这一项文字的基线。
  type LegendItem = { readonly swatch: number; readonly label: string; readonly draw: (x: number, base: number) => string };
  const items: LegendItem[] = [];
  const kinds = [...new Set(leaves.map((n) => n.kind))];
  const kindGlyph = new Map(leafIcons.filter(({ icon }) => icon.source === "kind").map(({ node, icon }) => [node.kind, icon.url]));
  for (const kind of kinds) {
    const paint = `fill="${C4_STYLE[kind].fill}" stroke="${C4_STYLE[kind].stroke}"`, glyph = kindGlyph.get(kind);
    items.push({
      swatch: glyph ? 50 : 30, label: C4_STYLE[kind].notation,
      draw: (x, base) => (kind === "store" ? cylinder(x, base - 15, 22, 20, 4, paint) : `<rect x="${x}" y="${base - 13}" width="22" height="16" rx="3" ${paint}${kind === "external" ? ' stroke-dasharray="4 2"' : ""}/>`)
        + (glyph ? smallIcon(glyph, x + 28, base - 14, 16, C4_STYLE[kind].stroke) : ""),
    });
  }
  // 认出的技术、写明的图标、部署节点的种类：每个图标一项。逻辑边界框只按种类给的图标由"Boundary"一项说明。
  const named = [...leafIcons, ...frameIcons].filter(({ node, icon }) => icon.source !== "kind" || node.kind === "deploymentNode");
  for (const { url, label } of [...new Map(named.map(({ icon }) => [icon.url, icon])).values()]) {
    items.push({ swatch: 26, label, draw: (x, base) => smallIcon(url, x, base - 14, 18, "#26323f") });
  }
  const frameSwatch = (fill: string, stroke: string) => (x: number, base: number): string => `<rect x="${x}" y="${base - 13}" width="22" height="16" rx="3" fill="${fill}" stroke="${stroke}" stroke-dasharray="4 2"/>`;
  if (boundaries.some((n) => n.kind !== "deploymentNode")) items.push({ swatch: 30, label: "Boundary · element opened in this view", draw: frameSwatch("#f6f9fc", "#5b6b7c") });
  if (boundaries.some((n) => n.kind === "deploymentNode" && n.tags.length === 0)) items.push({ swatch: 30, label: "Deployment Node", draw: frameSwatch("#f6f9fc", "#5b6b7c") });
  tagKeys.forEach((key, i) => items.push({ swatch: 30, label: `Deployment Node ${key}`, draw: frameSwatch(TAG_TINTS[i % TAG_TINTS.length]!.fill, TAG_TINTS[i % TAG_TINTS.length]!.stroke) }));
  if (diagram.groups.length) items.push({ swatch: 30, label: "Group", draw: (x, base) => `<rect x="${x}" y="${base - 13}" width="22" height="16" rx="3" fill="#eef2f6" stroke="#7d8b99" stroke-dasharray="2 2"/>` });
  items.push({ swatch: 30, label: "Call · initiator → callee", draw: (x, base) => `<path d="M${x},${base - 5} h22" stroke="#5d6b78" stroke-width="1.6" stroke-dasharray="5 3" marker-end="url(#arrow)"/>` });
  const drillKinds = new Set([...drills.values()].map((d) => d.kind));
  for (const kind of ["view", "box"] as const) if (drillKinds.has(kind)) items.push(drillLegend(kind));
  const width = Math.max(area.width + 56, 860);
  const placedItems: { readonly item: LegendItem; readonly x: number; readonly row: number }[] = [];
  let legendX = 28, row = 0;
  for (const item of items) {
    const span = item.swatch + sizedWidth(item.label, 12);
    if (legendX > 28 && legendX + span > width - 28) { row++; legendX = 28; }
    placedItems.push({ item, x: legendX, row });
    legendX += span + 34;
  }
  const rows = row + 1, height = area.height + 95 + 110 + (rows - 1) * LEGEND_ROW;
  const legend = placedItems.map(({ item, x, row: r }) => {
    const base = height - 32 - (rows - 1 - r) * LEGEND_ROW;
    return item.draw(x, base) + text(x + item.swatch, base, [item.label], "start", 12);
  }).join("");
  return frame(diagram.title, diagram.description, width, height, `<g transform="translate(${28 - area.x},${95 - area.y})">${frames}${edges}${headers}${nodes}${labels}${pills}</g>`, legend, rows);
}

const TIER_STYLE: Readonly<Record<LayerTier, { readonly name: string; readonly band: string; readonly fill: string; readonly stroke: string }>> = {
  business: { name: "Business", band: "#fff7ec", fill: "#fde9cf", stroke: "#c9761f" },
  architecture: { name: "Architecture", band: "#f2f7fd", fill: "#dfeaf8", stroke: "#2e6faf" },
  store: { name: "Data store", band: "#f0f8f2", fill: "#dcefe2", stroke: "#2f7d4f" },
};

/** drills：模块名 → 它的契约盒子，在模块框右上角画成下钻标注。 */
export async function layersSvg(diagram: LayersDiagram, drills: ReadonlyMap<string, Drill>): Promise<DiagramSvg> {
  const width = 260, height = 74, gutter = 150;
  const labelLines = diagram.imports.map((i) => sizedWrap(i.names.join(", "), 170, 12));
  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered", "elk.direction": "DOWN", "elk.edgeRouting": "ORTHOGONAL", "elk.partitioning.activate": "true", "elk.layered.thoroughness": "100",
      "elk.spacing.nodeNode": "48", "elk.layered.spacing.nodeNodeBetweenLayers": "104", "elk.spacing.edgeNode": "24", "elk.spacing.edgeEdge": "14",
      "elk.padding": "[top=26,left=20,bottom=26,right=20]",
    },
    children: diagram.modules.map((m) => ({ id: m.module, width, height, layoutOptions: { "elk.partitioning.partition": String(TIER_ORDER.indexOf(m.tier)) } })),
    edges: diagram.imports.map((i, index) => ({ id: `import${index}`, sources: [i.from], targets: [i.to] })),
  };
  const ids = diagram.modules.map((m) => m.module);
  const { box, routes: raw } = await bestLayout([graph], (box) => ({
    boxes: ids.map((id): RouteBox => ({ kind: "node", rect: box(id) })),
    headers: [],
    edges: diagram.imports.map((i) => ({ source: ids.indexOf(i.from), target: ids.indexOf(i.to) })),
  }));
  // 模块右移出左侧的层名栏。
  const at = (module: string): Rect => { const r = box(module); return { ...r, x: r.x + gutter }; };
  const routes = raw.map((points) => points.map((p) => ({ x: p.x + gutter, y: p.y })));
  const area = extent(ids.map(at), routes);
  const totalWidth = area.x + area.width + 20;
  let bands = "", edges = "", nodes = "", labels = "";
  for (const tier of TIER_ORDER) {
    const members = diagram.modules.filter((m) => m.tier === tier).map((m) => at(m.module));
    if (members.length === 0) continue;
    const top = Math.min(...members.map((r) => r.y)) - 18, bottom = Math.max(...members.map((r) => r.y + r.height)) + 18;
    bands += `<rect x="0" y="${top}" width="${totalWidth}" height="${bottom - top}" rx="8" fill="${TIER_STYLE[tier].band}" stroke="${TIER_STYLE[tier].stroke}" stroke-opacity="0.35"/>`;
    bands += text(16, top + 26, [TIER_STYLE[tier].name], "start", 14, "bold", TIER_STYLE[tier].stroke);
  }
  const labelBoxes = placeLabels(routes, labelLines.map(labelSize), diagram.modules.map((m) => at(m.module)));
  for (const [index, points] of routes.entries()) {
    const model = diagram.imports[index]!, attrs = `data-edge="${index}" data-source="${esc(model.from)}" data-target="${esc(model.to)}"`;
    const d = roundedPath(points, 12);
    edges += `<g ${attrs}><path d="${d}" fill="none" stroke="transparent" stroke-width="12"/><path d="${d}" fill="none" stroke="#5d6b78" stroke-width="1.6" marker-end="url(#arrow)"/></g>`;
    const r = labelBoxes[index];
    if (r) {
      labels += `<g ${attrs}><rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="4" fill="#ffffff" stroke="#c9d1d9"/>`;
      labels += text(r.x + r.width / 2, r.y + 16, labelLines[index]!, "middle", 12, "normal", "#2b3640") + "</g>";
    }
  }
  for (const m of diagram.modules) {
    const r = at(m.module), style = TIER_STYLE[m.tier];
    nodes += `<g data-node="${esc(m.module)}"><rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="8" fill="${style.fill}" stroke="${style.stroke}" stroke-width="1.6"/>`;
    nodes += text(r.x + r.width / 2, r.y + 28, [m.module], "middle", 14, "bold");
    nodes += text(r.x + r.width / 2, r.y + 50, [`${m.title} · ${m.element}`], "middle", 12, "normal", MUTED) + "</g>";
    const d = drills.get(m.module);
    if (d !== undefined) labels += drillPill(r.x + r.width - 10, r.y, d, m.module, true);
  }
  if (diagram.modules.length === 0) nodes += text(20, 30, ["No contract modules"]);
  const height2 = area.y + area.height + 20 + 95 + 110;
  let legendX = 28, legend = "";
  for (const tier of TIER_ORDER) {
    legend += `<rect x="${legendX}" y="${height2 - 45}" width="22" height="16" rx="3" fill="${TIER_STYLE[tier].fill}" stroke="${TIER_STYLE[tier].stroke}"/>` + text(legendX + 30, height2 - 32, [TIER_STYLE[tier].name], "start", 12);
    legendX += 30 + sizedWidth(TIER_STYLE[tier].name, 12) + 34;
  }
  legend += `<path d="M${legendX},${height2 - 37} h22" stroke="#5d6b78" stroke-width="1.6" marker-end="url(#arrow)"/>` + text(legendX + 30, height2 - 32, ["Import · importer → imported, names imported"], "start", 12);
  legendX += 30 + sizedWidth("Import · importer → imported, names imported", 12) + 34;
  if (drills.size > 0) {
    const e = drillLegend("box");
    legend += e.draw(legendX, height2 - 32) + text(legendX + e.swatch, height2 - 32, [e.label], "start", 12);
    legendX += e.swatch + sizedWidth(e.label, 12) + 28;
  }
  return frame("Contract layers", "Who imports whose definitions: imported modules sit lower; business above architecture; data stores deepest", Math.max(totalWidth + 56, legendX), height2, `<g transform="translate(28,95)">${bands}${edges}${nodes}${labels}</g>`, legend);
}

type TypeRole = "own" | "state" | "imported";
const TYPE_STYLE: Readonly<Record<TypeRole, { readonly fill: string; readonly stroke: string; readonly dash: string; readonly name: string }>> = {
  own: { fill: "#f2eff8", stroke: CONTRACT, dash: "", name: "Type · defined here" },
  state: { fill: "#fff3ea", stroke: CONTRACT, dash: "", name: "State" },
  imported: { fill: "#f4f6f8", stroke: "#8a96a3", dash: ' stroke-dasharray="6 4"', name: "Type · from another module" },
};
const typeRole = (diagram: TypesDiagram, node: TypeNode): TypeRole => node.module !== diagram.module ? "imported" : node.category === "state" ? "state" : "own";
/** 框右上角的种类：state、record、union、quote，其余写成 type。 */
function typeTag(node: TypeNode): string {
  if (node.category === "state") return "state";
  switch (node.shape.kind) {
    case "record": case "union": case "quote": return node.shape.kind;
    case "alias": return "type";
    default: return assertNever(node.shape);
  }
}
/** 结构的文字：记录逐字段 `名 : 类型`，并列逐项 `| 选项`，引号类型是值本身，其余 `= 类型式`；折行续在缩进处。 */
function shapeLines(shape: TypeShape, width: number): CodeLine[] {
  const code = (entries: readonly string[]): CodeLine[] => entries.flatMap((entry) => sizedWrap(entry, width, 12).map((t, i): CodeLine => ({ label: null, text: t, size: 12, weight: "normal", fill: INK, mono: true, indent: i === 0 ? 0 : 16 })));
  switch (shape.kind) {
    case "record": return code(shape.fields.map((f) => `${f.name} : ${f.type}`));
    case "union": return code(shape.alternatives.map((a) => `| ${a}`));
    case "quote": return code([shape.value]);
    case "alias": return code([`= ${shape.type}`]);
    default: return assertNever(shape);
  }
}
const TYPE_MIN = 220, TYPE_MAX = 440, TYPE_HEAD = 34, TYPE_FROM = 18;
interface TypeBox { readonly node: TypeNode; readonly role: TypeRole; readonly width: number; readonly lines: readonly CodeLine[]; readonly height: number }
function typeBox(diagram: TypesDiagram, node: TypeNode): TypeBox {
  const role = typeRole(diagram, node);
  const raw = shapeLines(node.shape, Number.POSITIVE_INFINITY);
  const head = sizedWidth(node.name, 14) + sizedWidth(typeTag(node), 11) + 48;
  const width = Math.round(Math.min(TYPE_MAX, Math.max(TYPE_MIN, head, ...raw.map((l) => sizedWidth(l.text, 12) + 32), ...(node.inv ? [sizedWidth(node.inv.text, 12) + PREDICATE_LABEL + 32] : []))));
  const lines = [...shapeLines(node.shape, width - 32), ...(node.inv ? predicateBlock("inv", node.inv, width - 32) : [])];
  const height = TYPE_HEAD + (role === "imported" ? TYPE_FROM : 0) + linesHeight(lines) + 12 + (node.obligations.length > 0 ? 24 : 0);
  return { node, role, width, lines, height };
}
export async function typesSvg(diagram: TypesDiagram): Promise<DiagramSvg> {
  const title = `Contract types · ${diagram.module}`;
  const boxes = diagram.nodes.map((node) => typeBox(diagram, node));
  const ids = diagram.nodes.map((n) => n.id);
  const labelLines = diagram.edges.map((e) => e.fields.length > 0 ? sizedWrap(e.fields.join(", "), 170, 12) : null);
  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered", "elk.direction": "DOWN", "elk.edgeRouting": "ORTHOGONAL", "elk.layered.thoroughness": "100",
      "elk.spacing.nodeNode": "48", "elk.layered.spacing.nodeNodeBetweenLayers": "88", "elk.spacing.componentComponent": "72", "elk.padding": "[top=20,left=20,bottom=20,right=20]",
    },
    children: boxes.map((b) => ({ id: b.node.id, width: b.width, height: b.height })),
    edges: diagram.edges.map((e, index) => ({ id: `use${index}`, sources: [e.source], targets: [e.target] })),
  };
  const { box, routes } = boxes.length === 0 ? { box: (id: string): Rect => { throw new Error(`没有类型 ${id}`); }, routes: [] } : await bestLayout([graph], (box) => ({
    boxes: ids.map((id): RouteBox => ({ kind: "node", rect: box(id) })),
    headers: [],
    edges: diagram.edges.map((e) => ({ source: ids.indexOf(e.source), target: ids.indexOf(e.target) })),
  }));
  const rects = ids.map(box), area = extent(rects, routes);
  let edges = "", nodes = "", labels = "";
  const labelBoxes = placeLabels(routes, labelLines.map((l) => l === null ? null : labelSize(l)), rects);
  for (const [index, points] of routes.entries()) {
    const model = diagram.edges[index]!, attrs = `data-edge="${index}" data-source="${esc(model.source)}" data-target="${esc(model.target)}"`;
    const d = roundedPath(points, 12);
    edges += `<g ${attrs}><path d="${d}" fill="none" stroke="transparent" stroke-width="12"/><path d="${d}" fill="none" stroke="#5d6b78" stroke-width="1.6" marker-end="url(#arrow)"/></g>`;
    const r = labelBoxes[index], lines = labelLines[index];
    if (r && lines) labels += `<g ${attrs}><rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="4" fill="#ffffff" stroke="#c9d1d9"/>${text(r.x + r.width / 2, r.y + 16, lines, "middle", 12, "normal", "#2b3640")}</g>`;
  }
  for (const b of boxes) {
    const r = box(b.node.id), style = TYPE_STYLE[b.role];
    nodes += `<g data-node="${esc(b.node.id)}"><rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="8" fill="${style.fill}" stroke="${style.stroke}" stroke-width="1.6"${style.dash}/>`;
    nodes += text(r.x + 16, r.y + 24, [b.node.name], "start", 14, "bold");
    nodes += text(r.x + r.width - 14, r.y + 23, [typeTag(b.node)], "end", 11, "normal", MUTED);
    if (b.role === "imported") nodes += text(r.x + 16, r.y + TYPE_HEAD + 8, [`from ${b.node.module}`], "start", 11.5, "normal", MUTED);
    const bodyTop = r.y + TYPE_HEAD + (b.role === "imported" ? TYPE_FROM : 0);
    nodes += `<line x1="${r.x}" x2="${r.x + r.width}" y1="${bodyTop - 2}" y2="${bodyTop - 2}" stroke="${style.stroke}" stroke-opacity="0.35"/>`;
    nodes += codeLines(r.x + 16, bodyTop, b.lines);
    if (b.node.obligations.length > 0) nodes += obligationRow(r.x + 16, r.y + r.height - 12, b.node.obligations);
    nodes += "</g>";
  }
  if (boxes.length === 0) nodes += text(20, 30, ["No types or state in this module"]);
  // 图例两行：第一行是框与箭头，第二行是证明义务的状态色。
  const height = area.y + area.height + 95 + 110 + 20 + LEGEND_ROW, row = height - 32 - LEGEND_ROW;
  let legendX = 28, legend = "";
  for (const role of ["own", "state", "imported"] as const) {
    const style = TYPE_STYLE[role];
    legend += `<rect x="${legendX}" y="${row - 13}" width="22" height="16" rx="3" fill="${style.fill}" stroke="${style.stroke}"${style.dash}/>` + text(legendX + 30, row, [style.name], "start", 12);
    legendX += 30 + sizedWidth(style.name, 12) + 30;
  }
  legend += `<path d="M${legendX},${row - 5} h22" stroke="#5d6b78" stroke-width="1.6" marker-end="url(#arrow)"/>` + text(legendX + 30, row, ["Uses · via fields"], "start", 12);
  legend += poLegend(28, height - 32);
  return frame(title, `${diagram.element} · each box is a type with its structure; arrows point at the types it uses`, area.x + area.width + 20 + 56, height, `<g transform="translate(28,95)">${edges}${nodes}${labels}</g>`, legend, 2);
}

const ACCESS_STYLE: Readonly<Record<Access, { readonly fill: string; readonly ink: string; readonly text: string; readonly name: string }>> = {
  wr: { fill: "#fde6da", ink: "#b2431c", text: "wr", name: "wr · writes (and may read)" },
  rd: { fill: "#e3eefb", ink: "#1f5fa8", text: "rd", name: "rd · reads only" },
  none: { fill: "#ffffff", ink: MUTED, text: "", name: "blank · does not touch" },
};
const ACCESS_ROW = 36, ACCESS_HEAD = 44;
export function accessSvg(table: AccessTable): DiagramSvg {
  const sourceNote = (row: AccessRow): string => `${row.source === "ext" ? "ext clause" : "derived from body"}${row.exported ? "" : " · internal"}`;
  const first = Math.max(220, ...table.rows.map((r) => Math.max(sizedWidth(r.operation, 14), sizedWidth(sourceNote(r), 11)) + 32));
  const columns = table.fields.map((f) => Math.max(72, sizedWidth(f, 13) + 28));
  const x0 = (index: number): number => first + columns.slice(0, index).reduce((a, b) => a + b, 0);
  const gridWidth = x0(columns.length), gridHeight = ACCESS_HEAD + table.rows.length * ACCESS_ROW;
  let body = `<rect x="0" y="0" width="${gridWidth}" height="${gridHeight}" rx="6" fill="#fff" stroke="#c9d1d9"/>`;
  body += `<rect x="0" y="0" width="${gridWidth}" height="${ACCESS_HEAD}" rx="6" fill="#f6f7f9"/>`;
  body += text(16, 27, [`operation \\ ${table.state}`], "start", 12.5, "bold", MUTED);
  table.fields.forEach((f, i) => {
    body += `<g data-node="${esc(`field:${f}`)}"><rect x="${x0(i)}" y="0" width="${columns[i]}" height="${ACCESS_HEAD}" fill="transparent"/>${text(x0(i) + columns[i]! / 2, 27, [f], "middle", 13, "bold")}</g>`;
  });
  table.rows.forEach((row, r) => {
    const y = ACCESS_HEAD + r * ACCESS_ROW;
    body += `<g data-node="${esc(row.operation)}">`;
    body += `<rect x="1" y="${y}" width="${gridWidth - 2}" height="${ACCESS_ROW}" fill="${r % 2 === 1 ? "#fafbfc" : "transparent"}"/>`;
    body += text(16, y + 17, [row.operation], "start", 14, "bold");
    body += text(16, y + 31, [sourceNote(row)], "start", 11, "normal", MUTED);
    row.cells.forEach((cell, i) => {
      const style = ACCESS_STYLE[cell];
      if (cell !== "none") body += `<rect x="${x0(i) + 8}" y="${y + 6}" width="${columns[i]! - 16}" height="${ACCESS_ROW - 12}" rx="4" fill="${style.fill}"/>` + text(x0(i) + columns[i]! / 2, y + 23, [style.text], "middle", 13, "bold", style.ink);
    });
    body += "</g>";
  });
  body += `<line x1="0" x2="${gridWidth}" y1="${ACCESS_HEAD}" y2="${ACCESS_HEAD}" stroke="#c9d1d9"/>`;
  for (let r = 1; r < table.rows.length; r++) body += `<line x1="0" x2="${gridWidth}" y1="${ACCESS_HEAD + r * ACCESS_ROW}" y2="${ACCESS_HEAD + r * ACCESS_ROW}" stroke="#edf0f3"/>`;
  for (let i = 0; i < columns.length; i++) body += `<line x1="${x0(i)}" x2="${x0(i)}" y1="0" y2="${gridHeight}" stroke="#e1e5e9"/>`;
  if (table.rows.length === 0) body += text(16, ACCESS_HEAD + 24, ["No operations"], "start", 13, "normal", MUTED);
  const height = 95 + gridHeight + 100;
  let legendX = 28, legend = "";
  for (const cell of ["wr", "rd", "none"] as const) {
    const style = ACCESS_STYLE[cell];
    legend += `<rect x="${legendX}" y="${height - 45}" width="22" height="16" rx="3" fill="${style.fill}" stroke="#c9d1d9"/>` + text(legendX + 30, height - 32, [style.name], "start", 12);
    legendX += 30 + sizedWidth(style.name, 12) + 30;
  }
  return frame(`Read / write · ${table.module}`, `${table.element} · which state fields each operation reads or writes`, Math.max(gridWidth, legendX) + 56, height, `<g transform="translate(28,95)">${body}</g>`, legend);
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
