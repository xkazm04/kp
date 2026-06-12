# Biz+UI Scan — kp, 2026-06-12

> Combined **Business Visionary 🚀 + UI Perfectionist 🎨** value scan: each context audited once through both lenses, capped at the 5 highest-value NET-NEW findings (prior feature-scout/bug-hunt campaigns deduped).
> 22 parallel subagent runs, batched in waves of 8 / 8 / 6.

---

## Totals

| | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|
| Across 22 contexts | 32 | 63 | 13 | **108** |
| Share | 30% | 58% | 12% | 100% |

Severity = **value** in this scan (High = clear hiring-outcome or differentiation impact; Medium = meaningful quality/efficiency; Low = polish). Counts verified two ways: `> Total:` header sum = 108, `**Severity**:` bullet count = 108.

---

## Per-context breakdown

(Sorted by Highs desc, then total.)

| # | Context | High | Med | Low | Total | Report |
|---|---------|---:|---:|---:|---:|--------|
| 1 | JD Library & Builder | 3 | 2 | 0 | 5 | [jd-library-builder.md](jd-library-builder.md) |
| 2 | Dev Case Studio (UI) | 2 | 3 | 0 | 5 | [dev-case-studio-ui.md](dev-case-studio-ui.md) |
| 3 | Dev Case Orchestration & API | 2 | 3 | 0 | 5 | [dev-case-orchestration-api.md](dev-case-orchestration-api.md) |
| 4 | Dev Case Python Engine | 2 | 3 | 0 | 5 | [dev-case-python-engine.md](dev-case-python-engine.md) |
| 5 | GitHub Code Analysis | 2 | 3 | 0 | 5 | [github-code-analysis.md](github-code-analysis.md) |
| 6 | Voice Interview Runtime | 2 | 3 | 0 | 5 | [voice-interview-runtime.md](voice-interview-runtime.md) |
| 7 | Job Catalog, Ingestion & Sourcing | 2 | 2 | 1 | 5 | [job-catalog-sourcing.md](job-catalog-sourcing.md) |
| 8 | Analytics & Diagrams | 2 | 2 | 1 | 5 | [analytics-diagrams.md](analytics-diagrams.md) |
| 9 | Data Layer, Schemas & Python Bridge | 2 | 2 | 1 | 5 | [data-layer-python-bridge.md](data-layer-python-bridge.md) |
| 10 | Interview Prep & Rubric | 2 | 2 | 0 | 4 | [interview-prep-rubric.md](interview-prep-rubric.md) |
| 11 | CV Analysis Workspace | 1 | 3 | 1 | 5 | [cv-analysis-workspace.md](cv-analysis-workspace.md) |
| 12 | Analysis Results & Reporting | 1 | 3 | 1 | 5 | [analysis-results-reporting.md](analysis-results-reporting.md) |
| 13 | Decision Workflow & Group Eval | 1 | 3 | 1 | 5 | [decision-workflow-group-eval.md](decision-workflow-group-eval.md) |
| 14 | Candidate-Job Matching & Fit Matrix | 1 | 3 | 1 | 5 | [matching-fit-matrix.md](matching-fit-matrix.md) |
| 15 | Automation Orchestration | 1 | 3 | 1 | 5 | [automation-orchestration.md](automation-orchestration.md) |
| 16 | Conversational Apply | 1 | 3 | 1 | 5 | [conversational-apply.md](conversational-apply.md) |
| 17 | Candidate Profile Builder | 1 | 4 | 0 | 5 | [candidate-profile-builder.md](candidate-profile-builder.md) |
| 18 | Pipeline Board & Scheduler | 1 | 4 | 0 | 5 | [pipeline-board-scheduler.md](pipeline-board-scheduler.md) |
| 19 | Demo Simulation & Channels | 1 | 4 | 0 | 5 | [demo-simulation-channels.md](demo-simulation-channels.md) |
| 20 | Scoring & Extraction Engine | 1 | 2 | 2 | 5 | [scoring-extraction-engine.md](scoring-extraction-engine.md) |
| 21 | Scheduling & Offers | 1 | 2 | 1 | 4 | [scheduling-offers.md](scheduling-offers.md) |
| 22 | Workspace Shell & Shared UI | 0 | 4 | 1 | 5 | [workspace-shell-shared-ui.md](workspace-shell-shared-ui.md) |

