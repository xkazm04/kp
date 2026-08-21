# Candidates — CV intake, profile, and archetype detection

Everything that turns a person into a scoreable candidate: CV upload/analysis,
the manual/conversational profile, and the archetype (experienced / student /
career-switcher) that other features key off. Downstream ranking is
`docs/features/matching/README.md`.

## Entry points

- **CV analysis tool** — `app/features/tools/analyze/AnalyzeTab.tsx` (`AnalyzeWorkspace.tsx`,
  `AnalyzeForm.tsx`), file intake via `AnalyzeFileDropZone.tsx` / `useAnalyzeCvFiles.ts`.
- **Conversational apply** — `app/apply/[id]/ConversationalApply.tsx` (the view) over
  `use-apply-draft.ts` (resume/persist), `use-apply-submit.ts` (the final POST and its
  recoverable failure), `use-apply-followup.ts` (post-accept gap questions) and the
  `ApplyStepControls` / `ApplyDoneCard` / `ApplyErrorBlock` / `ApplyFollowup` blocks —
  all in the same folder, driven by `app/_lib/apply-intake.ts` and `app/_lib/apply.ts`.
- **Quick apply** — `app/apply/[id]/quick/QuickApplyForm.tsx`, `app/api/apply/[id]/quick/route.ts`.
- **Profile editor** — `app/features/tools/profile/ProfileEditor.tsx` (+ `ProfileEditorFields.tsx`,
  `ProfileEditorArchetypeOptions.tsx`).
- **Archetypes tab** (`?tab=archetypes`; renamed from `?tab=profile`, which still
  resolves via `LEGACY_TAB_ALIASES` in `app/features/shell/tabs.ts`) —
  `app/features/tools/profile/ProfileTab.tsx`. It carries the archetype registry
  plus one candidate population under a List | Matrix projection toggle:
  - **Archetype manager** (admin view of the registry) — `ArchetypeManager.tsx`.
  - **List** — `ProfileRoster.tsx` (fetch + filter state + pager) over
    `ProfileRosterTable.tsx` / `ProfileRosterRow.tsx`, with the filter/sort rules in
    the pure `profileRosterView.ts`. A paginated ledger: in-header column filters
    (candidate / archetype / role family / status), sortable name + completeness,
    20 rows a page via the shared `app/_components/table/TablePager.tsx`.
  - **Matrix** — `CandidateMatrix.tsx` (fetch + population filters + detail modal)
    over `CandidateMatrixBoard.tsx`: the population as a **board of archetype
    lanes**, every lane on screen at once (lanes wrap rather than scrolling
    sideways), each with a score-distribution bar summarizing its cohort shape.
    Grouping/filtering rules are the pure `candidateMatrixView.ts`.
    `CandidateChip.tsx` is the unit a lane tiles and carries only what you scan by —
    name, `ScoreBadge`, a seniority glyph, and one action icon (save an analysed CV
    as a profile, or edit a saved one). Role, role family and source live in
    `CandidateMatrixFilterBar.tsx` (population filters) and
    `CandidateDetailModal.tsx` (per-candidate detail) rather than on every card.
- **Saved analysis report** — `app/history/[slug]/page.tsx`; history list —
  `app/features/tools/analyze/history/HistoryTab.tsx`.
- **Public skill credential** — `app/skill/[token]/page.tsx`.

## Flows

### 1. CV upload → analysis
`AnalyzeFileDropZone.tsx` accepts PDF/DOCX/TXT/MD → `AnalyzeApi.ts` /
`analyzeRunAnalysis.ts` → `app/api/analyze/route.ts` → Gemini extraction in
`pipeline/jobfit/gemini.py`. Extraction is archetype-aware: it emits structured
`experiences` (including `thesis`/`project` kinds), skill claims **with
per-skill provenance**, and archetype signals (`is_enrolled`,
`expected_graduation`, `education_is_dominant`, `wants_domain_change`,
`has_substantial_experience`). Orchestration lives in `app/_lib/analyze-run.ts`
and `app/_lib/analyze-phases.ts`; results persist to the `analyses` table and
render in `HistoryTab.tsx` / `app/history/[slug]/page.tsx`.

