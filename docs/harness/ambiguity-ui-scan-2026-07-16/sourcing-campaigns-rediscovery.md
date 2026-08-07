# Sourcing, Campaigns & Rediscovery — ambiguity-guardian + ui-perfectionist scan

> Total: 6 findings (0 critical, 2 high, 3 medium, 1 low)

## 1. Feed "Refresh" sweeps the DEFAULT tenant's roles, then reports its counts against the session tenant's feed
- **Severity**: High
- **Lens**: ambiguity
- **Category**: cross-tenant-sweep-mismatch
- **File**: `app/api/rediscovery/alerts/route.ts:67` (root in `app/_lib/rediscover.ts:256`)
- **Scenario**: A recruiter signed into a non-default workspace clicks Refresh on the rediscovery feed. The POST calls `sweepRediscoveryAlerts()` with no workspace, and `defaultSweepDeps()` calls `listJobStatuses()` bare — which is workspace-scoped and defaults to `DEFAULT_WORKSPACE_ID` (`job-ingest.ts:171`). So the sweep ranks the *default* tenant's published roles, persists alerts into each job's own workspace (`raiseRediscoveryAlertsForJob`'s `getJobWorkspace` fallback), and then the route returns `relevantAlerts(await currentWorkspace())` — the *session* tenant's feed. The UI dutifully shows "Swept 25 roles, found 7 candidates" while zero new rows appear in the feed below it.
- **Root cause**: The GET/PATCH paths were tenancy-hardened (relevantAlerts threads `currentWorkspace()`), but the POST sweep was left on the "per-tenant sweep is a separate feature (NON-GOAL)" comment in `rediscover.ts` — reasonable for the *background* sweep, but this sweep is user-triggered from a specific team's session, so the non-goal note no longer matches the call site.
- **Impact**: In any multi-workspace deployment the Refresh button does work for the wrong team, burns up to 25 recruiter_cli rankings on another tenant's catalog, and reports counts (`jobsSwept`/`newAlerts`) that contradict the feed it returns — recruiters learn the numbers are meaningless. Single-workspace deployments are unaffected, which is why it's latent.
- **Fix sketch**: Thread the session workspace: `sweepRediscoveryAlerts({ signal, workspaceId: await currentWorkspace() })`, have `defaultSweepDeps(workspaceId)` call `listJobStatuses(workspaceId)` and pass the same id through `raiseForJobBounded` → `raiseRediscoveryAlertsForJob` (which already accepts `opts.workspaceId`). Update or delete the now-stale NON-GOAL comment so the next reader doesn't re-introduce the bare call.

## 2. Feed row state is keyed by candidateId, so one candidate alerted for two roles shows "Added ✓" on both
- **Severity**: High
- **Lens**: ui
- **Category**: state-key-collision
- **File**: `app/features/sub_jobs/RediscoveryFeed.tsx:219` (also 122, 186, 229)
- **Scenario**: The alert store's unique index is `(job_id, candidate_id)`, so the same silver medalist legitimately appears in the feed once per open role (e.g. "Anna clears the bar for Role X" and "…for Role Y"). The recruiter clicks "Add to pipeline" on the Role X row. Both rows immediately swap to the green "Added ✓" badge (`added.has(a.candidateId)`), and only the Role X row is dismissed after `ADDED_BADGE_MS` — the Role Y row is left permanently badged "Added", with its add and dismiss buttons unrendered (they live in the `else` branch), even though Anna was never added to Role Y.
- **Root cause**: `added`, `pending`, and `rowError` are `Set`/`Map` keyed on `a.candidateId`, but the row identity in this list is the alert id (`a.id`, job+candidate). `pending` has the same collision: while one add is in flight, the other role's button renders disabled/"Adding…".
- **Impact**: A recruiter is told a candidate is already filed for a role they were never added to, and loses the only affordances (add/dismiss) on that row until a full reload — a wrong-decision surface, not just cosmetics.
- **Fix sketch**: Key the three state slices by `a.id` instead of `a.candidateId` (the input to `postPipelineAdd` keeps using `a.candidateId`/`a.jobId` unchanged). The render-site checks (`added.has(a.id)`, `pending.has(a.id)`, `rowError.get(a.id)`) then match row identity, and the deferred `dismiss(a.id)` already agrees with that key.

## 3. `POOL_FIT_FLOOR = 55` re-hardcodes the server's `SCORE_FLOOR` in the client, with drift by design
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: duplicated-magic-number
- **File**: `app/features/sub_jobs/RecruiterCandidates.tsx:142`
- **Scenario**: A dev tunes rediscovery admission by changing `SCORE_FLOOR` in `app/_lib/rediscover.ts:21` (say 55 → 60). The Candidates tab's "Pool fit" filter — whose own comment says a pool fit is "promising (≥ the rediscover SCORE_FLOOR)" — silently keeps using 55, so the two features that are documented as sharing one bar now disagree: rediscovery surfaces nobody under 60 while Pool Fit still badges 55-59 candidates as strong matches.
- **Root cause**: `rediscover.ts` imports better-sqlite3 at module top, so the client component can't import the constant directly; instead of moving the number to a shared import-safe module, it was re-declared inline. The coupling lives only in a comment, which nothing enforces.
- **Impact**: Latent drift between two surfaces that promise the same threshold; the comment actively tells the next reader they're linked while the code guarantees nothing. Also nothing ties either to `matching.FIT_PROMISING_THRESHOLD`, which `SCORE_FLOOR`'s comment claims to mirror.
- **Fix sketch**: Hoist the floor into an import-free shared module (the same pattern already used for `rediscovery-relevance.ts` and `rediscovery-add.ts`), e.g. `export const FIT_PROMISING_FLOOR = 55`, and import it from both `rediscover.ts` (re-exporting as `SCORE_FLOOR` for back-compat) and `RecruiterCandidates.tsx`. A type-only import is not enough here — the value is needed at runtime, so the module must be runtime-clean.

## 4. Campaign/winnability/rediscover routes return raw `error.message` on 500 — bypassing the repo's own `safeJsonError` boundary
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: error-boundary-inconsistency
- **File**: `app/api/jobs/[id]/campaign/route.ts:70-74` (same shape at `winnability/route.ts:60-62`, `rediscover/route.ts:33-37`)
- **Scenario**: Campaign generation fails outside the CLI's parsed-stderr path (workdir creation, `parsePythonJson` on garbled stdout, a DB write). The catch-all serializes `error.message` straight into the JSON body, and `CampaignTab.generate` renders it verbatim (`e.message`, CampaignTab.tsx:116) — so absolute workdir paths, Python tracebacks fragments, or SQLite errors land in the recruiter's face. The sibling routes in this same feature (`outreach`, `rediscovery/alerts`) route the identical situation through `safeJsonError`, which logs internals server-side and returns a coded, client-safe message.
- **Root cause**: These three routes predate (or missed) the `safeJsonError` convention; each has a hand-rolled `error instanceof Error ? error.message : …` catch. There is no documented rule for which route class gets which treatment, so the split looks intentional to a reader when it isn't.
- **Impact**: Internal details cross the trust boundary and the UX degrades to raw exception text; inconsistency also means the next route author flips a coin. (CLI-originated failures are fine — `parseStderrError` already produces user-facing messages; it's only the catch-all leg that leaks.)
- **Fix sketch**: Replace the three catch-alls with `return safeJsonError(error, "api:jobs:campaign", "CAMPAIGN_FAILED")` (and the winnability/rediscover equivalents), keeping the existing `parseStderrError` and `PipelineError` branches as-is since those are already client-safe. `CampaignTab` already falls back to `t("generateFailed")` when the message is empty, so no client change is needed.

## 5. Sweep truncation is "never silent" on the server console but always silent in the UI
- **Severity**: Medium
- **Lens**: ui
- **Category**: missing-state-truncation
- **File**: `app/features/sub_jobs/RediscoveryFeed.tsx:87-96`
- **Scenario**: A workspace has 40 published roles. The recruiter clicks Refresh; the sweep processes 25 (`SWEEP_MAX_ROLES`) and defers 15, and the route faithfully returns `truncated: 15`. The feed's note says "Swept 25 roles, found N" — nothing tells the recruiter that 15 roles were skipped or that clicking Refresh *again* is the designed way to cover them ("Excess is deferred to the next Refresh"). The design doc's promise that truncation is "never a silent cap" (`rediscover.ts:180-182`) is only kept via `console.warn` on the server.
- **Root cause**: The POST response's `truncated` field is parsed into neither the response type nor the note: the body cast in `sweep()` only picks `alerts`/`newAlerts`/`jobsSwept`.
- **Impact**: In exactly the large-catalog case the bounds were built for, recruiters believe a sweep covered everything and never re-click, so roles beyond the ceiling *are* silently un-swept — the failure mode the ceiling comment says must not happen.
- **Fix sketch**: Add `truncated?: number` to the body cast and extend the note when `truncated > 0`, e.g. a `t("sweptPartial", { jobs, found, deferred })` message ("…15 roles deferred — refresh again to continue"). One new i18n key across locales; no server change needed.

## 6. Education gate rows render the Languages icon
- **Severity**: Low
- **Lens**: ui
- **Category**: wrong-icon
- **File**: `app/features/sub_jobs/CoachPanel.tsx:180`
- **Scenario**: The winnability coach lists loosenable gates of two kinds — `language` and `education` (`Gate.kind`, line 16). The row copy branches per kind (`gateLanguage` vs `gateEducation`), but the leading icon is unconditionally `<Languages size={15} />`, so "Drop the Master's degree requirement (+3)" is decorated with a translation/language glyph.
- **Root cause**: The icon was hardcoded when language gates were the only kind; the copy branch was added without a matching icon branch.
- **Impact**: Mild scanning confusion — recruiters skimming the list by icon read an education lever as a language lever; it also breaks the panel's otherwise consistent icon semantics (Coins for salary, SlidersHorizontal for must-haves).
- **Fix sketch**: Branch the icon on `g.kind`: keep `Languages` for language gates and use `GraduationCap` (lucide) for education gates, same size/class. Two-line change plus the import.
