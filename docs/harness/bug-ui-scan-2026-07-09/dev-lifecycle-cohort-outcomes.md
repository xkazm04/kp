# Dev Lifecycle, Cohort & Outcomes — bug-hunter + ui-perfectionist scan

> Context: Dev-case lifecycle state machine (approve/close/redesign), cohort probe rollups, SLA/stall, the outcome ledger + calibration, and the public Durable Skill Profile credential.
> Files reviewed: 24 of 35
> Total: 5

## 1. Close-case is a TOCTOU race — a double close re-sends a rejection to every non-promoted candidate

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: `app/api/devcase/lifecycle/[id]/close/route.ts:14-70`
- **Scenario**: Two close requests for the same lifecycle overlap — an operator double-clicks across two tabs, a retry fires, or two teammates close at once. Request A reads `lc.stage` (not `"closed"`, line 19), enters the posting loop and hits `await sendComm(...)` (line 47), yielding the event loop. Request B's continuation then runs, reads the same still-open stage, and also loops. Both dispatch the full rejection batch before either reaches `updateLifecycle(id, { stage: "closed" })` at line 70.
- **Root cause**: The `stage === "closed"` short-circuit is a check-then-act guard with an `await` between the check and the terminal write, and the dedup `Set` is per-request (line 30) so it can't suppress a second concurrent pass. The comment at lines 66-68 assumes only *sequential* re-runs, which the guard does handle — but there is no compare-and-swap / lock protecting the concurrent window.
- **Impact**: Every non-promoted submitter receives a duplicate "we won't be moving forward" rejection — a doubled adverse-action comm to candidates (reputational, and awkward under any auditable-comms expectation). Postings are flipped twice and two `closed` audit rows are written.
- **Fix sketch**: Make the transition atomic and self-guarding: flip the stage first via a conditional write (`UPDATE dev_lifecycle SET stage='closing' WHERE id=? AND stage != 'closed'` and bail if `changes === 0`), then notify. That claims the close before any `await`, so a second request no-ops. This makes the whole class (any awaited multi-step lifecycle transition) safe.

## 2. Tampered / invalid Durable Skill Profile still renders its full untrusted score card

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: misleading-affordance
- **File**: `app/skill/[token]/page.tsx:30-36,58-93`
- **Scenario**: A third party opens a skill-profile link whose signature no longer verifies — either genuine tampering, or the ordinary operational event of rotating `KP_SECRET`, which flips *every* previously-issued credential to `valid: false`. The badge shows a small red "tampered" chip (line 45), but the score section below is gated only on `verdict.substantive` (line 58), so the big serif transfer score, confidence %, and all axis bars render exactly as they do for a verified credential.
- **Root cause**: The trust verdict (`valid`) and the substance check (`substantive`) are conflated at the render gate. `substantive` answers "does it have numbers?", not "should we vouch for them?" — so untrusted numbers get full visual prominence directly under a tampered badge, the opposite of the page's own "no green shield over a 0" principle.
- **Impact**: On this public "verified by kp" credential surface, a forged or post-rotation profile presents attacker-/stale-controlled scores as the visual focus; a reader who doesn't parse the badge reads a confident score. Undermines the credential's trust model.
- **Fix sketch**: Gate the score card on `state === "verified"` (valid AND substantive), not on `substantive` alone. For `tampered`/`revoked`, render the muted "summary unavailable" block (line 95) instead of the numbers, so untrusted content is never shown as if attested.

## 3. Refless outcome upsert matches on (candidateRef, outcome) — it silently merges distinct outcomes or duplicates one hire

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: state-corruption
- **File**: `app/_lib/dev-outcomes.ts:117-150`
- **Scenario**: The `/api/devcase/outcomes` POST accepts an outcome with no `ref` (the schema makes `ref` optional). `recordOutcome` then finds the "same" prior row by `TRIM(candidate_ref) = ? AND outcome = ?` (lines 124-127). Two failure modes follow: (a) two different real people who share a `candidateRef` (a common name) and the same outcome collapse into one row — the second UPDATE overwrites the first's `predictedScore`; (b) conversely, a hire auto-recorded by the pipeline under `candidateLabel` (line 179) and then re-recorded manually under a differently-typed name inserts a *second* hired row for the same person.
- **Root cause**: `(candidateRef, outcome)` is used as an identity key but is neither unique nor stable — `ref` (the submission id) is the only real identity, and it's optional. So the refless path guesses, and guesses wrong in both directions.
- **Impact**: `calibrate()` counts decided rows individually and its `MIN RESOLVED` gate is 4 (line 336); a single merge or duplicate can move a band's hire rate and shift the human-facing `suggestedFloor` a whole tier — a silently biased promote-floor recommendation.
- **Fix sketch**: Require `ref` for any human-entered outcome (the UI already knows the submission id), or match refless entries on `(candidateRef, outcome, predictedScore)` and warn on ambiguity rather than blind-updating. Make identity explicit so the calibration sample can't be silently mis-counted.

## 4. A re-evaluated submission keeps its stale public credential — the score card silently diverges from the corrected evaluation

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: `app/_lib/db/skill-profiles.ts:72-118` (with `saveSubmissionEvaluation` at `app/_lib/db/devcase.ts:682-689`)
- **Scenario**: A submission is evaluated and a Durable Skill Profile is minted (token shared with the candidate). The recruiter later re-runs evaluation — e.g. after fixing the rubric — and `saveSubmissionEvaluation` overwrites `eval_json` + `transfer_score`. Any later `issueSkillProfile(submissionId)` returns the *original* profile because the mint is idempotent by `submission_id` on the newest non-revoked row (lines 78-85); it never notices the underlying scores changed.
- **Root cause**: Idempotency is keyed purely on submission identity, with no comparison against the current evaluation content. The credential is treated as immutable, but the evaluation it attests is mutable and there is no reissue/invalidation link between them.
- **Impact**: The candidate's public "verified by kp" credential can attest a score/axes the system no longer believes — stale in either direction — with no signal to viewer or candidate and no way to refresh short of a manual revoke.
- **Fix sketch**: On re-evaluation, auto-revoke (or mark superseded) the live profile for that submission so the next mint issues a fresh signed artifact; or fingerprint the eval content into the idempotency check so a changed evaluation forces a reissue.

## 5. [STILL-OPEN] Skill-profile axis meters have no accessible role/value; a 0-score axis is an invisible bar

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: a11y
- **File**: `app/skill/[token]/page.tsx:79-90`
- **Scenario**: A screen-reader user (or the candidate) opens the public score-card. Each axis renders a label, a raw number, and a `bg-stone-100` track with a `bg-ink` fill whose `width` is the score (lines 85-87). The fill div carries no `role="meter"`/`progressbar`, no `aria-valuenow/min/max`, and no `aria-label`; an axis scoring `0` renders a track with zero-width fill — a visually empty bar next to a "0", indistinguishable from "no data". Still present since the 2026-06-20 scan (prior finding #4) on a public candidate credential, so it still matters.
- **Root cause**: The meter is a purely presentational div; the numeric value lives only in an adjacent visual span, not associated with the bar, and there is no zero/empty treatment.
- **Impact**: Assistive-tech users get the number with no notion of scale or that a bar exists; sighted users see ambiguous empty bars for low/zero axes on a shareable credential.
- **Fix sketch**: Wrap the track in `role="meter"` with `aria-valuenow={score} aria-valuemin={0} aria-valuemax={100}` and an `aria-label` naming the axis; render a faint baseline tick (or a "—") when `score === 0` so an empty bar reads as "low", not "missing".