**Plain-text uploads carry a code page.** `pipeline/jobfit/extractors.py`
(`_decode_text_document`) decodes a `.txt`/`.md` upload as `utf-8-sig` first — the
`-sig` consumes a Windows BOM instead of gluing a U+FEFF to the first line, where
it defeats the top-of-document name heuristics. A decode failure proves the bytes
are not UTF-8, so it picks a Windows ANSI page: **cp1250** when the stream carries
a Central-European marker byte (`Š š Ž ž`, which sit at the same positions in both
ANSI pages, so their presence is evidence about the document rather than about the
guess), else **cp1252**; the loser is still tried, because cp1252 leaves five bytes
undefined and `Ť`/`ť` live at two of them. `latin-1` is the never-fails backstop.
This replaced a `read_text(encoding="utf-8", errors="ignore")` that **deleted**
every non-UTF-8 byte, so a Czech CV saved as ANSI reached the deterministic
pre-pass, the redactor and — in blind mode — the model itself as
`"Ji ez, Senior vvoj, esk spoitelna"`. PDF/DOCX are unaffected (pypdf decodes,
and a DOCX body is declared UTF-8). Known limit: a Czech document with none of
`Š/š/Ž/ž/Ť/ť` is read as cp1252 and its carons come out as Western grave accents —
visible mis-mapping instead of silent deletion. Pinned by
`pipeline/jobfit/tests/test_extractors.py::PlainTextDecodingTest`.

When the analysis targets a library JD (`jdSlug`), `analyze-run.ts` also
resolves the ingested structured Job at `jd-<slug>` server-side and passes it to
the CLI as `--job-json` (role-intake Phase 0): the honesty cross-check in
`pipeline/jobfit/pipeline.py` then scores against the **authored** requirement
grading (must/nice + prerequisite/learnable, with prose-detected extras unioned
in as nice-to-have) instead of regex-re-deriving a flattened all-must list from
the JD text. Prose-only runs (pasted JDs, no ingested job) behave exactly as
before; a malformed structured payload degrades to prose with a note in the
trust ledger. The structured job is part of the analyze cache key
(`app/_lib/cache-key.ts`), so a re-ingest invalidates cached results.

### 2. Conversational / quick apply
Conversational apply asks 4 universal questions (name, most relevant recent
experience, skills, "which best describes you" archetype pick), then branches:
students get project/thesis + education + aspirations questions, switchers get
prior-field + direction questions, experienced candidates get the original
flow. This branching is implemented as conditional steps in `apply.ts` /
`apply-intake.ts` (`stepConditionMet` / `nextVisibleStepIndex`), not a
per-archetype form. Quick apply (`QuickApplyForm.tsx`) is the short-form
alternative behind `app/api/apply/[id]/quick/route.ts`.

Three invariants both intake surfaces hold on the way into the pipeline —
pinned by `app/api/apply/apply-intake-scope.test.ts`:

- **One tenant.** A public applicant has no session, so the entry is filed into
  the *opening's* team (`getJobWorkspace`), and `buildApplicantProfile` is passed
  that same workspace. The tenant is a caller argument, not derived from the job
  (the CV sim deliberately splits them), so an omission is silent: the profile
  row lands in the default workspace while the entry goes to the job owner, and
  the recruiter then finds no profile behind their new applicant, the Match pool
  never sees them, and `POST /api/apply/[id]/followup` 404s.
- **The landing column comes from the axis.** Every inbound surface files at
  `stageWithRole("entry", getPipelineAxis(workspaceId).stages) ?? "Accepted"` —
  conversational apply, quick apply (`lead-intake.ts`) and CV intake
  (`cv-intake.ts`) alike. A hardcoded stage name strands applicants on
  `PipelineBoardOffAxisStrip` as soon as a team renames its first column.
