# Dev Case — LLM-era developer assessment

An assignment lifecycle for hiring developers in a world where "is the code
correct" is the wrong question — 100% of a candidate's code can plausibly be
LLM-generated. Instead of grading raw output, Dev Case grades *how* the
candidate drove the work: problem framing, tooling fluency, verification
habits, and whether demonstrated skill transfers to the role being hired for.
It is generalized beyond software (marketing/finance/sales/design cases exist
too), riding the same lifecycle.

The system also runs six "LLM-era controls" so an unverifiable, fully-AI-authored
submission cannot be waved through as a strong hire — see [Anti-delegation
controls](#anti-delegation-controls-shipped) below. All six are shipped.

## Entry points

- Recruiter workspace — the **Dev** tab: `app/features/tools/devcases/DevTab.tsx`,
  routed through `DevTabSwitcher.tsx` / `DevTabDefineView.tsx` (need intake +
  analysis) / `DevTabCasesView.tsx` (case list) / `DevCaseDetail.tsx` (per-case
  lifecycle, submissions, evaluation).
- Candidate apply/work surface — `app/devcase/apply/[token]/page.tsx` +
  `DevApplyForm.tsx`; the in-browser editor is `LiveWorkSurface.tsx`.

## Flows

1. **Need intake → reality reflection.** Recruiter describes a need (stack,
   responsibilities, an optional codebase ref) via `DevNeedForm.tsx` →
   `useDevTabNeedAnalysis.ts` → `pipeline/jobfit/devcase/analyze.py`
   (`analyze_need`), reflecting the stated need against real signals
   (`realStack` **or** `coreResponsibilities` — relaxed to also ground
   non-software roles).
2. **Case + role design.** `pipeline/jobfit/devcase/design.py` (`design_case`,
   `design_role`, prompt `case-design-v6`) produces a `CaseScenario` (brief,
   starting materials, covert tooling-probes, rubric) anchored to the ROLE
   being hired, not the codebase's domain — a v2 fix (see
   `docs/_archive/dev-d3-hardening-findings.md`) — plus a mid-session
   **requirement change** (`midFlightUpdate`, v6) that makes pure one-shot
   generation structurally insufficient.
3. **Human gate.** The role/case is a Decisions approval
   (`app/api/devcase/lifecycle/route.ts`, `.../[id]/approve/route.ts`) before
   it is published/sent.
4. **Candidate works the case.** Either a git-based submission (repo trace) or
   the in-product **Live Work Surface** (`LiveWorkSurface.tsx`) — every
   open/edit/decision-log/submit/paste event is server-recorded
   (`pipeline/jobfit/devcase/process_events.py`), so there is a first-party
   observed trace with no reliance on a private git log.
5. **Evaluation.** `pipeline/jobfit/devcase/evaluate.py` +
   `reflect.py` run `reflect_commits → assess_tooling → evaluate_submission →
   score_transfer` (or the observed-event equivalent), producing dimension
   scores, an authenticity band, and a transfer score. Results surface as
   review cards in `app/features/tools/devcases/DevEvalPanel*.tsx`,
   `DevCompareSubmissions.tsx`, `DevCohortProbePanel.tsx`.
6. **Promotion.** `app/api/devcase/promote/route.ts` + `dev-control.ts`
   (autonomy level, promote floor) — auto-promotion is gated: a submission
   flagged `suspect` by the authenticity score, or with a broken integrity
   chain, is held for a live ownership-verifying interview rather than
   advanced on transfer score alone.

## Anti-delegation controls (shipped)

Six controls, referenced in code comments as "LLM-era controls #1–#6":

