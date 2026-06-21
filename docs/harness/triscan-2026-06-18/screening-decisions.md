# Screening Decisions & Records — Tri-Lens Scan
> Total: 5
> Severity: 0 Critical / 2 High / 3 Medium / 0 Low
> Lens: 2 bug / 1 ui / 2 biz

## 1. Reinstate reverses a sealed auto-rejection but writes no record into the decision chain
- **Lens**: 🐛 Bug Hunter
- **Severity**: High
- **Category**: Audit-record integrity / completeness
- **Value**: impact 8/10 · effort 3/10 · risk 2/10
- **File**: `app/_lib/db/pipeline.ts:392` (reinstatePipelineEntry) vs `app/_lib/screen-wave.ts:215` (seal on reject)
- **Scenario**: Screen-wave auto-rejects a candidate → `sealDecisionSafe({kind:"auto_rejected", ...})` writes a tamper-evident chain link. A recruiter clicks "Reinstate" in the Reconsider queue → `reinstatePipelineEntry` flips status back to active and writes only a `pipeline_events` row (`kind:"reinstated"`). Nothing is sealed into `decision_records`.
- **Root cause**: The hash chain is wired to the *forward* consequential decision (auto-reject) but not its *reversal*. The two stores (`pipeline_events` vs `decision_records`) are independent; reinstate only touches the former.
- **Impact**: The "System of Record" the DecisionRecordsPanel advertises as tamper-evident proof is silently incomplete: the dossier shows the candidate was auto-rejected, with no sealed evidence the decision was later reversed (or by whom). For a legally-auditable hiring record this is the exact gap an auditor would probe — a reversal is itself a consequential decision.
- **Fix sketch**: In `reinstatePipelineEntry` (or the reinstate route), on a successful reversal call `sealDecisionSafe({ kind:"reinstated", actor:"human:recruiter", policyVersion:"reconsider", candidateRef:id, rationale:"Auto-rejection reversed for re-review", reasonCode:"reinstate", inputs:{ priorStatus:"rejected" } })`. Add `reinstated` to the records UI kind styling.

## 2. verifyDecisionChain cannot detect tail-truncation (deletion of the newest records)
- **Lens**: 🐛 Bug Hunter
- **Severity**: High
- **Category**: Tamper-evidence / decision-hash integrity
- **File**: `app/_lib/decision-record-store.ts:175` (verifyDecisionChain)
- **Scenario**: An actor with DB access deletes the last K rows of `decision_records` (e.g. removing evidence of three controversial auto-rejections from this morning). On the next load, verify re-derives over the *remaining* rows starting from genesis `""`; every surviving link still chains correctly, so it returns `{ ok:true }`. The DecisionRecordsPanel renders the green "Verified" ShieldCheck.
- **Root cause**: A pure prev-hash chain only proves the *retained* records are internally consistent. With AUTOINCREMENT `seq` reset on a tail delete (and no anchored expected-count, signature, or external high-water mark), removing the suffix is indistinguishable from "those decisions never happened." The test suite (`decision-hash.test.ts:50`) only covers middle-edit/reorder, not truncation.
- **Impact**: The headline feature — "tamper-evident proof, not just a log" — gives a false green verdict for the single most attractive tampering vector (delete the damaging recent rows). Undermines the compliance differentiator.
- **Fix sketch**: Persist a monotonic high-water mark (max seq + head content_hash) in a separate single-row table / external store updated on every seal; in verify, assert the live chain's count/last-hash matches or exceeds it, else `ok:false`. Add a truncation test. (Even a logged "expected ≥N records, found M" warning closes the silent-green case.)

