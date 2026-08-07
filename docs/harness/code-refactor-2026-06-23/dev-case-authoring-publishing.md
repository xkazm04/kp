> Total: 5 findings (0c critical, 1h high, 2m medium, 2l low)

## 1. Sourcing-into-pipeline logic is duplicated between the source route and the orchestrator — and they have drifted
- **Severity**: High
- **Category**: duplication
- **File**: app/api/devcase/source/route.ts:20-33 (plus app/_lib/devcase-orchestrator.ts:217-236)
- **Scenario**: Both code paths take `runSourceForRole(role).candidates`, loop the matches, skip those without `candidateId`, and call `createPipelineEntry({ candidateId, candidateLabel, archetype, roleFamily: "software_engineering", jobId: \`dc-<caseId>\`, jobTitle, matchScore, stage: "Accepted" })` while counting `added`/`sourced`. I diffed the two blocks: they are line-for-line equivalent EXCEPT the orchestrator sets `sourceChannel: "devcase"` (orchestrator line 233) and the route does NOT. Confirmed via `grep -rn "sourceChannel" app/api/devcase/source/route.ts app/_lib/devcase-orchestrator.ts` — the marker exists only in the orchestrator. So a candidate sourced by clicking "Source DB" in CaseDetail is written without the origin marker, while the same candidate sourced by the automated lifecycle gets it — the drawer's "via dev case" attribution (commit d95fed6d) silently depends on which button the user pressed.
- **Root cause**: The manual "Source DB" route was added beside the orchestrator's sourcing step; the later `sourceChannel` enrichment was applied to the orchestrator copy only and never back-ported to the duplicated route.
- **Impact**: Provenance inconsistency that is invisible until someone looks at the pipeline drawer and wonders why some dev-case candidates aren't tagged. Two copies of the same write contract means future field additions (locale, dedupe semantics) must be remembered in two places.
- **Fix sketch**: Extract a single helper, e.g. `seedPipelineFromMatches(matches, { caseId, roleTitle }): { added: number }` in devcase-run.ts (next to `runSourceForRole`), that owns the loop + the `createPipelineEntry` shape INCLUDING `sourceChannel: "devcase"`. Call it from both the route and the orchestrator. Behavior-preserving for the orchestrator; it fixes the missing marker for the route as a side effect.

## 2. `approve()` in DevTab bypasses the shared `runAction` error wrapper, re-implementing fetch + losing the error banner
- **Severity**: Medium
- **Category**: duplication
- **File**: app/features/sub_dev/DevTab.tsx:323-340 (wrapper at 200-220)
- **Scenario**: DevTab defines `runAction` (lines 200-220) precisely so write POSTs "surface a failed/non-OK POST as a banner instead of silently no-op'ing." Every other write — `runLifecycle`, `approveLifecycle`, `publish`, `source` — routes through it. `approve()` does NOT: it hand-rolls `fetch("/api/devcase", …)` / `await r.json()` / `if (r.ok)` with no `catch` and no `setActionError`. I confirmed by reading all five action handlers: `approve` is the only one that does a raw fetch. Approve is the human gate (the single most consequential write in this context), yet a failed approve is exactly the silent no-op the wrapper was built to prevent.
- **Root cause**: `approve` predates / sits apart from the `runAction` consolidation (it also threads `setApprovedId` from the response body, which made it feel "special"), so it was never migrated.
- **Impact**: Inconsistent UX (a failed approval looks like a dead button) and a second copy of fetch/ok/parse boilerplate to maintain. Masks real publish-gate failures.
- **Fix sketch**: Route through `runAction("Approve", () => fetch("/api/devcase", {…}), (body) => { setApprovedId((body as {id?: string}).id ?? null); loadCases(); })` and keep `setApproving` in the surrounding try/finally. Net: removes the duplicated error path and gives the gate the same banner as its siblings.

