import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  useReactFlow,
  ReactFlowProvider,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { invoke } from '@tauri-apps/api/core';
import { IssueNode } from './IssueNode';
import { SwimlaneLayer } from './SwimlaneLayer';
import { useDependencyGraph } from './useDependencyGraph';
import { findCriticalPath } from './criticalPath';
import { useTikiReleasesStore, useProjectsStore, type TikiRelease } from '../../stores';
import './DependencyGraph.css';

const nodeTypes: NodeTypes = {
  issue: IssueNode,
};

function DependencyGraphInner() {
  // Central store (sidebar's view) — active releases only, never archived.
  // Used as the trigger for re-fetching our archive-inclusive list.
  const storeReleases = useTikiReleasesStore((s) => s.releases);
  const activeProject = useProjectsStore((s) => s.getActiveProject());
  const { fitView } = useReactFlow();

  // Local archive-inclusive release list (graph-only). Includes shipped releases
  // from .tiki/releases/archive/ so historical work is browseable here without
  // re-introducing #142's sidebar regression.
  const [releases, setReleases] = useState<TikiRelease[]>(storeReleases);

  useEffect(() => {
    let cancelled = false;
    const tikiPath = activeProject ? `${activeProject.path}\\.tiki` : undefined;
    invoke<TikiRelease[]>('load_tiki_releases', { tikiPath, includeArchived: true })
      .then((all) => {
        if (!cancelled) setReleases(all);
      })
      .catch((e) => {
        console.error('Dependency Graph: failed to load archive-inclusive releases:', e);
      });
    return () => {
      cancelled = true;
    };
    // storeReleases dependency: re-fetch when the central store updates (file watcher
    // signalled a change). activeProject changes also trigger a re-fetch.
  }, [storeReleases, activeProject]);

  // Promote active releases to top; backend already returns descending semver order.
  const sortedReleases = useMemo(() => {
    return [...releases].sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (b.status === 'active' && a.status !== 'active') return 1;
      return 0;
    });
  }, [releases]);

  // Auto-select the first active release, or the first release
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  useEffect(() => {
    if (selectedVersion) return;
    const active = sortedReleases.find((r) => r.status === 'active');
    if (active) setSelectedVersion(active.version);
    else if (sortedReleases.length > 0) setSelectedVersion(sortedReleases[0].version);
  }, [sortedReleases, selectedVersion]);

  const [showCriticalPath, setShowCriticalPath] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const { nodes, edges, isLoading, error, hasEdges, issueCount } =
    useDependencyGraph(selectedVersion, releases);

  // Compute critical path
  const criticalPath = useMemo(() => {
    if (!showCriticalPath || !hasEdges) return null;
    return findCriticalPath(nodes, edges);
  }, [nodes, edges, showCriticalPath, hasEdges]);

  const hasCycle = showCriticalPath && hasEdges && criticalPath === null;

  // Pre-compute adjacency maps so per-hover lineage BFS is cheap.
  const adjacency = useMemo(() => {
    const forward = new Map<string, Set<string>>();
    const backward = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!forward.has(e.source)) forward.set(e.source, new Set());
      forward.get(e.source)!.add(e.target);
      if (!backward.has(e.target)) backward.set(e.target, new Set());
      backward.get(e.target)!.add(e.source);
    }
    return { forward, backward };
  }, [edges]);

  // When a node is hovered, compute its lineage (ancestors + descendants + edges
  // along the chain). Memoized per hoveredId so re-hovers are cheap.
  const lineage = useMemo(() => {
    if (!hoveredId) return null;
    const nodeIds = new Set<string>([hoveredId]);
    const edgeIds = new Set<string>();
    const walk = (start: string, dir: 'forward' | 'backward') => {
      const map = dir === 'forward' ? adjacency.forward : adjacency.backward;
      const queue = [start];
      const seen = new Set([start]);
      while (queue.length) {
        const id = queue.shift()!;
        const next = map.get(id);
        if (!next) continue;
        for (const n of next) {
          if (seen.has(n)) continue;
          seen.add(n);
          nodeIds.add(n);
          queue.push(n);
          const edgeId =
            dir === 'forward' ? `e${id}-${n}` : `e${n}-${id}`;
          edgeIds.add(edgeId);
        }
      }
    };
    walk(hoveredId, 'forward');
    walk(hoveredId, 'backward');
    return { nodeIds, edgeIds };
  }, [hoveredId, adjacency]);

  // Apply edge styling: hover lineage takes precedence over critical path.
  const styledEdges = useMemo(() => {
    if (lineage) {
      return edges.map((edge) => {
        const inLineage = lineage.edgeIds.has(edge.id);
        return {
          ...edge,
          style: {
            ...edge.style,
            stroke: 'var(--text-secondary, #555)',
            strokeWidth: inLineage ? 2.5 : 2,
            opacity: inLineage ? 1 : 0.15,
          },
          animated: false,
        };
      });
    }
    if (!criticalPath || criticalPath.edgeIds.size === 0) return edges;
    return edges.map((edge) => {
      const isOnPath = criticalPath.edgeIds.has(edge.id);
      return {
        ...edge,
        style: {
          ...edge.style,
          stroke: isOnPath ? '#f59e0b' : 'var(--text-secondary, #555)',
          strokeWidth: isOnPath ? 3 : 2,
          opacity: isOnPath ? 1 : 0.3,
        },
        animated: isOnPath,
      };
    });
  }, [edges, criticalPath, lineage]);

  // Apply node styling: hover lineage takes precedence over critical path.
  const styledNodes = useMemo(() => {
    if (lineage) {
      return nodes.map((node) => ({
        ...node,
        className: lineage.nodeIds.has(node.id) ? 'lineage-node' : 'dimmed-node',
      }));
    }
    if (!criticalPath || criticalPath.nodeIds.size === 0) return nodes;
    return nodes.map((node) => {
      const isOnPath = criticalPath.nodeIds.has(node.id);
      return {
        ...node,
        className: isOnPath ? 'critical-path-node' : 'dimmed-node',
      };
    });
  }, [nodes, criticalPath, lineage]);

  const isStyled = showCriticalPath || lineage !== null;

  const handleFitView = useCallback(() => {
    fitView({ padding: 0.2, duration: 300 });
  }, [fitView]);

  // No releases at all
  if (releases.length === 0) {
    return (
      <div className="dependency-graph">
        <div className="dependency-graph-empty">
          <h2>No Releases</h2>
          <p>Create a release to visualize issue dependencies.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dependency-graph">
      <div className="dependency-graph-toolbar">
        <label className="dependency-graph-label">Release:</label>
        <select
          className="dependency-graph-select"
          value={selectedVersion ?? ''}
          onChange={(e) => setSelectedVersion(e.target.value || null)}
        >
          {sortedReleases.map((r) => (
            <option key={r.version} value={r.version}>
              {r.version} ({r.issues.length} issue{r.issues.length !== 1 ? 's' : ''}) — {r.status}
            </option>
          ))}
        </select>

        {hasEdges && (
          <button
            className={`dependency-graph-btn ${showCriticalPath ? 'dependency-graph-btn-active' : ''}`}
            onClick={() => setShowCriticalPath((v) => !v)}
            title="Highlight the longest dependency chain"
          >
            Critical Path
          </button>
        )}

        <button
          className="dependency-graph-btn"
          onClick={handleFitView}
          title="Fit all nodes in view"
        >
          Fit View
        </button>
      </div>

      {isLoading && (
        <div className="dependency-graph-empty">
          <p>Loading issue data...</p>
        </div>
      )}

      {error && (
        <div className="dependency-graph-empty">
          <p className="dependency-graph-error">Error: {error}</p>
        </div>
      )}

      {!isLoading && !error && issueCount === 0 && (
        <div className="dependency-graph-empty">
          <h2>No Issues</h2>
          <p>This release has no issues assigned.</p>
        </div>
      )}

      {!isLoading && !error && issueCount > 0 && (
        <div className="dependency-graph-container">
          {!hasEdges && (
            <div className="dependency-graph-no-deps-banner">
              No dependency relationships found between issues in this release.
            </div>
          )}
          {hasCycle && (
            <div className="dependency-graph-cycle-warning">
              Circular dependency detected — critical path cannot be calculated.
            </div>
          )}
          <ReactFlow
            nodes={isStyled ? styledNodes : nodes}
            edges={isStyled ? styledEdges : edges}
            nodeTypes={nodeTypes}
            onNodeMouseEnter={(_, node) => setHoveredId(node.id)}
            onNodeMouseLeave={() => setHoveredId(null)}
            fitView
            minZoom={0.3}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
          >
            <SwimlaneLayer />
            <Background gap={20} size={1} />
            <Controls showFitView={false} />
          </ReactFlow>
          <div className="dependency-graph-legend">
            <span className="dependency-graph-legend-item">
              <span className="dependency-graph-legend-dot legend-dot-open" /> Open
            </span>
            <span className="dependency-graph-legend-item">
              <span className="dependency-graph-legend-dot legend-dot-executing" /> In Progress
            </span>
            <span className="dependency-graph-legend-item">
              <span className="dependency-graph-legend-dot legend-dot-completed" /> Completed
            </span>
            <span className="dependency-graph-legend-item">
              <span className="dependency-graph-legend-dot legend-dot-failed" /> Failed
            </span>
            {hasEdges && (
              <>
                <span className="dependency-graph-legend-item">
                  <span className="dependency-graph-legend-edge dependency-graph-legend-edge-solid" /> Depends on
                </span>
                <span className="dependency-graph-legend-item">
                  <span className="dependency-graph-legend-edge dependency-graph-legend-edge-dashed" /> Related to
                </span>
              </>
            )}
            {showCriticalPath && criticalPath && criticalPath.edgeIds.size > 0 && (
              <span className="dependency-graph-legend-item">
                <span className="dependency-graph-legend-dot legend-dot-critical" /> Critical
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Wrap with ReactFlowProvider so useReactFlow() works
export function DependencyGraph() {
  return (
    <ReactFlowProvider>
      <DependencyGraphInner />
    </ReactFlowProvider>
  );
}
