# Pipeline Board & Candidate Drawer — ambiguity-guardian + ui-perfectionist scan

> Total: 6 findings (0 critical, 2 high, 3 medium, 1 low)

## 1. Ungated `?entry=` branch of the events route leaks the full per-candidate history the sibling routes were gated to protect
- **Severity**: High
- **Lens**: ambiguity
- **Category**: authz-parity-gap
- **File**: `app/api/pipeline/events/route.ts:29`
- **Scenario**: An anonymous demo-workspace session (or anyone who reaches the origin on a gated deploy) calls `GET /api/pipeline/events?entry=<id>`. It receives the entry's complete event history — full `candidateLabel`, `archetype`, `entryId`, stage transitions, and raw `detail` (including rejection reasons) via `listPipelineEventsForEntry` (`app/_lib/db/pipeline.ts:108`), with none of the initials-only anonymization the public feed applies.
- **Root cause**: The single-entry-authz-parity hardening added `requireOperator()` to `GET /api/pipeline/[id]` and `/api/pipeline/[id]/timeline` explicitly because "the full labels … expose the same recruiter PII, so all three are gated the SAME way" — but the `?entry=` branch of the events route, which serves the same entry-keyed recruiter data, was never included. It is also now dead code: the drawer's one-call bundle (`/timeline`) replaced it, so no live client uses it (only docs reference it), meaning the gap can't even be noticed by breaking a feature.
- **Impact**: The exact IDOR class `pipeline-events-public.ts` documents (entry ids called "an IDOR handle") is re-opened through a forgotten branch: candidate identity tied to hiring outcomes is readable ungated, one entry at a time, on any deploy with `KP_OPERATOR_PASSWORD` set — silently bypassing a gate the team believes is closed.
- **Fix sketch**: Either delete the `?entry=` branch outright (no live caller — the drawer uses the operator-gated `/timeline` bundle) or run `requireOperator()` before serving it, matching the `[id]` routes. Add the branch to the error-message-hygiene/authz-parity test so a future per-entry read on this route can't ship ungated again.

## 2. `reject below N%` confirm silently caps execution at the 50-row preview while the UI says "affects 120"
- **Severity**: High
- **Lens**: ambiguity
- **Category**: preview-cap-truncates-confirm
- **File**: `app/api/pipeline/command/route.ts:11`
- **Scenario**: A recruiter types "reject everyone below 60%" on a board where 120 active candidates match. The preview shows 50 rows plus "affects 120 candidates". They confirm. `CommandBar.tsx:44` sends `confirmIds = result.preview.map(row => row.id)` — only the 50 rendered rows — and `resolveRejectTargets` deliberately acts only on previewed ids, so exactly 50 are rejected. The done chip reads "50 rejected" with `droppedOut = 0`; the other 70 candidates stay active with no message, and the recruiter believes the cohort is cleared.
- **Root cause**: Two individually-correct designs compose wrongly: `PREVIEW_CAP = 50` truncates the row list (fine for rendering) while the TOCTOU fix binds the confirm to "ids the recruiter was shown". Nothing reconciles `total` (120) against `preview.length` (50) — neither the confirm button, the description, nor the result mentions the 70 matching-but-never-previewed entries that the subset contract silently excludes.
- **Impact**: The board's most destructive bulk action (reject + candidate emails) quietly does less than half of what the recruiter approved on large cohorts, with a success message that reads as complete. Stale sub-60% candidates linger and get chased or re-screened; trust in the command bar erodes when the mismatch is eventually noticed.
- **Fix sketch**: When `total > PREVIEW_CAP`, say so at confirm time ("showing 50 of 120 — confirming rejects only these 50") and offer a re-run/next-page path; or have the preview return the full previewed id list (ids are cheap — cap only the *rendered* rows) so the confirm covers everything counted in `total`. Also surface an explicit "N matched but weren't previewed/acted on" count in the done payload instead of relying on `droppedOut`, which by construction can never include them.

## 3. `commsFailed` — "rejected but the candidate was never notified" — is computed, returned, and dropped on the floor by the CommandBar
- **Severity**: Medium
- **Lens**: ui
- **Category**: missing-error-state
- **File**: `app/features/sub_pipeline/CommandBar.tsx:8`
- **Scenario**: A bulk `reject below` runs; two rejection comms fail to queue. The route counts them (`commsFailed`, `command/route.ts:110-119`), records a per-entry `rejection_comms_failed` audit event telling the operator to "nudge manually", and returns `commsFailed: 2` — but the `CommandResult` type has no `commsFailed` field, `post()` never destructures it, and the done phase renders only `count`/`heldAtOffer`/`droppedOut`. The recruiter sees a clean green "2 rejected… done".
- **Root cause**: The server half of the UAT M3 "a bulk reject must never ghost the candidate" fix shipped without its client half — the response field exists, the UI contract was never extended to display it.
- **Impact**: The exact failure the feature exists to surface (a rejected candidate who was never told) is invisible at the surface where the action was taken; it survives only in an event feed line the operator has no reason to check after seeing a success chip.
- **Fix sketch**: Add `commsFailed?: number` to `CommandResult`, thread it through `post()`, and render an amber warning line in the done phase (mirroring `doneHeldAtOffer` / `doneDroppedOut`): "N rejection notices failed to queue — nudge manually." One new catalog key, three lines of wiring.

