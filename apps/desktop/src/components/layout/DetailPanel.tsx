import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { Panel, Separator, type PanelImperativeHandle } from "react-resizable-panels";

interface DetailPanelProps {
  children: ReactNode;
  defaultSize?: number;
  minSize?: number;
  className?: string;
}

export function DetailPanel({
  children,
  defaultSize = 25,
  minSize = 15,
  className = "",
}: DetailPanelProps) {
  const panelRef = useRef<PanelImperativeHandle>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const handleToggle = () => {
    if (isCollapsed) {
      panelRef.current?.expand();
    } else {
      panelRef.current?.collapse();
    }
  };

  return (
    <>
      <Separator className="resize-handle" />
      {isCollapsed && (
        <button
          className="expand-toggle expand-toggle-detail"
          onClick={handleToggle}
          title="Expand detail panel"
        >
          «
        </button>
      )}
      <Panel
        id="detail-panel"
        panelRef={panelRef}
        defaultSize={defaultSize}
        minSize={minSize}
        collapsible
        collapsedSize={0}
        onResize={(size) => {
          setIsCollapsed(size.asPercentage === 0);
        }}
        className={`panel detail-panel ${isCollapsed ? "collapsed" : ""} ${className}`.trim()}
      >
        {!isCollapsed && (
          <button
            className="collapse-toggle collapse-toggle-detail"
            onClick={handleToggle}
            title="Collapse detail panel"
          >
            »
          </button>
        )}
        <div className="detail-content">
          {children}
        </div>
      </Panel>
    </>
  );
}
