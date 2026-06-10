# Fixes — Wave 4: Recruiter-facing i18n (Theme C, recruiter half) (2026-06-10)

> 8 findings: CV3, MAT1, SCOR6, DEC4, SHELL5, PREP2, PREP3, RES2. All addressed.
> Gates per fix: catalogs JSON-valid, tsc 0, unit 665 (+5 across MAT1/PREP3), py 500, lint clean.
> Wave verification: full `npm run build` + `test:python` 500 OK.

One mental model: **the `--lang` threading template (analyze-run's pattern) +
the report chrome, applied across every remaining recruiter LLM path and the
report surface.** Where the plumbing already existed, only the control/wiring
was missing; where it didn't, one `--lang` flag per CLI closed it. The
candidate half (Wave 3) made what candidates see bilingual; this makes what the
recruiter generates and reads bilingual too.

---

## 1. CV3 — Per-run report-language override (`4ca3dee`)

A "Report language" select on the Analyze form (defaults to active locale)
threads `reportLang` through the submit FormData; `/api/analyze` prefers the
validated field over `getServerLocale()`. The analyze cache is already
lang-keyed, so the other-language re-run is cache-correct — only the control
was missing.

## 2. MAT1 — "Explain fit" reasoning in the recruiter locale (`bcc981f`)

`reasoning_cli` gains `--lang` → `match_reasoning.generate(lang=)`; runReasoning
threads it to the CLI AND the cache key (a NEW fourth invalidation axis, +test,
so a cached cs verdict never serves an en session). MatchCard passes its active
locale in the task params; the sync route defaults from getServerLocale.

## 3. SCOR6 — Market-salary deterministic fallback (`caceeb5`)

JDL5 already forwarded `--lang`; this finishes the sub-gap — `_fallback`'s
English summary (interpolated straight into the JD "About the role") now picks
a localized string from a bilingual map (the TS normalizer passes it through
verbatim).

## 4. DEC4 — Screening-wave reason codes (`724b0ce`)

`ScreenDecision` gains structured `reasonCode` + `reasonParams` alongside the
UNCHANGED byte-identical English `rationale` (the persisted audit string + its
test pin). ScreenWaveModal renders `decisions.wave.reasons.<code>` (would/did
phrasing from the run's dryRun flag, tie-adjustment note) — both the preview
and committed views localize at zero audit risk.

## 5. SHELL5 — Locale metadata + latin-ext fonts (`2b2afe9`)

Both `next/font` subsets gain `latin-ext` (the Czech diacritics were rendering
in a fallback font); the static metadata export becomes `generateMetadata()`
reading a new `meta` catalog + a locale-correct `og:locale` (en_US / cs_CZ).
The OG image stays intentionally English (its glyph loading is out of scope).

## 6. PREP2 — Interview-prep pack in the recruiter locale (`90723fe`)

`automation_cli` gains a global `--lang` (only `prep` reads it) → the
`interview_prep` prompt appends `language_directive`. runAutomationTask threads
lang into the CLI + the automation cache key as a prep-only axis. The
deterministic scaffolding (buildRunOfShow / studentPrepRunOfShow block
topics/goals/signals/scenario) localizes from self-contained bilingual tables;
the fixed six-phase STUDENT_SCRIPT prose stays English (the cs/en-aware voice
agent delivers it). runInterviewPrep reads the locale from the task params,
threads it everywhere, and persists `lang`.

## 7. PREP3 — Key-stable rubric/BARS localization (`7a318b6`)

The canonical English `competency` stays the storage + scoring KEY; the cs
strings live in a TS-side `RUBRIC_CS` overlay (+ `RATING_ANCHORS_CS`) keyed BY
that canonical string, so the Python-shared `interview-rubrics.json` and its
drift test are untouched. `localizedRubric`/`rubricLabel` swap display strings
while preserving the key; HumanScorecardPanel / CompareInterviews /
InterviewTranscriptModal render localized labels but POST/match the canonical
key. +4 drift guards (overlay ⊆ canonical, every competency+anchor-level has an
overlay, the cs scale covers the same levels, the key survives).

## 8. RES2 — Bilingual report frame (`b6ee6b9`)

New `report` namespace. The report FRAME is now bilingual: ResultPanel tab
labels + aria, ReportActions (copy link / print), AddToPipelineButton,
DispositionEditor, the cross-cutting shared widgets (ListBlock/InlineList empty
states + copy, EnginePanel metadata), and the history detail page
(header/score/saved + both error panels).

**Scoped follow-up (NOT shipped):** the deep per-tab BODY section labels — ~50
strings across `extraction/` ("Strengths", "Gaps", "Experience Evidence",
"Gemini skills"…), `compare/` ("Overall", "Experience", "Skills"…), `job-fit/`
("Interview Talking Points", "Must-Prove Evidence", "Recruiter Risk Flags",
"CV Rewrite Suggestions"; MissingSkillsTiers "Must have"/"Nice to have"/"Bonus"
+ 3 advice lines), `salary/` ("Salary Evidence"; SalaryGauge aria), and
`interview/` ("Behavioral"/"Technical"/"Red-flag defense"/"Other"; STAR
"Situation/Task/Action/Result"). The DATA these labels wrap is already the
localized narrative; only the section scaffolding remains. The frame — the most
visible mixed-language seam — ships here; the body labels are a bounded,
enumerated future pass.

---

## Patterns worth keeping (→ harness-learnings)

1. **The `--lang` template generalizes** (CV3/MAT1/SCOR6/PREP2): capture the
   locale at request scope (the detached task can't read the cookie → pass it
   in the task params), append `--lang` to the CLI, and add a lang axis to any
   per-result cache key (else a cached verdict in one language serves the
   other). reasoning + automation(prep) both needed the cache axis.
2. **Localize narrative, keep the KEY** (DEC4/PREP3): when a string is both
   audited/joined-on AND displayed, split them — keep the byte-identical
   English as the audit/scoring key, add a structured `reasonCode`/overlay for
   display. The persisted shape never changes; a drift test pins the overlay to
   the canonical keys.
3. **Self-contained bilingual tables for lib-level scaffolding** (PREP2): the
   run-of-show block strings live in the module (not the catalog) so the pure
   unit tests stay unchanged (lang defaults to en) and a non-active locale
   renders without a hook.
4. **Honest frame-first scoping on a broad surface** (RES2): migrate the chrome
   that wraps the (already-localized) narrative first — it's the visible
   mixed-language seam — and enumerate the deep body labels as a bounded
   follow-up rather than half-migrate a 50-string surface under time pressure.
