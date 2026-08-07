# CV Analysis Workspace — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀2 / 🚀3 | Severity: C0/H2/M2/L1

## 1. No bulk multi-candidate screening — the workspace only ranks variants of ONE person
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: unmet recruiter pain / monetization
- **File**: app/api/analyze/route.ts:134 (collectCvFiles) + app/_lib/analyze-run.ts:196 (buildComparison "best of N")
- **Observation**: Multiple uploaded CVs are content-deduped and treated as *variants of the same candidate*, then collapsed into a single "best of N" winner (route.ts:144-153 dedupe + analyze-run.ts:196-208 winner-merge), capped at `MAX_CV_VARIANTS = 3`. There is no path to score many *different* candidates against one JD in a single run. The meter even bills "variants of the same person count once" (route.ts:24-28), confirming the single-candidate mental model.
- **Why it matters**: For a recruiting SaaS the #1 daily pain is triaging dozens-to-hundreds of resumes against one req. The product can analyze and score CV↔JD fit beautifully but forces it one candidate at a time — the single biggest "value left on the table." A bulk-screen-against-JD mode (upload N CVs → ranked shortlist) is both the core differentiator and an obvious paid-tier/usage-meter expansion.
- **Recommendation**: Add a distinct "Screen against JD" intake (separate from the same-person variant compare) that fans out N CVs as independent analyses sharing one JD, then renders a ranked shortlist reusing `listAnalysesByJd` (already best-score-first). Meter per candidate.
- **Effort**: L

## 2. `grounding` is hard-wired to `true` — a fully-built toggle that's never exposed, and a per-call cost with no off-switch
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: dark capability / cost & pricing lever
- **File**: app/features/sub_analyze/AnalyzeApi.ts:20 (`form.append("grounding", "true")`)
- **Observation**: The client unconditionally sends `grounding=true`. The *entire* off-path exists and is plumbed end-to-end — route parse (route.ts:33), CLI flag `--grounding` (analyze-run.ts:52), and it is part of the cache key (cache-key.ts:68) — but nothing ever sends `false`. Grounding blends live market/search context into the result (per AboutCoverageData.ts:244) and therefore carries a real Gemini grounding surcharge on *every single analysis*.
- **Why it matters**: Two losses at once: (a) every analysis pays the grounding premium with no cheap/fast mode for high-volume screening; (b) a shipped capability (grounded vs ungrounded analysis) is invisible to users. Grounding is a natural premium-tier differentiator ("market-grounded salary & fit") — gating it would both cut baseline cost and create an upsell.
- **Recommendation**: Surface grounding as a per-run toggle (default on for paid, off for a "fast" mode), or at minimum record the decision in code for why it's hardwired. The cache key already distinguishes the two, so it's cache-correct today.
- **Effort**: S

## 3. Blind vs non-blind re-scoring silently bills the "same person" twice — unstated conflict with the stated meter rule
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: undocumented trade-off / billing fairness
- **File**: app/_lib/cache-key.ts:77 (`if (input.blind) field("blind")`) + app/_lib/analyze-run.ts:180 (`if (!allCached) recordMeterUsage("ai_candidates")`)
- **Observation**: `blind` is part of the cache key, so a blind run of a CV and a non-blind run of the *identical bytes* are distinct keys → both miss cache → both debit one `ai_candidates` unit. Yet the route's billing contract states the unit is "one person fully worked … variants of the same person count once" (route.ts:24-28). A recruiter who toggles blind screening to compare results for the same candidate is charged twice, with no disclosure. The two comments encode an unreconciled rule: "same person = one unit" vs "blind re-run = new unit."
- **Why it matters**: Silent double-charging on a compliance-oriented feature (blind/bias-reduction) is exactly the kind of surprise that erodes trust and triggers billing disputes. The reasoning for charging the second run isn't recorded anywhere.
- **Recommendation**: Decide and document: either treat blind/non-blind of identical CV bytes as one billable "person" (bill once, keyed by CV hash) or surface "this counts as a second analysis" in the UI before the blind run.
- **Effort**: S

## 4. The analysis progress strip is a fixed timer, not real progress — long runs stall on "insights" with no signal
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: happy-path-only / hidden trade-off
- **File**: app/features/sub_analyze/AnalyzeApi.ts:50 (`setInterval(... 1800)`) and :52 (`idx < stages.length - 1`)
- **Observation**: `watchAnalysis` animates six stages (extract → gemini → profile → scoring → salary → insights) on an 1800ms timer, acknowledged in the comment (line 39-40) as theatrical because "the pipeline emits one final result, not per-token stages." After ~10.8s (6×1800ms) `idx` caps at the last stage and the strip freezes on "insights" while the real Python run continues. A user on a slow grounded run sees a stuck bar with no way to tell progress from hang; the only escape is the failure threshold (`MAX_CONSECUTIVE_ERRORS`, ~15s of *non-OK* polls), which never trips for a healthy-but-slow run.
- **Why it matters**: The intake's whole promise is "run a full AI analysis," and the most visible feedback is fabricated. There's no recorded decision for what the UX should be past the timeline's end (indeterminate spinner? elapsed timer?), so the long-run case is undefined.
- **Recommendation**: Once the scripted timeline ends, switch the strip to an indeterminate/elapsed-time state (or have the task report a real coarse phase), so a slow run reads as "still working," not "stuck."
- **Effort**: M

## 5. "Try sample CV" has no sample JD — first-run users get a weaker JD-blind demo
- **Lens**: 🚀 Business
- **Severity**: Low
- **Category**: onboarding / activation
- **File**: app/features/sub_analyze/AnalyzeProfileInput.tsx:76 (`fetch("/samples/sample-cv.txt")`)
- **Observation**: The empty-state "Try sample CV" loads only a sample CV. JD and company are optional, so a one-click sample produces a JD-blind analysis — the least impressive version of the product (no role-fit scoring against a target role). There is no paired sample JD or one-click "full sample analysis."
- **Why it matters**: The sample is the activation moment for a brand-new recruiter. Showing a JD-blind result undersells the core CV↔JD matching value prop at the exact moment first impressions form — a cheap, high-leverage activation win.
- **Recommendation**: Ship a paired `/samples/sample-jd.txt` and make "Try sample" preload both CV and JD (and optionally a company blurb) so the first run renders a full scored fit report.
- **Effort**: S
