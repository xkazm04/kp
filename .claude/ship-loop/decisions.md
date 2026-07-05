# Decisions log

## User-decided
- 2026-07-02 — Boot a FRESH ship-loop on kp; prior ai-bookkeeper state archived (user chose "Boot fresh on kp" when the copied state was found to belong to a repo absent from this machine).

## CP0 — boot (2026-07-02) — USER AFK AT CHECKPOINT, provisional defaults applied
- Ship bar: DEFERRED (existential, not auto-decidable) → re-ask at CP1. M1 chosen to be valid under all three candidate bars.
- Cadence: Milestone (recommended default, provisional)
- UAT depth: deterministic e2e only (keyless, no LLM spend without approval); e2e+Gemini smoke and /uat re-offered at CP1
- Milestone 1 = "correctness + cost visibility": items 4, 7, 8, 9, 15, 21 + gate incl. deterministic e2e (item 12). Item 6 (key rotation) is a USER ACTION — flagged for CP1.
- Work happens on branch ship-loop/m1 (main is the default branch; per-item commits land there, merge decision at CP1)

## Auto-decided (pending user review at CP0/CP1)
- 2026-07-02 — Dimension 5 kept as "Billing & LLM value" (kp genuinely has a Polar billing layer + LLM cost surface; not just an analog).
- 2026-07-02 — Dimension 9 seeded with the prior UAT industry-locked finding (bank/Czech/tech, 0/20 cohort) instead of re-running the cohort at boot.
- 2026-07-02 — Boot gate scope: typecheck/lint/unit/python/build only; e2e + /uat deferred to backlog items 12-13 (key- and time-gated).
- 2026-07-02 — Left both running dev servers untouched (:3000 Vibeman, :3001 kp); build proved non-conflicting.
- 2026-07-02 — Lint's 373 warnings excluded from item 4 scope (errors only) to keep M1 small.

## CP1 (2026-07-02) — USER AFK AT CHECKPOINT, provisional defaults applied
- Ship bar: STILL DEFERRED (existential) → re-ask at CP2. M2 chosen to be valid under all candidate bars.
- Milestone 2 = "Tests & CI": items 5 (CI workflow), 10 (store behavioral tests), 11 (API handler tests).
- Merge to main: NOT while user is AFK — M2 stacks on ship-loop/m1; merge re-offered at CP2.
- UAT depth: stays deterministic e2e only (no LLM spend without approval).
- Item 6 (rotate .env.local keys) remains an open USER ACTION.

## CP2 (2026-07-02) — USER AFK AT CHECKPOINT, provisional defaults applied
- Ship bar: STILL DEFERRED (4th ask at CP3).
- Merge/push: NOT while AFK (push publishes + activates CI = outward-facing). M3 stacks on ship-loop/m1.
- Milestone 3 = "UX resilience + value lens": items 18 (route chrome), 19 (toast layer — auto-decision: build IN-HOUSE on framer-motion/tokens, no new dependency while AFK), 20 (SimBar wrap + ScheduleTab tokens), 14 (value lens → .claude/ship-loop/value-case.md as a LOOP artifact, not a repo doc, until user decides).
- Item 6 (rotate keys) still open USER ACTION.

## CP3 (2026-07-02) — USER PRESENT, real answers
- SHIP BAR (finally set): PUBLIC PRODUCT PATH — multi-tenancy (~28 tables), landing launch, billing enforcement, on top of the pilot bar (auth-on default, real comms delivery, deploy story). Items 1-3 upgrade from "decisions" to core work.
- Merge + push: YES — ship-loop/m1 (10 commits) merges to main and pushes to origin; CI activates.
- Value verdicts adopted: V1 (Teamio-wedge GTM), V2 (AI-Act-native positioning, clock 2026-08-02), V4a AND V4b — interpreted as sequenced: embrace the bank/regulated vertical as the wedge NOW, fund the multi-industry unlock as the growth path. (V3/V5/V6 not selected — V6 sellability gate is implied by the ship bar anyway.)
- Milestone 4 = full /uat character run (item 13) — LLM spend approved by explicit choice.
- Item 6 (rotate keys) still open USER ACTION.

## CP4 (2026-07-02, ~22:15) — USER AFK AT CHECKPOINT, provisional defaults applied
- M5 = "stop the bleeding": live-confirmed uat bugs 28,29,30,31,32,34,35,36,37,38 (item 33 match-single-source deferred to M6 — architecturally deeper). Two agent waves (K/L/M then N/O) to spread session-limit burn.
- Pillar order M6+: tenancy (2) → delivery (1) → landing (3), with 25/26/27 alongside; re-ask at CP5.
- uat run evidence committed to main (11aa76e) per repo convention (prior runs are committed; shots gitignored).

## CP5 (2026-07-03, ~00:00) — USER AFK AT CHECKPOINT, provisional defaults applied
- Push of 11aa76e + b5aa2ad + 9fbd384: HELD (outward-facing; CP3 approval covered that one push, not standing). Re-offer when user returns.
- M6 = quick wins (16 voice attribution, 17 github retry+BYOM, 22 deterministic ledger rows, 23 prompt bounds, 33 score single-source) → then LOOP PAUSES pending user green-light for the tenancy pillar (L, better supervised).

## CP6 push (2026-07-03) — USER decision
- "Push the commits and wrap there for now" → pushed 11aa76e/b5aa2ad/9fbd384/3f03857 to origin/main; CI run 28645194227 triggered. Loop paused; NO new milestones started. Push held-at-CP5 now resolved.
