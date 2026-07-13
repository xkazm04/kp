# Medium/Low remediation — running log

> The Med/Low tail (125 Medium + 30 Low = 155) worked in **domain-topic waves**, one agent per
> context fixing that context's whole cluster on disjoint files. Same discipline as the
> Critical/High waves: fix at the root, skip a genuine non-issue with a reason (never pad),
> extract a pure `.ts` helper where the logic lives in a `.tsx` (the bare `node --test` can't
> load a `.tsx`), prove each behavioral test fails against pre-fix code, keep every gate green.
>
> All 9 Criticals + all 66 Highs were closed first (waves 1–11; see the FIXES-WAVE-*.md docs).

## Wave 12 — Platform, Shell & Shared UI (22 findings, 6 contexts)

7 commits (`ecc6362` i18n + 6 fixes). tsc 0 · node unit 1560 → **1610** · i18n 3249 → **3252** × 4 · `next build` ✓.

- **app-shell** (`4770f1a`): drawer closes on every nav (not just `selectTab`); palette
  loading state + active-option scroll; rail label 10.5→11px. Pure `drawer-nav-close.ts` /
  `palette-results.ts`.
- **branding** (`6e9040a`): clearing the accent reverts live; external-logo `onError` fallback
  + `no-referrer`; Reset restores last-saved + unsaved guard; 3-digit-hex badge fix.
- **shared-ui** (`1a9f921`): `htmlToMarkdown` escapes metacharacters (was corrupting JD text);
  `[text](url)` links round-trip with a scheme-validated `safeLinkHref`; RichTextEditor
  disabled/readonly + a11y name; form-control API convergence (safe subset).
- **tasks** (`d5b0d8d`): watchdog+reaper for hung slots; retention prune; memoized poll;
  honest indeterminate progress bar. Constants `TASK_MAX_RUNTIME_MS`/`TASK_RETENTION_DAYS`.
- **market** (`1e040f3`): the "every JD card is coral" bug — `familyColor(orgType)` fed a
  non-family key; `familyColor` is now TYPED so it's a compile error, plus a proper `orgColor`;
  map landmark + legend a11y.
- **shared-utils** (`bcada7e`): `publicBaseUrl` validates an absolute, deployment-owned origin
  (rejects Host-poisoning); durable retryable intake ack; `getAdapter` throws on an unknown
  channel. **Necessary consequence:** rewired `comms-dispatch.ts`'s now-unreachable
  "dead-relative-link" warning to fire via a new `publicOriginIsFallback` predicate — kept the
  loud misconfiguration signal, fixed the test that encoded the old empty-return contract.

