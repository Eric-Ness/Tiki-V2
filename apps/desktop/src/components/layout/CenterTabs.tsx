import { useLayoutStore, type ViewType } from '../../stores';
import './CenterTabs.css';

interface TabConfig {
  id: ViewType;
  label: string;
  shortcut: string;
}

const TABS: TabConfig[] = [
  { id: 'terminal', label: 'Terminal', shortcut: 'Ctrl+1' },
  { id: 'kanban', label: 'Kanban', shortcut: 'Ctrl+2' },
  { id: 'dependencies', label: 'Dependencies', shortcut: 'Ctrl+3' },
];

export function CenterTabs() {
  const activeView = useLayoutStore((s) => s.activeView);
  const setActiveView = useLayoutStore((s) => s.setActiveView);

  return (
    <div className="center-tabs">
      <div className="center-tabs-list">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`center-tab ${activeView === tab.id ? 'center-tab-active' : ''}`}
            onClick={() => setActiveView(tab.id)}
            title={tab.shortcut}
          >
            <span className="center-tab-label">{tab.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
