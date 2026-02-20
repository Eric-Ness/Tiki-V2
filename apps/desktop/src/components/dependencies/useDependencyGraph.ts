import { useState, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { MarkerType, type Node, type Edge } from '@xyflow/react';
import dagre from 'dagre';
import { useTikiReleasesStore, useProjectsStore, useTikiStateStore } from '../../stores';
import { parseDependencies } from './parseDependencies';
import type { IssueNodeData } from './IssueNode';

type IssueNodeType = Node<IssueNodeData, 'issue'>;

interface FetchedIssue {
  number: number;
  title: string;
  body?: string;
  state: string;
}

function layoutGraph(nodes: IssueNodeType[], edges: Edge[]) {
  if (nodes.length === 0) return { nodes: [], edges: [] };

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 80 });

  nodes.forEach((node) => {
    g.setNode(node.id, { width: 200, height: 60 });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: { x: pos.x - 100, y: pos.y - 30 },
    };
  });

  return { nodes: layoutedNodes, edges };
}

export function useDependencyGraph(releaseVersion: string | null) {
  const releases = useTikiReleasesStore((s) => s.releases);
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

    Promise.all(
      release.issues.map((issue) =>
        invoke<FetchedIssue>('fetch_github_issue_by_number', {
          number: issue.number,
          projectPath: activeProject?.path ?? null,
        }).catch(() => ({
          number: issue.number,
          title: issue.title,
          body: undefined,
          state: 'open',
        }))
      )
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

  // Build nodes and edges from fetched issues
  const { nodes, edges, hasEdges } = useMemo(() => {
    if (!release || fetchedIssues.length === 0) {
      return { nodes: [] as IssueNodeType[], edges: [] as Edge[], hasEdges: false };
    }

    const issueNumbers = new Set(release.issues.map((i) => i.number));

    // Build nodes
    const nodes: IssueNodeType[] = fetchedIssues.map((issue) => ({
      id: String(issue.number),
      type: 'issue' as const,
      position: { x: 0, y: 0 },
      data: {
        issueNumber: issue.number,
        title: issue.title,
        status: resolveStatus(issue),
      },
    }));

    // Build edges by parsing dependencies from issue bodies
    const edges: Edge[] = [];
    fetchedIssues.forEach((issue) => {
      if (!issue.body) return;
      const deps = parseDependencies(issue.body, issueNumbers);
      deps.forEach((depNumber) => {
        edges.push({
          id: `e${depNumber}-${issue.number}`,
          source: String(depNumber),
          target: String(issue.number),
          animated: false,
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        });
      });
    });

    const layouted = layoutGraph(nodes, edges);
    return { ...layouted, hasEdges: edges.length > 0 };
  }, [release, fetchedIssues, activeWork, recentIssues]);

  return { nodes, edges, isLoading, error, hasEdges, issueCount: release?.issues.length ?? 0 };
}
