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
import { arrayMove } from '@dnd-kit/sortable';
import { useIssuesStore, useKanbanStore, useTikiReleasesStore, useTerminalStore, useProjectsStore, useLayoutStore, useTikiStateStore, filterIssuesBySearch, EMPTY_TABS, EMPTY_COLUMN_ORDER } from '../../stores';
import { applyColumnOrder } from '../../stores/kanbanStore';
import type { GitHubIssue } from '../../stores';
import { KanbanColumn } from './KanbanColumn';
import { KanbanCard, type WorkItem } from './KanbanCard';
import { KanbanFilters } from './KanbanFilters';
import { getExecuteCommand } from './executeCommand';
import { collectCompletedIssueNumbers, buildCompletedCards } from './completedColumn';
import { classifyKanbanMove, type ColumnId } from './kanbanMoves';
import { useToastStore } from '../../stores/toastStore';
import { deriveDisplayStatus, type DisplayColumn } from '../../utils/deriveDisplayStatus';
import './kanban.css';

/**
 * Side-effect handlers a cross-column kanban drag may invoke. Injected so the
 * dispatch decision (which action runs for which classified move) is unit-
 * testable without rendering the board or driving a dnd-kit event (#280).
 */
export interface KanbanMoveDispatchers {
  triggerExecution: (issueNumber: number, fromColumn: string) => void;
  requestShip: (issueNumber: number) => void;
  toast: (message: string) => void;
}

/**
 * Build the toast message for a cross-column drag that the board can't dispatch.
 * Terminal-state sources (completed) have no terminal-driven recovery, so they
 * get a generic line; everything else points the user at the terminal command.
 */
function undispatchableMoveMessage(issueNumber: number, sourceColumn: ColumnId): string {
  if (sourceColumn === 'completed') {
    return "This move isn't available from the board.";
  }
  return `Moving work backward from the board isn't supported — drive it from the terminal (e.g. /tiki:execute ${issueNumber}).`;
}

/**
 * Pure routing of a classified cross-column move to a side effect (#280). The
 * same-column 'reorder' case is handled earlier in handleDragEnd, so it is a
 * no-op here. Every cross-column move resolves to a dispatch or a toast — there
 * is no silent snap-back.
 */
export function dispatchKanbanMove(
  source: ColumnId,
  target: ColumnId,
  issueNumber: number,
  d: KanbanMoveDispatchers
): void {
  switch (classifyKanbanMove(source, target)) {
    case 'dispatch-execute':
      d.triggerExecution(issueNumber, source);
      break;
    case 'dispatch-ship':
      d.requestShip(issueNumber);
      break;
    case 'toast':
      d.toast(undispatchableMoveMessage(issueNumber, source));
      break;
    case 'reorder':
      // Handled by the same-column early-return in handleDragEnd; no-op here.
      break;
  }
}

