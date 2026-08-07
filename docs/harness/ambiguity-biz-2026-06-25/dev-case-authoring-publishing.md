# Dev Case Authoring & Publishing — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀3 / 🚀2 | Severity: C0/H4/M1/L0

## 1. Multi-channel distribution is built and framed in the UI but only the "local" stub exists
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: dark capability / monetization
- **File**: app/_lib/distribution.ts:48
- **Observation**: The whole distribution seam is a pluggable `DistributionAdapter` interface ("email / ATS / job board", per the file header), `publish()` and the `Posting` carry a `channel`, the publish route forwards `body.channel` (app/api/devcase/publish/route.ts:14), and CaseDetail renders a per-channel "Apply channels" grid plus a cross-channel "Shortlist — all channels" leaderboard (app/features/sub_dev/CaseDetail.tsx:193). Yet `ADAPTERS` contains only `{ local }`, and `getAdapter()` silently falls back to local for any unknown channel (distribution.ts:53–54) — so a publish to "linkedin"/"ats" would return a posting tagged `local` with no error. The multi-channel product exists everywhere except the one place that matters.
- **Why it matters**: This is the most obvious monetizable expansion in the context — paid ATS/job-board/email connectors are exactly what recruiting SaaS upsells on, and the candidate-facing UI already promises "all channels." Shipping the second real adapter turns existing UI into revenue; the silent fallback also means a future caller can mis-route a live posting with no signal.
- **Recommendation**: Implement one real outbound adapter (start with an email/job-board webhook), make `getAdapter` throw on an unregistered channel instead of falling back, and gate non-local channels behind a plan/entitlement so the "all channels" UI becomes a paid feature.
- **Effort**: M

## 2. The verified-skills talent graph + "Source DB" re-sourcing flywheel is the buried killer feature
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: retention / data moat / unsurfaced value
- **File**: app/_lib/devcase-run.ts:312
- **Observation**: Every evaluated/promoted submission durably credits "observed-provenance" skills onto the candidate profile (`mintObservedFromSubmission`, devcase-run.ts:312; the interview twin at :239), and `runSourceForRole` (:527) ranks that same profile DB against a new role and seeds the pipeline at "Accepted" for free (`seedPipelineFromMatches`, :565). So each dev case makes the next role's sourcing measurably better — a compounding, verified-skills data moat. But the only entry point is a tiny secondary "Source DB" button in CaseDetail (app/features/sub_dev/CaseDetail.tsx:127), and nothing surfaces "verified by N dev cases" on a candidate, re-engages non-promoted-but-strong submitters, or reports the pool's growth.
- **Why it matters**: Sourcing from your own pool is a recruiter's highest-ROI action (free vs. paid inbound), and a proprietary verified-skills graph is the durable differentiator vs. gameable test platforms. Today the asset accrues invisibly and the action that unlocks it looks like a minor utility — value left entirely on the table.
- **Recommendation**: Promote "Source from your verified pool" to a first-class CTA at role-definition time, badge candidate profiles with their observed-skill provenance ("verified in N cases"), and add a talent-pool re-engagement surface for high-scoring non-hires. Consider metering verified-pool size as a plan dimension.
- **Effort**: M

## 3. Auto-approve gate thresholds are unexplained magic numbers with no calibration path
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: magic numbers / decision lacking recorded reasoning
- **File**: app/_lib/devcase-orchestrator.ts:32
- **Observation**: `DEV_POLICY` hardcodes `autoApproveMinConfidence: 0.5` and `autoApproveMaxGaps: 1` (devcase-orchestrator.ts:32–33) as the line that decides whether a developer-hiring case skips human review and auto-publishes to candidates. There's no recorded rationale for *why* 0.5 (a coin-flip) or 1 gap, and — unlike `promoteFloor`, which is deliberately runtime-calibratable via `dev_control` (`getPromoteFloor`, app/_lib/dev-control.ts:83) — these two thresholds are constants with no operator knob. The asymmetry (one gating number is tuned from outcomes, two equally consequential ones are frozen) is itself undocumented.
- **Why it matters**: These constants govern fully-autonomous publication of a hiring artifact. "0.5 confidence is good enough to skip a human" is a strong, contestable claim recorded nowhere; an operator who finds auto-approve too loose/strict has no lever and would have to ship code to change it.
- **Recommendation**: Document the basis for each threshold (even "conservative placeholder pending outcome data"), and either route both through `dev_control` like the promote floor or explicitly record why they are intentionally non-calibratable.
- **Effort**: S

## 4. Manually-published postings can never be closed — apply tokens stay open forever
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: unhandled edge case / undocumented assumption
- **File**: app/api/devcase/publish/route.ts:14
- **Observation**: The CaseDetail "Publish" button (app/features/sub_dev/CaseDetail.tsx:121) mints a posting + apply token via `/api/devcase/publish` for any approved case — including cases approved through the manual "Analyze → design → approve" path, which create **no** lifecycle (POST /api/devcase only calls `saveDevCase`). But the close-out that flips a posting to `closed` (`setPostingStatus(... "closed")`) lives solely in the lifecycle close route, which requires `getLifecycle(id)` (app/api/devcase/lifecycle/[id]/close/route.ts:18–20). That route's own header says it was built because "the never-expiring apply token kept collecting applications nobody would process" — yet it only fixes lifecycle-driven cases. A manually-published case has no lifecycle, so its token never closes, `intakeSubmission`'s `status === "closed"` guard can never fire for it, and there is no application-deadline/expiry concept anywhere.
- **Why it matters**: Silent, indefinite candidate ghosting for an entire publish path the team already recognized as harmful — exactly the failure mode the close-out exists to prevent. Recruiters also routinely need application deadlines / closeable links, which simply don't exist.
- **Recommendation**: Surface a "Close posting" action that works on a posting id directly (not just a lifecycle), and add an optional posting deadline/auto-close. At minimum, document that manually-published tokens are permanent and require a lifecycle to close.
- **Effort**: M

## 5. The auto-approve gate is blind to *design* provenance — a template-only (ungrounded) case can auto-publish
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: happy-path-only / orchestration partial failure
- **File**: app/_lib/devcase-orchestrator.ts:45
- **Observation**: `gateApproval(lc.analysis)` decides auto-publish purely from the *need-analysis* confidence and `statedVsRealGaps` (devcase-orchestrator.ts:45–61, called at :120). It never inspects whether the **design step** actually used the LLM: `runDesignArtifacts` returns `source`/`perStepSources` ("llm" vs "deterministic", devcase-run.ts:150), but those are not part of the gate. So if the analysis was confident (e.g. grounded from cache) while the design LLM call fell back to a deterministic template, the gate can auto-approve and auto-publish a generic, non-case-grounded assignment to candidates. The UI honestly badges this degradation after the fact (`scenarioDegraded`/`seedDegraded`, CaseDetail.tsx:82–83), but by then it's already live.
- **Why it matters**: This is a silent-quality hole in the core promise — candidates receive a templated assignment presented as a bespoke, codebase-grounded case, and a degraded design auto-ships on the strength of an unrelated signal (analysis confidence). It's the one orchestration partial-failure the otherwise-meticulous best-effort handling doesn't guard at the gate.
- **Recommendation**: Persist the design's `source`/`perStepSources` onto the lifecycle and fail the auto-approve gate closed when the role/case generation was not fully `llm` (route to human), mirroring the existing fail-closed treatment of missing reality-reflection.
- **Effort**: S
