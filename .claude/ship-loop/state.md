# Ship Loop — state

## Context refresher
- App: kp — "KP studio, talent matching": Next.js 16 + React 19 hiring workspace (18 tabs) + Python jobfit pipeline; better-sqlite3; 3 LLM engines; Polar billing; dual-theme; en+cs. Branch main.
- Ship bar (CP3, user): PUBLIC PRODUCT PATH. Verdicts V1+V2+V4a+V4b adopted. Now executing via the ENTERPRISE E-track (E0-E6, docs/ENTERPRISE_READINESS.md) which subsumes the tenancy pillar.
- RESUMED at CP7 (2026-07-05). During the CP6→CP7 pause, PARALLEL CLI sessions shipped 13 enterprise commits (E0 tenancy P1, E3 brand, E4 self-host/offline/model-endpoints/Helm/slim, Postgres audit) WITHOUT the loop's gate → CI went red on every push today. M7 = reconcile & re-green.
- SYNCED: local main == origin/main == 222bedf (M7 re-green 6e3ac90/7873b39/6fcd7d6 → M8 landing launch 284aebd SEO + 222bedf gate). A parallel session is still authoring the tenancy Phase 2 WIP (uncommitted: jobs/group_evals/pipeline/analytics/profiles/offers/sim scoping + tests) — LEFT for that session, not the loop's to commit.
- M8 LANDING LAUNCHED (item 3 ☑): '/' server-gates landing↔dashboard (real session / kp_entered marker), open-mode entry (no 503 lock-out), all dead CTAs rewired, SEO added, theme pre-paint decoupled. Verified live + full gate green. Follow-up: public demo CTA still tenancy-blocked (KP_DEMO_ENABLED).
- OPEN USER ACTIONS: item 6 rotate .env.local keys (still open since CP1) · E-track go-forward (finish E0→E1 SSO vs return to product pillars) · confirm the tenancy P2 WIP is the parallel session's to land.
- ⚠ GOVERNANCE: parallel sessions committing straight to main bypass the loop's green-gate discipline (root-caused CI red all day). M7's .npmrc fix restores cold-install; going forward the gate must run before pushes.

## Scorecard (updated at CP7, 2026-07-05 — post-M7 re-green; enterprise E-track folded in)
Deltas since CP6: Ops deploy story DONE (E4 self-host/Helm/slim) BUT CI regressed red all day (parallel pushes bypassed the gate) → M7 restored it (npm-ci ERESOLVE + react-is + lint + prerender). Tenancy (dim 2/6) advancing via E0 (P1 done, P2 in WIP). Dims below still reflect the day-1 baseline except where noted.
| # | Dimension | Score | Evidence | Top gaps |
|---|-----------|-------|----------|----------|
| 1 | Build & types | 🟢 | typecheck 0 · lint 0 err · unit 1237 · py 717 · build ✓ · e2e 5/5 | 373 lint warnings |
| 2 | Functional completeness | 🟢 | sim live-proven; delivery-honest surfaces; locale everywhere; canonical score | PILLARS: comms delivery (1), tenancy (2), landing (3) — the ship bar |
| 3 | Tests | 🟢 | 1237 unit (+182 day-1) + 717 py (+22); CI green | analytics/devcase/interviews stores; comms callbacks |
| 4 | Simulated UAT | 🟢 | full run (238 findings) + 11/11 uat bug items FIXED same-day (28-38 all ☑) | re-run /uat after pillars to re-certify |
| 5 | Billing & LLM value | 🟢 | ledger COMPLETE (flagship + github + voice + deterministic fallbacks) + usage panel + canonical score + acting-score calibration (n 0→21) + prompt bounds | Polar end-to-end still sandbox (pillar-adjacent) |
| 6 | Auth & security | 🟡 | decisions gated; voice leak fixed; GDPR links absolute; spend throttled; match-0 dead | ships OPEN over PII (tenancy pillar); LIVE keys → USER rotate (6) |
| 7 | UX/UI polish | 🟢 | route chrome, toasts, honesty vocabulary, provenance labels, mobile fixes | recipe drive (24, cut candidate) |
| 8 | Ops readiness | 🟢 | deploy story DONE (E4 self-host: Dockerfile+guide, Helm chart, image 1.78GB→465MB, KP_OFFLINE, self-hosted model endpoints); CI RESTORED at CP7 (was red all day) | CI-discipline regression (parallel pushes skipped the gate); Node-20 action SHA bump (cosmetic); engine-preflight readiness dot (follow-up) |
| 9 | Value & market reality | 🟡 | value-case.md verdicts adopted; unit econ proven | execute Teamio spike (25) + AI-Act pack (26; clock 2026-08-02) |

