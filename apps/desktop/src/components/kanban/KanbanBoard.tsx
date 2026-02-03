import { useMemo } from 'react';
import { useIssuesStore, useKanbanStore, useTikiReleasesStore } from '../../stores';
import type { GitHubIssue } from '../../stores';
import { KanbanColumn } from './KanbanColumn';
import './kanban.css';

// Column configuration mapping to Tiki work statuses
const COLUMN_CONFIG = [
  { id: 'backlog', title: 'Backlog', statuses: ['pending'] },
  { id: 'planning', title: 'Planning', statuses: ['planning'] },
  { id: 'executing', title: 'Executing', statuses: ['executing'] },
  { id: 'shipping', title: 'Shipping', statuses: ['shipping'] },
  { id: 'completed', title: 'Completed', statuses: ['completed'] },
] as const;

interface ColumnData {
  id: string;
  title: string;
  statuses: readonly string[];
  issues: GitHubIssue[];
}

export function KanbanBoard() {
  const issues = useIssuesStore((s) => s.issues);
  const releaseFilter = useKanbanStore((s) => s.releaseFilter);
  const tikiReleases = useTikiReleasesStore((s) => s.releases);

  // Filter issues by release if filter is set
  const filteredIssues = useMemo(() => {
    if (!releaseFilter) return issues;

    // Find the release and get its issues
    const release = tikiReleases.find((r) => r.version === releaseFilter);
    if (!release) return issues;

    const releaseIssueNumbers = new Set(release.issues.map((i) => i.number));
    return issues.filter((issue) => releaseIssueNumbers.has(issue.number));
  }, [issues, releaseFilter, tikiReleases]);

  // Organize issues into columns
  // For now, all issues go to Backlog since we don't have tikiState integration yet
  // This will be enhanced when we connect to the actual work state
  const columns: ColumnData[] = useMemo(() => {
    return COLUMN_CONFIG.map((col) => ({
      ...col,
      // For now, put open issues in Backlog, closed in Completed
      issues: filteredIssues.filter((issue) => {
        if (col.id === 'completed') {
          return issue.state === 'closed';
        }
        if (col.id === 'backlog') {
          return issue.state === 'open';
        }
        return false;
      }),
    }));
  }, [filteredIssues]);

  // Check if board is empty
  const totalIssues = columns.reduce((sum, col) => sum + col.issues.length, 0);

  if (totalIssues === 0) {
    return (
      <div className="kanban-board">
        <div className="kanban-empty">
          <div className="kanban-empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="5" height="18" rx="1" />
              <rect x="10" y="3" width="5" height="12" rx="1" />
              <rect x="17" y="3" width="5" height="15" rx="1" />
            </svg>
          </div>
          <h3 className="kanban-empty-title">No Issues</h3>
          <p className="kanban-empty-text">
            {releaseFilter
              ? `No issues found in release ${releaseFilter}`
              : 'Create issues in GitHub to see them here'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="kanban-board">
      <div className="kanban-columns">
        {columns.map((column) => (
          <KanbanColumn
            key={column.id}
            id={column.id}
            title={column.title}
            issues={column.issues}
          />
        ))}
      </div>
    </div>
  );
}