---

## All 32 High findings — one-line summary

Sorted into triage themes. Each item links to its full entry in the per-context report.

### A. Reach every candidate — comms delivery gaps
1. **Scheduling & Offers — Deliver the self-scheduling link through comms** — the only candidate token link that is never auto-dispatched; recruiters copy-paste it or the candidate never sees it. `app/api/schedule/invite/route.ts:26`
2. **Demo Sim & Channels — Tell knockout-declined channel leads the outcome** — `lead-intake.ts` holds the email but returns `declined` without dispatching; highest-volume channel ghosts. `app/_lib/lead-intake.ts:64`
3. **Dev Case Orchestration — Preserve contact + locale at promote** — post-promotion interview/offer/rejection comms address a free-text name, in English. `app/_lib/devcase-run.ts:581`
4. **Dev Case Studio — Require/surface candidate contact** — the take-home funnel can produce a winner you cannot reach. `app/devcase/apply/[token]/DevApplyForm.tsx:24`

### B. Honest automation — trust, attribution, audit integrity
5. **Analytics — Fix auto/human attribution** — `advanced` is written by both human accepts and automation but mapped "auto"; the "automation handled X%" headline is structurally wrong. `app/_lib/decision-attribution.ts:16`
6. **Decisions — Split human advances from automated advances** — same root as #5 (one fix closes both). `app/_lib/decision-attribution.ts:16`
7. **Automation — Supervised mode for clock auto-rejects** — the scheduled pass emails rejections fully unattended; no `rejection_review` queue rung on the trust ladder. `app/_lib/automation-pass.ts:237-263`
8. **Analytics — Count knockout discards in the funnel** — `ko_declined` recorded but consumed nowhere; top-of-funnel loss invisible. `app/_lib/db.ts:2943`
9. **DevCase Python — Stop shipping degraded seeds/scenarios as healthy** — bare `except` bypasses the provenance contract; prose-only seeds reach candidates as green. `pipeline/jobfit/devcase/seed_materializer.py:190`
10. **DevCase Python — Make observed-skill minting honest** — weight-1.0 skills minted ignoring confidence; ALL must-haves credited even when transfers match none. `pipeline/jobfit/live_case.py:87`
11. **Dev Case Studio — Persist recorded outcomes** — hire/reject lives in component-local state; reloads invite duplicate `dev_outcomes` rows that bias promote-floor calibration. `app/features/sub_dev/SubmissionRow.tsx:94`

### C. Real corpus, real data — intake & matching correctness
12. **Matching — Match tab sees only the demo corpus** — recruiter-ingested jobs never reach `match_cli`; the marquee feature ranks against seed data. `pipeline/jobfit/match_cli.py:44`
13. **Job Catalog — Stop advertising a fabricated salary** — the ad's actual stated pay is ignored in favor of an estimated band. `pipeline/jobfit/jobs.py:324`
14. **CV Workspace — Stop tagging JD-blind runs with the JD slug** — failed JD body fetch silently scores JD-blind yet persists role-tagged history. `app/features/sub_analyze/useAnalyzeJdLibrary.ts:45`
15. **Conversational Apply — Thread lead identity through quick-apply** — returning leads re-type everything; a typo'd email forks a duplicate pipeline row. `app/api/apply/[id]/quick/route.ts:85`
16. **Job Catalog — Show lifecycle state where links are minted** — closed roles still hand out apply links that 410. `app/features/sub_jobs/JobPostingModal.tsx:122`
17. **JD Library — Stop showing candidates' names + scores on the public JD page** — PII/GDPR leak to anyone with the shared link. `app/jds/[slug]/page.tsx:118`