- **Input caps precede the knockout audit.** A KO fail creates no entry but does
  persist an entry-less `ko_declined` event carrying the applicant's display
  name, and `pipeline_events` bounds the event *detail*, not the label — so the
  name cap runs above the gate on both routes.

### 3. Manual profile editing
`ProfileEditor.tsx` exposes the full structured profile: archetype-conditional
required fields (education detail + aspirations for early-career; years/seniority
for experienced) and a provenance dropdown per skill claim
(`ProfileEditorFields.tsx`, `profileCompletenessFields.ts`).

### 4. Archetype detection
Single-sourced in `pipeline/jobfit/archetypes.json`, read by both Python
(`pipeline/jobfit/registry.py`) and TS (`app/_lib/archetype-registry.ts`,
`app/_lib/archetypes.ts`). Signal-scored, not rule-matched:

| Signal | Effect |
|---|---|
| `is_enrolled` | student +2.0 |
| `expected_graduation` present | student +1.0 |
| years relevant experience < 1 | student +1.5 |
| `education_is_dominant` | student +1.0 |
| years relevant experience ≥ 3 | bau +1.5 |
| `has_substantial_experience` | bau +1.0 |
| wants domain change (± substantial experience) | career_switcher +3.0 / +1.0 |

Rules (`pipeline/jobfit/registry.py`): a self-declared archetype (from the apply
form) wins outright at confidence 0.9; CVs are read heuristically; contradictions
lower confidence (e.g. "student" signal alongside 3+ years experience → 0.65);
no signals defaults to `bau` at 0.4; confidence **< 0.55 flags the profile for
manual review**. The conservative default (unclassifiable → experienced, not
student) is deliberate: early-career archetypes are fairness-protected (see
below), so misreading an ambiguous profile as `bau` is the safe direction.

**Registry edits (the write boundary).** The Archetype admin UI writes
`archetypes.json` through `POST/PUT/PATCH /api/archetypes` (operator-gated;
`app/_lib/archetype-registry.ts` does an atomic temp-file + `rename`, serialized
so two saves cannot clobber each other). `validateArchetype` is deliberately at
least as strict as the file's *readers*, because Python re-reads and re-validates
it on **every** pipeline spawn (`registry._validate_archetype_weights` raises at
import, which would fail every analyze / match / intake / profile build on the
deployment):

- `weights` is projected onto exactly `skills`/`career`/`personal` (`slotsOnly`) —
  a submitted 4th dimension is dropped, never persisted, because Python refuses a
  weights map with any other key. Same for `dimensionLabels`.
- weights must sum to 1.0 within `1e-6`, the *same* tolerance Python uses (a
  looser one here would let through a file Python then refuses to load).
- each weight must be a share in `[0,1]`: a negative weight sums to 1.0 fine but
  **inverts** its dimension in the weighted average.
- `unknown` and `unrouted` are reserved ids and cannot be created — the fairness
  gate in `app/_lib/archetypes.ts` fails *closed* precisely because they are not
  registry members (see §6), so registering one would silently unshield every
  unrouted candidate on the deployment.
- built-ins (`bau`, `student`, `career_switcher`) additionally refuse edits to
  `fairnessProtected` / `scoringModel` and refuse archival.

Errors come back as `{ error (English), code, params }`; the client localizes by
`code` through the `errors.validation.*` catalog. **Known gap:** `weight_out_of_range`
and `id_reserved` have no catalog entry yet, so the manager UI falls back to its
generic "save failed" label for those two (the English `message` is still correct
for direct API callers).

### 5. Completeness follow-up
CV analysis emits unmet checklist items as structured gaps
(`profile.completeness_gaps`); `ArchetypeBanner.tsx` renders one targeted field
per gap, merged into the profile on save by `app/_lib/completeness-followup.ts`.
Per-archetype checklist weights live in `archetypes.json` (e.g. early-career
weights `has_project_or_thesis` highest, then `has_aspirations`, then
`education_detail`/`has_activity`).

