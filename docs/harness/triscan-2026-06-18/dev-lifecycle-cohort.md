# Dev Lifecycle, Cohort & Outcomes — Tri-Lens Scan
> Total: 5
> Severity: 1 Critical / 2 High / 2 Medium / 0 Low
> Lens: 3 bug / 1 ui / 1 biz

## 1. Closed posting still accepts submissions via the internal `submit` route
- **Lens**: 🐛 Bug Hunter
- **Severity**: Critical
- **Category**: Lifecycle close-out integrity / silent re-open
- **Value**: impact 8/10 · effort 2/10 · risk 2/10
- **File**: `app/api/devcase/submit/route.ts:25` (via `app/_lib/distribution.ts:66` `intakeSubmission`)
- **Scenario**: A recruiter closes a case. The close route flips every posting to `status='closed'` and tells non-promoted submitters "the intake for this role has now closed". The public `inbound` route correctly answers HTTP 410 for a closed posting (`inbound/route.ts:34`). But `/api/devcase/submit` — and the shared `intakeSubmission` — never read `posting.status`, so a submission posted there is accepted, gets a "we received your submission… reviewed shortly" acknowledgement (`distribution.ts:80`), and calls `resumeCollectingLifecycle`.
- **Root cause**: The closed-posting guard lives only in the `inbound` handler, not in the shared `intakeSubmission` core. `submit` bypasses it entirely.
- **Impact**: A closed case silently re-collects candidates who are promised a review nobody will perform — exactly the ghosting the close-out feature exists to prevent. The lifecycle can also be dragged back into `collecting` work after a human terminated it.
- **Fix sketch**: Move the `status === "closed"` (and ideally `"filled"`) check into `intakeSubmission` so both routes share it; return a typed "intake closed" result the routes surface as 410/409. One guard, both entry points.

## 2. Case close-out is non-atomic — a mid-loop comm failure leaves a half-closed, unflagged lifecycle
- **Lens**: 🐛 Bug Hunter
- **Severity**: High
- **Category**: Partial failure / data integrity
- **File**: `app/api/devcase/lifecycle/[id]/close/route.ts:33-58`
- **Scenario**: Close iterates postings, awaits `sendComm` per non-promoted submitter, then `setPostingStatus(posting.id, "closed")`, and only after the whole loop does `updateLifecycle(id, { stage: "closed" })` + `recordAudit`. If `sendComm` throws on submitter N (relay/network error in `WebhookChannel.deliver` surfacing, or any unexpected throw), the loop aborts: postings already iterated are committed as `closed`, the rest stay open, the lifecycle is NEVER flipped to `closed`, and no audit row is written.
- **Root cause**: No transaction and no try/per-item isolation around a multi-step, partially-side-effecting close. The comment claims "human-gated close-out" but the steps aren't all-or-nothing, and `sendComm` is treated as infallible.
- **Impact**: A lifecycle that looks open (stage unchanged) but has some postings already closed and some submitters notified mid-list. Re-running close re-notifies the already-notified (dedup is per-request `Set`, not persisted), double-messaging candidates with a second rejection.
- **Fix sketch**: Wrap each submitter send in try/catch (count failures, never abort the close); flip posting status and lifecycle stage regardless; OR record an outbox-queued row instead of awaiting live relay. Make the terminal `updateLifecycle`+audit run in a `finally`-style guarantee once postings are processed.