### D. Close the loop — dead ends in the recruiter workflow
18. **JD Library — Rehydrate a finished jd_build task** — the generated JD is unreachable after a tab switch. `app/features/tasks/TasksTab.tsx:483`
19. **Interview Prep — Regenerate blanks then destroys preserved notes/checklist/interviewer** — client clears what the server now carries forward; next debounced PUT clobbers. `app/features/sub_schedule/InterviewPrepModal.tsx:130`
20. **Interview Prep — Human-verdict candidates vanish from the Schedule tab** — `scorecard_review` + no transcript renders in neither list. `app/features/sub_schedule/ScheduleTab.tsx:96`
21. **Voice Interview — Give the candidate a real ending** — completed interviews end on a dead "Start again" button that 409s. `app/_components/voice/VoiceInterview.tsx:666`
22. **Voice Interview — "Interview in progress" button revokes the live call** — re-create mid-call kills the session and buries the finished transcript. `app/features/sub_schedule/ScheduleTab.tsx:275`
23. **Pipeline Board — Persistent per-candidate recruiter notes** — the drawer's only textarea is ephemeral AI-scorecard fuel; call notes have no home. `app/features/sub_pipeline/CandidateDrawer.tsx:594`
24. **Profile Builder — Route to recruiter-created archetypes** — the builder only routes to the built-in set. `app/features/sub_profile/ProfileTypes.ts:86`

### E. Evidence to decisions — computed-but-dark data
25. **GitHub Analysis — Feed persisted GitHub evidence into AI screen/prep/scorecard** — the auto-advance gate is blind to corroborated-vs-unverified skills the system already computed. `app/_lib/automation-run.ts:134`
26. **GitHub Analysis — Let board candidates gain GitHub evidence** — no handle capture at apply, no drawer run action; apply-path candidates structurally excluded. `app/_lib/apply-intake.ts:213`

