---
name: scaffold
description: Interview a greenfield project into a brief + draft epic/issue spine, then push to GitHub
argument: [one-line project description]
tools: Bash, Read, Write, AskUserQuestion
---

# Scaffold a Greenfield Project

The conversational front door for a brand-new project. Interview the user about what they
want to build, synthesize a **project brief** plus a project-wide **"what needs to be true"**
requirements list, and hand off toward the draft spine. Scaffold never drives the Tiki
pipeline (no transitions, no issue numbers exist yet) — it captures intent and emits a brief.

This command authors the brief. The downstream draft spine and the gated GitHub push are
separate capabilities that append to this same flow; this stage ends with a clean handoff.

<instructions>
  ## Stage 0 — Preflight (no interview questions yet)

  <step>**Resume detection.** Check whether `.tiki/onboarding/draft/manifest.json` already exists.
    - If it exists, a prior scaffold draft is in progress. The draft-spine capability owns that file, so for now simply **note** to the user that a draft already exists and ask (one AskUserQuestion) whether to **Continue the existing brief/draft** or **Start over** (which will overwrite). Do not delete or rewrite the draft here.
    - If it does not exist, proceed.
  </step>

  <step>**Greenfield readiness probe (WARN, never abort).** Run, via Bash:
    ```bash
    gh auth status
    git remote -v
    ```
    The only capability gated by these is the eventual GitHub push (a later stage). If `gh` is unauthenticated, or `git remote -v` shows no remote, **warn** the user that pushing issues to GitHub will be unavailable until they finish project setup (point them at the project-skeleton readiness checklist), and then **continue**. The interview and the local brief always proceed regardless — never stop the command because of these checks.
  </step>

  <step>**Derive and validate the project slug.** Choose a `<slug>` for the brief filename:
    - Lowercase kebab-case (letters, digits, hyphens only), derived from the project name once you know it (you may defer the final slug until after Q1/Q2, but validate before writing).
    - Must not contain `/` or `..` (path-traversal guard).
    - Surface the `invalid-slug` error if a derived slug fails validation; ask the user for a clean name.
  </step>

  <step>**Existing-brief gate.** If `.tiki/research/<slug>-brief.md` already exists, read it and present one AskUserQuestion offering **Merge** (append a new `## YYYY-MM-DD revision` section, preserving the original front-matter but extending `tags`) vs. **Overwrite** (replace entirely) vs. **Cancel**. This gate runs only at write time (after Q8), so an early abort never touches the file.
  </step>

  <step>**Seed context.** Fold the `argument` (the one-line project description) AND anything the user already said in this conversation into Q1, so the interview never re-asks what is already known. The `argument` pre-fills Q1 for confirm/edit rather than asking it cold.
  </step>

  ## The interview arc (adaptive, bounded — target ≤ 8 turns)

  Driving principle: **infer and propose, then ask for correction.** Proposing a best guess and letting the user trim is cheaper than open interrogation and is the only way to stay under budget. Each stage below is **one** AskUserQuestion; allow free-text via an "Other" option wherever it helps.

  **HARD convergence imperatives (obey all):**
  - Ask **at most 8 turns** total. Never exceed the Q1–Q8 budget.
  - **Skip any stage already answered** — if the `argument` or earlier answers already cover a later stage, collapse it into the proposal instead of asking. If Q1/Q3 are rich, fold Q5 into the proposal directly.
  - If you have already asked **6 or more** questions, **force the Q8 synthesis checkpoint immediately** with your best-guess scope filled in — do not keep interviewing.
  - On any **"you decide" / "no preference" / "whatever you think"** answer, **STOP asking about that gap**, fill it yourself with a sensible default, and **surface the assumption explicitly at Q8** so the user can correct it there.
  - **Q8 is the SINGLE write-gate.** NOTHING is written to disk before the user approves at Q8. Bailing out at any point before Q8 leaves the filesystem untouched.

  <step>**Q1 — Vision.** AskUserQuestion (pre-filled from `argument` if present): "In a sentence or two, what do you want to build?" Capture the 1–2 sentence "what." Offer "Other" for free-text edit. If the `argument` already states this clearly, present it for confirm/edit rather than asking blank.</step>

  <step>**Q2 — Project type.** AskUserQuestion, single-select (drives stack + epic shape): **Web app · API / service · CLI · Library / SDK · Desktop · Other** (free-text). Skip if Q1 already pins the type unambiguously (and confirm your inference at Q8).</step>

  <step>**Q3 — Users & core job.** AskUserQuestion, free-text: "Who uses it, and the one job it must do well?" This elicits the MVP slice. Offer "Other" for free-text.</step>

  <step>**Q4 — Stack & hard constraints.** AskUserQuestion, multi-select + "Other": language / framework, must-use technologies, compliance, deadlines. **Include a "You pick / no preference" option** so the LLM is authorized to recommend a stack (surface the recommendation at Q8).</step>

  <step>**Q5 — Must-have set for v0.1 (the spine).** Do NOT ask open-endedly. **PROPOSE 3–6 candidate capabilities** inferred from Q1–Q3, presented via AskUserQuestion (multi-select) so the user **trims / confirms**. This enforces a *small spine* — steer toward the smallest set that delivers the core job, and resist scope creep. Offer "Other" to add a capability.</step>

  <step>**Q6 — Non-functional priorities.** AskUserQuestion, multi-select (maps to success-criteria categories later): **testing · security · performance · documentation · not yet**. "Not yet" is a valid answer.</step>

  <step>**Q7 — Ordering.** Do NOT ask open-endedly. **PROPOSE the build ordering / dependency shape** ("auth before billing," "scaffolding first") via AskUserQuestion, and let the user **confirm or adjust**. This is what later becomes dependency edges.</step>

  <step>**Q8 — Synthesis checkpoint (the write-gate).** Summarize back, in chat, the full synthesized scope: vision, type & stack, users & core job, the trimmed must-have set, the ordering, the non-functional priorities, AND **every assumption you filled in** for "you decide" gaps. Then AskUserQuestion, single-select: **Draft it** (approve → write the brief) · **Adjust scope** (loop back to Q5) · **Change ordering** (loop back to Q7) · **Add / remove a capability** (loop back to the relevant stage). Only **Draft it** unlocks the write step below. Until then, nothing is written.</step>

  ## Brief emission (only after Q8 "Draft it")

  <step>**Write the brief with the Write tool** to `.tiki/research/<slug>-brief.md` (create `.tiki/research/` if absent). Use the research-doc front-matter schema below, then the section skeleton below. If the existing-brief gate above selected **Merge**, append a `## YYYY-MM-DD revision` section instead of replacing. Surface the `write-failed` error if the write does not succeed. Then confirm the path and a one-line summary, and present the `<next-actions>` handoff.</step>
