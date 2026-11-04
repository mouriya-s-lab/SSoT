import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api";
import type { Browser } from "playwright-core";
import { assertNever } from "../diag";
import { loadDiagramTools } from "../install";
import type { BoxDiagram } from "./box";
import type { CompositionDiagram, CompositionEdge, CompositionNode } from "./composition";

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
function text(x: number, y: number, lines: readonly string[], anchor: "start" | "middle" = "start", size = 14, weight = "normal"): string {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" font-weight="${weight}" fill="${INK}">${lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : 19}">${esc(line)}</tspan>`).join("")}</text>`;
}
function frame(title: string, subtitle: string, width: number, height: number, body: string, legend: string): DiagramSvg {
  const w = Math.ceil(Math.max(width, 860)), h = Math.ceil(height);
  return { width: w, height: h, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" font-family="Arial, sans-serif" font-size="14"><defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto-start-reverse"><path d="M0,0 L9,4.5 L0,9 z" fill="${MUTED}"/></marker></defs><rect width="100%" height="100%" fill="#fff"/>${text(28, 34, [title], "start", 21, "bold")}${text(28, 59, [subtitle], "start", 14)}${body}<line x1="28" x2="${w - 28}" y1="${h - 65}" y2="${h - 65}" stroke="#dde1e5"/>${legend}</svg>` };
}
function edgePath(edge: ElkExtendedEdge, kind: CompositionEdge["kind"] | "port"): string {
  let style: string;
  switch (kind) {
    case "take": case "put": case "port": style = `stroke="${MUTED}" marker-end="url(#arrow)"`; break;
    case "update": style = `stroke="${MUTED}" marker-start="url(#arrow)" marker-end="url(#arrow)"`; break;
    case "call": style = `stroke="${MUTED}" stroke-dasharray="8 4" marker-end="url(#arrow)"`; break;
    default: return assertNever(kind);
  }
  if (!edge.sections?.length) throw new Error(`ELK 没有布置连线 ${edge.id}`);
  return edge.sections.map((section) => `<polyline points="${[section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((point) => `${point.x},${point.y}`).join(" ")}" fill="none" stroke-width="1.7" ${style}/>`).join("");
}

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
      { id: `input${index}`, width: Math.max(80, Math.min(300, widthOf(port.inputs.join(" * ") || "()"))), height: wrap(port.inputs.join(" * ") || "()", 300).length * 19 + 8 },
      { id: `output${index}`, width: Math.max(80, Math.min(300, widthOf(port.output))), height: wrap(port.output, 300).length * 19 + 8 },
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
  for (const edge of laid.edges ?? []) body += edgePath(edge, "port");
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
    for (const [id, label] of [[`input${index}`, port.inputs.join(" * ") || "()"], [`output${index}`, port.output]] as const) {
      const node = laid.children!.find((node) => node.id === id)!;
      body += text(node.x!, node.y! + 15, wrap(label, 300));
    }
  });
  if (diagram.ports.length === 0) body += text(box.x + boxWidth / 2, box.y + 54, ["No exported operations / functions"], "middle");
  body += "</g>";
  const height = top + laid.height + 110;
  const legend = `<circle cx="35" cy="${height - 37}" r="4" fill="${CONTRACT}"/>${text(48, height - 32, ["Port · exported operation / function"], "start", 12)}<path d="M340,${height - 37} h38" stroke="${MUTED}" marker-end="url(#arrow)"/>${text(390, height - 32, ["Wire · parameter / result type"], "start", 12)}<path d="M640,${height - 32} v-14 h30 v14" fill="none" stroke="${MUTED}" marker-end="url(#arrow)"/>${text(685, height - 32, ["Feedback · state"], "start", 12)}`;
  return frame(`Contract box · ${diagram.module}`, diagram.element, laid.width + 56, height, body, legend);
}

export async function compositionSvg(diagram: CompositionDiagram): Promise<DiagramSvg> {
  const { ELK } = await loadDiagramTools();
  const key = (kind: CompositionNode["kind"], id: string): string => `${kind}:${id}`;
  const typeLines = (node: CompositionNode): string[] => node.kind === "wire" ? wrap(node.type, 260) : [];
  const size = (node: CompositionNode): { width: number; height: number } => {
    switch (node.kind) {
      case "step": return { width: Math.max(150, widthOf(node.id) + 40), height: 52 };
      case "wire": return { width: Math.max(widthOf(node.id) + 32, ...typeLines(node).map((line) => widthOf(line) * 0.9 + 32)), height: 30 + typeLines(node).length * 17 };
      case "contract": return { width: Math.max(170, widthOf(node.id) + 40), height: 60 };
      default: return assertNever(node);
    }
  };
  const ends = (edge: CompositionEdge): [string, string] => {
    switch (edge.kind) {
      case "take": case "update": return [key("wire", edge.wire), key("step", edge.step)];
      case "put": return [key("step", edge.step), key("wire", edge.wire)];
      case "call": return [key("step", edge.step), key("contract", edge.contract)];
      default: return assertNever(edge);
    }
  };
  const labelLines = diagram.edges.map((edge) => edge.kind === "call" ? wrap(edge.operations.join(", "), 240) : []);
  const graph: ElkNode = {
    id: "root", layoutOptions: { "elk.algorithm": "layered", "elk.direction": "RIGHT", "elk.edgeRouting": "ORTHOGONAL", "elk.spacing.nodeNode": "28", "elk.layered.spacing.nodeNodeBetweenLayers": "60", "elk.spacing.edgeNode": "18", "elk.spacing.edgeEdge": "12", "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX", "elk.padding": "[top=20,left=20,bottom=20,right=20]" },
    children: diagram.nodes.map((node) => ({ id: key(node.kind, node.id), ...size(node) })),
    edges: diagram.edges.map((edge, index) => {
      const [source, target] = ends(edge), lines = labelLines[index]!;
      return { id: `edge${index}`, sources: [source], targets: [target], labels: lines.length ? [{ text: lines.join("\n"), width: Math.max(...lines.map(widthOf)) * 0.9, height: lines.length * 17 + 6 }] : [] };
    }),
  };
  const laid = await new ELK().layout(graph);
  if (laid.width === undefined || laid.height === undefined) throw new Error(`ELK 没有布置组合图 ${diagram.module}`);
  let body = '<g transform="translate(28,95)">';
  for (const [index, edge] of (laid.edges ?? []).entries()) {
    body += edgePath(edge, diagram.edges[index]!.kind);
    for (const label of edge.labels ?? []) {
      body += `<rect x="${label.x! - 4}" y="${label.y! - 2}" width="${label.width! + 8}" height="${label.height! + 4}" rx="3" fill="#fff"/>`;
      body += text(label.x!, label.y! + 13, labelLines[index]!, "start", 12);
    }
  }
  const placed = new Map((laid.children ?? []).map((child) => [child.id, child]));
  for (const node of diagram.nodes) {
    const at = placed.get(key(node.kind, node.id));
    if (!at || at.x === undefined || at.y === undefined || at.width === undefined || at.height === undefined) throw new Error(`ELK 没有布置 ${node.kind} ${node.id}`);
    const { x, y, width, height } = at;
    switch (node.kind) {
      case "step":
        body += `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="8" fill="#eef4fa" stroke="${BEHAVIOR}" stroke-width="2"/>${text(x + width / 2, y + height / 2 + 5, [node.id], "middle", 14, "bold")}`;
        break;
      case "wire":
        body += `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${Math.min(15, height / 2)}" fill="#fff" stroke="${MUTED}" stroke-width="1.4"/>${text(x + width / 2, y + 19, [node.id], "middle", 13, "bold")}`;
        body += `<text x="${x + width / 2}" y="${y + 36}" text-anchor="middle" font-size="11" fill="${MUTED}">${typeLines(node).map((line, i) => `<tspan x="${x + width / 2}" dy="${i === 0 ? 0 : 17}">${esc(line)}</tspan>`).join("")}</text>`;
        break;
      case "contract":
        body += `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#f2eff8" stroke="${CONTRACT}" stroke-width="2" stroke-dasharray="7 3"/>${text(x + width / 2, y + height / 2 + 5, [node.id], "middle", 14, "bold")}`;
        break;
      default: assertNever(node);
    }
  }
  if (diagram.nodes.length === 0) body += text(20, 30, ["No steps, wires or contract calls"]);
  body += "</g>";
  const height = Math.max(laid.height + 210, 330);
  const legend = `<rect x="28" y="${height - 48}" width="20" height="16" rx="4" fill="#eef4fa" stroke="${BEHAVIOR}"/>${text(58, height - 34, ["Step · action in step"], "start", 12)}<rect x="230" y="${height - 48}" width="26" height="16" rx="8" fill="#fff" stroke="${MUTED}"/>${text(266, height - 34, ["Wire · var : type"], "start", 12)}<rect x="420" y="${height - 48}" width="20" height="16" fill="#f2eff8" stroke="${CONTRACT}" stroke-dasharray="4 2"/>${text(450, height - 34, ["Contract box"], "start", 12)}<path d="M560,${height - 40} h35" stroke="${MUTED}" marker-end="url(#arrow)"/>${text(605, height - 34, ["Take / Put"], "start", 12)}<path d="M690,${height - 40} h35" stroke="${MUTED}" marker-start="url(#arrow)" marker-end="url(#arrow)"/>${text(735, height - 34, ["Update · reads and writes"], "start", 12)}<path d="M930,${height - 40} h35" stroke="${MUTED}" stroke-dasharray="8 4" marker-end="url(#arrow)"/>${text(975, height - 34, ["Call · operations"], "start", 12)}`;
  return frame(`Composition · ${diagram.module}`, "Steps as boxes, behavior variables as wires, generated contract calls", Math.max(laid.width + 56, 1220), height, body, legend);
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
