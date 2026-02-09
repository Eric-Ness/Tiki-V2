import { useState, useRef, useEffect, useCallback } from 'react';
import { useTerminalStore, useProjectsStore, type TerminalTab } from '../../stores';
import { ContextMenu, type ContextMenuEntry, type ContextMenuPosition } from '../ui/ContextMenu';

interface StatusDotProps {
  status: TerminalTab['status'];
}

function StatusDot({ status }: StatusDotProps) {
  const colorMap: Record<TerminalTab['status'], string> = {
    starting: '#fbbf24',
    ready: '#22c55e',
    busy: '#3b82f6',
    idle: '#22c55e',
    exited: '#ef4444',
  };

  return (
    <span
      className="terminal-tab-status"
      style={{ backgroundColor: colorMap[status] }}
      title={status}
    />
  );
}

export function TerminalTabs() {
  const projectId = useProjectsStore((s) => s.activeProjectId) ?? 'default';
  const tabs = useTerminalStore((s) => s.tabsByProject[projectId] ?? []);
  const activeTabId = useTerminalStore((s) => s.activeTabByProject[projectId] ?? null);
  const { addTab, removeTab, setActiveTab, updateTabTitle, splitTerminal } = useTerminalStore();
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Context menu state
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState<ContextMenuPosition>({ x: 0, y: 0 });
  const [contextMenuTabId, setContextMenuTabId] = useState<string | null>(null);

  useEffect(() => {
    if (editingTabId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingTabId]);

  const handleTabClick = (id: string) => {
    setActiveTab(id);
  };

  const handleCloseClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    removeTab(id);
  };

  const handleNewTab = () => {
    addTab();
  };

  const handleDoubleClick = (e: React.MouseEvent, tab: TerminalTab) => {
    e.stopPropagation();
    setEditingTabId(tab.id);
    setEditValue(tab.title);
  };

  const handleRenameSubmit = () => {
    if (editingTabId && editValue.trim()) {
      updateTabTitle(editingTabId, editValue.trim());
    }
    setEditingTabId(null);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleRenameSubmit();
    } else if (e.key === 'Escape') {
      setEditingTabId(null);
    }
  };

  const handleTabContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
    setContextMenuTabId(tabId);
    setContextMenuOpen(true);
  }, []);

  const handleTabKeyDown = useCallback((e: React.KeyboardEvent, tabId: string) => {
    if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
      e.preventDefault();
      e.stopPropagation();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setContextMenuPosition({ x: rect.left + rect.width / 2, y: rect.bottom });
      setContextMenuTabId(tabId);
      setContextMenuOpen(true);
    }
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenuOpen(false);
    setContextMenuTabId(null);
  }, []);

  // Build context menu items for the right-clicked tab
  const contextMenuTab = contextMenuTabId ? tabs.find((t) => t.id === contextMenuTabId) : null;

  const contextMenuItems: ContextMenuEntry[] = contextMenuTab ? [
    {
      key: 'rename',
      label: 'Rename',
      icon: (
        <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8.5 1.5L10.5 3.5L4 10H2V8L8.5 1.5Z" />
        </svg>
      ),
      onClick: () => {
        setEditingTabId(contextMenuTab.id);
        setEditValue(contextMenuTab.title);
      },
    },
    { key: 'sep-1', separator: true },
    {
      key: 'split-horizontal',
      label: 'Split Right',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="12" y1="3" x2="12" y2="21" />
        </svg>
      ),
      onClick: () => {
        splitTerminal(contextMenuTab.id, contextMenuTab.activeTerminalId, 'horizontal');
      },
    },
    {
      key: 'split-vertical',
      label: 'Split Down',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="3" y1="12" x2="21" y2="12" />
        </svg>
      ),
      onClick: () => {
        splitTerminal(contextMenuTab.id, contextMenuTab.activeTerminalId, 'vertical');
      },
    },
    { key: 'sep-2', separator: true },
    {
      key: 'close',
      label: 'Close',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      ),
      onClick: () => {
        removeTab(contextMenuTab.id);
      },
      danger: true,
    },
  ] : [];

  return (
    <>
      <div className="terminal-tabs">
        <div className="terminal-tabs-list">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`terminal-tab ${tab.id === activeTabId ? 'terminal-tab-active' : ''} ${tab.backgroundMode ? 'terminal-tab-background' : ''}`}
              onClick={() => handleTabClick(tab.id)}
              onContextMenu={(e) => handleTabContextMenu(e, tab.id)}
              onKeyDown={(e) => handleTabKeyDown(e, tab.id)}
              title={tab.backgroundMode ? `${tab.cwd || tab.title} (background)` : (tab.cwd || tab.title)}
            >
              <StatusDot status={tab.status} />
              {editingTabId === tab.id ? (
                <input
                  ref={inputRef}
                  type="text"
                  className="terminal-tab-rename-input"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={handleRenameSubmit}
                  onKeyDown={handleRenameKeyDown}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span
                  className="terminal-tab-title"
                  onDoubleClick={(e) => handleDoubleClick(e, tab)}
                >
                  {tab.title}
                </span>
              )}
              <span
                className="terminal-tab-close"
                onClick={(e) => handleCloseClick(e, tab.id)}
                title="Close terminal"
              >
                ×
              </span>
            </button>
          ))}
        </div>
        <button
          className="terminal-tab-new"
          onClick={handleNewTab}
          title="New terminal (Ctrl+T)"
        >
          +
        </button>
      </div>
      <ContextMenu
        isOpen={contextMenuOpen}
        position={contextMenuPosition}
        items={contextMenuItems}
        onClose={closeContextMenu}
      />
    </>
  );
}
