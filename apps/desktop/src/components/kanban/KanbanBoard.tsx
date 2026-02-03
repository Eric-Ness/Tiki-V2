import './kanban.css';

export function KanbanBoard() {
  return (
    <div className="kanban-board">
      <div className="kanban-placeholder">
        <div className="kanban-placeholder-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="5" height="18" rx="1" />
            <rect x="10" y="3" width="5" height="12" rx="1" />
            <rect x="17" y="3" width="5" height="15" rx="1" />
          </svg>
        </div>
        <h3 className="kanban-placeholder-title">Kanban Board</h3>
        <p className="kanban-placeholder-text">
          Visual workflow management coming soon
        </p>
      </div>
    </div>
  );
}
