import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useProjectsStore, useToastStore } from "../../stores";
import {
  AUTO_HEAL_CATEGORIES,
  configToForm,
  formToConfig,
  validateWorkflowForm,
  type AutoHealCategory,
  type ConfigReadResult,
  type RawTikiConfig,
  type WorkflowFormState,
} from "./workflowConfig";

/**
 * Project-level workflow config editor backed by `.tiki/config.json`.
 *
 * Loads via the Rust `read_tiki_config` command on mount / project change and
 * persists via `save_tiki_config` (which validates + atomically writes). Unknown
 * keys come back as warnings and are surfaced inline; the Rust command preserves
 * them so a forward-compat config is never clobbered.
 */
export function WorkflowConfigSection() {
  const activeProject = useProjectsStore((s) => s.getActiveProject());
  const addToast = useToastStore((s) => s.addToast);

  const tikiPath = activeProject ? `${activeProject.path}/.tiki` : undefined;

  const [form, setForm] = useState<WorkflowFormState | null>(null);
  const [rawConfig, setRawConfig] = useState<RawTikiConfig | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await invoke<ConfigReadResult>("read_tiki_config", {
        tikiPath,
      });
      setRawConfig(result.config);
      setForm(configToForm(result.config));
      setWarnings(result.warnings ?? []);
      setDirty(false);
    } catch (e) {
      setLoadError(String(e));
    } finally {
      setLoading(false);
    }
  }, [tikiPath]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = useCallback((patch: Partial<WorkflowFormState>) => {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
  }, []);

  const toggleCategory = useCallback(
    (cat: AutoHealCategory, checked: boolean) => {
      setForm((prev) => {
        if (!prev) return prev;
        const set = new Set(prev.autoHealCategories);
        if (checked) set.add(cat);
        else set.delete(cat);
        // Preserve canonical ordering.
        const next = AUTO_HEAL_CATEGORIES.filter((c) => set.has(c));
        return { ...prev, autoHealCategories: next };
      });
      setDirty(true);
    },
    []
  );

  const handleSave = useCallback(async () => {
    if (!form) return;
    setSaving(true);
    try {
      const payload = formToConfig(form, rawConfig);
      const result = await invoke<ConfigReadResult>("save_tiki_config", {
        config: payload,
        tikiPath,
      });
      setRawConfig(result.config);
      setForm(configToForm(result.config));
      setWarnings(result.warnings ?? []);
      setDirty(false);
      addToast("Workflow config saved", "success");
    } catch (e) {
      addToast(`Failed to save config: ${e}`, "error");
    } finally {
      setSaving(false);
    }
  }, [form, rawConfig, tikiPath, addToast]);

  if (loading || !form) {
    return (
      <div className="settings-section">
        <div className="settings-section-header">
          <h3>Workflow Config</h3>
        </div>
        <p className="settings-hint">
          {loadError ? `Failed to load config: ${loadError}` : "Loading…"}
        </p>
      </div>
    );
  }

  const errors = validateWorkflowForm(form);
  const valid = Object.keys(errors).length === 0;

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h3>Workflow Config</h3>
        <button
          className="settings-reset-btn"
          onClick={handleSave}
          disabled={!valid || saving || !dirty}
          title="Save .tiki/config.json"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      <p className="settings-hint">
        Edits <code>.tiki/config.json</code> for the active project. Used by
        EXECUTE, SHIP, and RELEASE commands.
      </p>

      {warnings.length > 0 && (
        <div className="settings-config-warnings" role="status">
          <strong>Unknown config keys (ignored):</strong>
          <ul>
            {warnings.map((w) => (
              <li key={w}>
                <code>{w}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Tests */}
      <div className="settings-row">
        <label className="settings-checkbox-label">
          <input
            type="checkbox"
            checked={form.testsEnabled}
            onChange={(e) => update({ testsEnabled: e.target.checked })}
          />
          <span>Run tests</span>
        </label>
      </div>

      <div className="settings-row">
        <label htmlFor="cfg-tests-command">Test Command Override</label>
        <input
          id="cfg-tests-command"
          type="text"
          className="settings-input"
          value={form.testsCommand}
          onChange={(e) => update({ testsCommand: e.target.value })}
          placeholder="Auto-detect (vitest, jest, pytest, cargo test…)"
          disabled={!form.testsEnabled}
        />
      </div>

      <div className="settings-row">
        <label className="settings-checkbox-label">
          <input
            type="checkbox"
            checked={form.testsRunOnEachPhase}
            onChange={(e) => update({ testsRunOnEachPhase: e.target.checked })}
            disabled={!form.testsEnabled}
          />
          <span>Run tests after each phase</span>
        </label>
      </div>

      <div className="settings-row">
        <label className="settings-checkbox-label">
          <input
            type="checkbox"
            checked={form.testsRunBeforeShip}
            onChange={(e) => update({ testsRunBeforeShip: e.target.checked })}
            disabled={!form.testsEnabled}
          />
          <span>Run full suite before ship</span>
        </label>
      </div>

      <div className="settings-row">
        <label htmlFor="cfg-tests-timeout">Test Timeout</label>
        <div className="settings-input-group">
          <input
            id="cfg-tests-timeout"
            type="number"
            className="settings-input settings-input-narrow"
            value={form.testsTimeoutSeconds}
            onChange={(e) =>
              update({ testsTimeoutSeconds: Number(e.target.value) })
            }
            min={1}
            step={1}
            disabled={!form.testsEnabled}
            aria-invalid={!!errors.testsTimeoutSeconds}
          />
          <span className="settings-input-suffix">seconds</span>
        </div>
      </div>
      {errors.testsTimeoutSeconds && (
        <span className="settings-config-field-error">
          {errors.testsTimeoutSeconds}
        </span>
      )}

      {/* Auto-heal */}
      <div className="settings-row">
        <label className="settings-checkbox-label">
          <input
            type="checkbox"
            checked={form.autoHealEnabled}
            onChange={(e) => update({ autoHealEnabled: e.target.checked })}
          />
          <span>Enable auto-heal</span>
        </label>
      </div>

      <div className="settings-row">
        <label htmlFor="cfg-autoheal-attempts">Max Heal Attempts</label>
        <input
          id="cfg-autoheal-attempts"
          type="number"
          className="settings-input settings-input-narrow"
          value={form.autoHealMaxAttempts}
          onChange={(e) =>
            update({ autoHealMaxAttempts: Number(e.target.value) })
          }
          min={1}
          step={1}
          disabled={!form.autoHealEnabled}
          aria-invalid={!!errors.autoHealMaxAttempts}
        />
      </div>
      {errors.autoHealMaxAttempts && (
        <span className="settings-config-field-error">
          {errors.autoHealMaxAttempts}
        </span>
      )}

      <div className="settings-row settings-row-stack">
        <label>Heal Categories</label>
        <div className="settings-checkbox-grid">
          {AUTO_HEAL_CATEGORIES.map((cat) => (
            <label className="settings-checkbox-label" key={cat}>
              <input
                type="checkbox"
                checked={form.autoHealCategories.includes(cat)}
                onChange={(e) => toggleCategory(cat, e.target.checked)}
                disabled={!form.autoHealEnabled}
              />
              <span>{cat}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Parallel */}
      <div className="settings-row">
        <label className="settings-checkbox-label">
          <input
            type="checkbox"
            checked={form.parallelEnabled}
            onChange={(e) => update({ parallelEnabled: e.target.checked })}
          />
          <span>Allow parallel phase execution</span>
        </label>
      </div>

      {/* Backup retention */}
      <div className="settings-row">
        <label htmlFor="cfg-backup-retention">Backup Retention</label>
        <input
          id="cfg-backup-retention"
          type="number"
          className="settings-input settings-input-narrow"
          value={form.backupRetention}
          onChange={(e) => update({ backupRetention: Number(e.target.value) })}
          min={0}
          step={1}
          aria-invalid={!!errors.backupRetention}
        />
      </div>
      {errors.backupRetention && (
        <span className="settings-config-field-error">
          {errors.backupRetention}
        </span>
      )}
      <p className="settings-hint">
        Number of timestamped <code>state.json</code> backups to keep.
      </p>
    </div>
  );
}
