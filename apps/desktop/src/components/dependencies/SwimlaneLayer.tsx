import { useMemo } from 'react';
import { useNodes, useStore, type Node } from '@xyflow/react';
import type { IssueNodeData } from './IssueNode';

type IssueNodeType = Node<IssueNodeData, 'issue'>;

const STATUS_PRIORITY: Record<string, number> = {
  executing: 5,
  failed: 4,
  pending: 3,
  open: 3,
  completed: 2,
  closed: 2,
};

const BAND_BG: Record<string, string> = {
  executing: 'rgba(96, 165, 250, 0.06)',
  failed: 'rgba(239, 68, 68, 0.06)',
  pending: 'rgba(255, 255, 255, 0.02)',
  open: 'rgba(255, 255, 255, 0.02)',
  completed: 'rgba(34, 197, 94, 0.04)',
  closed: 'rgba(34, 197, 94, 0.04)',
};

interface Band {
  yStart: number;
  yEnd: number;
  status: string;
}

/**
 * Renders horizontal swimlane backgrounds behind the dependency graph nodes,
 * one band per dagre rank, colored by the dominant status of nodes at that rank.
 *
 * Lives as a child of <ReactFlow> so it shares the viewport transform via the
 * standard zustand store-state pattern. Tracks pan/zoom natively.
 */
export function SwimlaneLayer() {
  const nodes = useNodes<IssueNodeType>();
  const transform = useStore((s) => s.transform);

  const bands = useMemo<Band[]>(() => {
    if (nodes.length === 0) return [];

    // Group nodes by rounded position.y (each unique y is a dagre rank).
    const ranks = new Map<number, { statuses: string[] }>();
    for (const node of nodes) {
      const y = Math.round(node.position.y);
      const status = node.data?.status ?? 'pending';
      const bucket = ranks.get(y) ?? { statuses: [] };
      bucket.statuses.push(status);
      ranks.set(y, bucket);
    }

    // Sort ranks ascending by y.
    const sortedRanks = Array.from(ranks.entries()).sort(([a], [b]) => a - b);

    // Resolve dominant status per rank (most frequent; tie broken by STATUS_PRIORITY).
    const rankSummaries = sortedRanks.map(([y, { statuses }]) => {
      const counts: Record<string, number> = {};
      for (const s of statuses) counts[s] = (counts[s] ?? 0) + 1;
      const max = Math.max(...Object.values(counts));
      const dominants = Object.entries(counts).filter(([, n]) => n === max).map(([s]) => s);
      dominants.sort((a, b) => (STATUS_PRIORITY[b] ?? 0) - (STATUS_PRIORITY[a] ?? 0));
      return { y, status: dominants[0] };
    });

    // Compute vertical band extents: midpoints between adjacent rank y-values.
    // Node height in dagre layout is ~60px, so extend ~80px above/below for top/bottom.
    return rankSummaries.map((r, i) => {
      const prevY = i === 0 ? r.y - 80 : (rankSummaries[i - 1].y + r.y) / 2;
      const nextY = i === rankSummaries.length - 1 ? r.y + 80 : (r.y + rankSummaries[i + 1].y) / 2;
      return { yStart: prevY, yEnd: nextY, status: r.status };
    });
  }, [nodes]);

  if (bands.length === 0) return null;

  const [tx, ty, tz] = transform;

  return (
    <div
      className="dependency-graph-swimlanes"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 0,
      }}
    >
      <div
        style={{
          position: 'absolute',
          transform: `translate(${tx}px, ${ty}px) scale(${tz})`,
          transformOrigin: '0 0',
          width: '100%',
          height: '100%',
        }}
      >
        {bands.map((b, i) => (
          <div
            key={i}
            className={`dependency-graph-swimlane swimlane-${b.status}`}
            style={{
              position: 'absolute',
              left: -5000,
              right: -5000,
              top: b.yStart,
              height: b.yEnd - b.yStart,
              background: BAND_BG[b.status] ?? BAND_BG.pending,
              pointerEvents: 'none',
            }}
          />
        ))}
      </div>
    </div>
  );
}