// Column configuration mapping to Tiki work statuses
const COLUMN_CONFIG = [
  { id: 'open', title: 'Open', statuses: [] },
  { id: 'review', title: 'Review', statuses: ['pending', 'reviewing'] },
  { id: 'plan', title: 'Plan', statuses: ['planning'] },
  { id: 'execute', title: 'Execute', statuses: ['executing'] },
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
  const searchQuery = useIssuesStore((s) => s.searchQuery);
  const projectId = useProjectsStore((s) => s.activeProjectId) ?? 'default';
  const releaseFilter = useKanbanStore((s) => s.releaseFilterByProject[projectId] ?? null);
  const orderByColumn = useKanbanStore((s) => s.orderByColumnByProject[projectId] ?? EMPTY_COLUMN_ORDER);
  const tikiReleases = useTikiReleasesStore((s) => s.releases);
  const tabs = useTerminalStore((s) => s.tabsByProject[projectId] ?? EMPTY_TABS);
  const activeTabId = useTerminalStore((s) => s.activeTabByProject[projectId] ?? null);
  const setActiveView = useLayoutStore((s) => s.setActiveView);
  const activeWork = useTikiStateStore((s) => s.activeWork);
  const recentIssues = useTikiStateStore((s) => s.recentIssues);
  const recentReleases = useTikiStateStore((s) => s.recentReleases);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [shipConfirmation, setShipConfirmation] = useState<{ issueNumber: number; title: string } | null>(null);

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

  // Trigger execution for an issue
  const triggerExecution = useCallback(async (issueNumber: number, fromColumn: string) => {
    const work = activeWork[`issue:${issueNumber}`];
    const status = work && work.type === 'issue' ? work.status : undefined;
    const command = getExecuteCommand(issueNumber, fromColumn, status);

    // Record which terminal this issue's work is running in, so the detail
    // panel can offer a "Jump to terminal" action (#175).
    const terminalId = getActiveTerminalId();
    if (terminalId) {
      useTerminalStore.getState().associateWorkTerminal(issueNumber, terminalId);
    }

    // Switch to terminal view
    setActiveView('terminal');

    // Send command to terminal
    const success = await executeInTerminal(command);
    if (success) {
      console.log(`Started execution: ${command}`);
    }
  }, [activeWork, setActiveView, executeInTerminal, getActiveTerminalId]);

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

    // Record the terminal association for the "Jump to terminal" action (#175).
    const terminalId = getActiveTerminalId();
    if (terminalId) {
      useTerminalStore.getState().associateWorkTerminal(shipConfirmation.issueNumber, terminalId);
    }

    // Switch to terminal view
    setActiveView('terminal');

    // Send command to terminal
    const success = await executeInTerminal(command);
    if (success) {
      console.log(`Started shipping: ${command}`);
    }

    // Close the confirmation dialog
    setShipConfirmation(null);
  }, [shipConfirmation, setActiveView, executeInTerminal, getActiveTerminalId]);

  // Cancel ship operation
  const cancelShip = useCallback(() => {
    setShipConfirmation(null);
  }, []);

  // Open issue in GitHub (for context menu)
  const handleOpenInGitHub = useCallback((issue: GitHubIssue) => {
    window.open(issue.url, '_blank');
  }, []);

  // Resolve the canonical display column for an issue via the single-source-of-
  // truth selector (issue #222). Replaces the old per-surface statusToColumn
  // switch + GitHub-state fallback so the board agrees with the detail panel by
  // construction. Returns null when the issue isn't loaded.
  const displayColumnFor = useCallback((issueNumber: number): DisplayColumn | null => {
    const issue = issues.find((i) => i.number === issueNumber);
    if (!issue) return null;
    const work = activeWork[`issue:${issueNumber}`];
    const workLike =
      work && work.type === 'issue'
        ? { status: work.status, pipelineStep: work.pipelineStep, parentRelease: work.parentRelease }
        : null;
    return deriveDisplayStatus({
      number: issueNumber,
      work: workLike,
      githubState: { state: issue.state.toLowerCase() === 'closed' ? 'closed' : 'open' },
      history: { recentIssues, recentReleases },
    }).column;
  }, [issues, activeWork, recentIssues, recentReleases]);

  // Find which column an issue belongs to (drag handlers consume this). Keeps
  // the `string | null` contract by routing through the selector.
  const getIssueColumn = useCallback((issueNumber: number): string | null => {
    return displayColumnFor(issueNumber);
  }, [displayColumnFor]);

  const handleDragStart = (event: DragStartEvent) => {
    const id = event.active.id as number;
    setActiveId(id);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const issueNumber = active.id as number;
    const sourceColumn = getIssueColumn(issueNumber);
    if (!sourceColumn) return;

    // dnd-kit's `over.id` is either a column id (when dropping on empty space)
    // or another issue's number (when hovering over a sibling card).
    const overId = over.id;
    let targetColumn: string;
    if (typeof overId === 'string') {
      targetColumn = overId;
    } else {
      const overIssueColumn = getIssueColumn(overId as number);
      if (!overIssueColumn) return;
      targetColumn = overIssueColumn;
    }

    // Within-column reorder.
    if (sourceColumn === targetColumn) {
      const column = columns.find((c) => c.id === sourceColumn);
      if (!column) return;
      const ids = column.issues.map((i) => i.number);
      const fromIdx = ids.indexOf(issueNumber);
      const toIdx = typeof overId === 'number' ? ids.indexOf(overId) : ids.length - 1;
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
      const reordered = arrayMove(ids, fromIdx, toIdx);
      useKanbanStore.getState().setColumnOrder(sourceColumn, reordered);
      return;
    }

    // Cross-column move: dispatch the two command-backed actions, or surface a
    // toast for any unsupported (backward/lateral/invalid) drag instead of
    // silently snapping back (#267/#280). The card still visually snaps back
    // (dnd-kit) but the user now gets feedback.
    dispatchKanbanMove(sourceColumn as ColumnId, targetColumn as ColumnId, issueNumber, {
      triggerExecution,
      requestShip: requestShipConfirmation,
      toast: (message) => useToastStore.getState().addToast(message, 'info'),
    });
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

  // Filter issues by release and search query
  const filteredIssues = useMemo(() => {
    let result: GitHubIssue[];

    if (!releaseFilter) {
      result = issues;
    } else if (releaseFilter === 'unassigned') {
      result = issues.filter((issue) => !assignedIssueNumbers.has(issue.number));
    } else {
      const release = tikiReleases.find((r) => r.version === releaseFilter);
      if (!release) {
        result = issues;
      } else {
        const releaseIssueNumbers = new Set(release.issues.map((i) => i.number));
        result = issues.filter((issue) => releaseIssueNumbers.has(issue.number));
      }
    }

    return filterIssuesBySearch(result, searchQuery);
  }, [issues, releaseFilter, searchQuery, tikiReleases, assignedIssueNumbers]);

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

  // Get set of completed issue numbers from history (for exclusion from other
  // columns). Uncapped union of recentIssues + every recentReleases[].issues[]
  // so release-shipped children are excluded from non-completed columns too
  // (issue #219).
  const completedIssueNumbers = useMemo(() => {
    return collectCompletedIssueNumbers(recentIssues, recentReleases);
  }, [recentIssues, recentReleases]);

  // Synthesized cards for the Completed column: union of recentIssues +
  // release children, deduped (recentIssues win), sorted desc, capped at 50.
  const completedCards = useMemo(() => {
    return buildCompletedCards(recentIssues, recentReleases, 50);
  }, [recentIssues, recentReleases]);

  // Organize issues into columns based on Tiki work status
  const columns: ColumnData[] = useMemo(() => {
    const result = COLUMN_CONFIG.map((col) => {
      // For the completed column, use the union of recentIssues + release
      // children from history (capped at 50, deduped — issue #219).
      if (col.id === 'completed') {
        return {
          ...col,
          issues: applyColumnOrder(filterIssuesBySearch(completedCards, searchQuery), orderByColumn[col.id]),
        };
      }

      const colIssues = filteredIssues.filter((issue) => {
        // Belt-and-suspenders exclusion: anything in the release-children union
        // stays out of non-completed columns even if it's somehow absent from
        // the selector's history input (issue #219). Agrees with the selector,
        // which already returns 'completed' for history/closed items.
        if (completedIssueNumbers.has(issue.number)) {
          return false;
        }

        // Single source of truth for column placement (issue #222).
        return displayColumnFor(issue.number) === col.id;
      });
      return { ...col, issues: applyColumnOrder(colIssues, orderByColumn[col.id]) };
    });
    return result;
  }, [filteredIssues, displayColumnFor, completedCards, completedIssueNumbers, searchQuery, orderByColumn]);

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
          {columns.map((column) => {
            const hasFailed = column.issues.some(
              (issue) => workItemsMap.get(issue.number)?.status === 'failed'
            );
            return (
              <KanbanColumn
                key={column.id}
                id={column.id}
                title={column.title}
                issues={column.issues}
                workItems={workItemsMap}
                activeId={activeId}
                hasFailed={hasFailed}
                onExecute={(issueNumber) => triggerExecution(issueNumber, column.id)}
                onShip={requestShipConfirmation}
                onOpenInGitHub={handleOpenInGitHub}
              />
            );
          })}
        </div>
      </div>

      <DragOverlay>
        {activeIssue ? (
          <KanbanCard
            issue={activeIssue}
            isDragging
            columnId="drag-overlay"
            surfaceIssueNumbers={[]}
          />
        ) : null}
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
