import { useState, useEffect, useMemo, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { MarkerType, type Node, type Edge } from '@xyflow/react';
import dagre from 'dagre';
import { useProjectsStore, useTikiStateStore, type TikiRelease } from '../../stores';
import { parseDependencies } from './parseDependencies';
import { derivePhaseProgressFromPlan } from './phaseProgress';
import type { IssueNodeData } from './IssueNode';

type IssueNodeType = Node<IssueNodeData, 'issue'>;

interface FetchedIssue {
  number: number;
  title: string;
  body?: string;
  state: string;
  phaseCount?: number;
  labels?: { name: string; color: string }[];
  /** Per-phase status from the on-disk plan — the DURABLE source for phase
   *  progress (survives completion, unlike activeWork[issue:N].phase). */
  phases?: { status: string }[];
  /** Retained from the plan for #257's success-criteria panel. #256 keeps these
   *  in hand (the get_plan call already returns them) so #257 is pure UI; phase
   *  progress itself does not consume them. */
  successCriteria?: { id: string; description: string; category?: string }[];
  coverageMatrix?: Record<string, number[]>;
}

/** Subset of the camelCase TikiPlan JSON returned by the get_plan IPC command
 *  that the graph cares about (mirrors apps/desktop/src/components/detail
 *  /IssueDetail.tsx's TikiPlan interface — desktop keeps local type mirrors). */
interface PlanShape {
  phases?: { status: string }[];
  successCriteria?: { id: string; description: string; category?: string }[];
  coverageMatrix?: Record<string, number[]>;
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
          invoke<PlanShape | null>('get_plan', {
            issueNumber: issue.number,
            tikiPath,
          }).catch(() => null),
        ]);
        const ph = plan?.phases;
        const phases = Array.isArray(ph) ? ph : undefined;
        return {
          ...details,
          phaseCount: phases ? phases.length : undefined,
          phases: phases ? phases.map((p) => ({ status: p.status })) : undefined,
          successCriteria: plan?.successCriteria,
          coverageMatrix: plan?.coverageMatrix,
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

  // Live plan refresh (#256). When a plan file is written, the Rust watcher
  // fires planChanged → useTikiFileSync bumps that issue's planNonce. Re-read
  // ONLY the changed plans (local get_plan, NO GitHub re-fetch) and patch the
  // matching fetchedIssues entries so plan-derived phase progress ticks live as
  // EXECUTE completes phases. Keyed solely on planNonces; release/path are read
  // through refs so this never re-fires on release change (the main effect owns
  // that) and never double-fetches GitHub. Adding fetchedIssues to the main
  // effect's deps instead would infinite-loop — hence this separate path.
  const planNonces = useTikiStateStore((s) => s.planNonces);
  const releaseRef = useRef(release);
  releaseRef.current = release;
  const projectPathRef = useRef(activeProject?.path);
  projectPathRef.current = activeProject?.path;
  const prevNoncesRef = useRef(planNonces);
  useEffect(() => {
    const prev = prevNoncesRef.current;
    prevNoncesRef.current = planNonces;
    // Diff against the previous map; on mount prev === planNonces so this is
    // empty and we no-op (the main effect already loaded plans).
    const changed = Object.keys(planNonces)
      .map(Number)
      .filter((n) => planNonces[n] !== prev[n]);
    if (changed.length === 0) return;

    const rel = releaseRef.current;
    if (!rel) return;
    const relevant = changed.filter((n) => rel.issues.some((i) => i.number === n));
    if (relevant.length === 0) return;

    const path = projectPathRef.current;
    const tikiPath = path ? `${path}/.tiki` : undefined;
    let cancelled = false;
    Promise.all(
      relevant.map((n) =>
        invoke<PlanShape | null>('get_plan', { issueNumber: n, tikiPath })
          .catch(() => null)
          .then((plan) => ({ number: n, plan }))
      )
    ).then((results) => {
      if (cancelled) return;
      const byNum = new Map(results.map((r) => [r.number, r.plan]));
      setFetchedIssues((prevIssues) =>
        prevIssues.map((fi) => {
          if (!byNum.has(fi.number)) return fi;
          const plan = byNum.get(fi.number) ?? null;
          const ph = plan?.phases;
          const phases = Array.isArray(ph) ? ph : undefined;
          return {
            ...fi,
            phaseCount: phases ? phases.length : fi.phaseCount,
            phases: phases ? phases.map((p) => ({ status: p.status })) : fi.phases,
            successCriteria: plan?.successCriteria ?? fi.successCriteria,
            coverageMatrix: plan?.coverageMatrix ?? fi.coverageMatrix,
          };
        })
      );
    });
    return () => {
      cancelled = true;
    };
  }, [planNonces]);

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

  // Live phase progress for the issue that is ACTIVELY executing right now.
  // Gated on phase.status === 'executing' so a planning/pending entry (which
  // also carries a phase object, e.g. {current:1,total:5,status:'pending'})
  // does not overcount — those fall through to the durable plan-derived count.
  const resolvePhaseProgress = (
    issue: FetchedIssue
  ): IssueNodeData['phaseProgress'] => {
    const work = activeWork[`issue:${issue.number}`];
    const phase = (
      work as { phase?: { current?: number; total?: number; status?: string } } | undefined
    )?.phase;
    if (
      phase &&
      phase.status === 'executing' &&
      typeof phase.current === 'number' &&
      typeof phase.total === 'number' &&
      phase.total > 0
    ) {
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
          // Live executing override first; otherwise durable plan-derived count
          // (0/N pending, N/N completed/shipped) even with no activeWork entry.
          phaseProgress:
            resolvePhaseProgress(issue) ?? derivePhaseProgressFromPlan(issue.phases),
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
