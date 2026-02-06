import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CollapsibleSection } from "../ui/CollapsibleSection";
import "./ClaudeUsageSection.css";

interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests: number;
  costUsd: number;
}

interface DailyActivity {
  date: string;
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
}

interface ClaudeUsageStats {
  version: number;
  lastComputedDate: string;
  dailyActivity: DailyActivity[];
  dailyModelTokens: Array<{ date: string; tokensByModel: Record<string, number> }>;
  modelUsage: Record<string, ModelUsage>;
  totalSessions: number;
  totalMessages: number;
  firstSessionDate: string | null;
}

const MODEL_NAMES: Record<string, string> = {
  "claude-opus-4-5-20251101": "Opus 4.5",
  "claude-opus-4-6": "Opus 4.6",
  "claude-sonnet-4-5-20250929": "Sonnet 4.5",
  "claude-sonnet-4-20250514": "Sonnet 4",
  "claude-haiku-4-5-20251001": "Haiku 4.5",
};

function getModelName(modelId: string): string {
  return MODEL_NAMES[modelId] ?? modelId;
}

function formatTokenCount(count: number): string {
  if (count >= 1_000_000_000) return `${(count / 1_000_000_000).toFixed(1)}B`;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
}

function formatNumber(num: number): string {
  return num.toLocaleString();
}

function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDayLabel(dateStr: string): string {
  const parts = dateStr.split("-");
  return `${parts[1]}/${parts[2]}`;
}

const REFRESH_INTERVAL_MS = 60_000;

export function ClaudeUsageSection() {
  const [stats, setStats] = useState<ClaudeUsageStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchUsage = useCallback(async () => {
    try {
      const result = await invoke<ClaudeUsageStats | null>("get_claude_usage");
      setStats(result);
    } catch (err) {
      console.error("Failed to fetch Claude usage:", err);
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchUsage();
    setRefreshing(false);
  }, [fetchUsage]);

  useEffect(() => {
    fetchUsage();
    const interval = setInterval(fetchUsage, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchUsage]);

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

  // Find today's activity
  const today = getTodayDateString();
  const todayActivity = stats?.dailyActivity.find((d) => d.date === today);

  // Get last 7 days of activity
  const last7Days = stats?.dailyActivity.slice(-7) ?? [];
  const maxMessages = Math.max(...last7Days.map((d) => d.messageCount), 1);

  // Get model usage sorted by output tokens
  const modelEntries = stats
    ? Object.entries(stats.modelUsage).sort(
        ([, a], [, b]) => b.outputTokens - a.outputTokens
      )
    : [];

  return (
    <CollapsibleSection
      title="Claude Usage"
      icon={usageIcon}
      className="claude-usage-section"
      defaultCollapsed
    >
      <div className="claude-usage-content">
        {!stats ? (
          <div className="claude-usage-empty">No usage data available</div>
        ) : (
          <>
            {/* Today's Stats */}
            <div className="claude-usage-today">
              <div className="claude-usage-stat">
                <span className="claude-usage-stat-value">
                  {formatNumber(todayActivity?.messageCount ?? 0)}
                </span>
                <span className="claude-usage-stat-label">Messages</span>
              </div>
              <div className="claude-usage-stat">
                <span className="claude-usage-stat-value">
                  {formatNumber(todayActivity?.sessionCount ?? 0)}
                </span>
                <span className="claude-usage-stat-label">Sessions</span>
              </div>
              <div className="claude-usage-stat">
                <span className="claude-usage-stat-value">
                  {formatNumber(todayActivity?.toolCallCount ?? 0)}
                </span>
                <span className="claude-usage-stat-label">Tool Calls</span>
              </div>
            </div>

            {/* Model Usage */}
            {modelEntries.length > 0 && (
              <div className="claude-usage-models">
                <div className="claude-usage-section-label">Models</div>
                {modelEntries.map(([modelId, usage]) => (
                  <div key={modelId} className="claude-usage-model">
                    <span className="claude-usage-model-name">
                      {getModelName(modelId)}
                    </span>
                    <span className="claude-usage-model-tokens">
                      {formatTokenCount(usage.outputTokens)} out
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* 7-Day Activity */}
            {last7Days.length > 0 && (
              <div className="claude-usage-activity">
                <div className="claude-usage-section-label">Last 7 Days</div>
                {last7Days.map((day) => (
                  <div key={day.date} className="claude-usage-day">
                    <span className="claude-usage-day-label">
                      {getDayLabel(day.date)}
                    </span>
                    <div className="claude-usage-day-bar-bg">
                      <div
                        className="claude-usage-day-bar"
                        style={{
                          width: `${(day.messageCount / maxMessages) * 100}%`,
                        }}
                      />
                    </div>
                    <span className="claude-usage-day-count">
                      {formatTokenCount(day.messageCount)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Totals + Refresh */}
            <div className="claude-usage-totals">
              <span>
                {formatNumber(stats.totalMessages)} total messages
              </span>
              <button
                className="claude-usage-refresh"
                onClick={handleRefresh}
                disabled={refreshing}
                type="button"
                title="Refresh usage data"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
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
            </div>
          </>
        )}
      </div>
    </CollapsibleSection>
  );
}
