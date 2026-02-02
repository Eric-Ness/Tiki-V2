import type { ReactNode } from "react";
import { Group } from "react-resizable-panels";
import { useLayoutStore, type PanelSizes } from "../../stores";
import "./layout.css";

interface AppLayoutProps {
  children: ReactNode;
  className?: string;
}

export function AppLayout({ children, className = "" }: AppLayoutProps) {
  const setPanelSizes = useLayoutStore((state) => state.setPanelSizes);

  const handleLayout = (sizes: number[]) => {
    // sizes is an array of percentages in panel order: [sidebar, main, detail]
    if (sizes.length === 3) {
      const newSizes: PanelSizes = {
        sidebar: sizes[0],
        main: sizes[1],
        detail: sizes[2],
      };
      setPanelSizes(newSizes);
    }
  };

  return (
    <Group
      orientation="horizontal"
      className={`app-layout ${className}`.trim()}
      onLayout={handleLayout}
    >
      {children}
    </Group>
  );
}
