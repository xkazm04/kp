# Analysis Result Panels — ambiguity-guardian + ui-perfectionist scan

> Total: 6 findings (0 critical, 1 high, 3 medium, 2 low)

## 1. Comparison drivers and merged recommendation key by non-unique variant label
- **Severity**: High
- **Lens**: ambiguity
- **Category**: label-collision-identity
- **File**: `app/_lib/comparison.ts:124`
- **Scenario**: A recruiter compares three CV variants where two share a filename (the exact scenario the codebase documents: "labels aren't unique: two CV variants can share a filename", and which CompareTab even badges with "1"/"2" disambiguators). The compare table renders correctly, but the "What drove the ranking" list and the merged-recommendation card are wrong or incomplete.
- **Root cause**: `resolveWinnerIndex` was introduced precisely because labels collide, yet the two narrative builders still key by label. `computeDriverInsights` (comparison.ts:124) computes `others = variants.filter((v) => v.label !== best.label)` — a distinct variant that happens to share the winner's label is excluded from the driver narrative entirely. `buildMergedRecommendation` (comparison.ts:208) builds `byLabel = new Map(inputs.map(...))`, where a duplicate label silently collapses to the LAST analysis, so `byLabel.get(headlinePick.label)` (:249) and the skills line (:264) can pull headline/skills content from a different CV than the one credited as `sourceLabel`.
- **Impact**: In duplicate-label runs, the drivers list silently drops a real comparison column, and the merged recommendation can attribute one CV's headline/skills to another — a wrong-decision surface (the recruiter grafts sections from the wrong variant). The table's numbered badges create the impression the duplicate case is fully handled when the narrative half is not.
- **Fix sketch**: Make index the identity everywhere, mirroring `resolveWinnerIndex`: in `computeDriverInsights`, filter `others` by index (`variants.filter((_, i) => i !== winnerIndex)`); in `buildMergedRecommendation`, carry the input index alongside each variant (or zip `inputs` and `variants` positionally, which they already are) instead of the `byLabel` map, and store a source index next to `sourceLabel` in `sectionPicks` for future consumers.

## 2. ResultPanel's documented "comparison defaults to Compare tab" only holds for the first analysis of a session
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: stale-state-across-analyses
- **File**: `app/_components/results/ResultPanel.tsx:148`
- **Scenario**: A recruiter runs a single-CV analysis, clicks the Salary tab, then runs a multi-variant comparison. The new result renders still on the Salary tab — the Compare tab exists but is not selected, even though comments in this very file (:194-198) and the compare-gate comment (:113-117) promise a multi-variant run "defaults to the Compare tab".
- **Root cause**: The component instance survives across analyses (rendered without a key — acknowledged at :151-158), so the `useState(hasComparison ? "compare" : "extraction")` initializer at :148 runs only once. The render-phase guard at :159 handles the tab-disappeared case (stale tab → first tab) but nothing re-applies the default when a NEW analysis arrives and its preferred tab differs from the currently selected, still-valid tab.
- **Impact**: The winner's verdict banner shows, but the side-by-side table — the whole point of a comparison run — is hidden behind an unselected tab. Conversely, a user's tab choice being preserved across unrelated analyses is itself a debatable, undocumented behavior: nothing states whether tab selection is meant to persist per-session or reset per-analysis.
- **Fix sketch**: Track the analysis identity (e.g. `analysisSlug` or an `analysis` reference) in state alongside `activeTab`; when it changes during render, re-apply the default (`hasComparison ? "compare" : "extraction"`) using the same guarded render-phase pattern already used at :159. Document the chosen rule (reset per analysis) in the existing comment block.

