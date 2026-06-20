---
name: analytics-calibration
promotion: discovery
surfaces: [Analytics & Calibration Dashboards, Skill Matrix & Coverage, Screening Decisions & Records]
characters: [katerina-ta-analytics, lucie-dpo-compliance]
language: cs
---

# Analytics & calibration — every number ties to a decision

## Goal (in the user's words)
- **Kateřina (cs):** "Show me the funnel, the bottleneck, time-to-hire, and per-hire spend — and let
  me prove the AI's confidence scores actually track real outcomes, not vibes."
- **Lucie (cs):** "I need a defensible decision log: who/what decided, on what basis, with human
  oversight — the EU AI Act / GDPR Art. 22 evidence trail."

## Definition of done (user POV)
- Every headline number ties back to a concrete decision or cohort I can drill into.
- Confidence scores are CALIBRATED against measured outcomes (a reliability curve + Brier score),
  with an honest "not calibrated until N outcomes" gate — not a fake precision claim.
- Spend has per-hire attribution; the decision records are auditable and show human-in-the-loop.

## Entry state / preconditions
- Dev gate on; the canonical seed snapshot (ČS corpus + seeded pipeline) loaded so the funnel has real cohorts.
- **Seeded analyses with outcomes** for calibration to compute anything (`env.md` fixture #3) — without
  outcome pairs, calibration honestly reports "not yet calibrated", which is a strength, not a failure.

## What L1 must check (structural, code-grounded)
- **Reachability:** both reach the authed Analytics + Matrix tabs (no per-role gating) once the dev gate + data exist.
  Reachability ≈ "is there seeded data behind the tab" — flag an empty-but-reachable tab as a fixture gap, not a code bug.
- **Numbers tie to decisions:** the Analytics payload carries funnel, bottleneck, stage dwell, time-to-hire, by-job/source/
  channel/archetype/variant, momentum, automation ROI, deltas, and targets (`app/features/sub_analytics/AnalyticsTab.tsx:23-58`).
  Confirm each scalar has a source (DecisionLog + DecisionRecordsPanel are siblings, `:19-21`).
- **Calibration is MEASURED, not asserted (the crux):** `/api/analytics/calibration` bins real (score, advance/pass-outcome)
  pairs into a reliability curve + Brier score with a "calibrated since N outcomes" gate
  (`app/api/analytics/calibration/route.ts:10-24`; `computeCalibration` in `calibration.ts`). `?roleFamily` filters so a buyer
  can ask "how accurate for backend?" (`:18-22`). Flag any hardcoded/illustrative confidence that isn't outcome-derived.
- **Grounding audit:** calibration reads EVERY saved-analysis row for the current workspace (`:18`, `currentWorkspace()`) —
  tenant-scoped real data, not a sample. Spend (`/api/analytics/spend`) + automation ROI (`automation-roi.ts`) must attribute
  to actual hires/runs, not a flat estimate — a flat per-hire number is a trust `quality-gap` for Kateřina.
- **Decision audit (Lucie's bar):** decision records (`/api/decisions/records`, `decision-record-store.ts`, `decision-hash.ts`,
  `decision-attribution.ts`) capture the basis + who decided + human-in-loop. Absence of a defensible record on an AI-driven
  screen is a **blocker** for the compliance Character per the rubric's EU AI Act / Art. 22 rule.

## What L2 must confirm (live-only)
- **l2_priority — grounded/real-data:** with seeded outcomes, assert the reliability curve renders from real pairs and the Brier
  score / "calibrated since N" gate is honest (under-data → it says so, doesn't fake a curve). Drill a funnel number into its cohort.
- **Per-hire spend** resolves to attributed hires; CSV export (`downloadFile`/`toCsv`, `AnalyticsTab.tsx:8`) produces the same figures.
- **Decision log** shows a real entry with basis + human oversight Lucie could hand to an auditor.
- **Bilingual:** cs throughout (enum labels via `useEnumLabel`); no English leaking into the cs dashboard.
- **Rendering:** charts/meters/calibration panel render in both themes.

## Out of scope / known
- Forecast/momentum projection math is unit-tested (`analytics-forecast.test.ts` etc.) — trust the units, judge the surfaced output.
- Targets editing flow (set conversion/TTH goals) is adjacent; the headline is "numbers tie + scores calibrate".
