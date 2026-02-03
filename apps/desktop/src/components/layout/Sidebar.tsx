import type { ReactNode } from "react";
import { Panel } from "react-resizable-panels";

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
  return (
    <Panel
      id="sidebar"
      defaultSize={defaultSize}
      minSize={minSize}
      className={`panel sidebar-panel ${className}`.trim()}
    >
      <div className="sidebar-content">
        {children}
      </div>
    </Panel>
  );
}