| # | Control | What it does | Where |
|---|---|---|---|
| 1 | Tamper-evident hash chain | Every Live Work Surface event is chained server-side (SHA-256); a broken chain or backdated client timestamp marks the whole observed trace untrustworthy | `app/_lib/db/core.ts` (schema), `app/_lib/db/devcase.ts` (verify), `app/_lib/devcase-run.ts` |
| 2 | Captured prompt channel | In-session chat (assistant/stakeholder replies) is server-recorded, not client-reported, so tooling-fluency signals can't be fabricated | `pipeline/jobfit/devcase/chat.py`, `prompt_signals.py` |
| 3 | Canaries | The seed materializer plants known-ground-truth flaws; each is graded ADDRESSED / FLAGGED / PROPAGATED / UNVERIFIABLE against the submitted tree | `pipeline/jobfit/devcase/seed_materializer.py`, `artifact_checks.py` |
| 4 | Per-session watermark | A deterministic, session-specific marker in the seed; a **foreign** watermark inside a submission is the tell that a solution circulated between candidates | `app/_lib/db/devcase.ts` |
| 5 | Mid-flight perturbation | A requirement change revealed mid-session (server-timestamped), after which everything is the candidate's observed adaptation to a changed brief — defeats pure one-shot generation | `pipeline/jobfit/devcase/models.py`, `design.py` (case-design-v6), `process_events.py` |
| 6 | Frozen naive baseline | At approval, a bare one-shot LLM solve is frozen per case; submissions are diffed against it (never as a penalty — it aims the authorship interview, since using an LLM is never itself penalized) | `pipeline/jobfit/devcase/baseline.py`, `artifact_checks.py` |

Fairness invariants (checked in code, not just prose): using an LLM is never
penalized; over-reliance is inferred only from observed process artifacts
(opens/edits/decision-log), never keystrokes; a merely-missing own watermark
is not penalized (deleting a line isn't proof of anything) — only a
**foreign** watermark or a broken chain is decisive.

## Surface

| Path | Role |
|---|---|
| `app/api/devcase/route.ts` + `.../comms`, `.../control`, `.../feedback`, `.../inbound`, `.../outcomes`, `.../postings`, `.../promote`, `.../publish`, `.../skill-profile`, `.../source`, `.../submit` | Dev case CRUD + lifecycle actions |
| `app/api/devcase/lifecycle/route.ts` + `[id]/approve`, `[id]/close`, `[id]/redesign` | Decisions-gated lifecycle transitions |
| `app/api/devcase/session/route.ts` + `[id]`, `[id]/chat`, `[id]/submit` | Live Work Surface session API |
| `app/_lib/devcase-orchestrator.ts`, `devcase-run.ts` | Drives need→scenario→solve→evaluate→promote |
| `app/_lib/devcase-authenticity.ts` | Process-authenticity scoring (paste-from-LLM tells) |
| `app/_lib/devcase-probe-audit.ts`, `devcase-compare.ts`, `devcase-cohort.ts`, `devcase-interview-kit.ts` | Evaluation support: probe-outcome audit, submission comparison, cohort stats, interview-kit generation |
| `pipeline/jobfit/devcase/*.py` | The Python LLM pipeline: `analyze.py`, `design.py`, `evaluate.py`, `reflect.py`, `baseline.py`, `artifact_checks.py`, `seed_materializer.py`, `process_events.py`, `devcase_cli.py` |

## Data model

- `dev_cases` (case scenario, `baseline_json`) — SQLite, via `app/_lib/db/devcase.ts`
- `devcase_submissions`, `devcase_lifecycle` — orchestration state
- Live Work Surface event log — tamper-evident hash-chained rows (per `app/_lib/db/core.ts`)

## Known gaps

- The `architecture` rubric dimension name is still software-flavored even for
  a non-software case (the description text was neutralized, the field name
  wasn't — a cascading rename was deferred).
- Sub-specialty drift (a Frontend role handed a backend-stack repo, iOS handed
  Android) still falls back to "generic engineering" in `design_case` — see
  `docs/_archive/dev-d3-hardening-findings.md` residuals.
- 3rd-party distribution (publish/pull to email/ATS/job-board) is a local-stub
  adapter interface only, per the original plan (`docs/concepts/dev-extension-future-phases.md`).

## Case-generation calibration

The generator (`analyze → role → case`) is hardened against real, cross-industry
job descriptions by a separate harness — see
[`docs/development/case-calibration.md`](../../development/case-calibration.md).