## 4. Aging-dot tooltip quotes the default SLA even when the recruiter's per-board override set the flag
- **Severity**: Medium
- **Lens**: ui
- **Category**: tooltip-contradicts-state
- **File**: `app/features/sub_pipeline/PipelineShared.tsx:259`
- **Scenario**: A recruiter opens the PIPE4 SLA editor and tightens Interview from 5 to 2 days. A candidate 3 days in Interview correctly turns amber (the board's `isStale` in `PipelineTab.tsx:396` passes `slaOverrides` to `slaForStage`). Hovering the amber dot, the tooltip reads "aging — over **5** days in Interview": it names a threshold the card visibly did not exceed.
- **Root cause**: `CandidateRow` re-derives the threshold for its tooltip via `slaForStage(entry.stage)` *without* the overrides argument — the overrides live in `PipelineTab` state and are only baked into the boolean `stale` prop, so the row has no way to display the number that actually fired.
- **Impact**: The one place that explains *why* a card is flagged contradicts the recruiter's own configuration, making the SLA editor feel broken ("I set 2, it still says 5") and undermining trust in the aging signal it exists to tune.
- **Fix sketch**: Pass the effective threshold down instead of re-deriving it — e.g. change the board's `isStale` prop family to also provide `slaDays(e)` (or have `PipelineTab` pass `slaOverrides` through `PipelineBoard` → `StageCell` → `CandidateRow`), and use that value in the `candidateRow.aging` interpolation. The render-diet signature already folds the aging bucket, so no memoization change is needed.

## 5. Bulk invite's whole-request failure shows a bare "N failed" while its sibling bulk actions explain why
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: inconsistent-failure-grammar
- **File**: `app/features/sub_pipeline/PipelineTab.tsx:855`
- **Scenario**: On an operator-gated deploy, a non-operator selects 8 active candidates and clicks "Invite to schedule". `/api/schedule/invite/bulk` answers 401; `bulkInvite` marks all 8 failed and sets `bulkResult` with **no `reason`** — the status line reads "0 invited · 8 failed" with nothing else. The same session's bulk *move* or *reject* would have said "You don't have permission…" via `batchRequestReason` (`PipelineTab.tsx:748`).
- **Root cause**: `bulkInvite` predates (or missed) the batch-authz-parity pass that gave `bulkMove`/`bulkDecide` the whole-request-refusal grammar: its catch/else paths populate the failure set but never distinguish a 401/403 gate refusal from a transport blip, and never read the response body's `error`.
- **Impact**: A permissions problem is indistinguishable from a flaky network or per-candidate failures, so the recruiter's natural move is to retry a request that can never succeed — exactly the "silent count" the bulk-reason work was done to eliminate, surviving on one of the four bulk paths.
- **Fix sketch**: In `bulkInvite`, when `r.ok` is false set `requestReason = batchRequestReason({ ok: false, status: r.status })` (and reuse `pipelineActionReason(r)` for a body-carried message); include it as `reason` in the `setBulkResult` call, which already renders `bulkResult.reason` for the other verbs.

## 6. Salary market band hardcodes `en-US` number formatting in an otherwise locale-aware surface
- **Severity**: Low
- **Lens**: ui
- **Category**: hardcoded-locale
- **File**: `app/features/sub_pipeline/SalaryBenchmarkHint.tsx:20`
- **Scenario**: A recruiter running the app in Czech opens a drafted offer's market-band hint: the band renders "45,000–62,000" (en-US thousands commas) inside a sentence whose copy, dates, and every other number on the drawer follow the active locale (e.g. the drawer's JD-edited chip uses `Intl.DateTimeFormat(locale, …)`).
- **Root cause**: `const fmt = (n: number) => n.toLocaleString("en-US")` pins the formatter to en-US instead of reading `useLocale()` like the drawer header does — likely a leftover from before the i18n pass.
- **Impact**: Mixed-locale numerals in a money context are more than cosmetic: "45,000" reads as a decimal ("45.000" vs "45,000") ambiguity to European users, in the one hint whose entire job is communicating salary magnitudes.
- **Fix sketch**: Read `const locale = useLocale()` and format via `n.toLocaleString(locale)` (or `Intl.NumberFormat(locale)` hoisted once); alternatively pass the numbers raw into the `marketBand` catalog message and let next-intl's number formatting handle it.
