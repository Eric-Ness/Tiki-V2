import { useEffect } from "react";
import "./ResumeBanner.css";

export interface ResumeBannerProps {
  lastCommand: string;
  autoResume: boolean;
  onResume: () => void;
  onFresh: () => void;
}

export function ResumeBanner({ lastCommand, autoResume, onResume, onFresh }: ResumeBannerProps) {
  useEffect(() => {
    if (!autoResume) return;
    const id = setTimeout(onResume, 5000);
    return () => clearTimeout(id);
  }, [autoResume, onResume]);

  return (
    <div className="resume-banner" role="dialog" aria-label="Resume Claude conversation">
      <div className="resume-banner-content">
        <span className="resume-banner-label">Last command:</span>
        <code className="resume-banner-cmd">{lastCommand}</code>
      </div>
      <div className="resume-banner-actions">
        <button className="resume-banner-primary" onClick={onResume}>
          Resume Conversation
        </button>
        <button className="resume-banner-secondary" onClick={onFresh}>
          Fresh Terminal
        </button>
      </div>
    </div>
  );
}
