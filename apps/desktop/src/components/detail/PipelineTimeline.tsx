import { useState, useEffect, useRef } from "react";
import type { PipelineStep } from "../work/WorkCard";
import type { PipelineState } from "../../utils/deriveDisplayStatus";
import "./PipelineTimeline.css";

const PIPELINE_STEPS: PipelineStep[] = ["GET", "REVIEW", "PLAN", "AUDIT", "EXECUTE", "SHIP"];

const STEP_LABELS: Record<PipelineStep, string> = {
  GET: "GET",
  REVIEW: "REVIEW",
  PLAN: "PLAN",
  AUDIT: "AUDIT",
  EXECUTE: "EXEC",
  SHIP: "SHIP",
};

const ICON_SVG_PROPS = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
} as const;

const STEP_ICONS: Record<PipelineStep, React.ReactNode> = {
  GET: (
    // Cloud-arrow-down: fetch / pull from remote
    <svg {...ICON_SVG_PROPS} aria-hidden="true">
      <path d="M12 9v8m0 0-3-3m3 3 3-3" />
      <path d="M18 16.5A4.5 4.5 0 0 0 17.5 7.5 7 7 0 0 0 4 9a4.5 4.5 0 0 0 1 9h1" />
    </svg>
  ),
  REVIEW: (
    // Magnifying glass: analyze / inspect
    <svg {...ICON_SVG_PROPS} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  ),
  PLAN: (
    // Bullet list: break into phases
    <svg {...ICON_SVG_PROPS} aria-hidden="true">
      <path d="M8 6h13M8 12h13M8 18h13" />
      <circle cx="4" cy="6" r="1" fill="currentColor" />
      <circle cx="4" cy="12" r="1" fill="currentColor" />
      <circle cx="4" cy="18" r="1" fill="currentColor" />
    </svg>
  ),
  AUDIT: (
    // Clipboard-check: validation
    <svg {...ICON_SVG_PROPS} aria-hidden="true">
      <rect x="6" y="5" width="12" height="16" rx="2" />
      <path d="M9 5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
      <path d="m9.5 13 2 2 4-4" />
    </svg>
  ),
  EXECUTE: (
    // Play triangle: run
    <svg {...ICON_SVG_PROPS} aria-hidden="true">
      <path d="M7 4v16l13-8z" fill="currentColor" stroke="currentColor" />
    </svg>
  ),
  SHIP: (
    // Paper-airplane: deliver
    <svg {...ICON_SVG_PROPS} aria-hidden="true">
      <path d="m3 12 18-8-7 18-3-7-8-3z" />
      <path d="M10 14 21 4" />
    </svg>
  ),
};

interface PipelineTimelineProps {
  currentStep?: PipelineStep;
  workStatus: string;
  createdAt?: string;
  lastActivity?: string;
  /**
   * Canonical pipeline rendering directive from `deriveDisplayStatus` (#222).
   * When provided it DRIVES the step states (so a not-genuinely-complete item
   * never shows all-green). When undefined, falls back to the legacy
   * workStatus-based behavior for any other caller.
   */
  pipelineState?: PipelineState;
}

