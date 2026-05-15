import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./RateLimitIndicator.css";

const POLL_INTERVAL_MS = 60_000;
const INITIAL_FETCH_DELAY_MS = 1500;

export interface RateLimitBucket {
  limit: number;
  used: number;
  remaining: number;
  /** Unix epoch seconds (UTC) when this bucket resets. */
  reset: number;
}

export interface RateLimitStatus {
  core: RateLimitBucket;
  search: RateLimitBucket;
  graphql: RateLimitBucket;
  fetchedAtEpoch: number;
}

export type Severity = "healthy" | "warn" | "critical" | "unknown";

export function severityFor(remaining: number, limit: number): Severity {
  if (limit <= 0) return "unknown";
  const ratio = remaining / limit;
  if (ratio < 0.1) return "critical";
  if (ratio < 0.5) return "warn";
  return "healthy";
}

export function formatReset(epochSec: number, now: number = Date.now()): string {
  const ms = epochSec * 1000;
  const delta = ms - now;
  if (delta <= 0) return "resetting now";
  const mins = Math.ceil(delta / 60_000);
  if (mins < 60) return `resets in ${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return remainingMins === 0
    ? `resets in ${hours}h`
    : `resets in ${hours}h ${remainingMins}m`;
}

export function RateLimitIndicator() {
  const [status, setStatus] = useState<RateLimitStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const intervalRef = useRef<number | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const next = await invoke<RateLimitStatus>("fetch_rate_limit_status", {
        projectPath: null,
      });
      setStatus(next);
      setError(null);
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    }
  }, []);

  useEffect(() => {
    const initialId = window.setTimeout(fetchStatus, INITIAL_FETCH_DELAY_MS);
    intervalRef.current = window.setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => {
      window.clearTimeout(initialId);
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
      }
    };
  }, [fetchStatus]);

  if (status === null && error === null) {
    return (
      <span
        className="rate-limit-indicator rate-limit-indicator--loading"
        title="Loading GitHub API rate limit..."
      >
        GH: --/--
      </span>
    );
  }

  if (status === null) {
    return (
      <span
        className="rate-limit-indicator rate-limit-indicator--error"
        title={error ?? "Rate limit unavailable"}
      >
        GH: !
      </span>
    );
  }

  const severity = severityFor(status.core.remaining, status.core.limit);

  return (
    <div className="rate-limit-indicator-wrap">
      <button
        type="button"
        className={`rate-limit-indicator rate-limit-indicator--${severity}`}
        onClick={() => setTooltipOpen((v) => !v)}
        onMouseEnter={() => setTooltipOpen(true)}
        onMouseLeave={() => setTooltipOpen(false)}
        aria-label={`GitHub API rate limit: ${status.core.remaining} of ${status.core.limit} remaining, ${formatReset(status.core.reset)}`}
      >
        GH: {status.core.remaining}/{status.core.limit}
      </button>
      {tooltipOpen && (
        <div className="rate-limit-tooltip" role="tooltip">
          <div className="rate-limit-tooltip__row">
            <span className="rate-limit-tooltip__label">Core</span>
            <span>
              {status.core.remaining}/{status.core.limit} ·{" "}
              {formatReset(status.core.reset)}
            </span>
          </div>
          <div className="rate-limit-tooltip__row">
            <span className="rate-limit-tooltip__label">Search</span>
            <span>
              {status.search.remaining}/{status.search.limit} ·{" "}
              {formatReset(status.search.reset)}
            </span>
          </div>
          <div className="rate-limit-tooltip__row">
            <span className="rate-limit-tooltip__label">GraphQL</span>
            <span>
              {status.graphql.remaining}/{status.graphql.limit} ·{" "}
              {formatReset(status.graphql.reset)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
