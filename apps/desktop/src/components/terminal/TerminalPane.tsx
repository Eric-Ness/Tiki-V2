import { useCallback, useEffect, useRef } from 'react';
import { useTerminalStore } from '../../stores';
import { Terminal } from './Terminal';
import { TerminalTabs } from './TerminalTabs';
import './Terminal.css';

export function TerminalPane() {
  const { tabs, activeTabId, addTab, removeTab, setActiveTab, updateTabStatus } = useTerminalStore();
  const hasInitialized = useRef(false);

  // Create initial tab if none exist
  useEffect(() => {
    if (!hasInitialized.current && tabs.length === 0) {
      hasInitialized.current = true;
      addTab();
    }
  }, [tabs.length, addTab]);

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
  }, [activeTabId, addTab, removeTab, setActiveTab, tabs]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleStatusChange = (tabId: string, status: 'ready' | 'busy' | 'idle' | 'exited') => {
    updateTabStatus(tabId, status);
  };

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
            <Terminal
              tabId={tab.id}
              onStatusChange={(status) => handleStatusChange(tab.id, status)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
