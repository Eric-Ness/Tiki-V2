# Tiki Desktop

Tauri v2 desktop application for visualizing and managing Tiki workflow state. Built with React + TypeScript (frontend) and Rust (backend).

## Features

- Kanban board showing issue progress across workflow stages
- Side panel with active work, release tracking, and project details
- Integrated terminal with xterm.js
- Real-time file watching of `.tiki/` state changes
- Version display in footer with automatic update checking

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Zustand (state management), xterm.js (terminal)
- **Backend**: Rust, Tauri v2
- **Plugins**: `tauri-plugin-updater`, `tauri-plugin-process`, `tauri-plugin-dialog`, `tauri-plugin-shell`

## Development

```bash
# Install dependencies (from repo root)
pnpm install

# Run in dev mode
pnpm tauri:dev

# Build binary
pnpm tauri:build

# Lint
pnpm lint
```

**Windows**: Use "x64 Native Tools Command Prompt for VS 2022" for Tauri dev/build commands.

## Project Structure

```
src/
  components/
    layout/      # Main layout, panels, splitters
    sidebar/     # Side panel components (work cards, releases)
    terminal/    # xterm.js terminal integration
    detail/      # Issue detail views
  stores/        # Zustand state stores
  utils/         # Utilities (updater, helpers)
src-tauri/
  src/
    lib.rs       # Tauri app setup and plugin registration
    commands.rs  # IPC commands (load state, read plans, etc.)
    watcher.rs   # File system watcher for .tiki/ changes
    state.rs     # Rust state types (serde deserialization)
```