**Flake note:** the billing-webhook test flaked once (the known pid-keyed temp-DB issue,
data-store #4); 3 clean full runs confirmed it, not a regression.

## Wave 13 — Pipeline, Decisions & Channels (21 findings, 6 contexts)

7 commits (`558707e` i18n + 6 fixes). tsc 0 · node unit 1610 → **1658** · i18n 3252 → **3269** × 4 · python 878 OK · `next build` ✓.

- **communications-inbound-channels** (`3a3d307`, 5 findings): receiver-revoke `Modal`
  confirm (+ red live-receiver warning); pure `pickBounceTarget` binds a bounce to the single
  newest send at-or-before it (was fanning out over every same-`(ref,kind)` send); bounced rows
  get a `BouncedResend` control and the resend route stops treating a bounced receipt as
  "already recovered"; pure `callback-auth.ts` — `secretsMatch` (SHA-256 → `timingSafeEqual`,
  constant-time), timestamp freshness, replay guard; route reads secret header-only (dropped
  `?secret=`); `resolveCommsLocale` threads an optional `workspaceId`.
- **application-intake-apply-flows** (`f051144`): pure `classifyStatusError` (not-found /
  expired / transient) so the status page shows the right copy; `ConversationalApply` polish.
- **pipeline-board-candidate-drawer** (`97eac70`): pure `pipeline-move-targets.ts`
  (`moveStageSelectValues` / `resolveRejectTargets`) so move/reject menus only offer legal
  destinations; `pipeline-command` parsing hardened; drawer/board/command-bar fixes.
- **screening-decisions-records** (`825ea03`): SD-5 two-step confirm before the irreversible
  screen-wave commit + accessible preview button; SD-3 posture block no longer asserts a
  framing the candidate-facing `/api/compliance` disclosure never received.
- **group-evaluation-fairness** (`6d075e2`): **min-cohort floor** — `computeDifferentiators`
  returns `[]` with no rivals (an empty field trivially crowns every requirement skill
  "unique"), `GROUP_EVAL_MIN_COHORT=2` gates cohort stats; pure group-eval dedupe;
  `parseGroupCounts` hardened; `task-dedupe` keyed by role + governance-mode + candidate-set;
  FairnessPanel typing. **Two pre-existing differentiator tests** that used `[]` rivals as a
  shortcut were updated to pass a present non-matching rival (new contract, not a regression).
- **ats-integration-egress** (`cf966a1`): pure `ats-candidate-audit.ts` records what candidate
  fields egress on an ATS push; `resolveClientIp` honours **`KP_TRUSTED_PROXY`** (trust XFF only
  behind a declared proxy, else socket IP — spoof-resistant limiting). New optional env var
  documented in `docs/SELF_HOSTING.md`.

**New deploy env var:** `KP_TRUSTED_PROXY` (optional) — comma-separated trusted proxy CIDRs/IPs;
unset ⇒ XFF is ignored and the socket IP is used for rate limiting. All Wave-13 pure helpers
proven non-vacuous (each behavioral test fails against pre-fix code).

## Wave 14 — Insights, Analytics & Simulation (15 findings, 4 contexts)

5 commits (`923f8b0` i18n + 4 fixes). tsc 0 · node unit 1658 → **1695** · i18n 3269 → **3298** × 4 · python 878 OK · `next build` ✓.

- **analytics-calibration-dashboards** (`e795199`): **k-anonymity leak** — new
  `teamBenchmark(workspaceId)` computes the org aggregate with `excludeWorkspaceId`, so the
  k-anon floor counts only *other* teams (a 2-team org could back out its lone peer by
  subtracting its own stats); panel error branches render a real retry button with
  `role="alert"` (was a swallowed `role="status"`); `OrgBenchmarkPanel` gets a distinct error
  state before its silent null-return.
- **architecture-diagrams** (`8540490`): a test guard asserts every `/api` route drawn in a
  `STEP_DETAILS.puml` body/summary resolves to a real `route.ts` (catches diagram drift); the
  diagrams page is localized (new `diagrams.*` namespace, async `getTranslations`); pure
  `puml/a11y.ts` gives clickable nodes `aria-label`+`aria-pressed` and the interactive SVG
  `role="group"` not `role="img"`; StepDrawer keyed by `active.id` so a switch remounts.
- **guided-pipeline-simulation** (`226fecc`): **CROSS-TENANT LEAK** — sim `jobs`/`jds`
  DELETEs were UNSCOPED and `/api/sim/reset` was hardcoded to the DEFAULT workspace; both now
  scoped by the caller `workspace_id`. Pure `controlRoomConfirm.ts` arm→confirm gate on the 3
  consequential controls (approve gate / apply-floor / reconcile), pause/resume stay immediate;
  pure `phaseStep.ts` single-sources the stepper tri-state for visual + `aria-label`.
- **skill-matrix-coverage** (`<this wave>`): per-IP throttle (30/10min → 429) on the
  skill-profile verify route; pure `skillProfileFreshness` derives a "stale" amber verdict from
  the already-signed `issuedAt`+`methodologyVersion` (NO re-sign — page previously showed green
  for any age); pure `matrix-rows.ts` — `bestVisibleScore` returns `null` for a no-assessed-cell
  row (was floored to a fake 0) and splits hidden-by-floor vs hidden-unassessed; pure
  `matrix-popover.ts` clamps `top ≥ margin` (was negative on short viewports) + focus-trap / Esc
  / focus-restore / `aria-modal`.

**Two privacy/tenancy findings surfaced above Med here** (analytics k-anon self-exclusion,
sim cross-tenant DELETE) — fixed at root with non-vacuous tenant-survival tests. All Wave-14
pure helpers proven non-vacuous.

## Wave 15 — AI Matching & Extraction Engine (14 findings: 10 fixed, 4 deferred-with-cause, 5 contexts)

6 commits (`39817f1` i18n + 5 fixes). tsc 0 · node unit 1695 → **1696** · python 878 → **907** · i18n 3298 → **3299** × 4 · **matching_eval golden 8/8 zero-delta** · `next build` ✓. Four agents were cut off by a session-limit mid-wave and **resumed from transcript** (SendMessage) after reset — partial edits preserved, no cold restart.

- **cv-extraction-pipeline-services** (`7528a74`): #4 salary currency/period validation +
  per-currency **annual** ceiling for ALL markets (CZK ceiling = old `SALARY_PLAUSIBILITY_CEILING`
  ×12 so CZK/month is byte-identical); unrecognized code → manual review, closing the
  "garbage currency sidesteps the CZK gate" hole. New `test_salary_currency_validation.py` (11).
  (#5 was mislabeled STILL-OPEN — already fixed: `_reject_oversized` guards both upload paths.)
- **matching-transformation-engine** (`070922d`): #4 `group_compare` "covers the most required
  skills" now ranks by fewest **unmet must-haves** (was crowning the most nice-to-haves +
  printing a fabricated mixed ratio); honest gap wording. New `CoverageMetricTest` (3).
- **pipeline-clis-script-bridges** (`<clis>`): #2 draft route `maxDuration`+abort signal; #3
  `python-runner` `stdin.end()` after spawn (was hanging to the 600s backstop); #4 winnability
  CLI reports dropped candidates + `CoachPanel` amber "N not assessed" note; #5 `profile_draft_cli`
  exit-code corrections. 4 Python + 1 TS test.
- **pipeline-test-suite-python** (`<suite>`): test-only hardening — #2 prompt-version SHA-256
  fingerprint (analysis edit → CI "bump PROMPT_VERSION"); #3 early-career **registry AST
  discovery** (caught 3 consumers the static allow-list silently missed) + `{set}`/`frozenset`
  regex; #4 diagram bijection (both orphan directions); #5 ts-const comment stripping. 16 tests.

### Deferred-with-cause (4 — NEED SIGN-OFF / UNBLOCK)
- **matching-transformation-engine #5** (product decision): forming a one-sided salary band for a
  lone stated floor (`normalize_band(min,min)`) contradicts the deliberately-pinned
  `test_jobs.py::test_half_stated_band_falls_back_to_the_anchor` and fabricates an unstated
  **ceiling** — violates the recruiter-honesty invariant. Not a unilateral golden flip; the
  "carry min/max independently" alternative is a `Job`-model change touching winnability/campaign/
  matrix_cli. **Team call required.**
- **evaluation-fairness-seed-data #3, #4, #5** (blocked on WIP): all three root-cause in
  `pipeline/jobfit/eval/interview_eval.py` — the user's protected **voice-eval WIP** — so the agent
  made ZERO edits. Precise fixes noted for a dedicated single-owner pass once the WIP lands:
  #3 a `--strict` unscored-fraction floor in `_passes`; #4 N-repeat persistence or restrict
  `--strict` regression-gating to the deterministic golden path; #5 fold `must_hold`-derived
  ElevenLabs failures into `r.issues` (currently non-gating `r.quality_issues`).

## Wave 16 — Candidate Analysis (13 findings, all resolved, 4 contexts)

6 commits (`829721e` i18n + 4 fixes + 1 heredoc re-commit). tsc 0 · node unit 1696 → **1725** · i18n 3299 → **3315** × 4 · `next build` ✓. No Python touched (matching_eval N/A).

- **candidate-profile-job-matching** (`e9bafad`): #3 `profile/draft` route uses
  `parsePythonJson` (a bare `JSON.parse(stdout)` could 500 a SUCCESSFUL paid draft on
  interpreter teardown noise); #5 `WeightsPanel` re-anchors sliders to the server-renormalized
  vector after each apply (were stale → labels disagreed with the ranking + "Apply re-rank"
  stayed falsely enabled); pure `weightsDirty`/`syncDraftToWeights`. #4 was a dedup of
  analytics-calibration #1 (`toCsv` neutralization, already fixed).
- **cv-analysis-workspace** (`44f67f8`): #3 pure `githubRunPolicy` bails the GitHub deep-dive
  in blind mode (identity can no longer render beside a blind-scored CV); #4 `AnalysisProgress`
  a11y (dropped the panel-wide `role=status`, narrowed to two small live regions); #5 **real
  per-variant progress** wired end-to-end (server already persisted `progressDone/Total`) —
  multi-variant shows "X of N variants", single run flips to indeterminate on the final stage
  (kills the frozen 83% fake bar).
- **github-evidence-cv-utilities** (`<github>`): #3 paginate owned repos to 300 with an honest
  truncation note (prolific candidates' flagship repos now analyzed); #4 `SKILL_ALIASES` made
  mutually exclusive (**intentional taxonomy refinement** — one JD keyword → one concept-level
  match/gap, not three); #5 `extractCvEmail` disambiguates multi-email CVs.
- **analysis-result-panels** (`<panels>`): #2 ArchetypeBanner OMITs the chip for absent values
  (was a misleading definite "0%"); #3 ScoreDial band verdict + aria localized (was hardcoded
  English on bilingual reports); #4 SalaryGauge growth caption DERIVED from the real rounded
  target (+34% not a fixed "+30%"); #5 CompareTab table a11y (caption/scope/sr-only winner).

**Behavior change flagged:** github-evidence #4 makes skill-alias buckets mutually exclusive —
react/next.js resolve only to the `react` concept (previously also counted as typescript +
javascript). Improves match/gap honesty; worth a glance if any downstream report expected the
triple-count.

## Status
Med/Low: **81 of 155 closed**, 74 open (50 M + 24 L) — of the open, **4 are deferred-with-cause**
(1 product decision + 3 blocked on the voice-eval WIP; see Wave 15). Remaining topic waves:
Dev Hiring, Interviews/Scheduling, Offers/Automation + Identity/Data/Privacy,
Jobs/JD/Sourcing + LLM + Billing.
