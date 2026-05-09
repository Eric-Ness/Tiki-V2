# Version Check

Display the current Tiki framework and desktop version, and check if updates are available.

<instructions>
  <step>Read the installed framework version:
    - Prefer `<project>/.tiki/.framework-version` (written by `install.js` and the
      desktop app's `install_framework` IPC). This is the authoritative
      "what's actually installed in this project right now" answer.
    - Fall back to `packages/framework/.claude-plugin/plugin.json`'s `version`
      field for monorepo work (where `.tiki/.framework-version` may not exist
      because the user runs against the source tree).
    - As a last fallback, check `packages/framework/package.json`.
  </step>
  <step>Read the installed desktop version:
    - Check `apps/desktop/src-tauri/tauri.conf.json` for the `version` field
  </step>
  <step>Fetch the latest release version from GitHub:
    - Run: `gh api repos/Eric-Ness/Tiki-V2/releases/latest --jq .tag_name`
    - If this fails (no releases), note that no releases are published yet
  </step>
  <step>Compare and display results. If the framework version came from
    `.tiki/.framework-version` and is older than the desktop binary version,
    note that the project's commands can be refreshed via the desktop app's
    "Update" badge on the project card (or by re-running `node packages/framework/install.js`).
  </step>
</instructions>

<output>
## Tiki Version Info

| Component | Installed | Latest |
|-----------|-----------|--------|
| Framework | {framework_version} | {latest_version} |
| Desktop   | {desktop_version}   | {latest_version} |

{If framework version came from .tiki/.framework-version and < desktop: "Framework outdated for this project — open the desktop app and click the Update badge, or run `node packages/framework/install.js`."}
{If outdated: "Update available! Run `git pull` and rebuild to get the latest version."}
{If current: "You are on the latest version."}
</output>
