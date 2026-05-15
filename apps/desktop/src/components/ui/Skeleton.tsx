import type { FC } from "react";
import "./Skeleton.css";

export interface SkeletonProps {
  width?: string | number;
  height?: number;
  borderRadius?: number;
  className?: string;
}

interface SkeletonComponent extends FC<SkeletonProps> {
  Text: FC<{ lines?: number; className?: string }>;
  Card: FC<{ className?: string }>;
}

const SkeletonBase: FC<SkeletonProps> = ({
  width = "100%",
  height = 16,
  borderRadius = 4,
  className,
}) => (
  <div
    className={`skeleton${className ? " " + className : ""}`}
    style={{
      width: typeof width === "number" ? `${width}px` : width,
      height: `${height}px`,
      borderRadius: `${borderRadius}px`,
    }}
    aria-hidden="true"
  />
);

const Skeleton = SkeletonBase as SkeletonComponent;

Skeleton.Text = ({ lines = 1, className }) => (
  <div className={`skeleton-text${className ? " " + className : ""}`}>
    {Array.from({ length: lines }, (_, i) => (
      <SkeletonBase
        key={i}
        height={12}
        // Last line narrower for natural-paragraph feel.
        width={i === lines - 1 && lines > 1 ? "60%" : "100%"}
      />
    ))}
  </div>
);

Skeleton.Card = ({ className }) => (
  <div className={`skeleton-card${className ? " " + className : ""}`}>
    <SkeletonBase height={14} width="70%" />
    <SkeletonBase height={12} width="40%" />
  </div>
);

export { Skeleton };
