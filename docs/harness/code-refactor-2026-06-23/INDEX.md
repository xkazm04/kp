# Code Refactor Scan — kp, 2026-06-23

> A code-cleanliness audit (dead code · duplication · structure · cleanup) over **all 43 contexts** of the kp hiring platform (Next.js 16 / React 19 / better-sqlite3 + a Python `pipeline/jobfit/` engine).
> 43 parallel subagent runs, batched in waves of 8. Read-only scan — no source changed.

---

## Totals

| | Critical | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|---:|
| Across 43 contexts | 0 | 41 | 91 | 107 | **239** |
| Share | 0% | 17% | 38% | 45% | 100% |

Counts verified two ways (sum of `> Total:` headers = count of `**Severity**:` bullets = **239**).

By category:

| Category | High | Medium | Low | Total |
|---|---:|---:|---:|---:|
| **Duplication** (single-source violations) | 23 | 49 | 36 | **108** |
| **Dead code** (zero-consumer exports / unreachable branches) | 18 | 31 | 33 | **82** |
| **Cleanup** (stale comments, naming, magic literals) | 0 | 2 | 30 | **32** |
| **Structure** (god-files, misplaced helpers) | 0 | 9 | 8 | **17** |

No criticals is expected for a refactor lens — refactoring surfaces maintenance cost, not runtime failure. But ~8 of the Highs are **latent bugs hiding inside already-drifted duplicates** (see Theme A2), which is where the real value is.

---

## Per-context breakdown

(Sorted by High desc, then total desc)

| Context | C | H | M | L | Total |
|---|---:|---:|---:|---:|---:|
| shared-ui-design-system | 0 | 2 | 3 | 2 | 7 |
| cv-extraction-pipeline-services | 0 | 2 | 2 | 2 | 6 |
| dev-submissions-live-work-surface | 0 | 2 | 2 | 2 | 6 |
| github-evidence-cv-utilities | 0 | 2 | 2 | 2 | 6 |
| hiring-automation-scheduler | 0 | 2 | 3 | 1 | 6 |
| pipeline-test-suite-python | 0 | 2 | 3 | 1 | 6 |
| shared-utility-libraries | 0 | 2 | 1 | 2 | 5 |
| app-shell-navigation | 0 | 1 | 2 | 3 | 6 |
| auth-sessions-workspace-tenancy | 0 | 1 | 2 | 3 | 6 |
| candidate-profile-job-matching | 0 | 1 | 3 | 2 | 6 |
| communications-inbound-channels | 0 | 1 | 3 | 2 | 6 |
| dev-case-pipeline-python | 0 | 1 | 2 | 3 | 6 |
| evaluation-fairness-seed-data | 0 | 1 | 2 | 3 | 6 |
| jd-authoring-library-templates | 0 | 1 | 2 | 3 | 6 |
| job-postings-lifecycle | 0 | 1 | 3 | 2 | 6 |
| landing-marketing | 0 | 1 | 3 | 2 | 6 |
| llm-provider-layer-python | 0 | 1 | 2 | 3 | 6 |
| matching-transformation-engine | 0 | 1 | 3 | 2 | 6 |
| pipeline-board-candidate-drawer | 0 | 1 | 2 | 3 | 6 |
| pipeline-clis-script-bridges | 0 | 1 | 2 | 3 | 6 |
| plans-checkout-billing-ui | 0 | 1 | 3 | 2 | 6 |
| tasks-system-operations | 0 | 1 | 2 | 3 | 6 |
| analytics-calibration-dashboards | 0 | 1 | 2 | 2 | 5 |
| application-intake-apply-flows | 0 | 1 | 2 | 2 | 5 |
| billing-engine-webhooks | 0 | 1 | 2 | 2 | 5 |
| candidate-onboarding-hand-off | 0 | 1 | 0 | 4 | 5 |
| cv-analysis-workspace | 0 | 1 | 2 | 2 | 5 |
| dev-case-authoring-publishing | 0 | 1 | 2 | 2 | 5 |
| dev-lifecycle-cohort-outcomes | 0 | 1 | 2 | 2 | 5 |
| model-api-key-management | 0 | 1 | 2 | 2 | 5 |
| privacy-consent-provenance | 0 | 1 | 1 | 3 | 5 |
| screening-decisions-records | 0 | 1 | 2 | 2 | 5 |
| sourcing-campaigns-rediscovery | 0 | 1 | 2 | 2 | 5 |
| voice-interview | 0 | 1 | 2 | 2 | 5 |
| architecture-diagrams | 0 | 0 | 2 | 4 | 6 |
| data-store-persistence | 0 | 0 | 3 | 3 | 6 |
| offers-onboarding | 0 | 0 | 2 | 4 | 6 |
| analysis-result-panels | 0 | 0 | 3 | 2 | 5 |
| group-evaluation-fairness | 0 | 0 | 2 | 3 | 5 |
| guided-pipeline-simulation | 0 | 0 | 1 | 4 | 5 |
| interview-simulation-comparison | 0 | 0 | 3 | 2 | 5 |
| skill-matrix-coverage | 0 | 0 | 1 | 4 | 5 |
| interview-scheduling-prep-rubric | 0 | 0 | 1 | 3 | 4 |