### 6. Fairness protection
`student` and `career_switcher` are fairness-protected: automation may never
auto-reject or auto-advance them at the screening stages
(`app/_lib/pipeline-stages.ts`, `app/_lib/archetypes.ts`). This is enforced at
the pipeline-stage layer, independent of the score itself.

## Surface

| Concern | Files |
|---|---|
| CV extraction (Gemini) | `pipeline/jobfit/gemini.py`, `app/api/analyze/route.ts` |
| Analysis orchestration | `app/_lib/analyze-run.ts`, `app/_lib/analyze-phases.ts`, `app/_lib/completeness-followup.ts`, `app/_lib/provenance-dossier.ts` |
| Apply intake | `app/_lib/apply-intake.ts`, `app/_lib/apply.ts`, `app/apply/[id]/ConversationalApply.tsx` (+ `use-apply-draft.ts`, `use-apply-submit.ts`, `use-apply-followup.ts`, `ApplyStepControls.tsx`, `ApplyDoneCard.tsx`, `ApplyErrorBlock.tsx`, `ApplyFollowup.tsx`, `apply-chat-types.ts`), `app/apply/[id]/quick/QuickApplyForm.tsx`, `app/api/apply/[id]/route.ts`, `app/api/apply/[id]/quick/route.ts` |
| Apply session state | `app/_lib/apply-session-client.ts`, `app/_lib/apply-session-store.ts`, `app/api/apply/[id]/session/` |
| Profile editing | `app/features/tools/profile/ProfileEditor.tsx`, `ProfileEditorFields.tsx`, `useProfileEditorSubmit.ts`, `profileEditorPayload.ts` |
| Profile schema (shared) | `app/features/tools/profile/ProfileTabTypes.ts`, `pipeline/jobfit/profile.py` |
| Archetype registry | `pipeline/jobfit/archetypes.json`, `pipeline/jobfit/registry.py`, `app/_lib/archetype-registry.ts`, `app/_lib/archetypes.ts` |
| Archetype admin UI | `app/features/tools/profile/ArchetypeManager.tsx` + `ArchetypeManagerEditPanel.tsx`/`ArchetypeManagerList.tsx` |
| GitHub evidence | `app/_lib/github-evidence.ts`, `github-handle.ts`, `github-summary.ts`, `repo-activity.ts`, `repo-snapshot.ts` |
| GitHub analysis run | `app/api/github-analysis/route.ts` (HTTP shell only) over `app/_lib/github/`: `analysis.ts` (orchestration), `client.ts` (REST), `heuristics.ts` (ranking/complexity/language), `skills.ts` (JD fit taxonomy), `code-review.ts` (Gemini deep review), `usage.ts` (metering), `cache.ts` (TTL cache) |
| Signal display | `app/_components/Badge.tsx`, `PotentialBadge.tsx`, `FactorChart.tsx`, `ScoreDial.tsx`, `ScoreBadge.tsx`, `ScoreProvenanceLabel.tsx` |
| Saved analyses | `app/history/[slug]/page.tsx`, `app/features/tools/analyze/history/*` |
| Public skill credential | `app/skill/[token]/page.tsx` |

### What the GitHub payload says, and in which language

`/api/github-analysis` is computed on the server and read in the browser, so every
string in the payload had to be assigned to one of the three mechanisms in
[`docs/architecture/localization.md`](../../architecture/localization.md):

