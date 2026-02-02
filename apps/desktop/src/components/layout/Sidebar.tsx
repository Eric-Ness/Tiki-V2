import type { ReactNode } from "react";
import { useRef } from "react";
import { Panel, Separator, type PanelImperativeHandle } from "react-resizable-panels";
import { useLayoutStore } from "../../stores";

interface SidebarProps {
  children: ReactNode;
  defaultSize?: number;
  minSize?: number;
  className?: string;
}

export function Sidebar({
  children,
  defaultSize = 20,
  minSize = 15,
  className = "",
}: SidebarProps) {
  const panelRef = useRef<PanelImperativeHandle>(null);
  const isCollapsed = useLayoutStore((state) => state.collapsedPanels.sidebar);
  const setCollapsed = useLayoutStore((state) => state.setCollapsed);

  const handleToggle = () => {
    if (isCollapsed) {
      panelRef.current?.expand();
    } else {
      panelRef.current?.collapse();
    }
  };

  const handleResize = (size: { asPercentage: number }) => {
    const collapsed = size.asPercentage === 0;
    if (collapsed !== isCollapsed) {
      setCollapsed("sidebar", collapsed);
    }
  };

  return (
    <>
      <Panel
        id="sidebar"
        panelRef={panelRef}
        defaultSize={defaultSize}
        minSize={minSize}
        collapsible
        collapsedSize={0}
        onResize={handleResize}
        className={`panel sidebar-panel ${isCollapsed ? "collapsed" : ""} ${className}`.trim()}
      >
        <div className="sidebar-content">
          {children}
        </div>
        {!isCollapsed && (
          <button
            className="collapse-toggle collapse-toggle-sidebar"
            onClick={handleToggle}
            title="Collapse sidebar"
          >
            «
          </button>
        )}
      </Panel>
      {isCollapsed && (
        <button
          className="expand-toggle expand-toggle-sidebar"
          onClick={handleToggle}
          title="Expand sidebar"
        >
          »
        </button>
      )}
      <Separator className="resize-handle" />
    </>
  );
}
