# Dev Case Authoring & Publishing — ambiguity-guardian + ui-perfectionist scan

> Total: 6 findings (0 critical, 2 high, 3 medium, 1 low)

## 1. Manual publish route bypasses the freeze-at-publish contract (no seed/scenario materialization, no dedup, no audit)
- **Severity**: High
- **Lens**: ambiguity
- **Category**: parallel-path-drift
- **File**: `app/api/devcase/publish/route.ts:13`
- **Scenario**: A recruiter approves a case via the manual Define-need flow and clicks Publish in CaseDetail. The route calls `getAdapter(channel).publish(devCase)` directly — the case goes live with NO interview scenario and NO materialized seed, so candidates get prose-only materials and a different submit surface than lifecycle-published cases. A retry/second tab also mints a duplicate posting: the orchestrator's own comment (devcase-orchestrator.ts:162) states `createPosting` has no caseId dedup, and unlike the lifecycle path there is no persisted `postingId` guard here. No `recordAudit` row is written either, while every lifecycle publish is audited.
- **Root cause**: The FREEZE-AT-PUBLISH hardening (devcase-orchestrator.ts:146-241) was implemented only inside the lifecycle `approved` handler; the standalone publish route is a parallel writer to the same posting store that predates it and was never updated — the same "parallel write path sidesteps the hardened path" shape that `/api/devcase` POST already had to fix for the probe gate.
- **Impact**: Candidates on manually-published cases receive non-comparable, prose-only assignments (the exact comparability failure the freeze fix documents); duplicate live apply tokens can be minted for one case; human publish decisions leave no trace in the `dev_audit` oversight log the control surface renders.
- **Fix sketch**: Extract the orchestrator's `approved`-stage block (scenario-if-absent → seed-if-absent → publish-with-persisted-postingId) into a shared `publishDevCase(devCase, lifecycle?)` helper and call it from both the lifecycle handler and this route. In the route, first look up an existing posting for the caseId and return it instead of minting a second; add a `recordAudit({actor: "human", action: "published", ref})` row.

## 2. Manual approve in DevTab silently swallows failures — a probe-gate block looks like a dead button
- **Severity**: High
- **Lens**: ui
- **Category**: missing-error-state
- **File**: `app/features/sub_dev/DevTab.tsx:323`
- **Scenario**: In the Define-need flow the user clicks "Approve" on a designed case whose probes fail the probe-strength gate (`enforceProbeGate` in `/api/devcase` POST returns a structured error + code + verdict). The button spins, then nothing happens — no banner, no explanation, no way to proceed. Every other write action on this tab (`publish`, `source`, `runLifecycle`) routes through `runAction` and surfaces failures via the `actionError` banner; `approve()` is the one hold-out that does a bare `fetch` and only acts `if (r.ok)`.
- **Root cause**: When the shared `runAction` error surface was added (comment at DevTab.tsx:69: "The write actions below previously swallowed every error"), `approve()` was not migrated. Additionally, the API supports `overrideProbeAudit: true` for a deliberate human override, but this UI path never exposes it, so a gate-blocked manual approval is a hard dead end.
- **Impact**: The strictest quality gate in the flow is invisible to the person it addresses: authors retry a "broken" button, and a weak-probe case can neither be knowingly overridden nor understood as blocked. The gate's carefully structured `error`/`verdict` payload is discarded.
- **Fix sketch**: Route `approve()` through `runAction("Approve", …)` so non-OK responses land in the existing `actionError` banner with the server's message. When the response carries the probe-gate `code`, render the verdict plus an explicit "approve anyway" affordance that re-posts with `overrideProbeAudit: true` (mirroring the audited override contract the route already supports).

## 3. The "degraded" publish acknowledgement fires on degraded artifacts but not on absent ones
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: absent-vs-degraded-conflation
- **File**: `app/features/sub_dev/CaseDetail.tsx:86`
- **Scenario**: A case approved through the manual flow never gets a scenario or seed (see finding 1), so `kase.scenario` and `kase.seed` are null. `scenarioDegraded`/`seedDegraded` both compute false (they require `source != null && source !== "llm"`), so `isDegradedPublish` returns false and the confirm dialog shows the clean, no-checkbox path — even though the candidate will receive strictly less than a "degraded" template case (no starter files, no interview scenario at all).
- **Root cause**: The `source != null` guard exists for legacy records saved before provenance was persisted (a reasonable grandfather clause, mirrored in `gateApproval`), but CaseDetail reuses it for a different question — "is this case ready to hand to candidates?" — where absence is the worst state, not a neutral one. `CaseDetail.publish.ts` only models `scenarioDegraded`/`seedDegraded` booleans, so "missing entirely" is unrepresentable.
- **Impact**: The publish confirm gate is weakest exactly where the case is weakest: fully-degraded (template) cases require an explicit acknowledgement while empty ones sail through, and the author gets no signal that candidates will see a prose-only brief with no seed and interviewers will have no scenario.
- **Fix sketch**: Extend `PublishGateInput` with `scenarioMissing`/`seedMissing` (scenario/seed strictly null on the record) and include them in `isDegradedPublish` + `degradedReasons` with their own copy ("No interview scenario has been generated for this case", "No starter-file seed…"). Keep the legacy-provenance exemption only for records that *have* a blob without a `source` field.