function formatElapsed(ms: number): string {
  if (ms < 0) return "<1m";
  const totalMinutes = Math.floor(ms / 60000);
  if (totalMinutes < 1) return "<1m";
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

type StepState = "completed" | "active" | "pending" | "failed";

function getStepState(
  stepIndex: number,
  currentIndex: number,
  workStatus: string,
  pipelineState?: PipelineState
): StepState {
  // When the canonical pipelineState is supplied it drives rendering (#222) —
  // the key correctness goal is that an item that is NOT genuinely complete
  // never shows an all-green pipeline.
  if (pipelineState) {
    switch (pipelineState) {
      case "complete":
        return "completed";
      case "partial":
        // All green except the final SHIP step (closed-not-merged).
        return stepIndex === PIPELINE_STEPS.length - 1 ? "pending" : "completed";
      case "reset":
      case "none":
        return "pending";
      case "failed":
        if (stepIndex < currentIndex) return "completed";
        if (stepIndex === currentIndex) return "failed";
        return "pending";
      case "paused":
        if (stepIndex < currentIndex) return "completed";
        if (stepIndex === currentIndex) return "active";
        return "pending";
      case "active":
      default:
        if (stepIndex < currentIndex) return "completed";
        if (stepIndex === currentIndex) return "active";
        return "pending";
    }
  }

  // Legacy fallback: derive from raw workStatus (preserved for any caller that
  // doesn't yet pass pipelineState).
  if (workStatus === "completed") return "completed";
  if (workStatus === "failed") {
    if (stepIndex < currentIndex) return "completed";
    if (stepIndex === currentIndex) return "failed";
    return "pending";
  }
  if (stepIndex < currentIndex) return "completed";
  if (stepIndex === currentIndex) return "active";
  return "pending";
}

/** Animation class state for transition effects */
interface AnimationClasses {
  activatingStep: number | null;
  completingStep: number | null;
  fillingConnector: number | null;
}

export function PipelineTimeline({
  currentStep,
  workStatus,
  createdAt,
  lastActivity,
  pipelineState,
}: PipelineTimelineProps) {
  const [elapsed, setElapsed] = useState<string>("");
  const [animations, setAnimations] = useState<AnimationClasses>({
    activatingStep: null,
    completingStep: null,
    fillingConnector: null,
  });

  const currentIndex = currentStep ? PIPELINE_STEPS.indexOf(currentStep) : -1;
  const prevIndexRef = useRef<number>(currentIndex);

  // Track step transitions and trigger animations
  useEffect(() => {
    const prevIndex = prevIndexRef.current;
    prevIndexRef.current = currentIndex;

    // Only animate when step actually advances forward
    if (currentIndex > prevIndex && prevIndex >= 0) {
      setAnimations({
        activatingStep: currentIndex,
        completingStep: prevIndex,
        // The connector between prevIndex and currentIndex just completed
        fillingConnector: prevIndex,
      });

      // Clear animation classes after animations complete
      const timer = setTimeout(() => {
        setAnimations({
          activatingStep: null,
          completingStep: null,
          fillingConnector: null,
        });
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [currentIndex]);

  // Live-update elapsed time
  useEffect(() => {
    if (!createdAt) {
      setElapsed("");
      return;
    }

    const updateElapsed = () => {
      const start = new Date(createdAt).getTime();
      // If completed/failed, use lastActivity as end time; otherwise use now
      const isActive = workStatus !== "completed" && workStatus !== "failed";
      const end = isActive
        ? Date.now()
        : lastActivity
          ? new Date(lastActivity).getTime()
          : Date.now();
      setElapsed(formatElapsed(end - start));
    };

    updateElapsed();

    const isActive = workStatus !== "completed" && workStatus !== "failed";
    if (isActive) {
      const interval = setInterval(updateElapsed, 1000);
      return () => clearInterval(interval);
    }
  }, [createdAt, lastActivity, workStatus]);

  return (
    <div className="pipeline-timeline">
      <div className="pipeline-steps">
        {PIPELINE_STEPS.map((step, index) => {
          const state = getStepState(index, currentIndex, workStatus, pipelineState);
          const isActivating = animations.activatingStep === index;
          const isCompleting = animations.completingStep === index;
          const isFilling = animations.fillingConnector === index;

          const circleClasses = [
            "pipeline-step-circle",
            `step-${state}`,
            isActivating ? "activating" : "",
            isCompleting ? "completing" : "",
          ]
            .filter(Boolean)
            .join(" ");

          const connectorClasses = [
            "pipeline-connector",
            state === "completed" ? "connector-completed" : "connector-pending",
            isFilling ? "filling" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <div key={step} style={{ display: "contents" }}>
              <div className="pipeline-step">
                <div className={circleClasses} title={STEP_LABELS[step]}>
                  {state === "completed" ? "\u2713" : STEP_ICONS[step]}
                </div>
                <span className={`pipeline-step-label label-${state}`}>
                  {STEP_LABELS[step]}
                </span>
              </div>
              {index < PIPELINE_STEPS.length - 1 && (
                <div className={connectorClasses} />
              )}
            </div>
          );
        })}
      </div>
      {elapsed && <div className="pipeline-elapsed">{elapsed}</div>}
    </div>
  );
}