## 3. Sealed `inputs` snapshot is too thin to actually explain a per-candidate rejection
- **Lens**: 🚀 Business Visionary
- **Severity**: Medium
- **Category**: Explainability / defensible-decision depth
- **File**: `app/_lib/screen-wave.ts:222` (`inputs: reasonParams`)
- **Scenario**: An auto-rejected candidate (or auditor) requests the basis for the decision. The sealed record's `inputs` is only `reasonParams` = `{pct, n, count, rank, score, threshold, tieAdjusted}`. It records *that* the candidate ranked low, but not the cohort scores it was ranked against, the candidate's archetype, or the fairness-gate evaluation — the actual decisive evidence.
- **Root cause**: `inputs` reuses the modal's interpolation params rather than a purpose-built decision snapshot. The fairness check, archetype, and the comparative score distribution (the thing that makes "bottom 20%" meaningful) are computed in the loop but never sealed.
- **Impact**: The record is replayable as arithmetic but not *defensible* as an explanation — it can't answer "why this candidate and not the one ranked just above." For an AI-hiring product whose pitch is auditable/defensible decisions, the moonshot's own promise ("the inputs it saw") is under-delivered.
- **Fix sketch**: Seal a richer `inputs`: `{ matchScore, archetype, protectedFromAutoReject, knownArchetype, cohortSize:n, effectiveCutoffScore: sorted[effectiveBottomCount-1]?.score, rank }`. Keep `reasonParams` as a sub-key for the localized rendering. No schema change (it's JSON in `payload_json`).

## 4. Per-candidate "right to explanation" dossier is built but unreachable from the UI
- **Lens**: 🚀 Business Visionary
- **Severity**: Medium
- **Category**: Journey dead-end / built-but-unwired
- **File**: `app/api/decisions/records/route.ts:16` (`?candidate=` param) vs `app/features/sub_analytics/DecisionRecordsPanel.tsx:25`
- **Scenario**: The records route supports `?candidate=<entryId>` to scope the chain to one subject — documented as "the right-to-explanation dossier." But the only consumer, DecisionRecordsPanel, fetches `/api/decisions/records` with no param, and the Reconsider/Decisions UI offers no "view this candidate's sealed record" affordance. The scoped dossier is dead code from the user's perspective.
- **Root cause**: Backend capability shipped ahead of the UI entry point; the candidate-scoped path was never linked from the candidate-centric surfaces (Reconsider row, AnalysisSummaryModal).
- **Impact**: The single most valuable compliance interaction — "show me everything we sealed about *this* applicant, with the verify badge" — can't be performed without hand-crafting a URL. The differentiator is invisible exactly where a recruiter/auditor would reach for it.
- **Fix sketch**: Add a "View decision record" link on the Reconsider row and/or AnalysisSummaryModal that opens a candidate-scoped records view (`/api/decisions/records?candidate=<id>`), reusing DecisionRecordsPanel with a `candidateRef` prop. Note: the global chain verdict should stay global (integrity is chain-wide) even when the list is scoped — keep that distinction in the header copy.

## 5. ScreenWaveModal commit count can mismatch the previewed cohort (debounced in-flight preview)
- **Lens**: 🎨 UI Perfectionist
- **Severity**: Medium
- **Category**: Stale-preview / commit-accuracy of an irreversible action
- **File**: `app/features/sub_decisions/ScreenWaveModal.tsx:198` (commit button) + `:57` (350ms debounced preview)
- **Scenario**: Recruiter drags the bottom-% slider to 40%, and within the 350ms debounce window clicks "Reject N and notify". The button is gated on `loading`, but the gate only reflects the *previous* settled preview; if a new debounced fetch hasn't started yet (`loading` still false from the prior settle) the displayed `rejects` list and the "Reject {count}" label can reflect the older slider value while the commit POSTs the *current* slider override. The committed set then differs from the visibly-approved one.
- **Root cause**: The commit override `override()` reads live slider state, but the rendered `rejects`/`count` come from the last `preview` response. There's no "preview matches current controls" invariant before enabling commit.
- **Impact**: For an irreversible action (status flips + queued rejection emails), the recruiter can authorize a different number/set of rejections than the screen showed — a confidence/trust break on the product's most consequential button. Server CAS protects data integrity, but not the recruiter's informed consent.
- **Fix sketch**: Track the override the current `preview` was computed for; disable commit (or show "recomputing…") whenever live controls differ from the previewed override, until a fresh preview settles. Cheap: store `previewedOverride` alongside `preview` and compare in the disabled/title logic.