| In the payload | Mechanism | Where the words live |
|---|---|---|
| A failed run (`{ error, code }`) | machine **code** | `results.github.errors.<CODE>` — `HANDLE_REQUIRED`, `PROFILE_NOT_FOUND`, `RATE_LIMITED`, `API_ERROR`, `BAD_SHAPE`, `NOT_A_PERSON`, `REQUEST_THROTTLED`, `ANALYSIS_FAILED`. Thrown as `GithubAnalysisError` / `GithubHttpError` (`app/_lib/github/client.ts`); resolved by `useGithubErrorMessage()` (`app/_lib/use-github-error.ts`) |
| `contributionSignals`, `limitations`, `complexityAssessment`, `topRepositories[].complexitySignals`, `codeReview.evidenceBasis`, `summaryFinding` | **finding** `{ kind, params }` | `results.github.finding.*`. `GithubFinding` + `describeEvidenceBasis()` in `app/_lib/github-evidence.ts`; counts and window lengths stay raw numbers so ICU does the plurals |
| `codeReview.summary` on a non-`ok` status | **code** (`codeReview.reason`) | `results.github.review.<reason>` — `keyUndecryptable`, `disabled`, `noRepos`, `fetchFailed`, `throttled`, `noSignals`, `malformed`, `requestFailed`; `codeReview.partial` renders the partial-evidence caveat |
| `summary`, `codeReview.summary` on `ok` | canonical **English string** | the model's own prose, plus the line `buildGithubEvidenceSummary` freezes into a pipeline entry — a sealed record and a server-log line, never the thing the panel renders when a finding/reason is present |

Two consequences worth knowing:

- The panel (`app/_components/GithubAnalysisPanel.tsx`) is the only place that turns
  a finding into a sentence. Nothing server-side composes prose a user reads.
- A payload stored *before* findings existed carries the frozen English sentence its
  run produced. The schema accepts `string | GithubFinding` everywhere a finding
  travels, so a saved report keeps rendering — in that run's English — instead of
  failing to parse.

## Data model

- `analyses` table — one row per CV analysis (~21 KB JSON payload: `jobFit`
  overlay of matching/missing skills, salary assessment, role/seniority
  alignment). Read via `/api/analyses` and the History tab.
- `profiles` — structured candidate profile (archetype-conditional fields,
  typed evidence list with `kind` + `provenance` per claim).
- `pipeline_entries` — the per-job application record; carries the *snapshot*
  `match_score` (see matching doc for why that snapshot matters after a scoring
  change).

## CV analysis quality (calibration facts worth keeping)

From a seeded pilot (`pipeline/jobfit/eval/seed_cv_fixtures.py`, 50 candidates
rendered→analyzed→scored on role/seniority/salary/skill-recall against real
Gemini output): the pipeline was **materially miscalibrated on salary anchoring**
and was fixed in two iterations, both landed in code:

1. **Seniority-aware salary anchoring.** The deterministic seniority detector
   used substring keyword matching that fired `lead` on tokens like `hlavní`,
   `cto` (matched inside other words), and bare `vedoucí`, while `junior`
   lacked `student`/`absolvent`/`graduate` markers — so entry-level CVs got no
   anchor (LLM guessed high) or a false lead-tier anchor. Fixed in
   `data/taxonomy.json` (moved terms between `sen_lead`/`sen_junior`) and
   `pipeline/jobfit/taxonomy.py` (`has_seniority_junior_signal`); entry markers
   now floor to junior, and `lead` requires a co-occurring `senior` signal.
   Effect: student over-anchoring 10→0 candidates, `salary_overlap` eval score
   66%→82%.
