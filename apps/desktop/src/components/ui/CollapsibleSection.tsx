import { type ReactNode, useState } from "react";
import "./CollapsibleSection.css";

export interface CollapsibleSectionProps {
  title: string;
  children: ReactNode;
  icon?: ReactNode;
  badge?: number;
  defaultCollapsed?: boolean;
  className?: string;
}

export function CollapsibleSection({
  title,
  children,
  icon,
  badge,
  defaultCollapsed = false,
  className = "",
}: CollapsibleSectionProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const handleToggle = () => {
    setCollapsed((prev) => !prev);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleToggle();
    }
  };

  return (
    <div
      className={`collapsible-section ${collapsed ? "" : "expanded"} ${className}`.trim()}
    >
      <button
        className="collapsible-header"
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        aria-expanded={!collapsed}
        type="button"
      >
        {icon && <span className="collapsible-icon">{icon}</span>}
        <span className="collapsible-title">{title}</span>
        {badge !== undefined && (
          <span className="collapsible-badge">{badge}</span>
        )}
        <svg
          className="collapsible-chevron"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M6 4L10 8L6 12"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <div className="collapsible-content">
        <div className="collapsible-content-inner">{children}</div>
      </div>
    </div>
  );
}
