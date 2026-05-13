import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import './IssueNode.css';

export type IssueNodeData = {
  issueNumber: number;
  title: string;
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'open' | 'closed';
  phaseProgress?: { current: number; total: number };
};

type IssueNodeType = Node<IssueNodeData, 'issue'>;

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  executing: 'In Progress',
  completed: 'Completed',
  failed: 'Failed',
  open: 'Open',
  closed: 'Closed',
};

export function IssueNode({ data }: NodeProps<IssueNodeType>) {
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

  return (
    <div className={`issue-node issue-node-${data.status}`}>
      <Handle type="target" position={Position.Top} />
      <div className="issue-node-header">
        <span className="issue-node-number">#{data.issueNumber}</span>
        <span className={`issue-node-status issue-node-status-${data.status}`}>
          {STATUS_LABELS[data.status] ?? data.status}
        </span>
      </div>
      <div className="issue-node-title">{truncatedTitle}</div>
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