## Day-1 ledger (2026-07-02 → 03)
M1 correctness+cost (4,7,8,9,12,15,21) · M2 tests+CI (5,10,11) · M3 UX+value lens (14,18,19,20) · M4 full /uat (13) · M5 bug waves (28-32,34-38) · M6 quick wins (16,17,22,23,33)
Commits: cf0d63c 8ef6392 d903e8d 517ff33 2ae3f01 ff68217 30f4c3e 5b11553 3c65bcb d21320a → merge 3395b4c (PUSHED, CI green) → 11aa76e b5aa2ad 9fbd384 3f03857 (PUSHED at CP6)
Interruptions: session limit ×3 (M3 agents, M4 uat ×2) — all resumed from transcript/checkpoint, zero work lost.

## Enterprise E-track ledger (2026-07-04→05, PARALLEL sessions — outside the loop's gate)
13 commits d359dc3→3fe42f1: M2 backgrounded JD gen · org/multiuser + CV-intake + channels studio (9925545) · E4 self-host packaging+guide (185a502) · E5 self-hosted model endpoints (a3f0c85) · E4b KP_OFFLINE no-egress (f7d8c97) · E3 Postgres seam audit (2a5f7a4) · E3 brand/white-label (dc21fdd, a14db7d) · E-slim image (eec5a92) · E-SH-2 Helm (c792dc4) · E0 tenancy P1 campaign_packs+jobs+group_evals (3fe42f1). Effect: deploy story (#27) effectively DONE; tenancy (#40/#2) underway. Cost: pushed red — CI failed every run.

## M7 re-green ledger (2026-07-05, CP7)
M7 reconcile & re-green — mine: 6e3ac90 (useOrgMembers set-state-in-effect + /invite instant=false) · 7873b39 (.npmrc legacy-peer-deps → the actual CI-red root cause: npm ci ERESOLVE on the pinned next canary) · 6fcd7d6 (react-is direct dep — legacy-peer-deps had dropped recharts' peer, breaking the build). Parallel session in the same window: 6e6a534 (market-pulse ISPV salary anchors). Tenancy P2 WIP still uncommitted (parallel session's). RESULT: CI GREEN on 6fcd7d6 (run 28745269439, 2m26s) — first green all day. main==origin==6fcd7d6.

## Remaining backlog (open)
- PILLARS: 1 comms delivery (M) · 3 landing launch (M) still open. 2 tenancy (L) NOW IN PROGRESS via E0 (P1 committed: campaign_packs/jobs/group_evals; P2 in parallel-session WIP: pipeline/analytics/profiles/offers/sim + tests).
- ENTERPRISE E-track (docs/ENTERPRISE_READINESS.md): 40 E0 tenancy IN PROGRESS · 44 E3 brand DONE · 45 E4 self-host DONE (subsumes 27 deploy story) · 41 E1 SSO/RBAC, 42/43 E2 audit+GDPR, 46 E5 SOC2, 47 E6 org-billing OPEN · Postgres seam audit done (E3/§).
- 25 Teamio spike (M) · 26 AI-Act pack (M, clock 2026-08-02) · 24 recipe drive (cut candidate) · 6 USER: rotate keys (STILL OPEN).
- Follow-ups: ci.yml Node-20 action SHA bump (annotation, cosmetic); engine-preflight BYOM-aware readiness dot; going forward — RUN THE GATE before pushing (parallel-session discipline gap that reddened CI).

## Checkpoint history
- CP0-CP2 AFK (M1-M3) · CP3 USER: ship bar/merge+push/verdicts/M4 · CP4 AFK (M5 bug waves) · CP5 AFK (M6 quick wins, push held) · CP6 (2026-07-03): LOOP PAUSED — final report delivered; awaiting push decision, key rotation, tenancy go/no-go.
- CP7 (2026-07-05): RESUME. Reconciled 13 parallel enterprise commits shipped during the pause (CI red all day). M7 = reconcile & re-green: fixed lint (set-state-in-effect), /invite prerender, and the real CI-red root cause (npm ci ERESOLVE on pinned next canary → .npmrc legacy-peer-deps + react-is direct dep). Pushed 6e3ac90/7873b39/6fcd7d6. Feature WIP (tenancy P2) left to the parallel session. Then user → "product pillar" → "landing launch" = M8.
- CP8 (2026-07-05): LOOP PAUSED. M8 landing launch shipped (284aebd SEO + 222bedf gate: server-gate '/' + open-mode entry + CTA rewiring + theme decouple), verified live + CI green. Day-3 = M7 (CI restored) + M8 (landing live). User → "Pause here". Re-invoke to resume; open threads: tenancy P2 (parallel session), item 6 keys (USER), demo-CTA tenancy unblock, comms delivery (1), E1 SSO.
