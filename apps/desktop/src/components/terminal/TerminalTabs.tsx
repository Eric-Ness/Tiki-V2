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
  const { tabs, activeTabId, addTab, removeTab, setActiveTab } =
    useTerminalStore();

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

  return (
    <div className="terminal-tabs">
      <div className="terminal-tabs-list">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`terminal-tab ${tab.id === activeTabId ? 'terminal-tab-active' : ''}`}
            onClick={() => handleTabClick(tab.id)}
            title={tab.cwd || tab.title}
          >
            <StatusDot status={tab.status} />
            <span className="terminal-tab-title">{tab.title}</span>
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