## 3. Skill-profile shows a "verified" badge for a non-evaluated / zero-axis credential
- **Lens**: 🐛 Bug Hunter
- **Severity**: High
- **Category**: Skill-profile verify trust gap / empty-state
- **File**: `app/skill/[token]/page.tsx:24-77` and `app/api/skill-profile/[token]/verify/route.ts:19-30`
- **Scenario**: A profile is minted only from an evaluated submission, but `buildDurableSkillProfile` (`skill-profile.ts:46-61`) clamps a missing transferScore/confidence to `0` and an empty `dimensionScores` to `{}`. If the evaluation bundle lacks dimension scores (or has none mapped), the public card and the verify API both report `valid: true` with a green "Verified by kp" shield, transfer score **0**, confidence **0%**, and no axes — a genuinely-signed but substantively empty credential presented as a real, verified skill attestation.
- **Root cause**: The signature attests *integrity* (untampered) but the page conflates that with *substance*. There is no minimum-content gate at mint or display: zero-axis / zero-score profiles are issued and rendered as verified.
- **Impact**: Undermines the flagship "verified skill credential" differentiator — a third party scanning the badge sees a trusted-looking card that says nothing, or worse, a score of 0 under a green checkmark. Erodes the FICO-style trust model the whole moonshot rests on.
- **Fix sketch**: Refuse to mint when `axes` is empty AND transferScore is 0 (return `not_evaluated`-style result in `issueSkillProfile`, `skill-profiles.ts:65`); on the page, when axes are empty render a muted "summary unavailable" state rather than a confident green verdict.

## 4. Cohort probe-miss + probe-strength panels never render an empty/below-threshold state
- **Lens**: 🎨 UI Perfectionist
- **Severity**: Medium
- **Category**: Empty/loading state · reviewer guidance
- **File**: `app/features/sub_dev/CohortProbePanel.tsx:25` and `app/features/sub_dev/ProbeStrengthBanner.tsx:14`
- **Scenario**: `CohortProbePanel` returns `null` when `evaluatedCount === 0` (no submission scored yet); `ProbeStrengthBanner` returns `null` when `audit.total === 0`. A reviewer at the gate or on a live case sees the panel simply not exist — indistinguishable from "feature missing" or "still loading". With submissions present but none yet evaluated, the cohort insight silently vanishes with no "scores will appear once candidates are evaluated" affordance.
- **Root cause**: Both components treat "nothing to show yet" as "render nothing" rather than as an explicit, explainable empty state — inconsistent with the rest of the studio (OutboxTable, LoadStatus) which render purposeful empties.
- **Impact**: Reviewers can't tell whether the calibration signal is absent, broken, or pending; the cohort-calibration loop (a key value prop) is invisible until enough data accrues, with no breadcrumb that it exists.
- **Fix sketch**: When probes exist but `evaluatedCount === 0`, render a one-line muted hint ("Probe insights appear once submissions are evaluated · N pending"). For `ProbeStrengthBanner`, keep the `total===0` null only when there are genuinely no probes; otherwise show the audit.

## 5. No re-source / fill loop closes the "stalled, re-sourced, still empty" dead-end
- **Lens**: 🚀 Business Visionary
- **Severity**: Medium
- **Category**: Hiring-outcome journey dead-end
- **File**: `app/features/sub_dev/LifecycleRow.tsx:41-59` (stall flag + re-source) · `app/_lib/devcase-sla.ts:21`
- **Scenario**: A stalled lifecycle (open + empty ≥ 7 days) offers a one-click "Re-source". But re-sourcing only ranks the existing candidate DB against the role and re-seeds the pipeline. If the candidate pool is genuinely thin, re-source produces nothing, the row re-stalls, and the recruiter is back to the same two buttons with no escalation path (broaden the search, post to a new channel, or a guided "close + spin a fresh role"). The outcome loop also never learns from a role that *never converted a single submission*.
- **Root cause**: The stall remediation is a single retry of the same internal ranking, with no signal when the pool itself is exhausted and no tie-in to the calibration/outcomes data that would tell the recruiter the role design (not the candidates) is the problem.
- **Impact**: Roles silently die in `collecting`; recruiters churn on re-source with no progress, and the product's "calibration loop" never surfaces the highest-value insight — "this role as designed attracts nobody". A clear differentiator (design-feedback from zero-yield roles) is left on the table.
- **Fix sketch**: After a re-source that yields zero new candidates, surface a distinct "pool exhausted" state with two real next actions (widen sourcing criteria / publish to another channel) and a "redesign the role" link; feed zero-yield roles into the outcomes view as a design-quality signal.
