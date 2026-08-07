# Group Evaluation & Fairness — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀3 / 🚀2 | Severity: C1/H1/M3/L0

## 1. "Fairness Check" measures weight-scheme robustness, not bias / adverse-impact fairness
- **Lens**: 🌀 Ambiguity
- **Severity**: Critical
- **Category**: misleading label / false assurance
- **File**: app/features/sub_decisions/group-eval/FairnessPanel.tsx:6 (also types.ts:7, group-eval-run.ts:476-479)
- **Observation**: The panel titled "Fairness Check" (and the `Fairness` type, the "robust order agrees/diverges" verdict) checks ONE thing: does the ranking hold when each candidate is re-scored under every candidate's *bounded dynamic weight vector*. That is weight-sensitivity analysis. It does NOT measure demographic disparate impact / adverse impact (the regulatory meaning of "fairness" in hiring — EEOC 4/5ths, NYC LL144, EU AI Act). The governance note itself admits "the app holds no demographic/veteran data" (group-eval-governance.ts:39-46), yet nothing on the panel says the fairness check is silent on protected-class bias.
- **Why it matters**: A recruiter (or a buyer in a demo) sees a green "Fairness Check · robust order agrees" and reasonably concludes the tool has cleared the candidate ranking of bias/EEO concerns. It has done nothing of the kind. In a regulated hire that is a documented false assurance — a correctness AND legal-exposure risk that undermines the core promise of the feature's own name.
- **Recommendation**: Rename to something honest ("Weighting Robustness" / "Weight-Sensitivity Check") OR add a one-line scope disclaimer ("Checks ranking stability under different scoring emphases — does not assess demographic bias; the app holds no protected-class data"). Cheapest: i18n copy change next to `fairnessExplain`.
- **Effort**: S

## 2. Per-role fairness matrices + sealed decision records exist, but no exportable bias-audit / compliance report
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: monetization / regulatory differentiator / value left on the table
- **File**: app/_lib/group-eval-run.ts:418-441 (seals decision records) & :479 (fairness persisted only inside `payload_json`); app/api/decisions/group-eval/route.ts:11 (read-only GET, no export)
- **Observation**: Every group eval already (a) computes a cross-scheme fairness matrix, (b) records the AI's weight source + per-candidate rationale, and (c) seals a `group_eval_lead`/`group_eval_advisory` decision record with a policy version. All the raw material for an auditable hiring-decision trail is being produced — then buried in a per-role `group_evals.payload_json` blob with no aggregation and a read-only single-role route. There is no "export bias audit" / "compliance pack" surface anywhere (the records route exists but doesn't carry the fairness data).
- **Why it matters**: NYC Local Law 144 mandates an annual independent bias audit for automated employment decision tools; the EU AI Act classes hiring AI as high-risk requiring documented fairness assessment. For a recruiting SaaS this is both a hard sales objection and a premium upsell. kp is one aggregation + PDF/CSV export away from "compliance-ready hiring AI" — a top-of-funnel differentiator competitors charge for — and is shipping the data to /dev/null instead.
- **Recommendation**: Add an export endpoint that aggregates sealed group-eval decision records + their fairness matrices into a per-role/period bias-audit artifact (CSV/PDF). Gate it as a paid "Compliance" tier. Reuse the existing `decision-record-store` + `payload_json`.
- **Effort**: M

## 3. Hardcoded `55` lower-fit risk threshold silently duplicates FIT_PROMISING_THRESHOLD
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: magic number / duplicated constant
- **File**: app/_lib/group-eval-run.ts:384 (`c.score > 0 && c.score < 55`) vs pipeline/jobfit/matching.py:70 (`FIT_PROMISING_THRESHOLD = 55`)
- **Observation**: The risk synthesizer flags "lower fit — confirm must-haves at interview" for any candidate scoring below a bare inline `55`. That `55` is not arbitrary — it is exactly the Python pipeline's `FIT_PROMISING_THRESHOLD`, the documented "SINGLE SOURCE OF TRUTH" for the strong/promising/partial banding. But the TS layer re-hardcodes it with no comment, no import, and no link to that source of truth.
- **Why it matters**: The "lower fit" risk is meant to mean "below promising tier (i.e. partial)". If anyone tunes `FIT_PROMISING_THRESHOLD` Python-side (its whole point is to be the one knob), the modal's risk flag silently drifts out of sync — flagging promising candidates as risky or letting partial ones pass unflagged. It is decision-relevant tribal knowledge masquerading as a literal.
- **Recommendation**: Surface the tier thresholds (or a `fitTier === "partial"` check) to the TS side and derive the risk from the tier, or at minimum add a comment naming `FIT_PROMISING_THRESHOLD` so the coupling is visible.
- **Effort**: S

## 4. Fairness panel self-suppresses when weighting is uniform — the marquee feature is invisible in the common no-LLM case
- **Lens**: 🚀 Business
- **Severity**: Medium
- **Category**: dark capability / discoverability
- **File**: app/features/sub_decisions/group-eval/FairnessPanel.tsx:20 (`if (!adjusted) … return fairnessUniform`)
- **Observation**: The full matrix renders only when `weightNotes` is non-empty for some candidate. In the deterministic path (`propose_weights`, matching.py:528) notes are appended ONLY when a candidate backs the role's must-haves with high-trust evidence. For early-career / dev-case pools (a product focus) and any run without an LLM key, that's frequently empty → the whole fairness matrix collapses to a single "fairnessUniform" sentence.
- **Why it matters**: The fairness check is exactly the regulatory/sales differentiator the product should be showing off, yet it hides itself precisely in the default (free, deterministic) configuration most prospects will first experience. A uniform-but-shown matrix is still positive evidence of diligence ("we checked, ranking is robust"); suppressing it makes the headline capability look absent.
- **Recommendation**: Always render the matrix (or a compact "robust under all weightings ✓" card) even when uniform, with copy that frames uniformity as a passed check rather than a non-event.
- **Effort**: S

## 5. Fairness weight bounds (0.15 / 0.10 / 0.60, 0.04 bump) — the ranking levers — lack recorded calibration rationale or a boundary fairness test
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: magic numbers / undocumented trade-off
- **File**: pipeline/jobfit/matching.py:461-463 (`_WEIGHT_MAX_DELTA=0.15`, `_WEIGHT_FLOOR=0.10`, `_WEIGHT_CEIL=0.60`) & :529 (`bump = min(0.12, 0.04 * len(relevant_strong))`)
- **Observation**: These four constants govern how far per-candidate dynamic weighting may move — i.e. they directly decide who can out-rank whom under the "fairness" re-weighting. The intent is well-commented ("never erase a dimension nor let it dominate"), but the chosen VALUES are tribal: why a 0.15 max delta and a 0.60 ceiling and not 0.20/0.50? Why 0.04 per high-trust skill, capped at 0.12 (3 skills)? No rationale, no sensitivity note, and the fairness test pins bounds-enforcement but not "these specific bounds keep ranking fair" as a stated invariant.
- **Why it matters**: This is the math that produces the very fairness/robustness claim the panel makes. If the bounds are too loose, one strong signal can flip a ranking and still pass the "robust order" check; too tight and dynamic weighting is cosmetic. With no recorded reasoning, the calibration can't be defended in an audit or safely re-tuned — it's load-bearing fairness logic resting on undocumented constants.
- **Recommendation**: Document the calibration choice (a short ADR or expanded comment: what each bound protects against and the cohort it was tuned on), and add a test asserting the fairness invariant the bounds are meant to guarantee, not just that clamping occurs.
- **Effort**: M
