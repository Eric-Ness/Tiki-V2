import { useMemo, useState, useCallback, useEffect } from 'react';
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
import { useIssuesStore, useKanbanStore, useTikiReleasesStore, useTerminalStore, useLayoutStore, useTikiStateStore } from '../../stores';
import type { GitHubIssue } from '../../stores';
import { KanbanColumn } from './KanbanColumn';
import { KanbanCard, type WorkItem } from './KanbanCard';
import { KanbanFilters } from './KanbanFilters';
import './kanban.css';

// Valid state transitions for drag-and-drop
const VALID_TRANSITIONS: Record<string, string[]> = {
  backlog: ['planning', 'executing'],
  planning: ['backlog', 'review', 'executing'],
  review: ['planning', 'executing'],
  executing: ['shipping', 'backlog'],
  shipping: ['completed', 'executing'],
  completed: [], // Cannot move completed items
};

// Column configuration mapping to Tiki work statuses
const COLUMN_CONFIG = [
  { id: 'backlog', title: 'Backlog', statuses: ['pending'] },
  { id: 'planning', title: 'Planning', statuses: ['planning'] },
  { id: 'review', title: 'Review', statuses: [] },
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
  const activeWork = useTikiStateStore((s) => s.activeWork);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [shipConfirmation, setShipConfirmation] = useState<{ issueNumber: number; title: string } | null>(null);

  // Debug logging for Kanban state
  useEffect(() => {
    console.log('[Kanban] === STATE UPDATE ===');
    console.log('[Kanban] issues count:', issues.length, 'numbers:', issues.map(i => i.number));
    console.log('[Kanban] activeWork:', Object.entries(activeWork).map(([k, v]) => `${k}: ${v.status}`));
    console.log('[Kanban] releaseFilter:', releaseFilter);
    console.log('[Kanban] tikiReleases count:', tikiReleases.length);
  }, [activeWork, issues, releaseFilter, tikiReleases]);

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

  // Show ship confirmation dialog
  const requestShipConfirmation = useCallback((issueNumber: number) => {
    const issue = issues.find((i) => i.number === issueNumber);
    if (issue) {
      setShipConfirmation({ issueNumber, title: issue.title });
    }
  }, [issues]);

  // Actually trigger the ship command
  const confirmShip = useCallback(async () => {
    if (!shipConfirmation) return;

    const command = `/tiki:ship ${shipConfirmation.issueNumber}`;

    // Switch to terminal view
    setActiveView('terminal');

    // Send command to terminal
    const success = await executeInTerminal(command);
    if (success) {
      console.log(`Started shipping: ${command}`);
    }

    // Close the confirmation dialog
    setShipConfirmation(null);
  }, [shipConfirmation, setActiveView, executeInTerminal]);

  // Cancel ship operation
  const cancelShip = useCallback(() => {
    setShipConfirmation(null);
  }, []);

  // Map Tiki work status to column ID, using pipelineStep to distinguish review
  const statusToColumn = (status: string, pipelineStep?: string): string => {
    // Issues in planning status with REVIEW pipeline step go to review column
    if (status === 'planning' && pipelineStep === 'REVIEW') {
      return 'review';
    }
    switch (status) {
      case 'planning':
        return 'planning';
      case 'executing':
        return 'executing';
      case 'shipping':
        return 'shipping';
      case 'completed':
        return 'completed';
      case 'pending':
      case 'paused':
      case 'failed':
      default:
        return 'backlog';
    }
  };

  // Find which column an issue belongs to based on Tiki work state
  const getIssueColumn = (issueNumber: number): string | null => {
    const issue = issues.find((i) => i.number === issueNumber);
    if (!issue) return null;

    // Check Tiki work state first
    const workKey = `issue:${issueNumber}`;
    const work = activeWork[workKey];
    if (work && work.type === 'issue') {
      return statusToColumn(work.status, (work as { pipelineStep?: string }).pipelineStep);
    }

    // Fall back to GitHub state
    const state = issue.state.toLowerCase();
    return state === 'closed' ? 'completed' : 'backlog';
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
    } else if (targetColumn === 'shipping' && sourceColumn === 'executing') {
      requestShipConfirmation(issueNumber);
    }
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
    console.log('[Kanban] Computing filteredIssues...');
    console.log('[Kanban] - releaseFilter:', releaseFilter);
    console.log('[Kanban] - issues count:', issues.length);

    if (!releaseFilter) {
      console.log('[Kanban] - No filter, returning all issues');
      return issues;
    }

    // Handle "unassigned" filter
    if (releaseFilter === 'unassigned') {
      const result = issues.filter((issue) => !assignedIssueNumbers.has(issue.number));
      console.log('[Kanban] - Unassigned filter, returning:', result.length);
      return result;
    }

    // Find the release and get its issues
    const release = tikiReleases.find((r) => r.version === releaseFilter);
    if (!release) {
      console.log('[Kanban] - Release not found, returning all issues');
      return issues;
    }

    const releaseIssueNumbers = new Set(release.issues.map((i) => i.number));
    const result = issues.filter((issue) => releaseIssueNumbers.has(issue.number));
    console.log('[Kanban] - Filtered by release, returning:', result.length, result.map(i => i.number));
    return result;
  }, [issues, releaseFilter, tikiReleases, assignedIssueNumbers]);

  // Create workItems map from activeWork for phase progress display
  const workItemsMap: Map<number, WorkItem> = useMemo(() => {
    const map = new Map<number, WorkItem>();
    Object.entries(activeWork).forEach(([key, work]) => {
      if (key.startsWith('issue:') && work.type === 'issue') {
        const issueNumber = parseInt(key.replace('issue:', ''), 10);
        const phase = (work as { phase?: { current?: number; total?: number } }).phase;
        map.set(issueNumber, {
          status: work.status as WorkItem['status'],
          currentPhase: phase?.current,
          totalPhases: phase?.total,
        });
      }
    });
    return map;
  }, [activeWork]);

  // Organize issues into columns based on Tiki work status
  const columns: ColumnData[] = useMemo(() => {
    console.log('[Kanban] Computing columns from', filteredIssues.length, 'filtered issues');
    const result = COLUMN_CONFIG.map((col) => {
      const colIssues = filteredIssues.filter((issue) => {
        // Check Tiki work state first
        const workKey = `issue:${issue.number}`;
        const work = activeWork[workKey];
        if (work && work.type === 'issue') {
          const issueColumn = statusToColumn(work.status, (work as { pipelineStep?: string }).pipelineStep);
          return issueColumn === col.id;
        }

        // Fall back to GitHub state for issues not in Tiki work
        const state = issue.state.toLowerCase();
        if (col.id === 'completed') {
          return state === 'closed';
        }
        if (col.id === 'backlog') {
          return state === 'open';
        }
        return false;
      });
      return { ...col, issues: colIssues };
    });
    console.log('[Kanban] Columns:', result.map(c => `${c.id}: ${c.issues.length}`).join(', '));
    return result;
  }, [filteredIssues, activeWork]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="kanban-board">
        <KanbanFilters />
        {issues.length === 0 && (
          <div className="kanban-no-issues-hint">
            No issues loaded. Click "Issues" in the sidebar to fetch from GitHub.
          </div>
        )}
        <div className="kanban-columns">
          {columns.map((column) => (
            <KanbanColumn
              key={column.id}
              id={column.id}
              title={column.title}
              issues={column.issues}
              workItems={workItemsMap}
              activeId={activeId}
              onExecute={(issueNumber) => triggerExecution(issueNumber, column.id)}
            />
          ))}
        </div>
      </div>

      <DragOverlay>
        {activeIssue ? <KanbanCard issue={activeIssue} isDragging /> : null}
      </DragOverlay>

      {/* Ship Confirmation Dialog */}
      {shipConfirmation && (
        <div className="kanban-dialog-overlay" onClick={cancelShip}>
          <div className="kanban-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="kanban-dialog-title">Ship Issue #{shipConfirmation.issueNumber}?</h3>
            <p className="kanban-dialog-message">
              This will commit changes, push to remote, and close the issue:
            </p>
            <p className="kanban-dialog-issue-title">{shipConfirmation.title}</p>
            <div className="kanban-dialog-actions">
              <button className="kanban-dialog-btn kanban-dialog-btn--cancel" onClick={cancelShip}>
                Cancel
              </button>
              <button className="kanban-dialog-btn kanban-dialog-btn--confirm" onClick={confirmShip}>
                Ship
              </button>
            </div>
          </div>
        </div>
      )}
    </DndContext>
  );
}
