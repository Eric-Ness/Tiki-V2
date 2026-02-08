# Version Check

Display the current Tiki framework and desktop version, and check if updates are available.

<instructions>
  <step>Read the installed framework version:
    - Check `packages/framework/.claude-plugin/plugin.json` for the `version` field
    - If not found, check `packages/framework/package.json`
  </step>
  <step>Read the installed desktop version:
    - Check `apps/desktop/src-tauri/tauri.conf.json` for the `version` field
  </step>
  <step>Fetch the latest release version from GitHub:
    - Run: `gh api repos/ericnichols/Tiki-V2/releases/latest --jq .tag_name`
    - If this fails (no releases), note that no releases are published yet
  </step>
  <step>Compare and display results</step>
</instructions>

<output>
## Tiki Version Info

| Component | Installed | Latest |
|-----------|-----------|--------|
| Framework | {framework_version} | {latest_version} |
| Desktop   | {desktop_version}   | {latest_version} |

{If outdated: "Update available! Run `git pull` and rebuild to get the latest version."}
{If current: "You are on the latest version."}
</output>
