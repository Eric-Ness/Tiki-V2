import { useDraggable } from '@dnd-kit/core';
import { useDetailStore } from '../../stores';
import type { GitHubIssue } from '../../stores';

export interface WorkItem {
  status: 'pending' | 'planning' | 'executing' | 'paused' | 'shipping' | 'completed' | 'failed';
  currentPhase?: number;
  totalPhases?: number;
  phaseName?: string;
}

export interface KanbanCardProps {
  issue: GitHubIssue;
  workItem?: WorkItem;
  isSelected?: boolean;
  isDragging?: boolean;
  isBeingDragged?: boolean;
}

export function KanbanCard({ issue, workItem, isSelected, isDragging, isBeingDragged }: KanbanCardProps) {
  const setSelectedIssue = useDetailStore((s) => s.setSelectedIssue);

  const isPaused = workItem?.status === 'paused';
  const isFailed = workItem?.status === 'failed';
  const isExecuting = workItem?.status === 'executing';
  const isCompleted = issue.state === 'closed';

  // Only make non-completed cards draggable
  const { attributes, listeners, setNodeRef, isDragging: isDraggingFromHook } = useDraggable({
    id: issue.number,
    disabled: isCompleted,
  });

  const classNames = [
    'kanban-card',
    isSelected && 'kanban-card--selected',
    isPaused && 'kanban-card--paused',
    isFailed && 'kanban-card--failed',
    (isDragging || isDraggingFromHook || isBeingDragged) && 'kanban-card--dragging',
    isCompleted && 'kanban-card--completed',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={setNodeRef}
      className={classNames}
      onClick={() => setSelectedIssue(issue.number)}
      {...listeners}
      {...attributes}
    >
      <div className="kanban-card-header">
        <span className="kanban-card-number">#{issue.number}</span>
        {isPaused && <span className="kanban-card-badge kanban-card-badge--paused">⏸</span>}
        {isFailed && <span className="kanban-card-badge kanban-card-badge--failed">!</span>}
      </div>

      <div className="kanban-card-title">{issue.title}</div>

      {issue.labels.length > 0 && (
        <div className="kanban-card-labels">
          {issue.labels.slice(0, 3).map((label) => (
            <span
              key={label.id}
              className="kanban-card-label"
              style={{ backgroundColor: `#${label.color}` }}
              title={label.name}
            />
          ))}
        </div>
      )}

      {isExecuting && workItem && workItem.currentPhase && workItem.totalPhases && (
        <div className="kanban-card-progress" title={workItem.phaseName || ''}>
          <div
            className="kanban-card-progress-bar"
            style={{ width: `${(workItem.currentPhase / workItem.totalPhases) * 100}%` }}
          />
          <span className="kanban-card-progress-text">
            Phase {workItem.currentPhase}/{workItem.totalPhases}
          </span>
        </div>
      )}
    </div>
  );
}
