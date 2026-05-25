import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import './IssueNode.css';

export type IssueNodeData = {
  issueNumber: number;
  title: string;
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'open' | 'closed';
  phaseProgress?: { current: number; total: number };
  phaseCount?: number;
  labels?: { name: string; color: string }[];
};

// Mirror of computeNodeHeight in useDependencyGraph.ts. Kept local so the
// rendered box honors dagre's allocation without an import cycle through the
// hook module.
function nodeHeightFor(phaseCount: number | undefined): number {
  if (phaseCount === undefined) return 60;
  if (phaseCount <= 1) return 50;
  if (phaseCount <= 3) return 60;
  if (phaseCount <= 6) return 75;
  return 90;
}

type IssueNodeType = Node<IssueNodeData, 'issue'>;

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  executing: 'In Progress',
  completed: 'Completed',
  failed: 'Failed',
  open: 'Open',
  closed: 'Closed',
};

// Memoized (#266): on hover the graph re-derives `styledNodes` — a fresh array
// where every node gets a new `className` (lineage/dimmed) but keeps the same
// `data` reference. Without memo, React re-rendered every node's inner JSX on
// each hover, and that re-render churn (combined with the CSS transitions) is
// what made nodes visibly blink. The dim/lineage highlight is applied by React
// Flow to the node WRAPPER as pure CSS, so memoizing the inner component keeps
// the highlight working while eliminating the per-hover re-render storm.
function IssueNodeComponent({ data }: NodeProps<IssueNodeType>) {
  const truncatedTitle =
    data.title.length > 30 ? data.title.slice(0, 28) + '...' : data.title;

  // Progress fill: full for completed/closed, current/total for executing,
  // empty for everything else. Undefined phaseProgress hides the bar.
  const isDone = data.status === 'completed' || data.status === 'closed';
  const percent = isDone
    ? 100
    : data.phaseProgress && data.phaseProgress.total > 0
      ? Math.round((data.phaseProgress.current / data.phaseProgress.total) * 100)
      : 0;
  const showProgress = isDone || data.phaseProgress !== undefined;
  const minHeight = nodeHeightFor(data.phaseCount);

  return (
    <div
      className={`issue-node issue-node-${data.status}`}
      style={{ minHeight }}
    >
      <Handle type="target" position={Position.Top} />
      <div className="issue-node-header">
        <span className="issue-node-number">#{data.issueNumber}</span>
        {data.phaseProgress && (
          <span
            className={`issue-node-phasecount issue-node-phasecount-${data.status}`}
            title={`Phase ${data.phaseProgress.current} of ${data.phaseProgress.total}`}
          >
            {data.phaseProgress.current}/{data.phaseProgress.total}
          </span>
        )}
        <span className={`issue-node-status issue-node-status-${data.status}`}>
          {STATUS_LABELS[data.status] ?? data.status}
        </span>
      </div>
      <div className="issue-node-title">{truncatedTitle}</div>
      {data.labels && data.labels.length > 0 && (
        <div className="issue-node-labels" aria-hidden="true">
          {data.labels.slice(0, 4).map((l) => (
            <span
              key={l.name}
              className="issue-node-label-chip"
              style={{ backgroundColor: `#${l.color}` }}
              title={l.name}
            />
          ))}
          {data.labels.length > 4 && (
            <span
              className="issue-node-label-overflow"
              title={data.labels.slice(4).map((l) => l.name).join(', ')}
            >
              +{data.labels.length - 4}
            </span>
          )}
        </div>
      )}
      {showProgress && (
        <div className="issue-node-progress" aria-hidden="true">
          <div
            className={`issue-node-progress-fill issue-node-progress-${data.status}`}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export const IssueNode = memo(IssueNodeComponent);