## 3. `roleFamily: "software_engineering"` is a magic literal repeated across the dev-case write paths
- **Severity**: Medium
- **Category**: duplication
- **File**: app/api/devcase/source/route.ts:26, app/_lib/devcase-orchestrator.ts:227, app/_lib/devcase-run.ts:624 (and DevTab.tsx:193 `roleFamily: "software_engineering"` in buildNeed)
- **Scenario**: `grep -rn '"software_engineering"' app/_lib/devcase-orchestrator.ts app/api/devcase/source/route.ts app/_lib/devcase-run.ts app/features/sub_dev/DevTab.tsx` shows the same string literal hard-coded at four dev-case sites. DevTab even documents it as "Intentionally FIXED for now (recorded decision)… roleFamily is a constant". The decision to fix it is fine; spreading the literal across four files is the cleanup issue — the same constant is restated everywhere it's consumed.
- **Root cause**: Each write site was authored independently; the "fixed for now" decision was documented in one place (DevTab) but the value itself was copied, not centralized.
- **Impact**: Low risk today (it really is constant), but if/when a second role family becomes real (DevTab's own comment anticipates this) the change must be hunted across four files, and a missed site mis-tags candidates.
- **Fix sketch**: Add `export const DEV_ROLE_FAMILY = "software_engineering";` to devcase-constraints.ts (the existing "single source of truth for dev-case … constraints" file) and reference it from all four sites. Pure de-duplication, no behavior change.

## 4. `Submission.contact` / `outcome` carry doc-comments describing the historical bug they fixed, now stale narrative in the type file
- **Severity**: Low
- **Category**: cleanup
- **File**: app/features/sub_dev/DevTypes.ts:88-100 (also numerous commit-hash markers across DevTypes/CaseDetail/orchestrator, e.g. DevTypes.ts:121 "W5-4", CaseDetail.tsx:61 "fec3e23a", :66 "8d4f38b9", :73 "99288c0e")
- **Scenario**: Several fields are annotated with past-tense bug stories: `contact` — "the API has always served it… this type dropped it, so the workbench couldn't show how to reach a winner"; `outcome` — "without it the 'recorded' state lived only in SubmissionRow and any remount re-offered the buttons, double-counting". These describe a defect that is already fixed; the comment documents history, not the current contract. The same pattern of inline commit-SHA markers ("fec3e23a", "8d4f38b9", "99288c0e", "W5-4", "ce28da40", "c364a44d") recurs throughout the in-scope files as code tags.
- **Root cause**: Fix-time annotations were left in place as a changelog-in-the-source habit; git already records the why.
- **Impact**: Cosmetic. Adds reading overhead and gradually turns type definitions into a commit log; harmless but accretes.
- **Fix sketch**: Optional. Trim the field doc-comments to what the field IS (e.g. `contact?: string | null; // email/phone captured at apply`), and let `git blame` carry the bug history. Do NOT mass-strip the commit-hash markers blindly — some pair a field with a still-relevant invariant; trim only the purely-historical ones.

## 5. `publish/route.ts` accepts a `channel` body param that no in-scope caller ever sends
- **Severity**: Low
- **Category**: dead-code
- **File**: app/api/devcase/publish/route.ts:10,14
- **Scenario**: The POST reads `{ caseId?: string; channel?: string }` and passes `getAdapter(body.channel ?? "local")`. DevTab's `publish()` (DevTab.tsx:248-254) sends only `{ caseId }`; the orchestrator publishes via `getAdapter("local")` directly, never through this route with a channel. `grep -rn '"channel"' app/features/sub_dev` and inspection of every publish caller show no caller supplies `channel`, so the branch always resolves to "local". It is a real (if unexercised) API extension point, not strictly dead — distribution has multiple adapters — so this is the weakest finding.
- **Root cause**: The route was built channel-generic ahead of a multi-channel publish UI that hasn't shipped; the only client hard-defaults to local.
- **Impact**: Negligible. A reader may assume the UI can pick a channel when it can't; the param is otherwise inert.
- **Fix sketch**: Leave as-is if multi-channel publish is on the roadmap (it's a deliberate seam). If not, drop `channel` from the parsed body and call `getAdapter("local").publish(devCase)` directly to make the single-channel reality explicit.
