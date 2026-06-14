---
topic: scaffold-interview-design
tags: [greenfield, scaffold, interview, epic-b, v1.0.0]
issues: []
created: 2026-06-13T00:00:00.000Z
---

# `/tiki:scaffold` — Interview Command Design (Epic B)

The conversational half of greenfield onboarding. Interviews the user about a brand-new
project, synthesizes a **project brief** + a **"what needs to be true" requirements list**,
decomposes a **small spine** of epics → first-wave issues (with success criteria + dependency
edges), stages them locally for review, and — only on explicit confirmation — pushes them to
GitHub as real issues grouped into a release.

Companion to [[greenfield-onboarding]]. Assumes Epic A (skeleton) has produced a valid,
git-initialized, GitHub-wired project. Scaffold does NOT drive the pipeline — it emits drafts
and hands off to `/tiki:get` / `/tiki:plan`.

---

## Design constraints honored (from the verified research)

- **No pipeline driving.** Scaffold never calls `state.mjs transition`/`journal` — no issue numbers
  exist during the interview. Keeps it off the transition-coverage allowlist tables.
- **No new schema.** Brief → research doc; requirements → `SuccessCriterion` (markdown in issue bodies);
  epics → research-brief headings + GitHub tracking issue + local release grouping. No `epic.json`.
- **Success-criteria category must be `"functional"`** (not the `plan.md:193` `"functionality"` typo).
- **Nothing outward-facing without explicit confirm.** Draft staged locally in `.tiki/onboarding/draft/`;
  a single confirm gate precedes any `gh` write.
- **Dep edges require same-release grouping.** Generated issues are written into one
  `.tiki/releases/{version}.json` (issues as `{number,title}` objects) or the graph renders nothing —
  ungrouped issues aren't even nodes. Edge direction: `Depends on #N` in issue X's body = edge N→X, so
  inject the dependency line into the **dependent (downstream)** issue's body.
- **Framework calls `gh` directly** (no Rust wrapper needed): `gh issue create --body-file --label
  --milestone`, parse `#N` from the returned URL; `gh issue edit --body-file` for the second pass.
- **Small spine, converge not exhaust** (user decision): 2–4 epics, ~3–8 first-wave issues total.
- **Process:** adding `scaffold.md` requires re-running `node packages/framework/install.js` (dogfood-copy
  parity test) and avoiding the banned ack-phrases. `argument` is singular.

---

## Command shell

```yaml
---
name: scaffold
description: Interview a greenfield project into a brief + draft epic/issue spine, then push to GitHub
argument: [one-line project description]   # optional seed; resume picks up an existing draft
tools: Bash, Read, Write, AskUserQuestion
---
```

`argument` is an optional seed. `/tiki:scaffold resume` re-enters an existing
`.tiki/onboarding/draft/` (review or push without re-interviewing).

---

## Stage 0 — Preflight (no questions yet)

1. **Already scoped?** If `.tiki/onboarding/draft/manifest.json` exists → offer Resume (review / push /
   discard-and-restart) via one AskUserQuestion. Skip the interview on resume.
2. **Greenfield-ready?** Run `gh auth status` and `git remote -v`. If unauthed or no remote, warn that
   push will be unavailable and point at Epic A's readiness checklist — but allow the interview + local
   draft to proceed (push is the only gated-out step).
3. **Seed context.** Fold the `argument` and any prior conversation into Q1 so the interview never asks
   what the user already told it.

---

## The interview arc (adaptive, bounded — target ≤ 8 turns)

Driving principle: **infer and propose, then ask for correction** — cheaper than open interrogation and
the only way to stay under budget. Each stage is one `AskUserQuestion` (free-text allowed via "Other").
Collapse stages when an answer already covers later ones. Never re-ask what's known.

| # | Stage | Elicits | Question shape |
|---|-------|---------|----------------|
| Q1 | **Vision** | the "what" in 1–2 sentences | Free-form: "In a sentence or two, what do you want to build?" (pre-filled from `argument` for confirm/edit) |
| Q2 | **Project type** | drives stack + epic shape | Single-select: Web app · API/service · CLI · Library/SDK · Desktop · Other |
| Q3 | **Users & core job** | the MVP slice | Free-form: "Who uses it, and the one job it must do well?" |
| Q4 | **Stack & hard constraints** | language/framework, must-use tech, compliance, deadline | Multi-select + Other; include "You pick / no preference" so the LLM recommends |
| Q5 | **Must-have set for v0.1** | the spine | LLM PROPOSES 3–6 candidate capabilities from Q1–Q3; user trims/confirms. Enforces "small spine" |
| Q6 | **Non-functional priorities** | maps to SC categories | Multi-select: testing · security · performance · documentation · not yet |
| Q7 | **Ordering** | dependency edges | LLM PROPOSES the ordering ("auth before billing"); user confirms/adjusts |
| Q8 | **Synthesis checkpoint** | approval before writing anything | Single-select: Draft it · Adjust scope · Change ordering · Add/remove an epic (loops back to the relevant stage) |

Convergence rules baked into `<instructions>`: cap at ~8 questions; if Q1/Q3 are rich, merge Q5 into the
proposal; if the user says "you decide," the LLM fills gaps and surfaces assumptions in the checkpoint
rather than asking more. The checkpoint is where scope is locked — nothing is written before Q8 approval.

