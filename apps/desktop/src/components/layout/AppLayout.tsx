import type { ReactNode } from "react";
import { Group } from "react-resizable-panels";
import "./layout.css";

interface AppLayoutProps {
  children: ReactNode;
  className?: string;
}

export function AppLayout({ children, className = "" }: AppLayoutProps) {
  return (
    <Group
      orientation="horizontal"
      className={`app-layout ${className}`.trim()}
    >
      {children}
    </Group>
  );
}
