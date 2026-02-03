import { useMemo, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useIssuesStore, useKanbanStore, useTikiReleasesStore, useTerminalStore, useLayoutStore } from '../../stores';
import type { GitHubIssue } from '../../stores';
import { KanbanColumn } from './KanbanColumn';
import { KanbanCard } from './KanbanCard';
import { KanbanFilters } from './KanbanFilters';
import './kanban.css';

// Valid state transitions for drag-and-drop
const VALID_TRANSITIONS: Record<string, string[]> = {
  backlog: ['planning', 'executing'],
  planning: ['backlog', 'executing'],
  executing: ['shipping', 'backlog'],
  shipping: ['completed', 'executing'],
  completed: [], // Cannot move completed items
};

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
  const { tabs, activeTabId } = useTerminalStore();
  const setActiveView = useLayoutStore((s) => s.setActiveView);
  const [activeId, setActiveId] = useState<number | null>(null);

  // Configure DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor)
  );

  // Get active terminal ID
  const getActiveTerminalId = useCallback((): string | null => {
    const activeTab = tabs.find((t) => t.id === activeTabId);
    return activeTab?.activeTerminalId || null;
  }, [tabs, activeTabId]);

  // Execute a command in the terminal
  const executeInTerminal = useCallback(async (command: string) => {
    const terminalId = getActiveTerminalId();
    if (!terminalId) {
      console.error('No active terminal found');
      return false;
    }
    try {
      await invoke('write_terminal', { id: terminalId, data: command + '\n' });
      return true;
    } catch (error) {
      console.error('Failed to write to terminal:', error);
      return false;
    }
  }, [getActiveTerminalId]);

  // Determine the appropriate command based on source column
  const getExecuteCommand = (issueNumber: number, fromColumn: string): string => {
    // If coming from Backlog (no plan yet), run full yolo
    if (fromColumn === 'backlog') {
      return `/tiki:yolo ${issueNumber}`;
    }
    // If coming from Planning (has plan) or resuming, just execute
    return `/tiki:execute ${issueNumber}`;
  };

  // Trigger execution for an issue
  const triggerExecution = useCallback(async (issueNumber: number, fromColumn: string) => {
    const command = getExecuteCommand(issueNumber, fromColumn);

    // Switch to terminal view
    setActiveView('terminal');

    // Send command to terminal
    const success = await executeInTerminal(command);
    if (success) {
      console.log(`Started execution: ${command}`);
    }
  }, [setActiveView, executeInTerminal]);

  // Find which column an issue belongs to
  const getIssueColumn = (issueNumber: number): string | null => {
    const issue = issues.find((i) => i.number === issueNumber);
    if (!issue) return null;
    // For now: closed = completed, open = backlog
    // This will be enhanced when we integrate with tikiState
    return issue.state === 'closed' ? 'completed' : 'backlog';
  };

  // Check if a transition is valid
  const isValidTransition = (fromColumn: string, toColumn: string): boolean => {
    return VALID_TRANSITIONS[fromColumn]?.includes(toColumn) ?? false;
  };

  const handleDragStart = (event: DragStartEvent) => {
    const id = event.active.id as number;
    setActiveId(id);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const issueNumber = active.id as number;
    const targetColumn = over.id as string;
    const sourceColumn = getIssueColumn(issueNumber);

    if (!sourceColumn || sourceColumn === targetColumn) return;

    if (!isValidTransition(sourceColumn, targetColumn)) {
      // Invalid transition - card will snap back automatically
      console.log(`Invalid transition: ${sourceColumn} → ${targetColumn}`);
      return;
    }

    // Trigger workflow action based on target column
    if (targetColumn === 'executing') {
      triggerExecution(issueNumber, sourceColumn);
    }
    // TODO: Issue #40 will handle shipping
  };

  // Get the issue being dragged for the overlay
  const activeIssue = activeId ? issues.find((i) => i.number === activeId) : null;

  // Get all issue numbers that are assigned to any release
  const assignedIssueNumbers = useMemo(() => {
    const assigned = new Set<number>();
    tikiReleases.forEach((release) => {
      release.issues.forEach((i) => assigned.add(i.number));
    });
    return assigned;
  }, [tikiReleases]);

  // Filter issues by release if filter is set
  const filteredIssues = useMemo(() => {
    if (!releaseFilter) return issues;

    // Handle "unassigned" filter
    if (releaseFilter === 'unassigned') {
      return issues.filter((issue) => !assignedIssueNumbers.has(issue.number));
    }

    // Find the release and get its issues
    const release = tikiReleases.find((r) => r.version === releaseFilter);
    if (!release) return issues;

    const releaseIssueNumbers = new Set(release.issues.map((i) => i.number));
    return issues.filter((issue) => releaseIssueNumbers.has(issue.number));
  }, [issues, releaseFilter, tikiReleases, assignedIssueNumbers]);

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
        <KanbanFilters />
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
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="kanban-board">
        <KanbanFilters />
        <div className="kanban-columns">
          {columns.map((column) => (
            <KanbanColumn
              key={column.id}
              id={column.id}
              title={column.title}
              issues={column.issues}
              activeId={activeId}
            />
          ))}
        </div>
      </div>

      <DragOverlay>
        {activeIssue ? <KanbanCard issue={activeIssue} isDragging /> : null}
      </DragOverlay>
    </DndContext>
  );
}
