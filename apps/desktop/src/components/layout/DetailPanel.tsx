import type { ReactNode } from "react";
import { Panel } from "react-resizable-panels";

interface DetailPanelProps {
  children: ReactNode;
  defaultSize?: number;
  minSize?: number;
  className?: string;
}

export function DetailPanel({
  children,
  defaultSize = 15,
  minSize = 15,
  className = "",
}: DetailPanelProps) {
  return (
    <Panel
      id="detail-panel"
      defaultSize={defaultSize}
      minSize={minSize}
      className={`panel detail-panel ${className}`.trim()}
    >
      <div className="detail-content">
        {children}
      </div>
    </Panel>
  );
}
