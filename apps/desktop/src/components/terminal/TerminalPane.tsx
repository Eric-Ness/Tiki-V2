import { useCallback, useEffect, useRef } from 'react';
import { useTerminalStore, useProjectsStore } from '../../stores';
import { TerminalSplit } from './TerminalSplit';
import { TerminalTabs } from './TerminalTabs';
import './Terminal.css';

export function TerminalPane() {
  const projectId = useProjectsStore((s) => s.activeProjectId) ?? 'default';
  const tabs = useTerminalStore((s) => s.tabsByProject[projectId] ?? []);
  const activeTabId = useTerminalStore((s) => s.activeTabByProject[projectId] ?? null);
  const { addTab, removeTab, setActiveTab, splitTerminal } = useTerminalStore();
  const hasInitialized = useRef(false);

  // Create initial tab if none exist
  useEffect(() => {
    if (!hasInitialized.current && tabs.length === 0) {
      hasInitialized.current = true;
      addTab();
    }
  }, [tabs.length, addTab]);

  // Reset initialization flag when project changes so new projects get a tab
  useEffect(() => {
    hasInitialized.current = false;
  }, [projectId]);

  // Keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const modifier = isMac ? e.metaKey : e.ctrlKey;

    if (!modifier) return;

    // Ctrl/Cmd + T: New tab
    if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      addTab();
      return;
    }

    // Ctrl/Cmd + W: Close current tab
    if (e.key === 'w' || e.key === 'W') {
      if (activeTabId) {
        e.preventDefault();
        removeTab(activeTabId);
      }
      return;
    }

    // Ctrl + Tab: Next tab
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const currentIndex = tabs.findIndex(t => t.id === activeTabId);
      const nextIndex = (currentIndex + 1) % tabs.length;
      if (tabs[nextIndex]) {
        setActiveTab(tabs[nextIndex].id);
      }
      return;
    }

    // Ctrl + Shift + Tab: Previous tab
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      const currentIndex = tabs.findIndex(t => t.id === activeTabId);
      const prevIndex = currentIndex <= 0 ? tabs.length - 1 : currentIndex - 1;
      if (tabs[prevIndex]) {
        setActiveTab(tabs[prevIndex].id);
      }
      return;
    }

    // Ctrl + Shift + H: Split horizontal
    if ((e.key === 'h' || e.key === 'H') && e.shiftKey) {
      e.preventDefault();
      const activeTab = tabs.find(t => t.id === activeTabId);
      if (activeTab && activeTabId) {
        splitTerminal(activeTabId, activeTab.activeTerminalId, 'horizontal');
      }
      return;
    }

    // Ctrl + Shift + V: Split vertical
    if ((e.key === 'v' || e.key === 'V') && e.shiftKey) {
      e.preventDefault();
      const activeTab = tabs.find(t => t.id === activeTabId);
      if (activeTab && activeTabId) {
        splitTerminal(activeTabId, activeTab.activeTerminalId, 'vertical');
      }
      return;
    }
  }, [activeTabId, addTab, removeTab, setActiveTab, splitTerminal, tabs]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="terminal-pane">
      <TerminalTabs />
      <div className="terminal-instances">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className="terminal-instance"
            style={{ display: tab.id === activeTabId ? 'flex' : 'none' }}
          >
            <TerminalSplit tabId={tab.id} node={tab.splitRoot} />
          </div>
        ))}
      </div>
    </div>
  );
}
