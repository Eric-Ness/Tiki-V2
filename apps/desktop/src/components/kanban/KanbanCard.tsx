import { memo, useMemo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { motion } from 'framer-motion';
import { useDetailStore, useProjectsStore, useSelectionStore } from '../../stores';
import type { GitHubIssue } from '../../stores';
import { useContextMenu, ContextMenu, type ContextMenuEntry } from '../ui/ContextMenu';

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
  /**
   * Column id ("open" | "review" | etc.) — used as the surface key for
   * shift+click range selection (`kanban:${columnId}`).
   */
  columnId: string;
  /**
   * Visible-order issue numbers in this column, used to compute the
   * range for shift+click selection.
   */
  surfaceIssueNumbers: number[];
  onExecute?: (issueNumber: number) => void;
  onShip?: (issueNumber: number) => void;
  onOpenInGitHub?: (issue: GitHubIssue) => void;
}

export const KanbanCard = memo(function KanbanCard({ issue, workItem, isSelected, isDragging, isBeingDragged, columnId, surfaceIssueNumbers, onExecute, onShip, onOpenInGitHub }: KanbanCardProps) {
  const setSelectedIssue = useDetailStore((s) => s.setSelectedIssue);
  const projectId = useProjectsStore((s) => s.activeProjectId) ?? 'default';
  const isBatchSelected = useSelectionStore(
    (s) => s.selectedByProject[projectId]?.has(issue.number) ?? false,
  );
  const toggleBatchSelection = useSelectionStore((s) => s.toggle);
  const rangeSelect = useSelectionStore((s) => s.rangeSelect);
  const surfaceKey = `kanban:${columnId}`;

  const handleCheckboxClick = (e: React.MouseEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.shiftKey) {
      // Shift-click: range select. Prevent the default toggle that
      // onChange would also produce — rangeSelect handles selection.
      e.preventDefault();
      rangeSelect(surfaceKey, surfaceIssueNumbers, issue.number);
    }
  };
  const contextMenu = useContextMenu();

  const isPaused = workItem?.status === 'paused';
  const isFailed = workItem?.status === 'failed';
  const isExecuting = workItem?.status === 'executing';
  const isCompleted = issue.state.toLowerCase() === 'closed';
  const canExecute = !isCompleted && !isExecuting && onExecute;
  const canShip = workItem?.status === 'shipping' || workItem?.status === 'executing';

  // Only make non-completed cards sortable/draggable
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isDraggingFromHook,
  } = useSortable({
    id: issue.number,
    disabled: isCompleted,
  });

  const sortableStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDraggingFromHook ? 0 : undefined,
  };

  const classNames = [
    'kanban-card',
    isSelected && 'kanban-card--selected',
    isBatchSelected && 'is-batch-selected',
    isPaused && 'kanban-card--paused',
    isFailed && 'kanban-card--failed',
    (isDragging || isDraggingFromHook || isBeingDragged) && 'kanban-card--dragging',
    isCompleted && 'kanban-card--completed',
  ]
    .filter(Boolean)
    .join(' ');

  const menuItems: ContextMenuEntry[] = useMemo(() => [
    {
      key: 'open-github',
      label: 'Open in GitHub',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      ),
      onClick: () => onOpenInGitHub?.(issue),
    },
    {
      key: 'view-detail',
      label: 'View Detail',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      ),
      onClick: () => setSelectedIssue(issue.number),
    },
    { key: 'sep-1', separator: true },
    {
      key: 'execute',
      label: 'Execute',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z" />
        </svg>
      ),
      onClick: () => onExecute?.(issue.number),
      disabled: !canExecute,
    },
    {
      key: 'ship',
      label: 'Ship',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14" />
          <path d="M12 5l7 7-7 7" />
        </svg>
      ),
      onClick: () => onShip?.(issue.number),
      disabled: !canShip,
    },
  ], [issue, canExecute, canShip, onOpenInGitHub, onExecute, onShip, setSelectedIssue]);

  const handleContextMenu = (e: React.MouseEvent) => {
    // Don't show context menu if currently dragging
    if (isDragging || isDraggingFromHook || isBeingDragged) return;
    contextMenu.handleContextMenu(e);
  };

  return (
    <>
      <div
        ref={setNodeRef}
        className={classNames}
        style={sortableStyle}
        onClick={() => setSelectedIssue(issue.number)}
        onContextMenu={handleContextMenu}
        {...listeners}
        {...attributes}
      >
        <div className="kanban-card-header">
          <input
            type="checkbox"
            className="kanban-card-select"
            checked={isBatchSelected}
            onChange={() => toggleBatchSelection(issue.number, surfaceKey)}
            onClick={handleCheckboxClick}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={`Select issue #${issue.number}`}
          />
          <span className="kanban-card-number">#{issue.number}</span>
          <div className="kanban-card-actions">
            {isPaused && <span className="kanban-card-badge kanban-card-badge--paused">PAUSED</span>}
            {isFailed && <span className="kanban-card-badge kanban-card-badge--failed">FAILED</span>}
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
      <ContextMenu
        isOpen={contextMenu.isOpen}
        position={contextMenu.position}
        items={menuItems}
        onClose={contextMenu.close}
      />
    </>
  );
});
