---
name: screening-decisions
promotion: discovery
surfaces: [Decisions tab, "Screening Decisions & Records"]
characters: [marek-coordinator, lucie-dpo-compliance]
language: cs
---

# Screeningová pravidla, vlna a obhajitelný záznam rozhodnutí

## Goal (in the user's words)
"Nastavím pravidla, spustím AI screeningovou vlnu — ale chci napřed VIDĚT koho by to
odmítlo, umět to vrátit, a mít záznam, který obhájím před regulátorem. Žádné tiché
plně automatické zamítnutí."

## Definition of done (user POV)
- Marek configures screening rules and runs an AI screen-wave over a role's cohort.
- **Human-in-the-loop:** the wave **previews** who would be rejected before anything
  mutates; Marek tunes the threshold, watches the count, then explicitly commits.
- A rejected candidate can be **reconsidered** (put back for a fresh look).
- Lucie gets an **auditable decision record** (who/what/why/when, policy version)
  she could hand a regulator under the EU AI Act / GDPR Art. 22.

## Entry state / preconditions
- Dev gate on → workspace at `/`, Decisions tab.
- ČS roles with a matched, scored cohort (seeded pipeline) so a wave has subjects.

## What L1 must check (structural, code-grounded)
- **Surface model:** `app/features/sub_decisions/DecisionsTab.tsx`,
  `DecisionRulesModal.tsx` (config), `ScreenWaveModal.tsx` (the wave),
  `AiReviewCard.tsx`. Reachable for both Characters (no role gating).
- **Human-in-the-loop (central — both severity-critical):** `ScreenWaveModal.tsx:26-29`
  documents "ALWAYS preview first"; it dry-runs on open and on every slider change
  (`ScreenWaveModal.tsx:57`) → `/api/decisions/screen-wave/route.ts:24` honors
  `dryRun` (full math, zero mutation/comms). Confirm the **commit** is a separate,
  explicit action and that **fairness shielding** (early-career / unknown archetype)
  is applied server-side, not just in the UI copy.
- **Grounding audit:** the wave's reject math runs on the cohort's **real match
  scores** (bottom-% + max-match-to-reject), validated/clamped at the boundary
  (`screen-wave/route.ts:19`, `validateScreeningOverride`) so a malformed override is a
  400, not a silent mis-reject. Each decision carries a `reasonCode`/`reasonParams`
  (`ScreenWaveModal.tsx:18-20`) — confirm it's a real, localizable rationale.
- **Audit record (Lucie):** decisions seal to `decision-record-store.ts` with a
  `decision-hash` + attribution; readable via `/api/decisions/records`. Verify the
  record captures policy version + actor, so an auto-action is attributable.
- **Reconsider:** `/api/decisions/reconsider/route.ts:9` projects the auto-rejected
  cohort back for a fresh look — confirm the path actually re-opens an entry (no
  silently-terminal rejection).

## What L2 must confirm (live-only)
- l2_priority: open the wave, change the threshold, confirm the **previewed reject
  list updates live** and that **nothing mutates** until commit (re-query the cohort).
- Commit a small wave, then **reconsider** one rejected candidate and confirm it
  returns to an active state — Marek's undo path is real, not cosmetic.
- Lucie's lens: open the decision record for a committed reject and confirm it answers
  "who decided, on what basis, under which policy, with what human sign-off" — absence
  of any of these is a **trust** finding (she may rate it blocker per AI Act).
- Latency: the wave/preview spawns work (`maxDuration=60`); budget for it, don't time out.

## Out of scope / known
- Side-by-side comparative pick of the survivors → `group-eval-fairness.md`.
- Sending the rejection comms / inbound channels → comms scope.
- Funnel-level decision-log analytics → `analytics-calibration.md`.
