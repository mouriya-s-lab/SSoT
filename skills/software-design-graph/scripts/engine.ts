import { lookup } from '../../software-design/scripts/model.ts';
import type { Selection } from '../../software-design/scripts/model.ts';
import type { Graph, GraphEdge, GraphNode, Neighborhood, PathResult, QueryResult } from './graph-model.ts';
function select(graph: Graph, selector: string): QueryResult<string> {
  const result = lookup([...graph.nodes.values()], selector);
  switch (result.kind) {
    case 'Found':
      return { kind: 'Found', value: result.id };
    case 'Missing':
      return { kind: 'Missing', selector };
    case 'Ambiguous':
      return { kind: 'Ambiguous', selector, candidates: result.candidates };
  }
}
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
export function compareEdges(a: GraphEdge, b: GraphEdge): number {
  return compare(a.relation, b.relation) || compare(a.to, b.to) || compare(a.from, b.from);
}
export function search(graph: Graph, text: string, kind?: GraphNode['kind']): readonly GraphNode[] {
  const query = text.toLowerCase();
  return [...graph.nodes.values()]
    .filter(
      (n) =>
        (!kind || n.kind === kind) &&
        [n.name, n.doc, n.id, n.at.path].some((value) => value.toLowerCase().includes(query)),
    )
    .sort((a, b) => compare(a.id, b.id));
}
export function neighbors(
  graph: Graph,
  selector: string,
  direction: 'out' | 'in' | 'both',
  depth: number,
): QueryResult<Neighborhood> {
  if (!Number.isSafeInteger(depth) || depth <= 0)
    throw new Error('Neighborhood depth must be a positive safe integer');
  const selected = select(graph, selector);
  if (selected.kind !== 'Found') return selected;
  const distance = new Map([[selected.value, 0]]);
  const queue = [selected.value];
  const edges: GraphEdge[] = [];
  const seenEdges = new Set<GraphEdge>();
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]!;
    const level = distance.get(id)!;
    if (level >= depth) continue;
    const adjacent = [
      ...(direction !== 'in' ? (graph.out.get(id) ?? []) : []),
      ...(direction !== 'out' ? (graph.incoming.get(id) ?? []) : []),
    ].sort(compareEdges);
    for (const edge of adjacent) {
      if (!seenEdges.has(edge)) {
        seenEdges.add(edge);
        edges.push(edge);
      }
      const next = edge.from === id ? edge.to : edge.from;
      if (!distance.has(next)) {
        distance.set(next, level + 1);
        queue.push(next);
      }
    }
  }
  return {
    kind: 'Found',
    value: {
      context: graph.context,
      nodes: [...distance.keys()].sort().map((id) => graph.nodes.get(id)!),
      edges: edges.sort(compareEdges),
    },
  };
}
/** Directed BFS answers graph structure only, not executability or completed assembly. */
export function shortestPath(graph: Graph, from: string, to: string): QueryResult<PathResult> {
  const start = select(graph, from);
  if (start.kind !== 'Found') return start;
  const end = select(graph, to);
  if (end.kind !== 'Found') return end;
  const queue = [start.value];
  const visited = new Set(queue);
  const previous = new Map<string, GraphEdge>();
  for (let index = 0; index < queue.length && !visited.has(end.value); index++) {
    for (const edge of [...(graph.out.get(queue[index]!) ?? [])].sort(compareEdges)) {
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);
      previous.set(edge.to, edge);
      queue.push(edge.to);
      if (edge.to === end.value) break;
    }
  }
  if (!visited.has(end.value)) return { kind: 'Found', value: { kind: 'NoPath', context: graph.context } };
  const edges: GraphEdge[] = [];
  let cursor = end.value;
  while (cursor !== start.value) {
    const edge = previous.get(cursor)!;
    edges.push(edge);
    cursor = edge.from;
  }
  edges.reverse();
  const roles: Selection[] = [];
  for (const id of [start.value, ...edges.map((e) => e.to)]) {
    const node = graph.nodes.get(id);
    if (node?.kind === 'Role') roles.push(node.details);
  }
  return { kind: 'Found', value: { kind: 'StructuralPath', context: graph.context, edges, roles } };
}