---

## Synthesis (after Q8 approval)

### 1. Project brief → `.tiki/research/<slug>-brief.md`
Reuses the research-doc format verbatim. `<slug>` = kebab project name.
```
---
topic: <slug>-brief
tags: [<type>, greenfield, scaffold]
issues: []            # backfilled with real #N after push
created: <ISO>
---
# <Project> — Project Brief
## Overview            (Q1)
## Users & problem     (Q3)
## Type & stack        (Q2, Q4)
## Scope: in / out     (Q5 — explicit non-goals matter)
## Constraints         (Q4)
## What needs to be true   ← the project-wide requirements list (the "if this is the app, then…")
## Proposed epics & first wave   (mirrors the manifest)
## Assumptions & open questions
```
The **"What needs to be true"** section is the project-level home for requirements that don't belong to a
single issue. Per-issue requirements become `SuccessCriterion`-shaped markdown in each issue body (below).

### 2. Decomposition → small spine
- **2–4 epics.** Epic 1 is almost always **Foundation/scaffolding** (dovetails with Epic C templates later);
  the rest are the core capability(ies) from Q5 + one supporting concern (e.g. testing/CI) if Q6 warrants.
- **~3–8 first-wave issues total.** Each issue: title, body, labels, epic key, symbolic dependencies.
- Epics are NOT a schema object — they're a heading in the brief, a label (e.g. `epic:foundation`), and
  (optionally) a GitHub tracking issue created in the push step.

### 3. Stage the draft → `.tiki/onboarding/draft/`
```
manifest.json
  {
    "version": "v0.1.0",
    "slug": "<slug>",
    "createdAt": "<ISO>",
    "milestone": "v0.1.0",                 // optional
    "epics":  [ { "key": "foundation", "title": "...", "label": "epic:foundation" } ],
    "issues": [ {
      "localId": "auth-api",               // symbolic id used for edges before #N exist
      "title": "...",
      "epicKey": "foundation",
      "labels": ["epic:foundation"],
      "dependsOn": ["scaffold-repo"],      // symbolic; resolved to "Depends on #N" on push
      "bodyFile": "issue-auth-api.md"
    } ]
  }
issue-<localId>.md   # rendered body per issue:
  ## Context        (1–2 lines tying to the brief)
  ## Scope          (in / out for THIS issue)
  ## Success criteria
    - [functional] SC1: <what needs to be true>      ← "functional", never "functionality"
    - [testing]    SC2: ...
  ## Dependencies
    Depends on {{scaffold-repo}}      ← symbolic token, replaced with #N on push
```

### 4. Review
Render the tree (epics → issues, deps, labels, target release) in chat and gate on one AskUserQuestion:
**Push to GitHub · Edit a draft · Save draft & exit · Discard.** Nothing has touched GitHub yet.

---

## Gated push (two-pass) — only on "Push to GitHub"

1. **Preflight** `gh auth status`; abort with the `gh auth login` hint on failure.
2. **(optional) Milestone** — if `manifest.milestone` set and absent:
   `gh api repos/{owner}/{repo}/milestones -f title="v0.1.0" -f state=open`.
3. **(optional) Epic tracking issues** — one `gh issue create` per epic; record its `#N` for the brief.
4. **Pass A — create issues.** For each issue: `gh issue create --title <t> --body-file issue-<id>.md
   --label <l>… [--milestone "v0.1.0"]`; parse the trailing `#N` from the returned URL (as
   `issues.rs:130-137` does); build a `localId → #N` map.
5. **Pass B — inject edges.** For every issue with `dependsOn`, re-render its body replacing each
   `{{localId}}` token with `Depends on #<resolved>` and `gh issue edit <#N> --body-file <rerendered>`.
   (Inject into the dependent's body so the edge points dep→issue.)
6. **Group the release.** `Write` `.tiki/releases/{version}.json` with
   `{ version, status:"active", issues:[{number,title}…], createdAt }` for ALL created issues — required
   or the dependency graph won't render them. (No framework IPC for this — write the file directly.)
7. **Backfill** the brief's `issues:[…]` frontmatter with the real numbers; move the draft to
   `.tiki/onboarding/pushed/` (so resume can't double-create).
8. **Hand off** via `<next-actions>`: `/tiki:get <first-issue>` · `/tiki:release v0.1.0` · "open the board".

---

## What scaffold deliberately does NOT do

- Does not write `.tiki/plans/issue-N.json` (that's `/tiki:plan`; AUDIT expects plans authored there).
- Does not call `state.mjs` at all (no transitions/journal — no issue numbers yet).
- Does not generate the full backlog — spine only; the user pulls more later.
- Does not create git repo / remote (that's Epic A; scaffold only preflights and warns).

## Open design questions for Epic B build

- **Epic tracking issues — on by default, or opt-in?** They give a GitHub-visible parent but add N issues.
  Leaning opt-in (a checkbox at the review gate).
- **Edit-a-draft UX:** in-chat re-interview of one node vs. "edit the file and `resume`". Leaning the latter
  (simpler, the draft is plain markdown/JSON).
- **Cross-project reuse:** the same command could scope a new epic in an EXISTING project. v1.0.0 targets
  greenfield; keep the instructions greenfield-framed but don't hard-block a non-empty repo.
