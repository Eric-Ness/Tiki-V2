import { useState, useEffect, useRef } from "react";
import type { PipelineStep } from "../work/WorkCard";
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

interface PipelineTimelineProps {
  currentStep?: PipelineStep;
  workStatus: string;
  createdAt?: string;
  lastActivity?: string;
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
  workStatus: string
): StepState {
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
          const state = getStepState(index, currentIndex, workStatus);
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
                <div className={circleClasses}>
                  {state === "completed" ? "\u2713" : index + 1}
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
