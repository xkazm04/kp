# Dev Case Orchestration & API — UI+Bug combined scan
> Total: 4 findings (1 crit / 1 high / 2 med / 0 low)
> Group: Dev Case Automation | Lens mix: 4 bug / 0 ui | Files read: 16 (+5 supporting: db.ts, distribution.ts, tasks.ts, task-dedupe.ts, random-id.ts)

## 1. Inbound webhook bypasses the apply-token gate via a guessable `postingId`
- **Severity**: Critical
- **Lens**: 🐛 Bug Hunter
- **Category**: Validation gap at trust boundary / broken access control
- **File**: `app/api/devcase/inbound/route.ts:22-24` (mirror: `app/api/devcase/submit/route.ts:19-21`)
- **Scenario**: The inbound route's own header comment states the **apply token** "gates who may POST a candidate's application" and the token is correctly minted from a 128-bit CSPRNG (`distribution.ts:21`). But the route accepts `body.postingId` as an *alternative* to the token: `let postingId = body.postingId; if (!postingId && body.token) postingId = getPostingByToken(...)`. When `postingId` is supplied directly, the token is never consulted. Posting ids are minted by `randomId("pst")` → `pst-<base36 Date.now()>-<6 Math.random() chars>` (`random-id.ts:21`), which that file **explicitly documents as an INTERNAL key, "Never a security boundary," using non-crypto `Math.random()`**. The time prefix is known and the random suffix is only 6 base36 chars from a predictable PRNG.
- **Root cause**: Two parallel addressing paths to the same action with asymmetric trust — one gated by an unguessable token, one by a guessable internal primary key — and `intakeSubmission`/`createSubmission` never verify the caller is authorized for that posting (it doesn't even check the posting exists; `getPosting` is called only afterward for a display title and tolerates null, `distribution.ts:79`).
- **Impact**: An unauthenticated external party can enumerate/guess `pst-` ids and inject candidate submissions into ANY posting — and worse, into a posting whose lifecycle is `collecting`, which auto-triggers the lifecycle task to evaluate→rank→promote→send an invite comm (`inbound/route.ts:37-39`). That is the full automated pipeline driven by forged input, entirely bypassing the bearer credential the route claims to require.
- **Fix sketch**: Treat the apply token as mandatory for the public inbound webhook — drop the `postingId` shortcut on `/inbound` (or require it ONLY on an internal/authenticated route), and resolve the posting exclusively via `getPostingByToken`. Have `createSubmission` reject a non-existent `postingId`.

## 2. `approved` lifecycle stage is non-idempotent — resume/restart mints a duplicate posting
- **Severity**: High
- **Lens**: 🐛 Bug Hunter
- **Category**: Idempotency / durability (race on restart)
- **File**: `app/_lib/devcase-orchestrator.ts:101-185`
- **Scenario**: The whole design (`control/route.ts:10-21` `reconcile()`, and the lifecycle dedupe key `lifecycle:${id}`) is sold as "stateful + resumable" — any non-terminal lifecycle with no in-flight task gets re-enqueued. But the `approved` handler does `const posting = await getAdapter("local").publish(devCase)` (line 104) and only flips the stage to `collecting` at the very end (line 174). If the task dies between those points (process restart common in `next dev`; a throw from the required `runEvaluateSubmission` path isn't here but a SIGKILL/crash is), the lifecycle is still at `approved`. On reconcile it re-runs the `approved` handler → `publish()` again. `createPosting` (`db.ts:3015`) unconditionally inserts a NEW row with a fresh `randomId("pst")` and a brand-new token — no dedup by `caseId`.
- **Root cause**: A side-effecting, non-idempotent external action (publish, which allocates a new posting + token) sits inside a "resumable" stage whose completion marker (stage→collecting + `postingId`) is written only at the end, with no guard against re-entry. (Sourcing re-runs are safe — `createPipelineEntry` dedups on the stable `dc-${caseId}` jobId — so the posting is the leak.)
- **Impact**: Orphan postings accumulate with valid, distinct apply tokens. `lifecycleByPosting` and `updateLifecycle({postingId})` track only the latest posting, so any submission that arrives on the earlier posting's still-live token is silently disconnected from the lifecycle — it will never auto-trigger collection. Duplicate published roles also confuse `GET /postings`.
- **Fix sketch**: Make publish idempotent per case — if the lifecycle already has a `postingId` (or a posting exists for `caseId`), reuse it; or persist `stage:"published"`+`postingId` immediately after `publish()` so a resume skips re-publishing. A dedicated `published` stage between `approved` and `collecting` would split the side effect from the sourcing loop cleanly.

## 3. Auto-approve gate fails OPEN when the analysis object is missing/partial
- **Severity**: Medium
- **Lens**: 🐛 Bug Hunter
- **Category**: Approval gate / fail-closed correctness
- **File**: `app/_lib/devcase-orchestrator.ts:38-48` (`gateApproval`)
- **Scenario**: `gateApproval` is the autonomy gate that decides whether a designed case auto-publishes or routes to a human. It reads `gaps = analysis?.statedVsRealGaps?.length ?? 0` and `conf = analysis?.confidence ?? 0`. The confidence check is sound (a missing `confidence` → `0` < 0.5 → routes to human). BUT the gaps check uses `?? 0`: if the analyzer produced an analysis object with a real `confidence` (≥ 0.5) but `statedVsRealGaps` is **absent or not an array** (e.g. a partial/legacy LLM envelope, or a deterministic-fallback analysis that omits the field), `gaps` defaults to `0`, which passes `0 > autoApproveMaxGaps(1)` → gate PASSES. The gate treats "we don't know how many reality gaps there are" identically to "we verified there are zero gaps."
- **Root cause**: `?? 0` conflates *absent* (unknown) with *zero* (verified-clean) for a safety signal. A fail-closed gate must treat a missing reality-reflection field as "not verified," not as "passed."
- **Impact**: A case that was never properly grounded against the codebase (the entire point of the human gate) can auto-publish and run the full autonomous hire pipeline — invites sent — without human review, as long as the confidence number alone clears 0.5. Silent erosion of the human-in-the-loop guarantee.
- **Fix sketch**: Require `Array.isArray(analysis?.statedVsRealGaps)` to consider the gap count trustworthy; if the field is absent, route to human (`{pass:false, reason:"reality reflection incomplete — human review"}`) rather than defaulting to 0.

## 4. `setFloor` calibration accepts `NaN`/non-finite — silent no-op recorded as a real change
- **Severity**: Medium
- **Lens**: 🐛 Bug Hunter
- **Category**: Validation gap / silent failure (success theater)
- **File**: `app/api/devcase/outcomes/route.ts:32-36`
- **Scenario**: The outcome POST validates the *outcome-record* path rigorously through `outcomeInputSchema` (good — verified, not re-flagged), but the `setFloor` branch is gated only by `typeof body.setFloor === "number"`. `typeof NaN === "number"` is `true`, so a `NaN` reaches `setPromoteFloor`. There, `Math.max(0, Math.min(100, Math.round(NaN)))` → `NaN`, stored as the string `"NaN"`. On read, `getPromoteFloor` does `Number("NaN")` → `NaN`, `Number.isFinite(NaN)` is false → returns `null` → orchestrator silently falls back to the `DEV_POLICY.promoteFloor` default (`dev-control.ts:86-95`). Meanwhile the route returns `200 {activeFloor}` and writes an audit row `floor → NaN (from calibration)` (line 34).
- **Root cause**: `typeof === "number"` is not a finite-number check, and `setPromoteFloor`'s clamp does not reject non-finite input — it propagates `NaN` into the store, where it is later coerced back to the default with no error surfaced.
- **Impact**: Lower than 1-3 (a JSON body can't carry a literal `NaN`, so this needs a non-JSON/internal caller, and the net effect is a benign fallback). But it is success theater: the human sees "floor set" + an audit trail claiming a calibrated change that never took effect, masking that their calibration action did nothing. `Infinity` similarly slips the typeof check (clamps to 100, so harmless).
- **Fix sketch**: Gate on `Number.isFinite(body.setFloor)` (and optionally a 0..100 range error) at the route, and/or have `setPromoteFloor` throw on non-finite input instead of stringifying `NaN`.
