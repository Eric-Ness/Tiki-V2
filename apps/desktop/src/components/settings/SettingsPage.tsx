import {
  useSettingsStore,
  useToastStore,
  DEFAULT_TERMINAL_SETTINGS,
  DEFAULT_APPEARANCE_SETTINGS,
  DEFAULT_WORKFLOW_SETTINGS,
  DEFAULT_GITHUB_SETTINGS,
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationSettings,
} from "../../stores";
import "./SettingsPage.css";

export function SettingsPage() {
  const terminal = useSettingsStore((s) => s.terminal);
  const appearance = useSettingsStore((s) => s.appearance);
  const workflow = useSettingsStore((s) => s.workflow);
  const github = useSettingsStore((s) => s.github);
  const notifications = useSettingsStore((s) => s.notifications);
  const updateTerminal = useSettingsStore((s) => s.updateTerminal);
  const updateAppearance = useSettingsStore((s) => s.updateAppearance);
  const updateWorkflow = useSettingsStore((s) => s.updateWorkflow);
  const updateGitHub = useSettingsStore((s) => s.updateGitHub);
  const updateNotifications = useSettingsStore((s) => s.updateNotifications);
  const resetTerminal = useSettingsStore((s) => s.resetTerminal);
  const resetAppearance = useSettingsStore((s) => s.resetAppearance);
  const resetWorkflow = useSettingsStore((s) => s.resetWorkflow);
  const resetGitHub = useSettingsStore((s) => s.resetGitHub);
  const resetNotifications = useSettingsStore((s) => s.resetNotifications);

  const isTerminalDefault = JSON.stringify(terminal) === JSON.stringify(DEFAULT_TERMINAL_SETTINGS);
  const isAppearanceDefault = JSON.stringify(appearance) === JSON.stringify(DEFAULT_APPEARANCE_SETTINGS);
  const isWorkflowDefault = JSON.stringify(workflow) === JSON.stringify(DEFAULT_WORKFLOW_SETTINGS);
  const isGitHubDefault = JSON.stringify(github) === JSON.stringify(DEFAULT_GITHUB_SETTINGS);
  const isNotificationsDefault = JSON.stringify(notifications) === JSON.stringify(DEFAULT_NOTIFICATION_SETTINGS);

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h2>Settings</h2>
      </div>

      <div className="settings-sections">
        {/* Terminal */}
        <div className="settings-section">
          <div className="settings-section-header">
            <h3>Terminal</h3>
            <button
              className="settings-reset-btn"
              onClick={resetTerminal}
              disabled={isTerminalDefault}
              title="Reset terminal settings to defaults"
            >
              Reset
            </button>
          </div>

          <div className="settings-row">
            <label htmlFor="settings-shell">Default Shell</label>
            <input
              id="settings-shell"
              type="text"
              className="settings-input"
              value={terminal.defaultShell}
              onChange={(e) => updateTerminal({ defaultShell: e.target.value })}
              placeholder="System default"
            />
          </div>

          <div className="settings-row">
            <label htmlFor="settings-font-size">Font Size</label>
            <input
              id="settings-font-size"
              type="number"
              className="settings-input settings-input-narrow"
              value={terminal.fontSize}
              onChange={(e) => updateTerminal({ fontSize: Number(e.target.value) })}
              min={8}
              max={24}
              step={1}
            />
          </div>

          <div className="settings-row">
            <label htmlFor="settings-font-family">Font Family</label>
            <input
              id="settings-font-family"
              type="text"
              className="settings-input"
              value={terminal.fontFamily}
              onChange={(e) => updateTerminal({ fontFamily: e.target.value })}
            />
          </div>

          <div className="settings-row">
            <label htmlFor="settings-scrollback">Scrollback Buffer</label>
            <input
              id="settings-scrollback"
              type="number"
              className="settings-input settings-input-narrow"
              value={terminal.scrollbackBuffer}
              onChange={(e) => updateTerminal({ scrollbackBuffer: Number(e.target.value) })}
              min={100}
              max={50000}
              step={100}
            />
          </div>
          <p className="settings-hint">Terminal settings apply to new terminals only.</p>
        </div>

        {/* Appearance */}
        <div className="settings-section">
          <div className="settings-section-header">
            <h3>Appearance</h3>
            <button
              className="settings-reset-btn"
              onClick={resetAppearance}
              disabled={isAppearanceDefault}
              title="Reset appearance settings to defaults"
            >
              Reset
            </button>
          </div>

          <div className="settings-row">
            <label htmlFor="settings-theme">Theme</label>
            <select
              id="settings-theme"
              className="settings-select"
              value={appearance.theme}
              onChange={(e) => updateAppearance({ theme: e.target.value as 'dark' | 'light' | 'system' })}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">System</option>
            </select>
          </div>

          <div className="settings-row">
            <label htmlFor="settings-sidebar-size">Sidebar Default Size</label>
            <div className="settings-input-group">
              <input
                id="settings-sidebar-size"
                type="number"
                className="settings-input settings-input-narrow"
                value={appearance.sidebarDefaultSize}
                onChange={(e) => updateAppearance({ sidebarDefaultSize: Number(e.target.value) })}
                min={10}
                max={40}
              />
              <span className="settings-input-suffix">%</span>
            </div>
          </div>

          <div className="settings-row">
            <label htmlFor="settings-detail-size">Detail Panel Default Size</label>
            <div className="settings-input-group">
              <input
                id="settings-detail-size"
                type="number"
                className="settings-input settings-input-narrow"
                value={appearance.detailDefaultSize}
                onChange={(e) => updateAppearance({ detailDefaultSize: Number(e.target.value) })}
                min={10}
                max={40}
              />
              <span className="settings-input-suffix">%</span>
            </div>
          </div>
        </div>

        {/* Workflow */}
        <div className="settings-section">
          <div className="settings-section-header">
            <h3>Workflow</h3>
            <button
              className="settings-reset-btn"
              onClick={resetWorkflow}
              disabled={isWorkflowDefault}
              title="Reset workflow settings to defaults"
            >
              Reset
            </button>
          </div>

          <div className="settings-row">
            <label htmlFor="settings-branch">Default Branch Strategy</label>
            <select
              id="settings-branch"
              className="settings-select"
              value={workflow.defaultBranchStrategy}
              onChange={(e) => updateWorkflow({ defaultBranchStrategy: e.target.value as 'current' | 'auto' | 'custom' })}
            >
              <option value="current">Current</option>
              <option value="auto">Auto (create from issue)</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          <div className="settings-row">
            <label htmlFor="settings-model">Default Claude Model</label>
            <select
              id="settings-model"
              className="settings-select"
              value={workflow.defaultModel}
              onChange={(e) => updateWorkflow({ defaultModel: e.target.value as 'sonnet' | 'opus' | 'haiku' })}
            >
              <option value="sonnet">Sonnet</option>
              <option value="opus">Opus</option>
              <option value="haiku">Haiku</option>
            </select>
          </div>

          <div className="settings-row">
            <label htmlFor="settings-planning">Default Planning Type</label>
            <select
              id="settings-planning"
              className="settings-select"
              value={workflow.defaultPlanningType}
              onChange={(e) => updateWorkflow({ defaultPlanningType: e.target.value as 'skip' | 'lite' | 'spec' | 'full' })}
            >
              <option value="full">Full (Recommended)</option>
              <option value="spec">Spec</option>
              <option value="lite">Lite</option>
              <option value="skip">Skip</option>
            </select>
          </div>
        </div>

        {/* GitHub */}
        <div className="settings-section">
          <div className="settings-section-header">
            <h3>GitHub</h3>
            <button
              className="settings-reset-btn"
              onClick={resetGitHub}
              disabled={isGitHubDefault}
              title="Reset GitHub settings to defaults"
            >
              Reset
            </button>
          </div>

          <div className="settings-row">
            <label htmlFor="settings-fetch-limit">Issue Fetch Limit</label>
            <input
              id="settings-fetch-limit"
              type="number"
              className="settings-input settings-input-narrow"
              value={github.issueFetchLimit}
              onChange={(e) => updateGitHub({ issueFetchLimit: Number(e.target.value) })}
              min={10}
              max={100}
              step={10}
            />
          </div>

          <div className="settings-row">
            <label htmlFor="settings-labels">Default Labels</label>
            <input
              id="settings-labels"
              type="text"
              className="settings-input"
              value={github.defaultLabels.join(", ")}
              onChange={(e) =>
                updateGitHub({
                  defaultLabels: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              placeholder="bug, enhancement, ..."
            />
          </div>
          <p className="settings-hint">Comma-separated list of labels to apply by default.</p>
        </div>

        {/* Notifications */}
        <div className="settings-section">
          <div className="settings-section-header">
            <h3>Notifications</h3>
            <button
              className="settings-reset-btn"
              onClick={resetNotifications}
              disabled={isNotificationsDefault}
              title="Reset notification settings to defaults"
            >
              Reset
            </button>
          </div>

          <div className="settings-row">
            <label className="settings-checkbox-label">
              <input
                type="checkbox"
                checked={notifications.enabled}
                onChange={(e) => updateNotifications({ enabled: e.target.checked })}
              />
              <span>Enable toast notifications</span>
            </label>
          </div>

          <div className="settings-row">
            <label htmlFor="settings-toast-position">Position</label>
            <select
              id="settings-toast-position"
              className="settings-select"
              value={notifications.position}
              onChange={(e) => updateNotifications({ position: e.target.value as NotificationSettings['position'] })}
              disabled={!notifications.enabled}
            >
              <option value="bottom-right">Bottom Right</option>
              <option value="bottom-left">Bottom Left</option>
              <option value="top-right">Top Right</option>
              <option value="top-left">Top Left</option>
            </select>
          </div>

          <div className="settings-row">
            <label htmlFor="settings-toast-duration">Auto-dismiss Duration</label>
            <div className="settings-input-group">
              <input
                id="settings-toast-duration"
                type="number"
                className="settings-input settings-input-narrow"
                value={notifications.duration / 1000}
                onChange={(e) => updateNotifications({ duration: Number(e.target.value) * 1000 })}
                min={1}
                max={15}
                step={1}
                disabled={!notifications.enabled}
              />
              <span className="settings-input-suffix">seconds</span>
            </div>
          </div>

          <div className="settings-row">
            <label htmlFor="settings-toast-max">Max Visible</label>
            <input
              id="settings-toast-max"
              type="number"
              className="settings-input settings-input-narrow"
              value={notifications.maxVisible}
              onChange={(e) => updateNotifications({ maxVisible: Number(e.target.value) })}
              min={1}
              max={10}
              disabled={!notifications.enabled}
            />
          </div>

          <div className="settings-row">
            <button
              className="settings-test-btn"
              onClick={() => useToastStore.getState().addToast('This is a test notification', 'info')}
              disabled={!notifications.enabled}
            >
              Test Notification
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
