# Tiki v2

A GitHub-issue-centric workflow framework for [Claude Code](https://claude.ai/code). Tiki orchestrates software development against GitHub issues with a structured pipeline: **GET > REVIEW > PLAN > AUDIT > EXECUTE > SHIP**.

## Products

Tiki ships as two separate products that share a version number:

| Product | Description | Location |
|---------|-------------|----------|
| **Tiki Framework** | Claude Code plugin providing workflow commands | `packages/framework/` |
| **Tiki Desktop** | Tauri desktop app for project visualization | `apps/desktop/` |

## Repository Structure

```
tiki-v2/
  packages/
    shared/          # @tiki/shared - TypeScript types and JSON schemas
    framework/       # Claude Code plugin (workflow commands)
  apps/
    desktop/         # Tauri desktop app (React + Rust)
  scripts/
    version-bump.mjs # Cross-package version sync utility
  .tiki/             # Local workflow state (gitignored)
  .github/
    workflows/
      release.yml    # CI/CD for building and publishing releases
  docs/
    DESIGN.md        # Full architecture document
    PLANNING-NOTES.md
```

## Workflow Commands

The Tiki Framework provides core commands as a Claude Code plugin:

| Command | Description |
|---------|-------------|
| `/tiki:get <N>` | Fetch a GitHub issue and initialize state |
| `/tiki:review <N>` | Analyze issue requirements and derive success criteria |
| `/tiki:plan <N>` | Break issue into executable phases |
| `/tiki:audit <N>` | Validate plan before execution |
| `/tiki:execute <N>` | Run phases with sub-agents for fresh context |
| `/tiki:ship <N>` | Commit, push, and close the GitHub issue |
| `/tiki:yolo <N>` | Full automated pipeline (all of the above) |
| `/tiki:version` | Display installed versions and check for updates |
| `/tiki:release <ver>` | Execute a release grouping multiple issues |

```
GET -> REVIEW -> PLAN -> AUDIT -> EXECUTE -> SHIP
                  ^                          |
                  +-------- (or YOLO) -------+
```

## Version System

Tiki uses a unified version number across both products. The version is maintained in three files:

| File | Field | Product |
|------|-------|---------|
| `apps/desktop/src-tauri/tauri.conf.json` | `version` | Desktop (binary version) |
| `apps/desktop/src-tauri/Cargo.toml` | `version` | Desktop (Rust crate) |
| `packages/framework/.claude-plugin/plugin.json` | `version` | Framework (plugin manifest) |

### Bumping the Version

A script keeps all three files in sync:

```bash
pnpm version-bump 0.3.0
```

This strips any leading `v` prefix and writes the clean version to all locations.

### Version Display

- **Desktop**: The app footer shows the current version (read at runtime via `getVersion()` from `@tauri-apps/api/app`)
- **Framework**: Run `/tiki:version` to see the installed framework version, desktop version, and latest GitHub release

### Auto-Update (Desktop)

The desktop app includes automatic update checking via the [Tauri Updater Plugin](https://v2.tauri.app/plugin/updater/):

- **On startup**: A silent background check runs. If an update is available, a dialog prompts the user to install it.
- **Manual check**: Click "Check for Updates" in the app footer.
- **Update flow**: When the user accepts, the update downloads, installs (passive mode on Windows), and relaunches the app.

**How it works:**

1. The CI/CD workflow builds signed installers and generates a `latest.json` manifest for each tagged release
2. The desktop app checks the endpoint: `https://github.com/Eric-Ness/Tiki-V2/releases/latest/download/latest.json`
3. If a newer version exists, the updater downloads the signed artifact, verifies the signature against the embedded public key, and installs it

### Signing

All release artifacts are signed with a minisign keypair:

- **Public key**: Embedded in `tauri.conf.json` under `plugins.updater.pubkey`
- **Private key + password**: Stored as GitHub repository secrets (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`)

To generate a new keypair:

```bash
pnpm tauri signer generate -w ~/.tauri/tiki.key
```

Then update the pubkey in `tauri.conf.json` and add both secrets to the GitHub repository settings.

## Development

### Prerequisites

- Node.js >= 20
- pnpm >= 9
- Rust (stable)
- **Windows**: Use "x64 Native Tools Command Prompt for VS 2022" for Tauri builds

### Setup

```bash
pnpm install
```

### Common Commands

```bash
# Build all packages
pnpm build

# Type-check all packages
pnpm typecheck

# Run desktop in dev mode (from apps/desktop)
pnpm tauri:dev

# Build desktop binary (from apps/desktop)
pnpm tauri:build

# Lint desktop frontend (from apps/desktop)
pnpm lint

# Bump version across all packages
pnpm version-bump 0.3.0
```

## CI/CD and Releases

Releases are triggered by pushing a tag matching `v*` or manually via GitHub Actions workflow dispatch:

```bash
git tag v0.3.0
git push origin v0.3.0
```

The release workflow:
1. Builds desktop binaries for **macOS** (ARM + Intel), **Linux**, and **Windows**
2. Signs all artifacts with the Tauri signing key
3. Generates `latest.json` for the auto-updater
4. Creates a GitHub Release with all assets attached

## Architecture

- **GitHub as Source of Truth** - Issues and milestones live in GitHub; Tiki orchestrates work against them
- **Fresh Context Execution** - Large work is broken into phases, each executed by sub-agents to manage context limits
- **Single State File** - One `state.json` tracks all execution contexts
- **Multi-Context Support** - Multiple terminals can work on different issues simultaneously

For the full architecture document, see [docs/DESIGN.md](docs/DESIGN.md).

## State System

All Tiki workflow state lives in the `.tiki/` directory:

```
.tiki/
  state.json              # Central state (active work, history)
  plans/
    issue-N.json          # Phase definitions per issue
    archive/              # Completed issue plans
  releases/
    vX.Y.Z.json           # Active release groupings
    archive/              # Completed releases
  research/
    *.md                  # Domain knowledge documents
```

## Documentation

- [DESIGN.md](docs/DESIGN.md) - Full architecture and design
- [PLANNING-NOTES.md](docs/PLANNING-NOTES.md) - Planning context and handoff notes
