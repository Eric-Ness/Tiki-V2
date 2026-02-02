import type { ReactNode } from "react";
import { Panel } from "react-resizable-panels";

interface MainContentProps {
  children: ReactNode;
  minSize?: number;
  className?: string;
}

export function MainContent({
  children,
  minSize = 30,
  className = "",
}: MainContentProps) {
  return (
    <Panel
      id="main-content"
      minSize={minSize}
      className={`panel main-content-panel ${className}`.trim()}
    >
      <div className="main-content">
        {children}
      </div>
    </Panel>
  );
}