---

## All 41 High findings — one-line summary, themed

### Theme A1 — Dead exported surface, safe to delete (zero consumers)
1. **shared-ui-design-system** — `ThemeSplit` component + its entire `.theme-light-only/.theme-dark-only` CSS mechanism, zero importers.
2. **shared-ui-design-system** — `DisclosureRow` component, zero importers.
3. **shared-utility-libraries** — `receiveSubmission` exported util superseded by guarded `intakeSubmission`, zero live callers.
4. **sourcing-campaigns-rediscovery** — `salaryBandError` exported but never called (covered by `normalizeSalaryBand`).
5. **hiring-automation-scheduler** — `APPROVAL_KIND_META` registry (+ `APPROVAL_KINDS`/`isApprovalKind`/`ApprovalKindMeta`), zero consumers.
6. **llm-provider-layer-python** — `LLMResult.raw` field written by 2/4 adapters, read by nobody.
7. **matching-transformation-engine** — `_DESCENDANTS`/`descendants()`/half the child-edge graph build, only test-referenced.
8. **pipeline-test-suite-python** — `mk_candidate()` factory in `_helpers.py` is dead while ~9 modules hand-roll `MatchCandidate(...)`.
9. **candidate-profile-job-matching** — the `"duplicate"` `EditorMode` and its UI branches are unreachable.
10. **communications-inbound-channels** — `isDeadLettered` helper dead; every consumer hand-rolls `status === "failed"`.
11. **dev-submissions-live-work-surface** — `SeedFiles` component dead (only its `SeedFile` type is imported).
12. **evaluation-fairness-seed-data** — `seed_jobs.py` generic spec-grid path superseded by `seed_jobs_csas.py`.

### Theme A2 — Drifted duplicates / dead branches that are LATENT BUGS (highest value)
13. **job-postings-lifecycle** — two `provLabel` copies; the fork drops the `observed` bucket → highest-trust provenance silently mislabeled "academic".
14. **dev-case-authoring-publishing** — sourcing-into-pipeline logic duplicated route↔orchestrator and drifted → "Source DB" candidates lose their `sourceChannel`.
15. **voice-interview** — server default-provider order (OpenAI-first) vs client order (ElevenLabs-first) disagree → inconsistent default provider.
16. **application-intake-apply-flows** — a 5th in-module copy of `APPLY_EMAIL_RE` has drifted from the constant it was meant to single-source.
17. **github-evidence-cv-utilities** — two GitHub-username parsers with the same grammar already drifted (one requires `https://`, one optional).
18. **pipeline-board-candidate-drawer** — `PipelineTypes.STAGES` is a divergent hand-maintained copy of canonical `PIPELINE_STAGES` (kept in sync by a comment).
19. **cv-extraction-pipeline-services** — `_generate_with_retry` is dead and `grounded_answer` bypasses it → the documented 429/5xx/timeout retry never runs in prod.
20. **auth-sessions-workspace-tenancy** — `/api/auth/logout` is a dead route; the only sign-out UI clears the dev gate, never POSTs it → prod sign-out can't clear the real cookie. (Wire, don't delete.)
21. **tasks-system-operations** — `commit_reflection` is a fully-registered task kind nothing ever creates (dead-but-reachable CLI-spawning handler).
22. **hiring-automation-scheduler** — retired AUTO1 `reject_mode`/`RejectMode` "auto" path still threaded through 3 layers (GDPR-sensitive dead knob).
23. **privacy-consent-provenance** — 3 `ConsentEventKind` values declared + schema-documented + i18n-mapped but never emitted.

