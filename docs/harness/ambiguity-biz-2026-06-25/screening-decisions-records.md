# Screening Decisions & Records — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀3 / 🚀2 | Severity: C0/H3/M2/L0

## 1. Human advance/reject decisions are never sealed into the tamper-evident chain
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: auditability gap / asymmetric audit
- **File**: app/api/pipeline/[id]/route.ts:239
- **Observation**: The "Decision System of Record" seals AI auto-rejections (screen-wave.ts:262), group-eval verdicts (group-eval-run.ts:419/432), offer terms (route.ts:51), and even reinstatements (route.ts:174) into the hash chain. But the most consequential HUMAN decisions — the recruiter's direct accept/reject in the Decisions queue and the ratification of an AI screening — flow through `actOnPipelineEntry` + `dispatchRejection` (lines 225–239) with NO `sealDecisionSafe` call. The recruiter's typed reason (DEC4 `detail`) lands only on a mutable pipeline event, not the immutable chain.
- **Why it matters**: The records route advertises `?candidate=<id>` as "the right to explanation dossier" (records/route.ts:11). A candidate rejected by a human recruiter has an EMPTY sealed dossier — the chain proves only what the machine did, not what people did. For a product whose differentiator is "auditable AI decisions," recording the AI rejections tamper-evidently but leaving the human gate decisions out of the chain is exactly backwards for Art. 22 / EU AI Act defensibility, and it makes the integrity proof partial.
- **Recommendation**: In the `accept`/`reject` branch, call `sealDecisionSafe({ kind: action === "reject" ? "rejected" : "advanced", actor: "human:recruiter", policyVersion: "manual", candidateRef: id, rationale: detail ?? ..., reasonCode: action, inputs: { fromStage, detail } })` — mirroring the reinstate seal already a few lines above.
- **Effort**: M

## 2. Every in-app rejection wave records "approved by operator" — the Art. 22 approver is never a real identity
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: undocumented trade-off / hollow compliance control
- **File**: app/features/sub_decisions/ScreenWaveModal.tsx:107
- **Observation**: The commit body the modal sends is `{ jobId, override, dryRun:false, approvalToken }` — it never includes `approvedBy`. Server-side both the route (screen-wave/route.ts:43) and `runScreenWave` (screen-wave.ts:185) then fall back to the literal `"operator (in-app approval)"` / `"operator"`. That placeholder is written verbatim into the sealed record's rationale ("· approved by operator…") and `inputs.approvedBy` (screen-wave.ts:221, 270). The approval token itself signs only the candidate set + policy version — not who approved it — so the gate is satisfied by echoing a token, with no authenticated human attached.
- **Why it matters**: The whole gate is justified in-code as "no solely-automated adverse decision (EU AI Act / GDPR Art. 22)". But the immutable record's central claim — WHO the human reviewer was — is a constant string for 100% of in-app commits. In a dispute or audit, "approved by operator" proves nobody in particular reviewed it; the human-in-the-loop is procedural (a modal click), not evidenced.
- **Recommendation**: Pass the signed-in user/email as `approvedBy` from the modal, and incorporate the approver identity into the token signature so the sealed record names a real, non-defaultable reviewer. If the app is genuinely single-operator, document that explicitly so the placeholder is a known, intentional posture rather than a silent gap.
- **Effort**: S

## 3. The per-candidate "right to explanation" dossier is built but never surfaced
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: dark capability / compliance differentiation
- **File**: app/features/sub_analytics/DecisionRecordsPanel.tsx:26
- **Observation**: The records API already supports candidate-scoped retrieval (`?candidate=<entryId>`, records/route.ts:16) and the comment literally calls it "the 'right to explanation' dossier." Yet the only consumer fetches `/api/decisions/records` with NO candidate parameter, and "Export dossier" dumps the ENTIRE chain as one `decision-records.json` blob (line 52–61). There is no way to produce, view, or hand a candidate THEIR decision record — the exact GDPR DSAR / Art. 22 artifact the backend was designed to serve.
- **Why it matters**: kp's stated differentiator is auditable, explainable AI hiring decisions — a real enterprise sales lever (EU AI Act compliance is becoming a procurement gate). A one-click, candidate-scoped, verifiable dossier is a concrete monetizable feature (compliance tier / per-export) and a candidate-trust signal. The capability is finished server-side and left unwired — kp's known "built-but-unsurfaced" pattern, here on the highest-value compliance surface.
- **Recommendation**: Add a per-candidate dossier action (from the pipeline drawer / candidate page) that calls `/api/decisions/records?candidate=<id>`, renders the verify badge + that candidate's links, and exports a single-subject PDF/JSON. Gate it as a paid compliance feature.
- **Effort**: M

## 4. The auto-rejected "Reconsider" pool is a silver-medalist talent asset reduced to a manual one-by-one button
- **Lens**: 🚀 Business
- **Severity**: Medium
- **Category**: retention / value left on the table
- **File**: app/features/sub_decisions/DecisionsTab.tsx:415
- **Observation**: The Reconsider section lists auto-rejected candidates with a single per-row "Reinstate" action that only puts them back at Screened for the SAME role (reinstate → reinstatePipelineEntry). These are already-sourced, already-scored candidates the system has full match data on. There is no re-match to OTHER open roles, no bulk re-engagement, no "notify me when a fitting role opens," and reinstate captures no recruiter reason (it seals a fixed "Auto-rejection reversed for re-review", route.ts:179).
- **Why it matters**: Re-surfacing a previously-rejected-but-qualified candidate to a newly-opened role is the classic "silver medalist" lever — it avoids re-sourcing cost and shortens time-to-fill, a measurable recruiter pain point and a retention/growth story for the product. Today that pool is write-once-then-forgotten unless a recruiter manually clicks each one back into the role that already passed on them.
- **Recommendation**: Add "re-match to open roles" on the reconsider row (reuse the existing matcher) and an optional reason field on reinstate (feed it into the sealed reversal record). Optionally surface a "talent pool" rollup of reconsiderable candidates by skill.
- **Effort**: M

## 5. `maxMatchToReject: 45` is an unexplained auto-rejection threshold
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: magic number / undocumented constant
- **File**: app/_lib/decision-config-schema.ts:25
- **Observation**: `SCREENING_DEFAULT.maxMatchToReject = 45` is the default match score below which a bottom-% candidate becomes eligible for irreversible auto-rejection. The sibling `rejectBottomPercent: 20` and the small-cohort/tie-break policies are all extensively justified in comments (lines 187–258), but the `45` cutoff — arguably the single number that most directly decides who the machine rejects — has no recorded rationale: why 45 and not 40 or 50, what score distribution it assumes, or how it relates to the match engine's tiers.
- **Why it matters**: A recruiter enabling auto-reject inherits 45 as "the system's opinion of unacceptable" with zero explanation, and a future maintainer can't tell whether it is calibrated or arbitrary. Even though auto-reject is opt-in (off by default), once on, this constant silently gates real adverse hiring outcomes — exactly the kind of decision the module elsewhere insists must carry recorded reasoning.
- **Recommendation**: Add a comment documenting the basis for 45 (relate it to the match engine's fit tiers / observed score distribution), and surface a short "what 45 means" hint in DecisionRulesModal next to the threshold input.
- **Effort**: S