## 4. Sourcing UI discards the `skipped`/`skippedReasons` honesty signal the API deliberately surfaces
- **Severity**: Medium
- **Lens**: ui
- **Category**: silent-degradation
- **File**: `app/features/sub_dev/DevTab.tsx:272`
- **Scenario**: The user clicks "Source DB" on a case. Every candidate payload in the pool fails `CandidateProfileV2` validation, so the API returns `{ added: 0, skipped: 40, skippedReasons: […] }` — its own comment says these fields exist "so the UI can be honest about an empty shortlist". The `onOk` handler reads only `added`, and the button label becomes "Sourced 0": indistinguishable from "nobody in the pool qualified".
- **Root cause**: `source()` in DevTab stores just `Number(body.added)` into `sourcedCounts`; `skipped` and `skippedReasons` are dropped on the floor, so the backend's carefully-drawn distinction (source/route.ts:22, `SourceOutcome` in devcase-run.ts:539) never reaches a pixel.
- **Impact**: A broken candidate pool reads as an honest empty shortlist — the recruiter concludes the database has no fits and moves on, when the truth is the pool failed to parse and is fixable. This is the exact wrong-decision failure the backend plumbing was built to prevent.
- **Fix sketch**: Store `{ added, skipped }` in `sourcedCounts` and render "Sourced 0 · 40 unparseable" (with a `title` or expandable note listing top `skippedReasons`) when `skipped > 0`. When `added === 0 && skipped > 0`, surface it through the existing `actionError`-style banner as a warning rather than a success label.

## 5. Sourcing floor/topN are hardcoded magic numbers that silently diverge from the calibrated promote floor
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: magic-numbers
- **File**: `app/_lib/devcase-run.ts:551`
- **Scenario**: An operator uses the outcome-loop calibration to raise the promote floor to 70 (`dev_control.promote_floor`). Publishing a case then proactively sources candidates with `runSourceForRole(role)` — which quietly uses its default `floor = 45` and `topN = 8` — seeding the pipeline at "Accepted" with candidates scoring 45-69, below the bar the same operator just declared. Neither 45 nor 8 is documented, configurable, or related to any other threshold in the system.
- **Root cause**: `DEV_POLICY` documents and centralizes the promote thresholds (and `activePromoteFloor()` exists precisely so "the floor the pipeline promotes against can never diverge from the one the calibration UI shows" — devcase-orchestrator.ts:39), but the sourcing defaults were defined inline as parameter defaults with no rationale comment and no tie to that mechanism. No production caller ever passes `floor`/`topN`, so the defaults ARE the policy.
- **Impact**: Two floors govern who enters the pipeline and only one is visible/tunable; sourced candidates enter at the *higher-trust* "Accepted" stage under the *lower* bar. Future developers have no way to know whether 45 is a deliberate "wider net for sourcing" decision or an arbitrary placeholder.
- **Fix sketch**: Move the sourcing defaults into `DEV_POLICY` (e.g. `sourceFloor`, `sourceTopN`) beside the promote thresholds, with a one-line recorded rationale for why the sourcing floor sits below the promote floor (wider net, humans review Accepted entries). If the divergence is *not* intentional, derive it from `activePromoteFloor()` instead.

## 6. Clipboard failure in ApplyTokenPill is a silent no-op — the user believes the apply link was copied
- **Severity**: Low
- **Lens**: ui
- **Category**: missing-error-feedback
- **File**: `app/features/sub_dev/ApplyTokenPill.tsx:38`
- **Scenario**: A recruiter on an insecure/proxied origin (or with clipboard permission denied) taps the apply-token pill to copy the candidate link. `navigator.clipboard.writeText` rejects, the `catch` swallows it, and the pill just… stays as it was. Having seen the "Copied!" behavior before, the user pastes into an email and sends the candidate their previous clipboard contents — or nothing.
- **Root cause**: The `copy()` handler's catch block is an explicit no-op ("clipboard unavailable — no-op"), so the failure state renders identically to not having clicked; only the success path has feedback.
- **Impact**: The apply link is the single artifact this whole flow exists to hand out; a silently failed copy directly breaks candidate outreach in exactly the environments (http intranet, hardened browsers) where clipboard APIs fail.
- **Fix sketch**: On catch, set a `failed` state that briefly renders the pill in the coral error tint with "Copy failed — select manually" (and switch the pill text to the full URL, or select the token text) so the user has a manual path. Reuse the existing 1.5s timer pattern for the transient state.