## 3. MissingSkillsTiers "no deal breakers" branch is unreachable — and contradicts the module's own position-not-criticality doctrine
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: dead-branch-misleading-semantics
- **File**: `app/_components/results/job-fit/MissingSkillsTiers.tsx:114`
- **Scenario**: A developer (or translator) reads `t("panel.noDealBreakers")` and believes the panel can tell recruiters "no deal-breaker gaps". It never can: the branch renders only when `tiers.must` is empty inside the `skills.length !== 0` arm, but `tiers.must = dedupe(skills).slice(0, 3)` is non-empty whenever `skills` is non-empty (dedupe of a non-empty array is non-empty), so the condition at :114 is always true and :116-118 is dead code.
- **Root cause**: The tiering was reframed from must/nice/bonus criticality to a pure prominence split (header comment :8-14 is explicit: "NOT a must-have vs nice-to-have classification"), but the empty-must branch — which only made sense under a real criticality model where the must tier could be empty — survived the reframe, along with the `must`/`nice`/`bonus` type vocabulary and `TIER_LABEL_KEY` names.
- **Impact**: Dead code plus a live i18n string ("no deal breakers") that asserts exactly the must-have semantics the module disclaims; if a future refactor ever made the branch reachable (e.g. tiering by an engine weight), it would over-claim importance the engine never expressed. The `Tier = "must" | "nice" | "bonus"` naming also invites the next developer to re-attach criticality meaning.
- **Fix sketch**: Delete the unreachable `noDealBreakers` branch and its message key (the `skills.length === 0` arm already covers "nothing missing"). When the engine later emits per-skill weights (the file's own stated plan), reintroduce an empty-top-tier message with honest wording. Optionally rename the tier keys to `top`/`other`/`minor` to match the neutral labels.

## 4. QualityStrip renders engine check strings keyed by raw text with no dedupe — the one list in the panel that skips the mandated idiom
- **Severity**: Medium
- **Lens**: ui
- **Category**: duplicate-keys-uncounted
- **File**: `app/_components/results/QualityStrip.tsx:87`
- **Scenario**: The engine emits the same sanity-check sentence twice (e.g. the same "Salary range needs manual review" repair stated once per variant or per pass — exactly the "model routinely repeats a line verbatim" behavior dedupe.ts documents). The strip shows the line twice, the "flagged N" badge counts duplicates, and React logs duplicate-key warnings with possible node mis-reconciliation.
- **Root cause**: `CheckList` maps `items` directly with `key={check}` (:87-88), and `splitSanityChecks`/the counts at :24-58 operate on the raw `checks` array. Every other engine-string list in this context routes through `dedupe`/`BulletList` (shared.tsx:138-162 states the doctrine: "no call site can silently forget it"), but QualityStrip — added later as its own component — silently forgot it.
- **Impact**: Latent duplicate-key collisions and an inflated "flagged N" count on degraded analyses — precisely the runs where the strip's credibility matters most, since it exists to make degradation visible and trustworthy.
- **Fix sketch**: Apply `dedupe(checks)` once at the top of `QualityStrip` before `splitSanityChecks`/`authenticityBand`, so the badge count, the warn/ok split, and the list keys all see unique lines; or switch `CheckList` to `BulletList` with a per-tone `itemClassName` and an icon-in-item wrapper.

## 5. Interview question numbers are filter-relative, so "Question 3" names a different question per filter
- **Severity**: Low
- **Lens**: ui
- **Category**: unstable-item-numbering
- **File**: `app/_components/results/interview/InterviewTab.tsx:151`
- **Scenario**: An interviewer filters to "Technical", jots "probe harder on Question 2" in their notes, later reopens the kit on "All" — Question 2 is now a different (behavioral) question, because the number shown is the index within the filtered list (`filtered.map((question, index) => <QuestionCard ... index={index} />` at :151-153, rendered as `questionNumber, { n: index + 1 }` at :179).
- **Root cause**: The card's ordinal is derived from the filtered array position instead of the question's stable position in the full kit.
- **Impact**: The ordinal reads like a stable identifier but isn't; notes, spoken references between interviewers ("take Q4"), and the copied prep-pack all lose their anchor as soon as anyone filters. Also feeds the card `key` (`${question.bucket}-${index}`), so filtering re-keys every card.
- **Fix sketch**: Compute each question's index in the unfiltered `questions` array once (e.g. `questions.map((q, i) => ({ q, n: i + 1 }))`), filter that, and pass the stable `n` to `QuestionCard` for both the label and the key. Numbers then stay constant across filters.

## 6. Skill-evidence tooltip has no viewport/boundary handling — clips off-screen on narrow layouts
- **Severity**: Low
- **Lens**: ui
- **Category**: tooltip-overflow
- **File**: `app/_components/results/job-fit/SkillChips.tsx:110`
- **Scenario**: On a phone-width report, a recruiter taps a matching-skill chip near the left or right edge of the "Matching skills" card. The evidence readout — a fixed `w-64` (256px) panel centered on the chip (`absolute bottom-full left-1/2 -translate-x-1/2`, :110-118) — extends up to ~128px past the chip on each side, running off the viewport edge, so the start or end of the CV snippet is unreadable.
- **Root cause**: The tooltip is positioned purely relative to the chip with a fixed width and no flip/shift logic or `max-width` fallback; chips render inside a `flex-wrap` row that routinely places them flush against the card edge.
- **Impact**: The evidence snippet — the feature's entire value ("which CV line proves this skill") — is partially unreadable for edge chips on mobile, and the truncation is silent (no scroll, no wrap indicator).
- **Fix sketch**: Clamp the panel within the card: give the positioned wrapper `max-w-[min(16rem,calc(100vw-2rem))]` and shift it with a small measurement effect (compare `getBoundingClientRect` against the viewport and add a translate correction), or anchor the tooltip to the card container rather than the chip on small screens. A CSS-only start: `left-1/2 -translate-x-1/2 max-sm:left-0 max-sm:translate-x-0` keeps edge cases readable without JS.