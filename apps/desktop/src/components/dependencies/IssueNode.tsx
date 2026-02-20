import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import './IssueNode.css';

export type IssueNodeData = {
  issueNumber: number;
  title: string;
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'open' | 'closed';
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
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
