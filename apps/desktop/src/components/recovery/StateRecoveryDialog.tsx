/**
 * State Recovery Dialog
 *
 * Renders when `get_state` returns Err — i.e. .tiki/state.json is corrupt or
 * unparseable after `read_json_resilient`'s 3 retries. Offers backup listing
 * (sorted newest-first), per-backup Preview + Restore actions, plus
 * Edit Manually and Start Fresh fallbacks.
 *
 * Wired in by `App.tsx` via the `recoveryError` state. The pure logic
 * (timestamp parsing, byte formatting, JSON shape validation) lives in
 * `./recoveryFlow` and is unit-tested separately.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openInShell } from "@tauri-apps/plugin-shell";
import {
  formatBytes,
  formatRelativeAge,
  parseBackupTimestamp,
  parseJsonErrorLocation,
  RESET_CONFIRMATION_PHRASE,
  validateBackupShape,
  type JsonErrorLocation,
} from "./recoveryFlow";
import "./StateRecoveryDialog.css";

interface BackupInfo {
  filename: string;
  timestamp: string;
  sizeBytes: number;
}

interface BackupRow {
  info: BackupInfo;
  /** Parsed date, or null if the timestamp segment was malformed. */
  date: Date | null;
  /** Whether the file content parses + has canonical shape. */
  valid: boolean;
  /** Cached content for preview. Loaded lazily on the first preview click. */
  content?: string;
  /** Error reason if `valid` is false. */
  invalidReason?: string;
}

interface StateRecoveryDialogProps {
  /** The raw error string from `get_state`. */
  error: string;
  /** Path to the `.tiki/` directory. Used to derive the state.json path
   * for Edit Manually and to scope IPC calls. */
  tikiPath?: string;
  /** Called when the state has been successfully recovered (Restore or
   * Start Fresh succeeded). The App should reload state and dismiss. */
  onRecovered: () => void;
  /** Called when the user explicitly closes the dialog without recovering. */
  onDismiss: () => void;
}

