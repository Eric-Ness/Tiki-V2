import { useDraggable } from '@dnd-kit/core';
import { motion } from 'framer-motion';
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
  onExecute?: (issueNumber: number) => void;
}

export function KanbanCard({ issue, workItem, isSelected, isDragging, isBeingDragged, onExecute }: KanbanCardProps) {
  const setSelectedIssue = useDetailStore((s) => s.setSelectedIssue);

  const isPaused = workItem?.status === 'paused';
  const isFailed = workItem?.status === 'failed';
  const isExecuting = workItem?.status === 'executing';
  const isCompleted = issue.state.toLowerCase() === 'closed';
  const canExecute = !isCompleted && !isExecuting && onExecute;

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
        <div className="kanban-card-actions">
          {isPaused && <span className="kanban-card-badge kanban-card-badge--paused">⏸</span>}
          {isFailed && <span className="kanban-card-badge kanban-card-badge--failed">!</span>}
          {canExecute && (
            <button
              className="kanban-card-play"
              onClick={(e) => {
                e.stopPropagation();
                onExecute(issue.number);
              }}
              title="Start execution"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
          )}
        </div>
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
          <motion.div
            className="kanban-card-progress-bar"
            initial={false}
            animate={{ width: `${(workItem.currentPhase / workItem.totalPhases) * 100}%` }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          />
          <span className="kanban-card-progress-text">
            Phase {workItem.currentPhase}/{workItem.totalPhases}
          </span>
        </div>
      )}
    </div>
  );
}
