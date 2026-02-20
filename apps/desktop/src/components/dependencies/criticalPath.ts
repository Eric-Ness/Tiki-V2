import type { Node, Edge } from '@xyflow/react';

/**
 * Find the critical path (longest path) through a DAG.
 *
 * Uses topological sort + dynamic programming to find the longest path
 * from any root to any leaf. Returns the set of node IDs and edge IDs
 * on that path.
 *
 * If cycles are detected, returns null so the caller can show a warning.
 */
export function findCriticalPath(
  nodes: Node[],
  edges: Edge[]
): { nodeIds: Set<string>; edgeIds: Set<string> } | null {
  if (nodes.length === 0 || edges.length === 0) {
    return { nodeIds: new Set(), edgeIds: new Set() };
  }

  // Build adjacency list and in-degree map
  const adj = new Map<string, { target: string; edgeId: string }[]>();
  const inDegree = new Map<string, number>();
  const edgeMap = new Map<string, string>(); // "source->target" -> edgeId

  for (const node of nodes) {
    adj.set(node.id, []);
    inDegree.set(node.id, 0);
  }

  for (const edge of edges) {
    adj.get(edge.source)?.push({ target: edge.target, edgeId: edge.id });
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    edgeMap.set(`${edge.source}->${edge.target}`, edge.id);
  }

  // Topological sort (Kahn's algorithm)
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const topoOrder: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    topoOrder.push(current);

    for (const neighbor of adj.get(current) ?? []) {
      const newDeg = (inDegree.get(neighbor.target) ?? 1) - 1;
      inDegree.set(neighbor.target, newDeg);
      if (newDeg === 0) queue.push(neighbor.target);
    }
  }

  // Cycle detection: if topo order doesn't include all nodes
  if (topoOrder.length !== nodes.length) {
    return null;
  }

  // Find longest path using DP
  const dist = new Map<string, number>();
  const prev = new Map<string, string>(); // node -> predecessor node

  for (const id of topoOrder) {
    dist.set(id, 0);
  }

  for (const u of topoOrder) {
    const d = dist.get(u)!;
    for (const neighbor of adj.get(u) ?? []) {
      const v = neighbor.target;
      if (d + 1 > (dist.get(v) ?? 0)) {
        dist.set(v, d + 1);
        prev.set(v, u);
      }
    }
  }

  // Find the node with the longest distance (end of critical path)
  let endNode = '';
  let maxDist = -1;
  for (const [id, d] of dist) {
    if (d > maxDist) {
      maxDist = d;
      endNode = id;
    }
  }

  if (maxDist <= 0) {
    return { nodeIds: new Set(), edgeIds: new Set() };
  }

  // Trace back the critical path
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  let current = endNode;

  while (current) {
    nodeIds.add(current);
    const predecessor = prev.get(current);
    if (predecessor) {
      const eId = edgeMap.get(`${predecessor}->${current}`);
      if (eId) edgeIds.add(eId);
      current = predecessor;
    } else {
      break;
    }
  }

  return { nodeIds, edgeIds };
}
