# Ship Loop — state

## Context refresher
- App: kp — "KP studio, talent matching": Next.js 16 + React 19 hiring workspace (18 tabs) + Python jobfit pipeline; better-sqlite3; 3 LLM engines; Polar billing; dual-theme; en+cs. Loop's home branch: main.
- Ship bar (CP3, user): PUBLIC PRODUCT PATH. Verdicts V1+V2+V4a+V4b adopted; ENTERPRISE E-track (docs/ENTERPRISE_READINESS.md) subsumes the tenancy pillar.
- SKILL ADOPTED (CP9, 2026-07-27): procedure now codified in .claude/skills/ship-loop/SKILL.md (adapted back from the personas repo's codification). State stays here.
- RESUMED at CP9 (2026-07-27) after the CP8 pause. Since CP8, parallel sessions shipped 11+ commits to main out-of-band (comms delivery + failure-truth, apply intake integrity, calibration holdout, matching evidence-gating — see git log 222bedf..283c5c1). Local main 283c5c1 is 4 commits AHEAD of origin/main 7ac77a8 (unpushed).
- WORKSPACE (CP9, user): loop executes in worktree C:/Users/kazda/kiro/kp-m9 on branch ship-loop/m9 (off local main). The primary checkout sits on vibeman/ambiguity-ui-wave1 with ~60 uncommitted foreign files — NOT the loop's to touch. main is also checked out in .claude/worktrees/perfect-merge.
- M9 (user pick): AI-Act pack (26) + CI-discipline guard (50) + premise-sweep (1/2/40). EXECUTED — commits on ship-loop/m9: e9ebb52 (50 pre-push gate hook), 0417b1b (51 relay env docs), 501f95d (26 docs/AI_ACT_CONFORMITY.md), abba8ce (reconcile: 7 lint errors ungated pushes left on main — lint is NOT in ci.yml, which is why CI stayed green while lint rotted; the new hook closes this).
- Gate (M9): typecheck ✓ · lint 0 err (390 warn) · unit 2425/2425 · python gate ✓ · build ✓ · e2e 5 passed/7 key-gated — FULL GREEN. The e2e suite had been unrunnable since M8 (dead dev-auth seed + 3 UI drifts) — repaired in e027e70; spawned items 54/55. M9 = 5 commits on ship-loop/m9: e9ebb52, 0417b1b, 501f95d, abba8ce, e027e70.
- CP10 (user): MERGE+PUSH ✓ (rebased onto the again-moved main — 6 more out-of-band commits; item 51 dropped as subsumed by 7004983) and M10 = AI-Act code closure ✓. CI RE-GREENED (run 30268242229, first green since 07-09; fixes: numpy dep, skip baseline 5 in run_gated + ci.yml env).
- M10 EXECUTED (agent-built, orchestrator-verified, all on ship-loop/m9→main): d531dad item 53 (neutrality INVARIANT HOLDS byte-identically across cs/vi/uk/ar/Roma names + sentinel; calibration_drift Art.72 seed) · 3f49c4c item 52 (AiDisclosure complete + candidate Art.86 redacted decision history) · 7eeedd8 items 54+55a (create CTA both projections; 4 Selects aria-labeled). Gate FULL GREEN incl. e2e 5/5. Pushed 9c219f7→7eeedd8.
- AI-Act pack status post-M10: ALL code gaps closed (G3, G9, G10-seed, G11, plus 54/55a hygiene) — remaining gaps are documentation/process (G1 risk-mgmt doc, G2 Annex IV/instructions-for-use, G4/G5/G7 audit epic, G13 posture doc, G14 CE scaffolding) + 55b dock overlap (diagnosed, cheap fix known).
- OPEN USER DECISIONS at CP11: (a) item 6 rotate .env.local keys (open since CP1); (b) next milestone — candidates: G1/G2 conformity DOCS (writing work, evidence exists; completes the AI-Act story), 41 E1 SSO (L), 25 Teamio spike, 42/43 E2 audit+GDPR, 55b dock fix (S).

## Scorecard (updated at CP9/M9, 2026-07-27)
Deltas since CP7/CP8: tenancy DONE (dim 2/6 ↑), comms delivery DONE out-of-band (dim 2 pillar closed), AI-Act pack DONE (dim 9 ↑), lint discipline restored + guarded (dim 1/8).
| # | Dimension | Score | Evidence | Top gaps |
|---|-----------|-------|----------|----------|
| 1 | Build & types | 🟢 | typecheck 0 · lint 0 err (M9 re-green; was 7 err from ungated pushes) · unit 2425 · build ✓ | ~390 lint warnings; lint absent from ci.yml (hook covers pushes; add to CI later) |
| 2 | Functional completeness | 🟢 | ALL 3 PILLARS CLOSED: comms delivery (relay+callback, verified), tenancy E0 (0 gaps, fail-closed guard), landing launched (M8) | relay config UI (51 residual); public-demo CTA KP_DEMO_ENABLED flip |
| 3 | Tests | 🟢 | 2425 unit (+1103 since day-1) + python gate; ~20 tenancy test files; e2e restored 5/5 (had rotted unnoticed since M8 — nothing runs it but the loop) | name-neutrality eval missing (53); e2e not in CI (keys — deterministic subset could run keyless) |
| 4 | Simulated UAT | 🟡 | day-1 full run + fixes still stand; heavy churn since (comms/tenancy/matching) unrecertified | re-run /uat to re-certify post-pillar reality |
| 5 | Billing & LLM value | 🟢 | ledger complete + usage panel + calibration holdout clean arm (out-of-band) | Polar e2e still sandbox; E6 org billing |
| 6 | Auth & security | 🟡→🟢 | tenancy DONE + identity layer (orgs/memberships/invites/roles); decision chains per-tenant HMAC | E1 SSO (41), E2 audit_events (42), USER: rotate keys (6) |
| 7 | UX/UI polish | 🟢 | (unchanged from CP7) + honest no-relay labeling everywhere | AiDisclosure missing on /status + /onboarding (52) |
| 8 | Ops readiness | 🟢 | CI green; deploy story done; NEW: pre-push gate hook prevents the CP7 ungated-push failure mode | lint not in ci.yml; SIEM/audit export (42) |
| 9 | Value & market reality | 🟢 | AI-Act conformity pack SHIPPED (docs/AI_ACT_CONFORMITY.md) 6 days before the 2026-08-02 applicability date; verdict: Art.14+12 posture strong, gaps mostly docs/process (G1-G14 register) | Teamio spike (25); risk-mgmt doc G1; instructions-for-use G2 |

## Ledgers (compressed — day-1..3 detail in journal.md + archive)
- Day-1 (07-02/03): M1-M6, commits cf0d63c→3f03857. Day-2/3 (07-04/05): 13 parallel enterprise commits (E0 P1/E3/E4) + M7 re-green (6e3ac90/7873b39/6fcd7d6) + M8 landing (284aebd/222bedf).
- Out-of-band (07-05→07-27): 222bedf→283c5c1 incl. comms delivery/callback/failure-truth, apply intake, calibration holdout + leakage disclosure, matching evidence-gating (docs/SCORING_REBASELINE.md), group-eval governance. Last 4 (3a1ad8a/c87def0/283c5c1 + f911815) UNPUSHED on local main.
- M9 (07-27, worktree kp-m9, branch ship-loop/m9): e9ebb52 · 0417b1b · 501f95d · abba8ce. Gate green (e2e note in journal).

## Remaining backlog (open)
- 6 USER: rotate keys (open since CP1) · 24 recipe drive (cut candidate) · 25 Teamio spike · 41 E1 SSO (L) · 42 E2a audit (L) · 43 E2b GDPR/DPA (M, now seeded by the AI-Act pack's G1/G2) · 46 E5 SOC2 (L) · 47 E6 org billing (M) · 51 relay config UI residual (S) · 52 AI-Act candidate surfaces (M) · 53 neutrality eval + drift alarm (M).

## Checkpoint history
- CP0-CP2 AFK (M1-M3) · CP3 USER: ship bar/verdicts · CP4-CP5 AFK (M5/M6) · CP6 pause · CP7 (07-05) resume: M7 re-green · CP8 (07-05) pause after M8 landing.
- CP9 (2026-07-27): RESUME, user present. Skill adopted; workspace = worktree off main; M9 = AI-Act pack + CI guard + premise-sweep. All executed + gate green. HOLDS at CP10 for: merge/push decision, key rotation, next milestone.
