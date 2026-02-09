import { useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  useLayoutStore,
  useProjectsStore,
  useIssuesStore,
  useTerminalStore,
  useDetailStore,
  useReleaseDialogStore,
  type CommandAction,
} from '../stores';
import { terminalFocusRegistry } from '../stores/terminalStore';

/**
 * Helper to write a command string to the active terminal and focus it.
 * Mirrors the pattern used by the "Start Claude" button in App.tsx.
 */
async function writeToActiveTerminal(command: string): Promise<void> {
  const projectId = useProjectsStore.getState().activeProjectId ?? 'default';
  const termState = useTerminalStore.getState();
  const tabs = termState.tabsByProject[projectId] ?? [];
  const activeTabId = termState.activeTabByProject[projectId] ?? null;
  const activeTab = tabs.find((t) => t.id === activeTabId);
  if (!activeTab) return;

  try {
    await invoke('write_terminal', {
      id: activeTab.activeTerminalId,
      data: command,
    });
    terminalFocusRegistry.focus(activeTab.activeTerminalId);
  } catch (err) {
    console.error('Failed to write to terminal:', err);
  }
}

/**
 * Builds the full list of CommandAction items for the command palette.
 * The list updates reactively when the underlying store data changes.
 */
export function useCommandActions(): CommandAction[] {
  // Subscribe to store slices that drive dynamic actions
  const projects = useProjectsStore((s) => s.projects);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const issues = useIssuesStore((s) => s.issues);
  const activeView = useLayoutStore((s) => s.activeView);

  return useMemo(() => {
    const actions: CommandAction[] = [];

    // ---- Navigation actions (always available) ----
    actions.push({
      id: 'nav:terminal',
      title: 'Switch to Terminal',
      category: 'navigation',
      keywords: ['terminal', 'shell', 'console', 'view'],
      shortcut: 'Ctrl+1',
      execute: () => useLayoutStore.getState().setActiveView('terminal'),
    });

    actions.push({
      id: 'nav:kanban',
      title: 'Switch to Kanban',
      category: 'navigation',
      keywords: ['kanban', 'board', 'view', 'columns'],
      shortcut: 'Ctrl+2',
      execute: () => useLayoutStore.getState().setActiveView('kanban'),
    });

    actions.push({
      id: 'nav:settings',
      title: 'Open Settings',
      category: 'navigation',
      keywords: ['settings', 'preferences', 'config', 'options'],
      shortcut: 'Ctrl+,',
      execute: () => useLayoutStore.getState().setActiveView('settings'),
    });

    // ---- Project actions (one per project) ----
    for (const project of projects) {
      actions.push({
        id: `project:${project.id}`,
        title: `Switch to ${project.name}`,
        subtitle: project.path,
        category: 'project',
        keywords: ['project', 'switch', 'workspace', project.name],
        execute: () => useProjectsStore.getState().setActiveProject(project.id),
      });
    }

    // ---- Issue actions (one per open issue) ----
    for (const issue of issues) {
      actions.push({
        id: `issue:${issue.number}`,
        title: `Open Issue #${issue.number}: ${issue.title}`,
        subtitle: issue.labels.map((l) => l.name).join(', ') || undefined,
        category: 'issue',
        keywords: [
          'issue',
          'bug',
          'feature',
          String(issue.number),
          issue.title,
        ],
        execute: () => useDetailStore.getState().setSelectedIssue(issue.number),
      });
    }

    // ---- Issue creation ----
    actions.push({
      id: 'issue:create',
      title: 'Create Issue',
      category: 'issue',
      keywords: ['create', 'new', 'issue', 'add'],
      execute: () => useIssuesStore.getState().setShowCreateForm(true),
    });

    // ---- Release actions ----
    actions.push({
      id: 'release:create',
      title: 'Create Release',
      category: 'release',
      keywords: ['release', 'create', 'new', 'version', 'tag'],
      execute: () => useReleaseDialogStore.getState().openDialog(),
    });

    // ---- Tiki command actions ----
    const tikiCommands: Array<{ cmd: string; label: string; keywords: string[] }> = [
      { cmd: 'tiki:get', label: 'Run tiki:get', keywords: ['get', 'fetch', 'issue', 'tiki'] },
      { cmd: 'tiki:plan', label: 'Run tiki:plan', keywords: ['plan', 'phases', 'tiki'] },
      { cmd: 'tiki:execute', label: 'Run tiki:execute', keywords: ['execute', 'run', 'build', 'tiki'] },
      { cmd: 'tiki:ship', label: 'Run tiki:ship', keywords: ['ship', 'deploy', 'push', 'commit', 'tiki'] },
      { cmd: 'tiki:yolo', label: 'Run tiki:yolo', keywords: ['yolo', 'auto', 'full', 'pipeline', 'tiki'] },
    ];

    for (const { cmd, label, keywords } of tikiCommands) {
      actions.push({
        id: `cmd:${cmd.replace(':', '-')}`,
        title: label,
        subtitle: `Write /${cmd} to active terminal`,
        category: 'command',
        keywords,
        execute: () => {
          // Switch to terminal view so the user can see the output
          useLayoutStore.getState().setActiveView('terminal');
          writeToActiveTerminal(`/${cmd}\n`);
        },
      });
    }

    return actions;
  }, [projects, activeProjectId, issues, activeView]);
}
