import { useDetailStore } from '../../stores';
import type { GitHubIssue } from '../../stores';
import { KanbanCard, type WorkItem } from './KanbanCard';

export interface KanbanColumnProps {
  id: string;
  title: string;
  issues: GitHubIssue[];
  workItems?: Map<number, WorkItem>;
}

export function KanbanColumn({ id, title, issues, workItems }: KanbanColumnProps) {
  const selectedIssue = useDetailStore((s) => s.selectedIssue);

  return (
    <div className={`kanban-column kanban-column--${id}`}>
      <div className="kanban-column-header">
        <span className="kanban-column-title">{title}</span>
        <span className="kanban-column-count">({issues.length})</span>
      </div>
      <div className="kanban-column-body">
        {issues.length === 0 ? (
          <div className="kanban-column-empty">No issues</div>
        ) : (
          issues.map((issue) => (
            <KanbanCard
              key={issue.number}
              issue={issue}
              workItem={workItems?.get(issue.number)}
              isSelected={selectedIssue === issue.number}
            />
          ))
        )}
      </div>
    </div>
  );
}
