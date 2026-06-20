---
name: dev-case-hire
promotion: discovery
surfaces: [Dev Case Authoring & Publishing, Dev Submissions & Live Work Surface, Dev Lifecycle Cohort & Outcomes, /devcase/apply/[token]]
characters: [eva-eng-hiring-lead, sam-dev-candidate]
language: both
---

# Dev case hire — author a real case, candidate does live work, defend the eval

## Goal (in the user's words)
- **Eva (cs authoring):** "From a concrete engineering need, generate a SHORT case — not a leetcode
  trap — publish an apply link, and get back an evaluation I can defend to the team with evidence."
- **Sam (en candidate):** "Give me a brief I can read in minutes, real starter files, and a place to
  actually work — and judge how I collaborate with AI, not whether I memorized an algorithm."

## Definition of done (user POV)
- A brief, role-grounded case (research anchor: <30 min; long take-homes lose 40-60% of seniors).
- A working live-work surface where Sam edits seed files and the system observes process (not keystrokes).
- An eval Eva can defend: evidence-backed, AI-era signal (judgment + AI collaboration), with provenance.

## Entry state / preconditions
- **Eva:** dev gate on; a role need to feed authoring; Gemini/LLM key for case generation + eval (else
  generation/eval are `scope_note`).
- **Sam:** a minted **dev-case apply token** for a published, non-closed posting (`env.md` fixture #4 + #5 —
  without it his whole leg is `unreachable`, not failing).

## What L1 must check (structural, code-grounded)
- **Reachability:** Sam reaches ONLY `/devcase/apply/[token]` — resolved by `getPostingByToken`, `notFound()` otherwise,
  closed posting → honest closure card (`app/devcase/apply/[token]/page.tsx:23-39`). Eva works the authed Dev tab
  (NeedForm/CasesTable/CaseDetail) + lifecycle/outcomes/cohort panels. Confirm Sam's token fixture.
- **Probe-safety (trust):** the candidate page renders `caseToMarkdown` which EXCLUDES probes by construction
  (`page.tsx:13-19,52-55` — "never render the raw case object here"). Flag if any probe/answer key could leak to the candidate.
- **Live-work surface is real, not a textarea:** `LiveWorkSurface` mounts an editor over the materialized seed, lazily mints
  a session on first interaction, and flushes OBSERVED process events + the file tree every 8s
  (`app/devcase/apply/[token]/LiveWorkSurface.tsx:7-13,17,38-45`). Submit finalizes via `/api/devcase/session/[id]/submit`
  (`app/api/devcase/session/[id]/submit/route.ts:11-19`). Verify a read-only visitor never orphans a session (`:39`).
- **Grounding audit (the crux):** follow Eva's authoring → `/api/devcase` + `/api/devcase/publish` → `devcase-orchestrator.ts`
  → the Python `devcase/design.py` / `analyze.py`. Does case design receive the REAL role need + role spec, or a sample?
  And does the eval (`devcase/evaluate.py` + `submission_eval.py`, via `/api/devcase/session`) score the ACTUAL observed
  process events, or a reconstructed/generic rubric? "Good machinery fed thin context" = senior-quality `quality-gap`.
- **Brevity gate:** check `devcase-constraints.ts` / design output bounds the case to a short scope — a sprawling take-home is a finding.

## What L2 must confirm (live-only)
- **l2_priority — grounded/non-default path:** Eva authors from a REAL need; assert the generated case names that role's stack
  and is short. Sam opens the token, edits seed files in the live surface, submits; assert the eval cites HIS observed events
  (files touched, DECISIONS.md), and Eva's panel shows an evidence-backed verdict with provenance, not a generic grade.
- **Real latency:** case generation + LLM eval are 15-130s-class Python/Gemini calls — an early timeout is a finding.
- **Bilingual:** Eva authors in cs, Sam works in en; the case/brief renders in the candidate's language without leaked strings.
- **Rendering:** the live-work editor + seed file tree + score bars render in both themes; the brief Markdown renders.

## Out of scope / known
- Keyless: case generation + eval degrade — drop one severity, `scope_note`.
- Cohort probe-strength + outcomes analytics (Dev Lifecycle context) — adjacent; the hire loop is the headline here.
- The POST-only inbound webhook (`/api/devcase/inbound`) is the channel path, not the browser apply surface.