2. **Aspiration disambiguation.** A CV naming a "Staff/Principal" aspiration was
   read as already at that level. Fixed in `pipeline/jobfit/pipeline.py`
   (`_current_level_text()` truncates at forward-looking goal markers like
   "aiming toward" / "rád bych"), plus reordering precedence so genuine
   senior/lead evidence beats an incidental junior mention ("mentored two junior
   engineers"). Effect: `salary_overlap` 82%→97%.
3. **Standing finding, not yet fixed:** a CV analysis anchors salary to the
   **matched job's** salary band, which is only valid when candidate seniority
   ≈ job seniority. A junior candidate matched to a lead-tier job still pulls
   that job's (too-high) band as an anchor, even though Gemini's own rationale
   often flags the mismatch and adjusts down. Anchoring to
   `role_band(family, candidate_seniority)` instead of the job's band is the
   open fix.

Re-run the scorer: `python -m pipeline.jobfit.eval --fixtures-dir
pipeline/jobfit/eval/fixtures_csas --strict`. Full corpus:
`python -m pipeline.jobfit.eval.seed_cv_fixtures --all`.

### Absence is not a finding (the analysis add-ons)

Two derived add-ons state signals about a named person and share one rule: a
*missing* input never becomes an accusation.

- **`recruiter_risk_flags` that assert there are no risks.** The Gemini contract has
  no "return `[]` when clean" rule, so a clean CV comes back as a sentence ("No
  significant concerns identified"). Both consumers — the mock-interview kit's
  red-flag-defense bucket (`pipeline/jobfit/interview.py`) and the soft-signal panel's
  folded hypotheses (`pipeline/jobfit/soft_signals.py`) — filter those through the
  shared `interview.is_no_risk_statement`, so a clean bill of health can no longer
  render as an ANTIPATTERN row, as a question asking the candidate to defend a
  non-finding, or as a phantom entry in the kit's evidence-gap count. The predicate is
  deliberately conservative: a real finding that merely opens with "No" ("No evidence
  of Kubernetes in the CV") names no risk noun and is kept.
  **English-only** — `job_fit` free text is written in the recruiter's locale
  (`gemini.py`), so a `cs`/`de`/`fr` analysis still folds its "no risks" sentence in;
  closing that needs a contract change (an explicit empty-list rule or a structured
  flag), not more phrase matching.
- **Quantified-outcome detection is gender-neutral in Czech.** The
  `soft_signals._METRIC_RE` achievement verbs now carry their l-participle inflection
  (`snížil|snížila|snížili|snížily…`). The masculine-only stems used to award
  `concrete_ownership` to a man and the `vague_delivery` antipattern to a woman for the
  same sentence.

## Known gaps

- Salary anchoring still uses the job's band rather than a candidate-seniority
  band when the two diverge (see above) — the one open item from the pilot.
- Bilingual skill-label recall (CZ claim text vs. EN Gemini output) is an
  eval-harness measurement gap, not a scoring bug — matched skills are present,
  the eval's substring matcher just can't bridge the language.
- `master`'s-degree CVs are sometimes read as `university`/`bachelor`
  (education softening) — cosmetic, not gated by any axis.
- The registry write boundary's two newest refusal codes (`weight_out_of_range`,
  `id_reserved`) have no `errors.validation.*` catalog entry, so the Archetype
  manager shows its generic save-failed label for them (see §4).
- Student/career-switcher scoring mechanics (potential score, observed-evidence
  minting, fairness matrix) are documented in `docs/features/matching/README.md`;
  the harder-to-validate parts of that model (whether `potential_score`'s
  35/25/25/15 weighting predicts outcomes) are tracked as an open question there,
  not resolved.

## doc-map

```json
{ "doc": "docs/features/candidates/README.md",
  "sourceGlobs": [
    "app/features/tools/analyze/**",
    "app/features/tools/profile/**",
    "app/_lib/apply-intake.ts", "app/_lib/apply.ts",
    "app/_lib/apply-session-client.ts", "app/_lib/apply-session-store.ts",
    "app/api/apply/**",
    "app/_lib/analyze-run.ts", "app/_lib/analyze-phases.ts",
    "app/_lib/completeness-followup.ts", "app/_lib/provenance-dossier.ts",
    "app/_lib/archetype-registry.ts", "app/_lib/archetypes.ts",
    "app/_lib/github-evidence.ts", "app/_lib/github-summary.ts",
    "app/features/tools/profile/ProfileTabTypes.ts",
    "pipeline/jobfit/profile.py", "pipeline/jobfit/registry.py",
    "pipeline/jobfit/archetypes.json", "pipeline/jobfit/gemini.py",
    "app/history/**", "app/skill/**"
  ] }
```
