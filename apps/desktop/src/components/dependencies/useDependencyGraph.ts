import { useState, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { MarkerType, type Node, type Edge } from '@xyflow/react';
import dagre from 'dagre';
import { useProjectsStore, useTikiStateStore, type TikiRelease } from '../../stores';
import { parseDependencies } from './parseDependencies';
import type { IssueNodeData } from './IssueNode';

type IssueNodeType = Node<IssueNodeData, 'issue'>;

interface FetchedIssue {
  number: number;
  title: string;
  body?: string;
  state: string;
  phaseCount?: number;
  labels?: { name: string; color: string }[];
}

// Maps plan phase count to a node visual height. Undefined = no plan yet
// (renders at default 60). Explicit 1 = smaller (50) so single-phase fixes
// telegraph as light work. Saturates at 90 so a 20-phase epic doesn't dwarf
// the canvas.
export function computeNodeHeight(phaseCount: number | undefined): number {
  if (phaseCount === undefined) return 60;
  if (phaseCount <= 1) return 50;
  if (phaseCount <= 3) return 60;
  if (phaseCount <= 6) return 75;
  return 90;
}

function layoutGraph(
  nodes: IssueNodeType[],
  edges: Edge[],
  heights: Map<string, number>
) {
  if (nodes.length === 0) return { nodes: [], edges: [] };

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 80 });

  nodes.forEach((node) => {
    const h = heights.get(node.id) ?? 60;
    g.setNode(node.id, { width: 200, height: h });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id);
    const h = heights.get(node.id) ?? 60;
    return {
      ...node,
      position: { x: pos.x - 100, y: pos.y - h / 2 },
    };
  });

  return { nodes: layoutedNodes, edges };
}

export function useDependencyGraph(releaseVersion: string | null, releases: TikiRelease[]) {
  const activeProject = useProjectsStore((s) => s.getActiveProject());
  const activeWork = useTikiStateStore((s) => s.activeWork);
  const recentIssues = useTikiStateStore((s) => s.recentIssues);
  const [fetchedIssues, setFetchedIssues] = useState<FetchedIssue[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const release = useMemo(
    () => releases.find((r) => r.version === releaseVersion),
    [releases, releaseVersion]
  );

  // Fetch issue details when release changes
  useEffect(() => {
    if (!release || release.issues.length === 0) {
      setFetchedIssues([]);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const tikiPath = activeProject?.path
      ? `${activeProject.path}/.tiki`
      : undefined;

    Promise.all(
      release.issues.map(async (issue) => {
        const [details, plan] = await Promise.all([
          invoke<FetchedIssue>('fetch_github_issue_by_number', {
            number: issue.number,
            projectPath: activeProject?.path ?? null,
          }).catch(() => ({
            number: issue.number,
            title: issue.title,
            body: undefined,
            state: 'open',
            labels: [],
          })),
          invoke<{ phases?: unknown[] } | null>('get_plan', {
            issueNumber: issue.number,
            tikiPath,
          }).catch(() => null),
        ]);
        return {
          ...details,
          phaseCount: Array.isArray(plan?.phases) ? plan.phases.length : undefined,
        };
      })
    )
      .then((issues) => {
        if (!cancelled) {
          setFetchedIssues(issues);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err));
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [release, activeProject?.path]);

  // Resolve issue status from Tiki state, falling back to GitHub state
  const resolveStatus = (issue: FetchedIssue): IssueNodeData['status'] => {
    // Check active work first
    const workKey = `issue:${issue.number}`;
    const work = activeWork[workKey];
    if (work) {
      const s = work.status;
      if (s === 'executing') return 'executing';
      if (s === 'failed') return 'failed';
      if (s === 'completed') return 'completed';
      return 'pending';
    }

    // Check recent completed issues
    const recent = recentIssues.find((i) => i.number === issue.number);
    if (recent) return 'completed';

    // Fall back to GitHub state
    return issue.state === 'closed' ? 'closed' : 'open';
  };

  // Surface live phase progress for executing issues so the graph node can
  // render a progress bar reflecting current/total phases.
  const resolvePhaseProgress = (
    issue: FetchedIssue
  ): IssueNodeData['phaseProgress'] => {
    const work = activeWork[`issue:${issue.number}`];
    const phase = (work as { phase?: { current?: number; total?: number } } | undefined)?.phase;
    if (phase && typeof phase.current === 'number' && typeof phase.total === 'number' && phase.total > 0) {
      return { current: phase.current, total: phase.total };
    }
    return undefined;
  };

  // Build nodes and edges from fetched issues
  const { nodes, edges, hasEdges } = useMemo(() => {
    if (!release || fetchedIssues.length === 0) {
      return { nodes: [] as IssueNodeType[], edges: [] as Edge[], hasEdges: false };
    }

    const issueNumbers = new Set(release.issues.map((i) => i.number));

    // Build nodes + capture per-node heights for the dagre layout.
    const heights = new Map<string, number>();
    const nodes: IssueNodeType[] = fetchedIssues.map((issue) => {
      const h = computeNodeHeight(issue.phaseCount);
      heights.set(String(issue.number), h);
      return {
        id: String(issue.number),
        type: 'issue' as const,
        position: { x: 0, y: 0 },
        data: {
          issueNumber: issue.number,
          title: issue.title,
          status: resolveStatus(issue),
          phaseProgress: resolvePhaseProgress(issue),
          phaseCount: issue.phaseCount,
          labels: issue.labels ?? [],
        },
      };
    });

    // Lookup of resolved status by node id so the edge builder can decide
    // whether work is currently flowing through each edge.
    const statusByNodeId = new Map<string, IssueNodeData['status']>();
    nodes.forEach((n) => statusByNodeId.set(n.id, n.data.status));

    // Build edges by parsing dependencies from issue bodies
    const edges: Edge[] = [];
    fetchedIssues.forEach((issue) => {
      if (!issue.body) return;
      const deps = parseDependencies(issue.body, issueNumbers);
      deps.forEach((dep) => {
        const sourceStatus = statusByNodeId.get(String(dep.number));
        const targetStatus = statusByNodeId.get(String(issue.number));
        const isFlowing =
          (sourceStatus === 'completed' || sourceStatus === 'closed') &&
          targetStatus === 'executing';

        edges.push({
          id: `e${dep.number}-${issue.number}`,
          source: String(dep.number),
          target: String(issue.number),
          animated: isFlowing,
          data: { kind: dep.kind },
          style: dep.kind === 'soft' ? { strokeDasharray: '6 4' } : undefined,
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        });
      });
    });

    const layouted = layoutGraph(nodes, edges, heights);
    return { ...layouted, hasEdges: edges.length > 0 };
  }, [release, fetchedIssues, activeWork, recentIssues]);

  return { nodes, edges, isLoading, error, hasEdges, issueCount: release?.issues.length ?? 0 };
}
