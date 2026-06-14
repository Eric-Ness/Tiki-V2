---
name: claudemd
description: Generate a project CLAUDE.md from a greenfield project brief
argument: [slug]
tools: Bash, Read, Write, Glob, AskUserQuestion
---

# Generate CLAUDE.md from a Project Brief

Turn a greenfield **project brief** (the `.tiki/research/<slug>-brief.md` that `/tiki:scaffold`
emits) into a project-root `CLAUDE.md` — the guidance file Claude Code reads on every session in
that project. This command **reads the brief and synthesizes**; it does NOT re-interview the user.
Every fact already captured in the brief flows straight into the CLAUDE.md; anything the brief does
not pin down becomes a `TODO:` placeholder, never a question.

This command does not drive the Tiki pipeline — no issue numbers, no transitions, no journal. It
reads one brief and writes one file behind a single review gate.

<instructions>
  ## The single most important rule: NO RE-INTERVIEW

  The brief is the source of truth. The synthesis path contains **NO AskUserQuestion** except for
  exactly two legitimate gates:
  1. **Multi-brief disambiguation** (STEP 1) — when several briefs exist and you must learn WHICH one
     to use. This is selection, not interrogation.
  2. **The final review gate** (STEP 4) — approve / edit / regenerate / cancel the rendered output,
     plus the Merge/Overwrite/Cancel sub-gate when a `CLAUDE.md` already exists.

  **NEVER ask the user a question whose answer is already in the brief** (or could be reasonably
  inferred from `type` + `stack`). If a fact is genuinely missing — an unknown directory layout, an
  un-chosen test runner, an undecided deploy target — **encode it as a `TODO:` placeholder in the
  generated CLAUDE.md** so a human can fill it later. Do not stop to ask. A CLAUDE.md full of honest
  `TODO:`s is correct; one that re-interviews the user is a bug.

  ## STEP 1 — Locate the brief

  <step>**Resolve which brief to read.**
    - If a `<slug>` argument was given, target `.tiki/research/<slug>-brief.md`. (Accept either the bare
      slug, e.g. `task-tracker`, or the full `task-tracker-brief` — normalize by stripping a trailing
      `-brief` before appending `-brief.md`.) If that file does not exist, surface the `no-brief` error.
    - If NO argument was given, `Glob` for `.tiki/research/*-brief.md`:
      - **Exactly one match** → use it (no question — there is nothing to disambiguate).
      - **Several matches** → present ONE AskUserQuestion listing each brief by slug so the user picks
        WHICH one. This is the multi-brief disambiguation gate — a legitimate selection, NOT a
        re-interview. Use the matched filenames as the options; do not ask anything about project
        content.
      - **No matches** → surface the `no-brief` error (hint: run `/tiki:scaffold` first to create one).
  </step>

  ## STEP 2 — Parse the brief

  <step>**Read and parse the brief** with the Read tool.
    - **Front-matter** (between the leading `---` fences): extract `topic`, `tags`, `type` (one of
      `web|api|cli|library|desktop|other`), and `stack` (a JSON-style array of language/framework/tech
      tokens). The `type` and `stack` keys are the machine-readable drivers for the Repository Structure
      and Development Commands sections. If `type` or `stack` is absent or empty, treat it as unknown and
      lean on `TODO:` placeholders downstream — do NOT ask.
    - **Section headings** (the brief skeleton from `/tiki:scaffold`): capture the body under each of
      `## Overview`, `## Users & problem`, `## Type & stack`, `## Scope: in / out`, `## Constraints`,
      `## What needs to be true`, and `## Proposed epics & first wave`. A brief may omit some sections;
      a missing section just means that part of the CLAUDE.md leans on a `TODO:`.
  </step>

  ## STEP 3 — Synthesize the CLAUDE.md

  <step>**Map the brief into the CLAUDE.md sections** per the `<claudemd-skeleton>` below. This is the
    heart of the command. Mapping rules (apply WITHOUT asking the user anything):

    - **Project Overview** ← `## Overview` + `## Users & problem`. State what the project is and who it
      is for, in a couple of tight paragraphs. The project name comes from the brief's `# <Project>` H1.
    - **Repository Structure** ← inferred from `type` + `stack`. **This is greenfield: no real file tree
      exists yet.** Propose a conventional layout for the type/stack and **MARK every aspirational or
      unknown path with `TODO:`** rather than inventing concrete file paths as if they already exist.
      For example, a `web` + `react/vite` project might note `src/ — app source (TODO: confirm once
      scaffolded)`. Never assert a directory exists; frame the structure as the intended layout.
    - **Development Commands** ← inferred from `type` + `stack`. Map the stack to its conventional
      toolchain and list the everyday commands. Heuristics (use the closest fit; mark anything uncertain
      `TODO:`):
      - Node / TypeScript / React / Vite / pnpm-or-npm → `pnpm install`, `pnpm dev`, `pnpm build`,
        `pnpm test`, `pnpm lint` (use `npm`/`yarn` if the stack names them instead).
      - Rust / Cargo / Tauri → `cargo build`, `cargo test`, `cargo clippy`, `cargo run`.
      - Python / uv / poetry / pip → `uv sync` / `uv run …` (or `poetry install` / `pip install -r
        requirements.txt`), `pytest`, `ruff check`.
      - Go → `go build ./...`, `go test ./...`, `go vet ./...`.
      - If the stack is unknown or names no toolchain, list the section with a single
        `TODO: choose and document the build / test / run commands once the stack is fixed`.
    - **Conventions** ← `## Constraints` + the non-functional priorities implied by the brief (testing /
      security / performance / documentation, if the brief or `tags` mention them). Capture hard
      requirements (compliance, deadlines, must-use tech) and coding/quality expectations. Where the
      brief is silent, add a `TODO:` (e.g. `TODO: decide on a formatter / lint baseline`) rather than
      inventing a convention.
    - **What needs to be true** ← the brief's `## What needs to be true` section verbatim-in-spirit:
      the project-wide truths that must hold. Keep them as a list. This is the closest thing to
      acceptance criteria for the whole project and belongs in CLAUDE.md so every session sees it.

    Keep the output tight and skimmable — match the quality bar of a hand-written CLAUDE.md (clear
    Project Overview, an honest Repository Structure, real Development Commands, explicit conventions).
    Do not pad. Prefer an honest `TODO:` over a confident guess.
  </step>

  ## STEP 4 — Review gate, then write

  <step>**Render the full synthesized CLAUDE.md in chat** (the actual markdown you intend to write), then
    present the review gate as ONE AskUserQuestion per `<review-gate>` below:
    **Write it · Edit a section · Regenerate · Cancel.**
    - **Write it** → proceed to the write step (subject to the existing-file sub-gate).
    - **Edit a section** → ask the user which section to adjust and how (this single targeted follow-up
      is part of the review gate, not a re-interview of the brief), revise that section, re-render, and
      present the gate again.
    - **Regenerate** → re-synthesize from the brief (e.g. with different structural assumptions) and
      re-render, then present the gate again.
    - **Cancel** → stop without writing anything. The filesystem is untouched.
  </step>

  <step>**Existing-file sub-gate (only when the user chose "Write it").** Determine the target path
    `<project>/CLAUDE.md` (the project root — the current working directory unless the brief clearly
    scopes a sub-package). If a `CLAUDE.md` already exists there, read it and present ONE AskUserQuestion
    offering **Merge** vs. **Overwrite** vs. **Cancel** (mirroring `/tiki:research`'s existing-doc gate):
    - **Merge** → preserve the existing CLAUDE.md's content and append a clearly delimited
      `## Generated from <slug>-brief.md (YYYY-MM-DD)` section containing the newly synthesized sections,
      so nothing the user hand-wrote is lost.
    - **Overwrite** → replace the file entirely with the synthesized CLAUDE.md.
    - **Cancel** → stop without writing. The existing file is untouched.
    If no `CLAUDE.md` exists at the target, skip this sub-gate and write a fresh file.
  </step>

  <step>**Write the file with the Write tool.** Write the approved CLAUDE.md to `<project>/CLAUDE.md`
    using the Write tool. Surface the `write-failed` error if the write does not succeed. On success,
    confirm the path and a one-line summary, and present the `<next-actions>` follow-on.
  </step>
</instructions>

<claudemd-skeleton>
The generated `CLAUDE.md` follows this section structure. Fill each section from the mapped brief
content (STEP 3). Use `TODO:` for anything the brief does not pin down — never invent concrete paths
or commands as if they already exist.

```markdown
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

<Overview + Users & problem: what the project is and who it serves.>

## Repository Structure

<Intended layout inferred from type + stack. Greenfield — mark aspirational/unknown paths with TODO:.
 e.g. `src/ — application source (TODO: confirm once scaffolded)`. Never assert a path exists.>

## Development Commands

<Everyday build / test / run / lint commands inferred from type + stack. Mark uncertain ones TODO:.>

```bash
# example, inferred from the stack
pnpm install
pnpm dev
pnpm test
```

## Conventions

<Constraints + non-functional priorities (testing / security / performance / documentation).
 Hard requirements (compliance, deadlines, must-use tech). TODO: where the brief is silent.>

## What needs to be true

<The brief's project-wide requirements list — the cross-cutting truths that must hold for the project.>
```

Notes:
- The leading line ("This file provides guidance to Claude Code…") is conventional — keep it.
- Drop a section entirely only if it would be 100% `TODO:` with nothing useful; otherwise keep it with
  an honest `TODO:` so the gap is visible to whoever fills it in.
</claudemd-skeleton>

<review-gate>
After rendering the synthesized CLAUDE.md in chat, present exactly ONE AskUserQuestion. Nothing is
written until the user approves here (and clears the existing-file sub-gate if a CLAUDE.md is present).

- question: "Here's the CLAUDE.md synthesized from {slug}-brief.md. What now?"
- header: "Review CLAUDE.md"
- options:
  - label: "Write it"
    description: "Write this CLAUDE.md to the project root (Merge/Overwrite gate if one already exists)"
  - label: "Edit a section"
    description: "Adjust one section, then re-render and review again"
  - label: "Regenerate"
    description: "Re-synthesize from the brief with different structural assumptions, then review again"
  - label: "Cancel"
    description: "Stop without writing anything — the filesystem is untouched"

Existing-file sub-gate (only after "Write it", only when a CLAUDE.md already exists at the target):
- question: "A CLAUDE.md already exists at {target}. How should I write?"
- header: "Existing CLAUDE.md"
- options:
  - label: "Merge"
    description: "Keep the existing file and append a dated 'Generated from {slug}-brief.md' section"
  - label: "Overwrite"
    description: "Replace the existing CLAUDE.md entirely with the synthesized one"
  - label: "Cancel"
    description: "Stop without writing — the existing file is untouched"
</review-gate>

<output>
## CLAUDE.md Generated: {project}

**Source brief:** `.tiki/research/{slug}-brief.md`
**Written to:** `{target}/CLAUDE.md`
**Type:** {type}
**Stack:** {stack as comma-separated list}
**Sections:** Project Overview · Repository Structure · Development Commands · Conventions · What needs to be true
**Open TODOs:** {count} placeholder(s) for the team to fill in

---

{First ~10 lines of the written CLAUDE.md as a preview...}

---

*CLAUDE.md saved. Claude Code reads it on every session in this project — fill in the `TODO:` placeholders as the project takes shape.*
</output>

<errors>
  <error type="no-brief">
    No project brief found. Expected a `.tiki/research/<slug>-brief.md` file (the output of `/tiki:scaffold`).
    - If you passed a slug, `.tiki/research/<slug>-brief.md` does not exist — check the slug.
    - If you passed no slug, no `*-brief.md` files were found under `.tiki/research/`.
    Run `/tiki:scaffold` first to interview your project into a brief, then re-run `/tiki:claudemd`.
  </error>
  <error type="write-failed">
    Failed to write `{target}/CLAUDE.md`: {error message}. Check that the target directory is writable.
    The brief at `.tiki/research/{slug}-brief.md` is unchanged — re-run `/tiki:claudemd {slug}` to retry.
  </error>
</errors>

<next-actions>
After writing the CLAUDE.md, present this follow-on so the user can keep moving:

- question: "CLAUDE.md written for {project}. What next?"
- header: "Next step"
- options:
  - label: "Review the file"
    description: "Open {target}/CLAUDE.md to fill in the TODO: placeholders"
  - label: "Scaffold the spine"
    description: "Run /tiki:scaffold (or resume) to turn the brief into draft issues"
  - label: "Start the first issue"
    description: "Run /tiki:get <issue> once the brief's spine has been pushed to GitHub"
  - label: "Done"
    description: "Return to the previous workflow step"
</next-actions>
</content>
</invoke>
