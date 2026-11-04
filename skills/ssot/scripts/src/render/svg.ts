import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api";
import type { Browser } from "playwright-core";
import { assertNever } from "../diag";
import { loadDiagramTools } from "../install";
import type { BoxDiagram } from "./box";
import type { CompositionDiagram, CompositionEdge } from "./composition";

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
    case "read": case "port": style = `stroke="${MUTED}" marker-end="url(#arrow)"`; break;
    case "call": style = `stroke="${MUTED}" stroke-dasharray="8 4" marker-end="url(#arrow)"`; break;
    case "sync": style = `stroke="${MUTED}" stroke-dasharray="2 4" marker-start="url(#arrow)" marker-end="url(#arrow)"`; break;
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
  const labelLines = diagram.edges.map((edge) => wrap(edge.labels.slice(0, 4).join(", ") + (edge.labels.length > 4 ? ` … (+${edge.labels.length - 4})` : ""), 280));
  const graph: ElkNode = {
    id: "root", layoutOptions: { "elk.algorithm": "layered", "elk.direction": "RIGHT", "elk.edgeRouting": "ORTHOGONAL", "elk.spacing.nodeNode": "50", "elk.layered.spacing.nodeNodeBetweenLayers": "130", "elk.spacing.edgeNode": "25", "elk.spacing.edgeEdge": "20", "elk.edgeLabels.inline": "false", "elk.padding": "[top=20,left=20,bottom=20,right=20]" },
    children: diagram.boxes.map((box) => {
      const width = Math.max(200, Math.min(350, widthOf(box.id) + 40));
      const feedback = box.kind === "behavior" ? Math.max(80, wrap(box.type, width - 64).length * 19 + 40) : 80;
      const body = Math.max(60, wrap(box.id, width - 24).length * 19 + 30);
      return { id: box.id, width, height: feedback + body + 10, layoutOptions: { "elk.portConstraints": "FIXED_POS" }, ports: [
        { id: `${box.id}:in`, x: 0, y: feedback + body / 2, width: 0, height: 0, layoutOptions: { "elk.port.side": "WEST" } },
        { id: `${box.id}:out`, x: width, y: feedback + body / 2, width: 0, height: 0, layoutOptions: { "elk.port.side": "EAST" } },
      ] };
    }),
    edges: diagram.edges.map((edge, index) => ({ id: `edge${index}`, sources: [`${edge.source}:out`], targets: [`${edge.target}:in`], labels: [{ text: labelLines[index]!.join("\n"), width: Math.max(...labelLines[index]!.map(widthOf)), height: labelLines[index]!.length * 19 + 8 }] })),
  };
  const laid = await new ELK().layout(graph);
  if (laid.width === undefined || laid.height === undefined) throw new Error(`ELK 没有布置组合图 ${diagram.module}`);
  let body = '<g transform="translate(28,95)">';
  for (const [index, edge] of (laid.edges ?? []).entries()) {
    body += edgePath(edge, diagram.edges[index]!.kind);
    for (const label of edge.labels ?? []) {
      body += `<rect x="${label.x! - 4}" y="${label.y! - 2}" width="${label.width! + 8}" height="${label.height! + 4}" rx="3" fill="#fff"/>`;
      body += text(label.x!, label.y! + 14, labelLines[index]!, "start", 13);
    }
  }
  for (const node of laid.children ?? []) {
    const box = diagram.boxes.find((box) => box.id === node.id)!;
    const x = node.x!, y = node.y!, width = node.width!;
    const behavior = box.kind === "behavior";
    const feedback = box.kind === "behavior" ? Math.max(80, wrap(box.type, width - 64).length * 19 + 40) : 80;
    const bodyHeight = Math.max(60, wrap(box.id, width - 24).length * 19 + 30);
    body += `<rect x="${x}" y="${y + feedback}" width="${width}" height="${bodyHeight}" rx="${behavior ? 9 : 0}" fill="${behavior ? "#eef4fa" : "#f2eff8"}" stroke="${behavior ? BEHAVIOR : CONTRACT}" stroke-width="2" ${behavior ? "" : 'stroke-dasharray="7 3"'}/>`;
    body += text(x + width / 2, y + feedback + 28, wrap(box.id, width - 24), "middle", 14, "bold");
    if (box.kind === "behavior") {
      body += `<path d="M${x + width - 22},${y + feedback} V${y + 30} H${x + 22} V${y + feedback}" fill="none" stroke="${MUTED}" stroke-width="1.7" marker-end="url(#arrow)"/>`;
      const lines = wrap(box.type, width - 64);
      body += `<rect x="${x + 30}" y="${y + 14}" width="${width - 60}" height="${lines.length * 19 + 4}" fill="#fff"/>${text(x + width / 2, y + 29, lines, "middle", 13)}`;
    }
  }
  if (diagram.boxes.length === 0) body += text(20, 30, ["No behavior variables or contract calls"]);
  body += "</g>";
  const height = Math.max(laid.height + 210, 330);
  const legend = `<rect x="28" y="${height - 48}" width="20" height="16" rx="4" fill="#eef4fa" stroke="${BEHAVIOR}"/>${text(58, height - 34, ["Behavior · feedback = type"], "start", 12)}<rect x="280" y="${height - 48}" width="20" height="16" fill="#f2eff8" stroke="${CONTRACT}" stroke-dasharray="4 2"/>${text(310, height - 34, ["Contract"], "start", 12)}<path d="M410,${height - 40} h35" stroke="${MUTED}" marker-end="url(#arrow)"/>${text(455, height - 34, ["Read"], "start", 12)}<path d="M525,${height - 40} h35" stroke="${MUTED}" stroke-dasharray="8 4" marker-end="url(#arrow)"/>${text(570, height - 34, ["Call"], "start", 12)}<path d="M635,${height - 40} h35" stroke="${MUTED}" stroke-dasharray="2 4" marker-start="url(#arrow)" marker-end="url(#arrow)"/>${text(680, height - 34, ["Sync · action"], "start", 12)}`;
  return frame(`Composition · ${diagram.module}`, "Behavior variables, generated contract calls and shared actions", laid.width + 56, height, body, legend);
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
