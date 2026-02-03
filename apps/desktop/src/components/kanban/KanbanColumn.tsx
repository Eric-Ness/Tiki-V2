import type { GitHubIssue } from '../../stores';

export interface KanbanColumnProps {
  id: string;
  title: string;
  issues: GitHubIssue[];
}

export function KanbanColumn({ id, title, issues }: KanbanColumnProps) {
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
            <div key={issue.number} className="kanban-card">
              <div className="kanban-card-number">#{issue.number}</div>
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
            </div>
          ))
        )}
      </div>
    </div>
  );
}
