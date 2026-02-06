import type { ReactNode } from "react";
import { Group, type Layout } from "react-resizable-panels";
import { useLayoutStore, type PanelSizes } from "../../stores";
import "./layout.css";

interface AppLayoutProps {
  children: ReactNode;
  className?: string;
}

export function AppLayout({ children, className = "" }: AppLayoutProps) {
  const setPanelSizes = useLayoutStore((state) => state.setPanelSizes);

  const handleLayoutChange = (layout: Layout) => {
    // Layout is a map of panel id to percentage (0..100)
    const newSizes: PanelSizes = {
      sidebar: layout["sidebar"] ?? 15,
      main: layout["main-content"] ?? 70,
      detail: layout["detail-panel"] ?? 15,
    };
    setPanelSizes(newSizes);
  };

  return (
    <Group
      orientation="horizontal"
      className={`app-layout ${className}`.trim()}
      onLayoutChange={handleLayoutChange}
    >
      {children}
    </Group>
  );
}
