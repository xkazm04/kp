# Analysis Result Panels — Tri-Lens Scan
> Total: 5
> Severity: 0 Critical / 2 High / 3 Medium / 0 Low
> Lens: 2 bug / 2 ui / 1 biz

## 1. Tab CONTENT is hardcoded English in an en/cs bilingual product
- **Lens**: 🎨 UI Perfectionist (primary) / 🚀 Business Visionary
- **Severity**: High
- **Category**: i18n / localization gap
- **Value**: impact 8/10 · effort 6/10 · risk 3/10
- **File**: `app/_components/results/extraction/ExtractionTab.tsx:30`, `salary/SalaryTab.tsx:27`, `job-fit/JobFitTab.tsx:17`, `interview/InterviewTab.tsx:78`, `job-fit/MissingSkillsTiers.tsx:12`, `job-fit/SkillChips.tsx:88`
- **Scenario**: A Czech recruiter (`messages/cs.json` ships a full `report` namespace) opens a saved analysis. The chrome — `ResultPanel`, `QualityStrip`, `SoftSignalsSection`, `AddToPipelineButton`, `DispositionEditor`, all using `useTranslations` — is Czech, but every section title and coaching sentence inside the tabs is English: "Salary Estimate", "Score Breakdown", "Job Fit", "Missing Skills", "Matching Skills", "Mock Interview", "Filter", "Strengths", "Gaps", "Must have / Nice to have / Bonus", "Add these explicitly to the CV — most ATS resume parsers require literal matches."
- **Root cause**: These tab components never adopted `useTranslations`. The `report` namespace carries only chrome keys (`tabs.*`, `copy`, `added`); no body/section keys exist. `ResultPanel.tsx:43`'s comment conflates LLM narrative (correctly left alone) with the app's own static labels (which should be translated).
- **Impact**: The core deliverable reads half-translated for the entire Czech market — the most visible credibility gap in a paid SaaS marketing `cs` support.
- **Fix sketch**: Add `report.sections.*` keys to both locales; thread `useTranslations("report")` through the six tab components + `MissingSkillsTiers`/`SkillChips`; move `coachingFor()`/`MoreIndicator` copy into keyed strings. `buckets.ts` stays code-side; only `BUCKET_META.label` needs keying.

## 2. Unsaved disposition note is silently lost when clearing the decision
- **Lens**: 🐛 Bug Hunter (primary)
- **Severity**: Medium
- **Category**: data loss / state corruption
- **Value**: impact 6/10 · effort 3/10 · risk 2/10
- **File**: `app/_components/results/DispositionEditor.tsx:54-58,88-97`
- **Scenario**: Recruiter picks "Hold", types a reason but does NOT blur, then clicks the active option to clear (or another disposition). `pick()` calls `save(next, note)` and re-renders; on clear, `next=""` unmounts the `disposition ? <textarea/>` block before its `onBlur` fires, discarding the typed note. Switching disposition saves the old `note` against the new disposition, mislabeling rationale.
- **Root cause**: Note is committed only on `onBlur`; `pick()` saves current `note` state without flushing pending textarea content, and clearing unmounts the field before blur fires.
- **Impact**: The human-decision record `AiDisclosure` promises (RES5) vanishes without warning — the exact audit trail this component exists to capture.
- **Fix sketch**: Save the note on every disposition change reading the live value; on clear, persist before unmounting (or keep textarea mounted+disabled). Simplest: debounce-save `note` on change rather than only on blur.

## 3. Extractor comparison & metric labels expose internal jargon to recruiters
- **Lens**: 🎨 UI Perfectionist (primary) / 🚀 Business Visionary
- **Severity**: Medium
- **Category**: clarity / audience mismatch
- **Value**: impact 6/10 · effort 4/10 · risk 2/10
- **File**: `app/_components/results/extraction/ExtractionTab.tsx:33-35,49-50,109`
- **Scenario**: The Extraction tab shows a recruiter "pypdf skills", "Gemini skills", "pypdf spacing artifacts", "pypdf extraction" / "Gemini extraction", and a card titled "LLM Explanation" — pipeline internals (two extractor names + the model vendor) with no recruiter-facing meaning.
- **Root cause**: The diagnostic Extraction-Quality panel was surfaced verbatim from engine debug fields (`extractionQuality.pypdfLetterSpacingHits` etc.) without relabel or explanatory caption.
- **Impact**: Erodes polish on the first tab users land on and buries the useful signal (extraction reliability) under vendor jargon — a transparency differentiator reading as an unfinished debug view.
- **Fix sketch**: Relabel to outcome language ("Skills found — fast vs. AI parser", "Formatting artifacts detected") with a one-line "why you care" caption; rename "LLM Explanation" → "Why this score"; gate raw fields behind a "Show diagnostics" toggle.

## 4. SkillChips evidence matcher misses multi-word skills / over-attributes short tokens
- **Lens**: 🐛 Bug Hunter (primary)
- **Severity**: Medium
- **Category**: correctness / edge case
- **Value**: impact 5/10 · effort 4/10 · risk 3/10
- **File**: `app/_components/results/job-fit/SkillChips.tsx:22-29,77-83`
- **Scenario**: `findEvidence` requires a multi-word skill ("React Native", "machine learning") to appear as an exact contiguous string, so genuinely-evidenced phrases show no tooltip (look unproven). The `[^a-z0-9]` boundary also lets a short skill "node" match evidence reading "node.js developer", over-attributing to the shorter token.
- **Root cause**: A single whole-token regex can't capture multi-word phrases or distinguish a short skill that is a substring-boundary of a longer evidenced phrase; it trades false positives on short tokens for false negatives on phrases.
- **Impact**: Evidence tooltips — the feature making a matching skill feel proven rather than asserted — are intermittently wrong/absent, undermining the "evidence-grounded" value prop in the Job-Fit tab.
- **Fix sketch**: Collapse internal whitespace to `\s+` in the pattern so phrases match; prefer the longest-matching snippet; tokenize multi-word skills (require all tokens). Memoize compiled patterns per evidence set.

## 5. No "what next" path from the report's strongest signals — journey dead-ends
- **Lens**: 🚀 Business Visionary (primary)
- **Severity**: High
- **Category**: missing capability / retention
- **Value**: impact 8/10 · effort 5/10 · risk 3/10
- **File**: `app/_components/results/job-fit/JobFitTab.tsx:55-91`, `interview/InterviewTab.tsx:140-145`, `salary/SalaryTab.tsx:42-45`
- **Scenario**: The report produces highly actionable artifacts — interview talking points, must-prove evidence, full STAR kit, CV-rewrite suggestions, salary negotiation angle — all read-only. The only forward actions are per-list "Copy" (markdown), print/provenance dossier, and `AddToPipelineButton` (only when `pipelineRef` is supplied). No "send kit to hiring manager", "schedule screen", "push to ATS", or "generate outreach".
- **Root cause**: Panels were built as a presentation layer; the value-capture/handoff layer (share, assign, schedule) was deferred — the repeated `ListBlock` copy-to-clipboard is a stopgap, not a workflow.
- **Impact**: The recruiter's journey ends at "read the report." The most monetizable surfaces leak value to manual copy-paste instead of driving pipeline progression or a shareable artifact — weak retention/differentiation.
- **Fix sketch**: Add a single "Use this" action row per high-value section ("Email interview kit", "Add talking points to candidate notes", "Share with hiring manager" — the tokenized public page already exists). Reuse `ReportActions`/`buildProvenanceDossier` plumbing and the optimistic `useAddToPipeline` pattern to wire into existing destinations.
