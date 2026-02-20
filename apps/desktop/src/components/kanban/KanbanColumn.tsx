import { memo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { motion, AnimatePresence } from 'framer-motion';
import { useDetailStore, useProjectsStore } from '../../stores';
import type { GitHubIssue } from '../../stores';
import { KanbanCard, type WorkItem } from './KanbanCard';

export interface KanbanColumnProps {
  id: string;
  title: string;
  issues: GitHubIssue[];
  workItems?: Map<number, WorkItem>;
  activeId?: number | null;
  onExecute?: (issueNumber: number) => void;
  onShip?: (issueNumber: number) => void;
  onOpenInGitHub?: (issue: GitHubIssue) => void;
}

const cardVariants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -20 },
};

export const KanbanColumn = memo(function KanbanColumn({ id, title, issues, workItems, activeId, onExecute, onShip, onOpenInGitHub }: KanbanColumnProps) {
  const projectId = useProjectsStore((s) => s.activeProjectId) ?? 'default';
  const selectedIssue = useDetailStore((s) => s.selectionByProject[projectId]?.selectedIssue ?? null);
  const { isOver, setNodeRef } = useDroppable({ id });

  const classNames = [
    'kanban-column',
    `kanban-column--${id}`,
    isOver && 'kanban-column--drop-target',
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
      </div>
      <div className="kanban-column-body">
        {issues.length === 0 ? (
          <div className="kanban-column-empty">No issues</div>
        ) : (
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
        )}
      </div>
    </div>
  );
});
