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
import { IssueNode } from './IssueNode';
import { useDependencyGraph } from './useDependencyGraph';
import { findCriticalPath } from './criticalPath';
import { useTikiReleasesStore } from '../../stores';
import './DependencyGraph.css';

const nodeTypes: NodeTypes = {
  issue: IssueNode,
};

function DependencyGraphInner() {
  const releases = useTikiReleasesStore((s) => s.releases);
  const { fitView } = useReactFlow();

  // Sort releases: active first, then by version descending
  const sortedReleases = useMemo(() => {
    return [...releases].sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (b.status === 'active' && a.status !== 'active') return 1;
      return b.version.localeCompare(a.version);
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

  const { nodes, edges, isLoading, error, hasEdges, issueCount } =
    useDependencyGraph(selectedVersion);

  // Compute critical path
  const criticalPath = useMemo(() => {
    if (!showCriticalPath || !hasEdges) return null;
    return findCriticalPath(nodes, edges);
  }, [nodes, edges, showCriticalPath, hasEdges]);

  const hasCycle = showCriticalPath && hasEdges && criticalPath === null;

  // Apply critical path highlighting to edges
  const styledEdges = useMemo(() => {
    if (!criticalPath || criticalPath.edgeIds.size === 0) return edges;
    return edges.map((edge) => {
      const isOnPath = criticalPath.edgeIds.has(edge.id);
      return {
        ...edge,
        style: {
          stroke: isOnPath ? '#f59e0b' : 'var(--text-secondary, #555)',
          strokeWidth: isOnPath ? 3 : 2,
          opacity: isOnPath ? 1 : 0.3,
        },
        animated: isOnPath,
      };
    });
  }, [edges, criticalPath]);

  // Apply critical path highlighting to nodes
  const styledNodes = useMemo(() => {
    if (!criticalPath || criticalPath.nodeIds.size === 0) return nodes;
    return nodes.map((node) => {
      const isOnPath = criticalPath.nodeIds.has(node.id);
      return {
        ...node,
        className: isOnPath ? 'critical-path-node' : 'dimmed-node',
      };
    });
  }, [nodes, criticalPath]);

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
            nodes={showCriticalPath ? styledNodes : nodes}
            edges={showCriticalPath ? styledEdges : edges}
            nodeTypes={nodeTypes}
            fitView
            minZoom={0.3}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
          >
            <Controls showFitView={false} />
            <Background gap={20} size={1} />
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
