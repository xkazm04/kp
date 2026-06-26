# Analysis Result Panels — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀2 / 🚀3 | Severity: C0/H3/M2/L0

## 1. Missing-skill "tiers" are positional, not semantic — the first 3 are branded "deal-breakers"
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: undocumented assumption / magic numbers / wrong-outcome risk
- **File**: app/_components/results/job-fit/MissingSkillsTiers.tsx:8
- **Observation**: `splitIntoTiers` slices the LLM's flat `missingSkills` array by position — `must = slice(0,3)`, `nice = slice(3,8)`, `bonus = rest` (MUST_HAVE_LIMIT=3, NICE_TO_HAVE_LIMIT=5 at lines 8-9, 32-38). The schema (`schemas.generated.ts:61`) defines `missingSkills` as a bare `z.array(z.string())` with no documented ordering contract. Yet the first three render as "Must have" with coaching "This one is likely a deal-breaker" (messages/en.json:152,155). Nothing guarantees the engine sorts missing skills by importance.
- **Why it matters**: If the model lists missing skills in any order other than strict criticality, a trivial gap emitted first is branded a deal-breaker and a disqualifying gap emitted 4th becomes "Nice to have" — directly skewing advance/reject decisions. The 3/5 cutoffs have no recorded reasoning.
- **Recommendation**: Either have the engine emit explicit per-skill tier/weight, or relabel to neutral position-free wording ("Top gaps" / "Other gaps") and document that order is model-emitted, not ranked. At minimum, comment why 3/5.
- **Effort**: M

## 2. "+30% growth target" is an unexplained constant hardcoded to "CZK / month", ignoring the analysis's real currency and period
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: magic number / currency & period correctness / undocumented assumption
- **File**: app/_components/results/salary/SalaryTab.tsx:18
- **Observation**: `targetSalary = Math.round((analysis.salary.midpoint * 1.3) / 5000) * 5000` — the 1.3 (+30%) has no recorded rationale and the 5000 rounding is CZK-sized. Shown via `t("panel.growthTarget", { amount: formatCzk(targetSalary) })` (line 52), whose string is hardcoded `"+30% growth target: {amount} CZK / month"` (messages/en.json:115). But `analysis.salary` carries its own `currency` and `period` (schemas.generated.ts:43-44), and `SalaryGauge.tsx:17-18,28` explicitly notes the analysis is "no longer CZK-only." `formatCzk` (format.ts:24) is symbol-less cs-CZ grouping, so "CZK / month" is fixed text.
- **Why it matters**: A EUR/USD or per-year salary still reads "+30% growth target: X CZK / month" — wrong currency and cadence on a figure recruiters anchor offers to. For small currencies the nearest-5000 rounding also erases the +30% (4000 EUR ×1.3 = 5200 → 5000). Mispriced targets undermine the salary-intelligence promise.
- **Recommendation**: Interpolate `currency`/`period` into the i18n string; derive rounding granularity from currency magnitude; extract `GROWTH_TARGET_MULTIPLIER = 1.3` to a named, justified constant.
- **Effort**: S

## 3. Dark capability: the engine's deterministic salary anchor, grounding sources, and market-evidence notes are computed but never shown
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: dark capability / trust differentiation
- **File**: app/_components/results/salary/SalaryTab.tsx:83
- **Observation**: The Salary tab renders `marketEvidence.summary`, `confidence`, suggested range and `sources`, but never `marketEvidence.notes` (schemas.generated.ts:94). `EnginePanel` (shared.tsx:206-228) renders engine/extractor/model + `parsingNotes` only — it drops `metadata.groundingSources` (schema:77) and the entire `metadata.deterministicEvidence`: `anchorBand`, `detectedSignals`, `detectedSkills`, `detectedCompanyType`, `detectedCompanyModifiers` (schema:78-86). All present on the payload, discarded.
- **Why it matters**: These are the "show your work" artifacts that separate a defensible salary read from an opaque guess — a concrete differentiator (recruiters distrust black-box pay numbers) and a premium-tier candidate. Data is already on the wire, so effort is near-zero.
- **Recommendation**: Add an "Anchor & grounding" disclosure showing `anchorBand`, `groundingSources`, and `marketEvidence.notes`, tied to the existing ConfidenceBadge.
- **Effort**: S

## 4. Dark capability: `jobFit.recommendations` (and top-level `recommendations`) are never rendered in any result panel
- **Lens**: 🚀 Business
- **Severity**: Medium
- **Category**: dark capability / value left on the table
- **File**: app/_components/results/job-fit/JobFitTab.tsx:56
- **Observation**: The Job-Fit tab surfaces summary, skills, alignment prose, `interviewTalkingPoints`, `mustProveEvidence`, `negotiationAngle`, `recruiterRiskFlags`, `cvRewriteSuggestions` — but not `jobFit.recommendations` (schemas.generated.ts:65). A repo-wide grep finds zero render sites for `jobFit.recommendations` or top-level `analysis.recommendations` (schema:54) anywhere in `app/_components/results/`.
- **Why it matters**: "Recommendations" is the most action-oriented field the engine produces for a recruiter (what to do next), generated in tokens and thrown away — an easy retention lever.
- **Recommendation**: Add a "Recommended next steps" `ListBlock` fed by `jobFit.recommendations` (fallback top-level), reusing the copyable `ListBlock`.
- **Effort**: S

## 5. The decision moment isn't captured on a live analyze run — disposition and add-to-pipeline only exist on saved reports
- **Lens**: 🚀 Business
- **Severity**: Medium
- **Category**: workflow gap / funnel & retention lever
- **File**: app/_components/results/ResultPanel.tsx:127
- **Observation**: `ResultPanel` renders `AddToPipelineButton` only when `pipelineRef` is supplied — "Omitted where the identifiers aren't available (e.g. a fresh, not-yet-saved analyze run)" (lines 33-37). `DispositionEditor` (advance/hold/pass) is not in `ResultPanel` at all; its comment scopes it to "the history detail header" (DispositionEditor.tsx:13-17), as does `ReportActions`. So right after reading a fresh analysis there is no way to record a verdict or push to pipeline without first saving and reopening from history.
- **Why it matters**: Decisions made at peak context are lost or deferred, weakening pipeline conversion and the `source: "analyze"` attribution (useAddToPipeline.ts:30) that only fires if the button shows. Inline capture is a direct activation/retention lever.
- **Recommendation**: Surface a lightweight disposition control and an always-available "save + add to pipeline" on the live analyze surface, persisting on first save.
- **Effort**: M
