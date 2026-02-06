import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CollapsibleSection } from "../ui/CollapsibleSection";
import "./ClaudeUsageSection.css";

interface UsageLimit {
  utilization: number;
  resetsAt: string | null;
}

interface ClaudeApiUsage {
  fiveHour: UsageLimit | null;
  sevenDay: UsageLimit | null;
  sevenDayOpus: UsageLimit | null;
  sevenDaySonnet: UsageLimit | null;
}

const REFRESH_INTERVAL_MS = 60_000;

function getUsageColor(pct: number): string {
  if (pct >= 90) return "var(--usage-red, #e53935)";
  if (pct >= 70) return "var(--usage-amber, #f9a825)";
  return "var(--usage-green, #43a047)";
}

function formatResetTime(resetsAt: string | null): string {
  if (!resetsAt) return "";
  const now = Date.now();
  const reset = new Date(resetsAt).getTime();
  const diff = reset - now;
  if (diff <= 0) return "resetting...";

  const hours = Math.floor(diff / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return `${days}d ${remHours}h`;
  }
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function ClaudeUsageSection() {
  const [usage, setUsage] = useState<ClaudeApiUsage | null>(null);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const checkKey = useCallback(async () => {
    try {
      const result = await invoke<boolean>("has_claude_session_key");
      setHasKey(result);
    } catch {
      setHasKey(false);
    }
  }, []);

  const fetchUsage = useCallback(async () => {
    try {
      const result = await invoke<ClaudeApiUsage | null>("get_claude_usage");
      setUsage(result);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchUsage();
    setRefreshing(false);
  }, [fetchUsage]);

  const handleSaveKey = useCallback(async () => {
    if (!keyInput.trim()) return;
    setSaving(true);
    try {
      await invoke("save_claude_session_key", { key: keyInput.trim() });
      setKeyInput("");
      setHasKey(true);
      setError(null);
      await fetchUsage();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }, [keyInput, fetchUsage]);

  const handleClearKey = useCallback(async () => {
    try {
      await invoke("clear_claude_session_key");
      setHasKey(false);
      setUsage(null);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  // Check key on mount
  useEffect(() => {
    checkKey();
  }, [checkKey]);

  // Fetch usage + polling when key is set
  useEffect(() => {
    if (!hasKey) return;
    fetchUsage();
    const interval = setInterval(fetchUsage, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [hasKey, fetchUsage]);

  const usageIcon = (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M3 12V7M6.5 12V4M10 12V6M13.5 12V2"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );

  const renderBar = (label: string, limit: UsageLimit | null | undefined) => {
    if (!limit) return null;
    const pct = Math.round(limit.utilization * 100);
    const color = getUsageColor(pct);
    const reset = formatResetTime(limit.resetsAt);

    return (
      <div className="claude-usage-limit">
        <div className="claude-usage-limit-header">
          <span className="claude-usage-limit-label">{label}</span>
          <span className="claude-usage-limit-pct" style={{ color }}>
            {pct}%
          </span>
        </div>
        <div className="claude-usage-bar-bg">
          <div
            className="claude-usage-bar-fill"
            style={{ width: `${pct}%`, backgroundColor: color }}
          />
        </div>
        {reset && (
          <div className="claude-usage-limit-reset">resets in {reset}</div>
        )}
      </div>
    );
  };

  return (
    <CollapsibleSection
      title="Claude Usage"
      icon={usageIcon}
      className="claude-usage-section"
      defaultCollapsed
    >
      <div className="claude-usage-content">
        {hasKey === null ? null : !hasKey ? (
          // No session key - show setup
          <div className="claude-usage-setup">
            <p className="claude-usage-setup-hint">
              Paste your Claude.ai session key to see plan usage.
            </p>
            <div className="claude-usage-key-row">
              <input
                type="password"
                className="claude-usage-key-input"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="sk-ant-..."
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveKey();
                }}
              />
              <button
                className="claude-usage-key-save"
                onClick={handleSaveKey}
                disabled={saving || !keyInput.trim()}
                type="button"
              >
                {saving ? "..." : "Save"}
              </button>
            </div>
          </div>
        ) : (
          // Has key - show usage or loading/error
          <>
            {error && (
              <div className="claude-usage-error">
                <span>{error}</span>
                <button
                  className="claude-usage-error-dismiss"
                  onClick={() => setError(null)}
                  type="button"
                >
                  &times;
                </button>
              </div>
            )}

            {usage ? (
              <div className="claude-usage-limits">
                {renderBar("5-Hour Limit", usage.fiveHour)}
                {renderBar("7-Day Limit", usage.sevenDay)}
                {renderBar("7-Day Opus", usage.sevenDayOpus)}
                {renderBar("7-Day Sonnet", usage.sevenDaySonnet)}
              </div>
            ) : !error ? (
              <div className="claude-usage-loading">Loading...</div>
            ) : null}

            <div className="claude-usage-footer">
              <button
                className="claude-usage-refresh"
                onClick={handleRefresh}
                disabled={refreshing}
                type="button"
                title="Refresh"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  className={refreshing ? "spinning" : ""}
                >
                  <path
                    d="M10 6A4 4 0 1 1 6 2M10 2V6H6"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <button
                className="claude-usage-clear-key"
                onClick={handleClearKey}
                type="button"
                title="Remove session key"
              >
                Clear Key
              </button>
            </div>
          </>
        )}
      </div>
    </CollapsibleSection>
  );
}