### F. Platform safety & reliability
27. **Data Layer — Re-run migrations after a workspace restore** — an older backup leaves "no such column" until full server restart while the UI says reload suffices. `app/_lib/db-portability.ts:163-180`
28. **Data Layer — Fast lane for interactive AI actions** — a single global 2-slot queue lets Gemini batch runs starve interactive Claude actions. `app/_lib/tasks.ts:32`
29. **Scoring Engine — Wire the transient-failure retry into `grounded_answer`** — the documented retry helper has zero callers; one 429 blip aborts a 60–90s analysis. `pipeline/jobfit/gemini.py:191`
30. **Automation — (Medium #2 escalation candidate) auto-reject notification failures silently ghost** — tracked in theme A wave as the comms-failure marker fix. *(listed here for cross-reference; severity Medium in report)*

### G. Bilingual product — candidate-facing English seams
31. **JD Library — Localize the public JD page chrome** — the one candidate-facing surface still hardcoded English. `app/jds/[slug]/page.tsx:79`
32. **Dev Case Orchestration — Render dev-case comms + brief headings in the case's language** — DEVP5 threaded `--lang`, the chrome didn't follow. `app/_lib/distribution.ts:80`

*(Print-artifact High from Analysis Results — `ReportActions.tsx:36` — slots into the shell/report UX wave, theme I below.)*

---

## Triage themes

| Theme | Approx count | Why this is a wave, not just individual fixes |
|---|---:|---|
| A. Reach every candidate (comms delivery) | 8 | One mental model: every candidate-facing artifact must dispatch through `sendComm`/outbox with a durable event marker — 4 Highs share it |
| B. Honest automation (attribution/audit/calibration) | 11 | Shared invariant: what the audit trail claims must match what happened; `decision-attribution`, decision log, dev-outcomes calibration all read the same event vocabulary |
| C. Real corpus, real data (intake/matching correctness) | 10 | All fixes defend the same promise: scores/ads/links reflect actual current data, not seed data or stale state |
| D. Close the loop (workflow dead ends) | 10 | Same UX grammar: every async artifact needs a route back to it; every state transition needs its UI representation |
| E. Evidence to decisions (dark data) | 8 | The repo-signal differentiator: evidence the system computes must reach the surfaces/automations that decide |
| F. Platform safety (restore/retry/queue) | 10 | Engine-room reliability invariants; mostly `_lib` + Python, no UI design decisions |
| G. Bilingual seams (i18n leftovers) | 12 | Mechanical application of the established localize-display-keep-the-key patterns from the i18n campaign |
| H. Candidate theme register (Spark Dark leaks + token compliance) | 9 | One decision (what theme do candidates get?) unlocks 4 fixes; rest are token-compliance sweeps |
| I. Shell & report UX (print, deep links, mobile, charts) | 11 | Recruiter-perception polish sharing the shell/design-system vocabulary |
| (unthemed Mediums/Lows) | ~29 | Sweep candidates after the themed waves |

---

## Suggested next-phase split

Waves sized 5–7 fixes, one mental model each. Waves 1–6 close all 32 Highs; 7+ are value-ordered Mediums.

| Wave | Theme | Fixes | Highs closed |
|---|---|---|---|
| 1 | **A — Reach every candidate**: sched-link dispatch, KO-decline comms, promote contact+locale, dev-apply contact required, auto-reject failure marker, dead-letter alarm clear | 6 | 4 |
| 2 | **B1 — Honest attribution**: decision-attribution split (closes 2 Highs at one root), supervised auto-reject mode, decision-log applied/failed/skipped, KO discards in funnel, wave outcome detail | 6 | 4 |
| 3 | **C — Real corpus, real data**: match corpus, fabricated salary, JD-blind runs, quick-apply identity, dead apply links, public JD PII leak | 6 | 6 |
| 4 | **D — Close the loop**: jd_build rehydrate, prep regenerate desync, human-verdict visibility, voice ending, in-progress revoke, pipeline notes | 6–7 | 7 (incl. archetype routing) |
| 5 | **B2+E — Honest evidence**: degraded-seed provenance, observed-skill minting, outcome persistence (+API dedupe), GitHub→AI screen, GitHub for board candidates | 6 | 5 |
| 6 | **F — Platform safety**: restore migrations, task fast lane, grounded retry, pre-restore snapshot, transcript-save retry, board-unmount guard | 6 | 3 |
| 7 | **G — Bilingual seams**: public JD chrome, dev-case comms lang, + highest-value Mediums (progress panel, scorer prose, group-eval narrative, policy reasons) | 6 | 2 |
| 8 | **H — Candidate theme register** (decision + token sweeps) | 5–6 | 0 |
| 9 | **I — Shell & report UX** (print artifact High, tab deep-link, command surface on detail pages, CSV full export) | 5–6 | 1 |

---

## How this scan was run

- **Scanner prompts**: Vibeman registry `business-visionary.ts` + `ui-perfectionist.ts` role definitions, blended into one per-context subagent with a combined ≤5-findings value cap (user-specified).
- **Date**: 2026-06-12. **Scope**: all 22 contexts from the 2026-06-01 context scan (`docs/contexts/scan-report-2026-06-01.md`), full-stack (app + pipeline).
- **Method**: 22 isolated general-purpose subagents in 3 waves (8/8/6), each reading its prior feature-scout reports first (net-new discipline), each writing one report file; orchestrator read only terse replies.
- **Dedup**: prior campaigns (bug-hunt 06-07, feature-scout 06-08 + 06-10, Erika backlog) + the global known-deferred list were excluded at the prompt level; agents verified shipped findings before flagging.
- **Files read by subagents**: ~440 (sum of reported approximates).
- **Verification**: header sum (108) = severity bullet count (108); severity distribution 32H/63M/13L.
- **Baseline at scan time**: tsc 0 errors, unit 719/719 pass, git clean on `main` @ 529f7a0.
