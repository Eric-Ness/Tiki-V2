import { memo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { motion, AnimatePresence } from 'framer-motion';
import { useDetailStore, useKanbanStore, useProjectsStore } from '../../stores';
import type { GitHubIssue } from '../../stores';
import { KanbanCard, type WorkItem } from './KanbanCard';

export interface KanbanColumnProps {
  id: string;
  title: string;
  issues: GitHubIssue[];
  workItems?: Map<number, WorkItem>;
  activeId?: number | null;
  hasFailed?: boolean;
  onExecute?: (issueNumber: number) => void;
  onShip?: (issueNumber: number) => void;
  onOpenInGitHub?: (issue: GitHubIssue) => void;
}

const cardVariants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -20 },
};

export const KanbanColumn = memo(function KanbanColumn({ id, title, issues, workItems, activeId, hasFailed, onExecute, onShip, onOpenInGitHub }: KanbanColumnProps) {
  const projectId = useProjectsStore((s) => s.activeProjectId) ?? 'default';
  const selectedIssue = useDetailStore((s) => s.selectionByProject[projectId]?.selectedIssue ?? null);
  const hasCustomOrder = useKanbanStore(
    (s) => Boolean(s.orderByColumnByProject[projectId]?.[id]?.length)
  );
  const { isOver, setNodeRef } = useDroppable({ id });

  const itemIds = issues.map((i) => i.number);

  const classNames = [
    'kanban-column',
    `kanban-column--${id}`,
    isOver && 'kanban-column--drop-target',
    hasFailed && 'kanban-column--has-failed',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={setNodeRef} className={classNames}>
      <div className="kanban-column-header">
        <span className="kanban-column-title">{title}</span>
        <motion.span
          className="kanban-column-count"
          key={issues.length}
          initial={{ scale: 1.2, opacity: 0.7 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.2 }}
        >
          ({issues.length})
        </motion.span>
        {hasCustomOrder && (
          <button
            type="button"
            className="kanban-column-reset"
            onClick={(e) => {
              e.stopPropagation();
              useKanbanStore.getState().clearColumnOrder(id);
            }}
            title="Reset to default order"
            aria-label={`Reset ${title} column to default order`}
          >
            {'↺'}
          </button>
        )}
      </div>
      <div className="kanban-column-body">
        {issues.length === 0 ? (
          !isOver && (
            <div className="kanban-column-empty">
              <svg
                className="kanban-column-empty-icon"
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {/* Empty-tray glyph: outer tray + inner divider line */}
                <path d="M22 12h-6l-2 3h-4l-2-3H2" />
                <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
              </svg>
              <span className="kanban-column-empty-label">No issues</span>
            </div>
          )
        ) : (
          <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
            <AnimatePresence mode="popLayout">
              {issues.map((issue) => (
                <motion.div
                  key={issue.number}
                  layoutId={`kanban-card-${issue.number}`}
                  variants={cardVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={{
                    type: 'spring',
                    stiffness: 500,
                    damping: 30,
                    layout: { duration: 0.3 },
                  }}
                >
                  <KanbanCard
                    issue={issue}
                    workItem={workItems?.get(issue.number)}
                    isSelected={selectedIssue === issue.number}
                    isBeingDragged={activeId === issue.number}
                    onExecute={onExecute}
                    onShip={onShip}
                    onOpenInGitHub={onOpenInGitHub}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </SortableContext>
        )}
      </div>
    </div>
  );
});
