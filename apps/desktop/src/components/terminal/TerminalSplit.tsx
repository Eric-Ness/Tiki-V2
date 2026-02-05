import { Fragment } from 'react';
import { Panel, Group, Separator, type Layout } from 'react-resizable-panels';
import { useTerminalStore, useProjectsStore, type SplitTreeNode, type SplitDirection } from '../../stores';
import { Terminal } from './Terminal';

interface TerminalSplitProps {
  tabId: string;
  node: SplitTreeNode;
}

interface SplitControlsProps {
  tabId: string;
  terminalId: string;
  showClose: boolean;
}

function SplitControls({ tabId, terminalId, showClose }: SplitControlsProps) {
  const { splitTerminal, closeSplit } = useTerminalStore();

  const handleSplit = (direction: SplitDirection) => (e: React.MouseEvent) => {
    e.stopPropagation();
    splitTerminal(tabId, terminalId, direction);
  };

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    closeSplit(tabId, terminalId);
  };

  return (
    <div className="terminal-split-controls">
      <button
        className="terminal-split-btn"
        onClick={handleSplit('horizontal')}
        title="Split horizontally (Ctrl+Shift+H)"
      >
        ⬓
      </button>
      <button
        className="terminal-split-btn"
        onClick={handleSplit('vertical')}
        title="Split vertically (Ctrl+Shift+V)"
      >
        ⬒
      </button>
      {showClose && (
        <button
          className="terminal-split-btn terminal-split-close"
          onClick={handleClose}
          title="Close split"
        >
          ×
        </button>
      )}
    </div>
  );
}

// Helper to count terminals in the tree
const countTerminals = (node: SplitTreeNode): number => {
  if (node.type === 'terminal') return 1;
  return node.children.reduce((sum, child) => sum + countTerminals(child), 0);
};

export function TerminalSplit({ tabId, node }: TerminalSplitProps) {
  const projectId = useProjectsStore((s) => s.activeProjectId) ?? 'default';
  const tabs = useTerminalStore((s) => s.tabsByProject[projectId] ?? []);
  const { updateSplitSizes, updateTabStatus, setActiveTerminal } = useTerminalStore();
  const activeProject = useProjectsStore((state) => state.getActiveProject());
  const tab = tabs.find((t) => t.id === tabId);
  const totalTerminals = tab ? countTerminals(tab.splitRoot) : 1;

  if (node.type === 'terminal') {
    const isActive = tab?.activeTerminalId === node.terminalId;
    return (
      <div
        className={`terminal-split-leaf ${isActive ? 'terminal-split-active' : ''}`}
        onClick={() => setActiveTerminal(tabId, node.terminalId)}
      >
        <SplitControls
          tabId={tabId}
          terminalId={node.terminalId}
          showClose={totalTerminals > 1}
        />
        <Terminal
          terminalId={node.terminalId}
          cwd={activeProject?.path}
          onStatusChange={(status) => updateTabStatus(tabId, status)}
        />
      </div>
    );
  }

  // Get panel IDs for children
  const getPanelId = (child: SplitTreeNode) =>
    child.type === 'terminal' ? child.terminalId : child.id;

  const handleLayoutChange = (layout: Layout) => {
    // Convert layout map to sizes array in the same order as children
    const sizes = node.children.map((child) => {
      const panelId = getPanelId(child);
      return layout[panelId] ?? 50;
    });
    updateSplitSizes(tabId, node.id, sizes);
  };

  return (
    <Group
      orientation={node.direction}
      onLayoutChange={handleLayoutChange}
      className="terminal-split-group"
    >
      {node.children.map((child, index) => {
        const panelId = getPanelId(child);
        return (
          <Fragment key={panelId}>
            <Panel
              id={panelId}
              defaultSize={node.sizes[index]}
              minSize={10}
              className="terminal-split-panel"
            >
              <TerminalSplit tabId={tabId} node={child} />
            </Panel>
            {index < node.children.length - 1 && (
              <Separator className="terminal-split-handle" />
            )}
          </Fragment>
        );
      })}
    </Group>
  );
}