</instructions>

<front-matter-schema>
The brief reuses the research-doc front-matter (so it surfaces during `/tiki:plan` and `/tiki:execute`), plus two machine-readable keys consumed by downstream tooling. The research-doc front-matter parser ignores keys it does not recognize, so the extra `type:` / `stack:` keys are safe to include.

```yaml
---
topic: <slug>-brief
tags: [<type>, greenfield, scaffold]
issues: []            # backfilled with real #N after the spine is pushed
created: <ISO 8601 timestamp>
type: <web|api|cli|library|desktop|other>   # machine-readable project type (Q2)
stack: [<lang/framework>, <key tech>, ...]   # machine-readable stack list (Q4)
---
```

Field rules:
- `topic`: `<slug>-brief`, matching the filename (without `.md`).
- `tags`: JSON-style array of short lowercase strings; lead with the project `<type>`.
- `issues`: JSON-style array of integer issue numbers — empty (`[]`) until a spine is pushed.
- `created`: ISO 8601 timestamp at write time, e.g. `2026-06-14T17:42:00.000Z`.
- `type`: single lowercase token mirroring Q2 (for #293/#294 tooling).
- `stack`: JSON-style array mirroring Q4's chosen stack (for #293/#294 tooling).
</front-matter-schema>

<brief-skeleton>
After the closing `---`, write these sections (markdown). Fill each from the mapped interview answers; keep it tight.

```markdown
# <Project> — Project Brief

## Overview
(Q1 — the 1–2 sentence vision)

## Users & problem
(Q3 — who uses it and the one job it must do well)

## Type & stack
(Q2 + Q4 — project type, language/framework, must-use tech)

## Scope: in / out
(Q5 — the trimmed must-have set, AND explicit non-goals: what v0.1 deliberately omits)

## Constraints
(Q4 — compliance, deadlines, hard requirements)

## What needs to be true
(The project-wide requirements list — the "if this is the app, then these must hold."
 These are the cross-cutting truths that do not belong to a single issue. Per-issue
 requirements become success criteria in individual issue bodies later.)

## Proposed epics & first wave
(Q5 + Q7 — the small spine: 2–4 epics, ~3–8 first-wave capabilities, in the confirmed
 ordering. This mirrors the draft manifest the next stage will produce.)

## Assumptions & open questions
(Every "you decide" gap you filled in, plus anything still unresolved for the user to revisit.)
```
</brief-skeleton>

<output>
## Project Brief Captured: {slug}

**File:** `.tiki/research/{slug}-brief.md`
**Type:** {type}
**Stack:** {stack as comma-separated list}
**Spine:** {N} epics, {M} first-wave capabilities

---

{One-line synthesis of the vision and core job...}

---

*Brief saved. Nothing has been pushed to GitHub yet — the next step drafts the issue spine.*
</output>

<errors>
  <error type="no-confirmation">
    Scope was not approved at the synthesis checkpoint (Q8), so nothing was written. Re-run `/tiki:scaffold` to resume the interview, or choose **Draft it** at Q8 to write the brief.
  </error>
  <error type="invalid-slug">
    Project slug "{slug}" is invalid. Must be lowercase kebab-case (letters, digits, hyphens only) and must not contain `/` or `..`. Examples: `task-tracker`, `weather-api`, `notes-cli`. Pick a clean project name and retry.
  </error>
  <error type="write-failed">
    Failed to write `.tiki/research/{slug}-brief.md`: {error message}. Check that the working directory is writable and that `.tiki/` exists.
  </error>
</errors>

<next-actions>
After saving the brief, hand off via AskUserQuestion (the draft itself is the next stage — this command only emits the brief):

- question: "Brief saved. What's next?"
- header: "Next step"
- options:
  - label: "Draft the issue spine"
    description: "Decompose the brief into a small epic/issue spine staged locally for review"
  - label: "Edit the brief"
    description: "Open .tiki/research/<slug>-brief.md to adjust scope before drafting"
  - label: "Save brief & exit"
    description: "Stop here — resume scaffolding later"
</next-actions>
