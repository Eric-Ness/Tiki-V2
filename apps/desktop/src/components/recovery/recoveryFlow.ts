/**
 * Pure helpers for the StateRecoveryDialog. Kept separate from the React
 * component so they can be unit-tested without mounting the UI or stubbing
 * Tauri IPC. See `__tests__/recoveryFlow.test.ts`.
 */

/**
 * Parse a backup timestamp string of the form `YYYY-MM-DDTHH-MM-SS` (the
 * format `backup_state` writes in Rust — colons replaced with hyphens for
 * filesystem safety). Returns a Date in UTC, or null if the string doesn't
 * match.
 *
 * Example: `"2026-05-11T16-30-00"` → `Date(Date.UTC(2026, 4, 11, 16, 30, 0))`
 */
export function parseBackupTimestamp(timestamp: string): Date | null {
  // Pattern: YYYY-MM-DDTHH-MM-SS
  const m = timestamp.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

/**
 * Render a human-friendly approximate age like "just now", "5 minutes ago",
 * "3 hours ago", "2 days ago", "a year ago". `now` is parameterized for
 * deterministic tests.
 */
export function formatRelativeAge(date: Date, now: Date): string {
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) {
    // Future timestamps (clock skew or invalid) — fall through to "just now".
    return 'just now';
  }
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

/**
 * Format a byte count for display. Uses 1024-based units (KB, MB, GB) and
 * one decimal place of precision for non-byte sizes.
 *
 * Examples:
 *   formatBytes(0)       → "0 B"
 *   formatBytes(512)     → "512 B"
 *   formatBytes(1536)    → "1.5 KB"
 *   formatBytes(2097152) → "2.0 MB"
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.floor(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)} GB`;
}

export interface BackupValidationResult {
  ok: boolean;
  error?: string;
}

/**
 * Verify that a candidate backup file's text content (a) parses as JSON and
 * (b) has the minimal canonical shape expected by the rest of the app:
 *   - `schemaVersion` is a number
 *   - `activeWork` is a plain object (record)
 *
 * Used to gate the Restore button — invalid backups are still listed but
 * disabled, preventing the "all 10 backups are also corrupt" footgun where
 * Restore would just propagate the problem.
 */
export function validateBackupShape(json: string): BackupValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Invalid JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'Root must be an object' };
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.schemaVersion !== 'number') {
    return { ok: false, error: 'Missing or invalid schemaVersion' };
  }
  if (
    typeof obj.activeWork !== 'object' ||
    obj.activeWork === null ||
    Array.isArray(obj.activeWork)
  ) {
    return { ok: false, error: 'Missing or invalid activeWork object' };
  }
  return { ok: true };
}

/**
 * Confirmation phrase the user must type literally into the Start Fresh
 * input box before the destructive write fires. Single source of truth so
 * the component and any test stay in sync.
 */
export const RESET_CONFIRMATION_PHRASE = 'reset';

export interface JsonErrorLocation {
  line: number;
  column: number;
}

/**
 * Extract a 1-based line/column from a JSON parse error message. Handles
 * both serde_json's format ("... at line 12 column 5") — the shape of the
 * `error` string `get_state` returns for a corrupt state.json — and modern
 * V8's format ("Unexpected token ... (line 12 column 5)") that JSON.parse
 * produces, which `validateBackupShape` captures into a backup's
 * invalidReason. Returns null when no location can be found.
 */
export function parseJsonErrorLocation(message: string): JsonErrorLocation | null {
  const m = message.match(/line (\d+) column (\d+)/i);
  if (!m) return null;
  const line = Number(m[1]);
  const column = Number(m[2]);
  if (!Number.isFinite(line) || !Number.isFinite(column)) return null;
  return { line, column };
}