### Theme B — Single-source consolidations (extract one shared helper; no behaviour change)
24. **analytics-calibration-dashboards** — 4 hand-written `hireRatePct` group-tally loops in `db/analytics.ts`.
25. **app-shell-navigation** — grouped nav-render block copy-pasted between `Workspace.tsx` and `WorkspaceNav.tsx` (only button vs link differs).
26. **billing-engine-webhooks** — `QUOTA_CODE` "stable branch key" exists but both consumers hardcode the `"quota_exceeded"` literal.
27. **candidate-onboarding-hand-off** — two hard-coded field-label maps for the same 6 questionnaire keys (already drifted).
28. **cv-analysis-workspace** — `JdSummary` duplicated verbatim across `AnalyzeTypes.ts` and `DevTypes.ts` (+ dead `preview`/`created_at`).
29. **cv-extraction-pipeline-services** — `_scan_json_values` + prose-JSON extraction duplicated across `gemini.py` and `claude_cli.py`.
30. **dev-case-pipeline-python** — four byte-identical `_generate` wrappers across analyze/design/evaluate/reflect.
31. **dev-lifecycle-cohort-outcomes** — `getPosting`/`getPostingByToken`/`listPostings` repeat an identical Posting row→object map.
32. **dev-submissions-live-work-surface** — `/api/devcase/seed/[id]` route has zero callers (page reads the seed directly).
33. **github-evidence-cv-utilities** — `safeLinkUrl` re-implements `safeHttpUrl` on a stale "must be dependency-free" premise.
34. **jd-authoring-library-templates** — `getJob → ingestJobAd` "re-sync linked job" block duplicated verbatim across PATCH + revisions routes.
35. **landing-marketing** — `DISPLAY`/`HAND` Spark font tokens re-declared in 3 files instead of imported from `tokens.ts`.
36. **model-api-key-management** — LLM use-case catalog duplicated TS (`LLM_USE_CASES`) ↔ Python (`USE_CASE_REQUIREMENTS`), guarded only by a comment.
37. **pipeline-clis-script-bridges** — stdio-reconfigure + `{error}` envelope hand-rolled in most CLIs despite a shared `_cli.py`.
38. **pipeline-test-suite-python** — canned-payload LLM provider stub copy-pasted across ~8 test modules (already drifted).
39. **plans-checkout-billing-ui** — triplicated CZK/USD price-rendering block in `BillingTab`.
40. **screening-decisions-records** — `policyVersion` template literal re-inlined inside `runScreenWave` instead of reusing its own const (audit/approval drift risk).
41. **shared-utility-libraries** — `safeHttpUrl` (XSS guard) re-implemented inline in `github-summary.ts` (same as #33, from the util side).

---

## Triage themes (suggested fix-wave split)

| Theme | Findings | Why it's a coherent wave |
|---|---|---|
| **A2 — Latent-bug drifted duplicates** | 11 Highs (#13–23) | Each is a real behaviour bug hiding in a drifted copy or dead branch. Highest value; fix these first. Mixed TS/Python. |
| **A1 — Safe dead-code deletion** | 12 Highs (#1–12) + ~33 dead Med/Low | Zero-consumer exports, unreachable branches. Mechanical, low-risk, big LOC win. Group the shared-UI + shared-lib ones together. |
| **B-TS — Extract shared TS helper** | ~12 Highs (#24–28, 31, 33–35, 39, 41) + many Med | Single-source consolidations in the TS app (price line, nav block, JdSummary, safe-url, font tokens, job-resync, hireRate, label maps). |
| **B-PY — Extract shared Python helper** | ~4 Highs (#29, 30, 37, 38) + Med | `_generate` factory, `_scan_json_values`, CLI `_cli.py` adoption, test LLM stub + `mk_candidate` adoption. Keep separate (different test runner). |
| **TS↔PY contract dups** | #36 + several Med | Catalogs/types mirrored across the TS/Python boundary with only a comment guard. Best fixed by a sync test, not a merge. |
| **Structure / god-files** | 9 Med (AnalyticsTab 1161 LOC, db/core.ts 1297 LOC, SimulationProvider 706 LOC, profile_draft_cli, etc.) | File splits. Higher blast radius — do deliberately, one file per commit, or defer. |
| **Cleanup tail** | 30 Low + 2 Med | Stale comments, magic literals, naming, dead default branches. Bundle opportunistically while touching a file for another fix. |

---

## Suggested next-phase split (wave plan)

Each wave ≈ 5–7 findings, one mental model, atomic commit per fix, `tsc` (and Python tests where touched) green before the summary doc.

- **Wave 1 — Latent-bug drift fixes (Theme A2, the 7 with real user impact):** provLabel `observed` bucket (#13), sourceChannel loss (#14), provider-order inversion (#15), APPLY_EMAIL_RE drift (#16), GitHub-username parser drift (#17), STAGES shadow (#18), logout route wiring (#20). **Start here — best value/risk.**
- **Wave 2 — Dead-branch / dead-knob removal (rest of A2 + A1 shared modules):** retry bypass (#19), commit_reflection (#21), reject_mode "auto" (#22), consent-event kinds (#23), `ThemeSplit`/`DisclosureRow` (#1–2), `receiveSubmission`/`salaryBandError` (#3–4).
- **Wave 3 — Safe dead-code deletion (A1 remainder):** APPROVAL_KIND_META (#5), LLMResult.raw (#6), descendant graph (#7), mk_candidate adoption (#8), "duplicate" editor mode (#9), isDeadLettered (#10), SeedFiles + seed route (#11/#32), seed_jobs generic path (#12).
- **Wave 4 — TS single-source helpers (Theme B-TS):** price line (#39), nav block (#25), JdSummary (#28), safe-url consolidation (#33+#41), Spark font tokens (#35), QUOTA_CODE (#26), label maps (#27).
- **Wave 5 — TS helpers cont. + audit/contract:** job-resync block (#34), hireRate tally (#24), policyVersion (#40), LLM use-case sync test (#36).
- **Wave 6 — Python helpers (Theme B-PY):** `_generate` factory (#30), `_scan_json_values` (#29), `_cli.py` adoption (#37), test LLM stub (#38).
- **Wave 7+ — Structure & cleanup tail (optional):** god-file splits + the 30 Low cleanups, opportunistically.

---

## How this scan was run

- **Scanner**: `code_refactor` (Code Refactor agent, `src/lib/prompts/registry/agents/code-refactor.ts`) — focus: dead code, duplication, structure, cleanup.
- **Date**: 2026-06-23. **Scope**: all 43 contexts (full-stack: `app/` TypeScript + `pipeline/jobfit/` Python), 919 file references.
- **Method**: one `general-purpose` subagent per context, 6 waves of ≤8 parallel. Each read its context's files, grep-verified every "unused"/"duplicate" claim repo-wide (built-in Grep returned empty in this repo — agents used Bash `grep -rn`/`rg`), and wrote one structured report. Orchestrator read only the terse replies.
- **Baselines (pre-fix)**: `tsc --noEmit` = 0 errors · `node --test app/**/*.test.ts` = 1019/1019 passing · git clean on `main`.
- **Verification**: findings counted two ways (header sum = bullet count = 239). Each subagent excluded `.claude/worktrees/` stale copies from its grep evidence.