export function StateRecoveryDialog({
  error,
  tikiPath,
  onRecovered,
  onDismiss,
}: StateRecoveryDialogProps) {
  const [rows, setRows] = useState<BackupRow[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewFilename, setPreviewFilename] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string>("");
  const [previewErrorLocation, setPreviewErrorLocation] =
    useState<JsonErrorLocation | null>(null);
  const [resetExpanded, setResetExpanded] = useState(false);
  const [resetInput, setResetInput] = useState("");

  const now = useMemo(() => new Date(), []);

  // Line/column of the state.json parse failure, surfaced as a callout in the
  // error summary so the user knows where to look before Edit Manually (#177).
  const errorLocation = useMemo(() => parseJsonErrorLocation(error), [error]);

  const stateJsonPath = useMemo(() => {
    if (!tikiPath) return null;
    // Normalize trailing separator regardless of OS
    const trimmed = tikiPath.replace(/[\\/]+$/, "");
    return `${trimmed}/state.json`;
  }, [tikiPath]);

  // Load + validate backups
  const loadBackups = useCallback(async () => {
    setLoadingBackups(true);
    setActionError(null);
    try {
      const backups = await invoke<BackupInfo[]>("list_backups", {
        tikiPath: tikiPath,
      });
      const validated: BackupRow[] = await Promise.all(
        backups.map(async (info) => {
          let content: string | undefined;
          let valid = false;
          let invalidReason: string | undefined;
          try {
            content = await invoke<string>("read_backup_content", {
              backupFilename: info.filename,
              tikiPath: tikiPath,
            });
            const shape = validateBackupShape(content);
            valid = shape.ok;
            if (!shape.ok) invalidReason = shape.error;
          } catch (e) {
            invalidReason = String(e);
          }
          return {
            info,
            date: parseBackupTimestamp(info.timestamp),
            valid,
            content,
            invalidReason,
          };
        })
      );
      // Newest first by timestamp string (lex sort works for our zero-padded format)
      validated.sort((a, b) => b.info.timestamp.localeCompare(a.info.timestamp));
      setRows(validated);
    } catch (e) {
      setActionError(`Failed to list backups: ${String(e)}`);
    } finally {
      setLoadingBackups(false);
    }
  }, [tikiPath]);

  useEffect(() => {
    void loadBackups();
  }, [loadBackups]);

  const handleRestore = useCallback(
    async (filename: string) => {
      setBusy(true);
      setActionError(null);
      try {
        await invoke("restore_backup_safe", {
          backupFilename: filename,
          tikiPath: tikiPath,
        });
        // Verify the restore by re-reading state. If get_state still errors,
        // the dialog stays open with the new error.
        await invoke("get_state", { tikiPath: tikiPath });
        onRecovered();
      } catch (e) {
        setActionError(`Restore failed: ${String(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [tikiPath, onRecovered]
  );

  const handlePreview = useCallback((row: BackupRow) => {
    setPreviewFilename(row.info.filename);
    setPreviewContent(row.content ?? "(content not yet loaded)");
    // An invalid backup's invalidReason carries the JSON.parse location;
    // valid backups have no failing line to highlight.
    setPreviewErrorLocation(
      row.valid ? null : parseJsonErrorLocation(row.invalidReason ?? "")
    );
  }, []);

  const handleClosePreview = useCallback(() => {
    setPreviewFilename(null);
    setPreviewContent("");
    setPreviewErrorLocation(null);
  }, []);

  const handleEditManually = useCallback(async () => {
    if (!stateJsonPath) {
      setActionError("No state.json path available to open.");
      return;
    }
    setActionError(null);
    try {
      await openInShell(stateJsonPath);
    } catch (e) {
      setActionError(`Failed to open editor: ${String(e)}`);
    }
  }, [stateJsonPath]);

  const handleStartFresh = useCallback(async () => {
    if (resetInput !== RESET_CONFIRMATION_PHRASE) {
      setActionError(`You must type "${RESET_CONFIRMATION_PHRASE}" exactly.`);
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await invoke("write_fresh_state", { tikiPath: tikiPath });
      await invoke("get_state", { tikiPath: tikiPath });
      onRecovered();
    } catch (e) {
      setActionError(`Start Fresh failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [resetInput, tikiPath, onRecovered]);

  return (
    <div className="recovery-dialog-overlay" role="dialog" aria-modal="true">
      <div className="recovery-dialog">
        <header className="recovery-dialog-header">
          <h2>State Recovery</h2>
          <button
            className="recovery-dialog-close"
            type="button"
            onClick={onDismiss}
            disabled={busy}
            aria-label="Dismiss recovery dialog"
            title="Dismiss (state will remain in error mode)"
          >
            X
          </button>
        </header>

        <section className="recovery-error-summary">
          <p className="recovery-error-label">
            Tiki could not parse your state file.
          </p>
          {errorLocation && (
            <p className="recovery-error-location">
              Parse error at <strong>line {errorLocation.line}</strong>, column{" "}
              {errorLocation.column}
            </p>
          )}
          <pre className="recovery-error-message">{error}</pre>
          {stateJsonPath && (
            <p className="recovery-file-path">
              <span className="recovery-file-path-label">File:</span>{" "}
              <code>{stateJsonPath}</code>
            </p>
          )}
        </section>

        <section className="recovery-backups">
          <h3>Available backups</h3>
          {loadingBackups && (
            <p className="recovery-hint">Loading backups...</p>
          )}
          {!loadingBackups && rows.length === 0 && (
            <p className="recovery-hint">
              No backups found in <code>.tiki/backups/</code>. Use Edit
              Manually or Start Fresh below.
            </p>
          )}
          {!loadingBackups && rows.length > 0 && (
            <ul className="recovery-backup-list">
              {rows.map((row) => (
                <li
                  key={row.info.filename}
                  className={`recovery-backup-row ${row.valid ? "" : "is-invalid"}`}
                >
                  <div className="recovery-backup-meta">
                    <span className="recovery-backup-filename">
                      {row.info.filename}
                    </span>
                    <span className="recovery-backup-details">
                      {row.date
                        ? formatRelativeAge(row.date, now)
                        : "unknown age"}{" "}
                      &middot; {formatBytes(row.info.sizeBytes)}
                      {!row.valid && (
                        <span className="recovery-backup-invalid-tag">
                          {" "}
                          &middot; invalid: {row.invalidReason ?? "unknown error"}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="recovery-backup-actions">
                    <button
                      type="button"
                      className="recovery-btn"
                      onClick={() => handlePreview(row)}
                      disabled={busy || row.content === undefined}
                    >
                      Preview
                    </button>
                    <button
                      type="button"
                      className="recovery-btn recovery-btn-primary"
                      onClick={() => handleRestore(row.info.filename)}
                      disabled={busy || !row.valid}
                      title={
                        row.valid
                          ? "Restore this backup"
                          : "Backup is unparseable — cannot restore"
                      }
                    >
                      Restore
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="recovery-other-actions">
          <h3>Other actions</h3>
          <div className="recovery-other-row">
            <button
              type="button"
              className="recovery-btn"
              onClick={handleEditManually}
              disabled={busy || !stateJsonPath}
              title="Open the broken state.json in your system editor"
            >
              Edit Manually
            </button>
            <span className="recovery-hint-inline">
              Open the broken file in your OS default editor.
            </span>
          </div>
          <div className="recovery-other-row">
            <button
              type="button"
              className="recovery-btn recovery-btn-danger"
              onClick={() => setResetExpanded((v) => !v)}
              disabled={busy}
            >
              Start Fresh
            </button>
            <span className="recovery-hint-inline">
              Overwrite with an empty state. Current file is preserved as
              <code>.broken.json</code>.
            </span>
          </div>
          {resetExpanded && (
            <div className="recovery-reset-confirm">
              <label htmlFor="recovery-reset-input">
                Type <strong>{RESET_CONFIRMATION_PHRASE}</strong> to confirm:
              </label>
              <input
                id="recovery-reset-input"
                type="text"
                className="recovery-reset-input"
                value={resetInput}
                onChange={(e) => setResetInput(e.target.value)}
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="recovery-btn recovery-btn-danger"
                onClick={handleStartFresh}
                disabled={busy || resetInput !== RESET_CONFIRMATION_PHRASE}
              >
                Confirm Start Fresh
              </button>
            </div>
          )}
        </section>

        {actionError && (
          <div className="recovery-action-error" role="alert">
            {actionError}
          </div>
        )}

        {previewFilename && (
          <div
            className="recovery-preview-overlay"
            onClick={handleClosePreview}
          >
            <div
              className="recovery-preview"
              onClick={(e) => e.stopPropagation()}
            >
              <header className="recovery-preview-header">
                <h3>{previewFilename}</h3>
                <button
                  type="button"
                  className="recovery-dialog-close"
                  onClick={handleClosePreview}
                  aria-label="Close preview"
                >
                  X
                </button>
              </header>
              <div className="recovery-preview-content">
                {previewContent.split("\n").map((lineText, i) => {
                  const lineNo = i + 1;
                  const isErrorLine = previewErrorLocation?.line === lineNo;
                  return (
                    <div
                      key={lineNo}
                      className={`recovery-preview-line${isErrorLine ? " is-error-line" : ""}`}
                      ref={
                        isErrorLine
                          ? (el) => el?.scrollIntoView({ block: "center" })
                          : undefined
                      }
                    >
                      <span className="recovery-preview-gutter">{lineNo}</span>
                      <span className="recovery-preview-text">{lineText || " "}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
