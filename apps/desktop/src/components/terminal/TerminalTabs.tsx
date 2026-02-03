import { useState, useRef, useEffect } from 'react';
import { useTerminalStore, type TerminalTab } from '../../stores';

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
  const { tabs, activeTabId, addTab, removeTab, setActiveTab, updateTabTitle } =
    useTerminalStore();
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

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

  return (
    <div className="terminal-tabs">
      <div className="terminal-tabs-list">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`terminal-tab ${tab.id === activeTabId ? 'terminal-tab-active' : ''} ${tab.backgroundMode ? 'terminal-tab-background' : ''}`}
            onClick={() => handleTabClick(tab.id)}
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
  );
}
