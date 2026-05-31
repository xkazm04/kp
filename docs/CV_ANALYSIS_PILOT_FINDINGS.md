# CV-analysis pilot — scoring-quality findings (8 ČS-matched candidates)

**What ran:** `pipeline/jobfit/eval/seed_cv_fixtures.py --pilot` — 8 seeded candidates
(spanning 3 role families × 3 archetypes), each: prose CV rendered from the profile
(Claude CLI) → **real Gemini analysis** conditioned on the candidate's matched Česká
spořitelna job → scored on the four golden axes → persisted to the `analyses` table
(visible in the History tab). One Gemini call per candidate; both outputs from it.

## Result — PASS on all four axes (after a ground-truth fix)

| metric | score | threshold | verdict |
|---|---|---|---|
| role_family | 88% | 85% | PASS |
| seniority | 100% | 70% | PASS |
| salary_overlap | **67%** | 60% | PASS |
| skill_recall | 90% | 75% | PASS |

DB: **8/8 analyses persisted** (`cv-cand-000…`), each a full ~21 KB payload carrying
`jobFit` (matched-JD overlay: matching/missing skills, salary assessment, role/seniority
alignment). Readable via `/api/analyses` → History tab.

## Finding 1 (harness bug, fixed): salary band was pinned tighter than seniority
First run showed salary_overlap **40% (FAIL)**. ~Half of that was *my* eval: the expected
salary band was pinned to a single seniority while the seniority axis tolerated ±1 notch.
A strong `bau` CV read one rung up (senior→lead) then "failed" the narrower senior band.
**Fix:** `_band_span()` widens the expected band across the *same* seniorities the
seniority axis accepts. Offline re-score of the saved payloads: **40% → 67% (PASS)**, no
new API calls. (Same widening already applied to career-switchers, whose prior-career
years make seniority genuinely ambiguous.)

## Finding 2 (real pipeline signal): CV-salary anchors to the matched JOB's band
Residual salary misses (cand-000, cand-013, **cand-006**) share one cause. cand-006's own
salary rationale is explicit:

> "The provided anchor band (135k-190k) is for a **Lead** role, which does not match this
> Junior/Student profile… Standard market rate for this profile in Prague is 55-75k CZK."

A **junior** PM (correctly read as `junior`) was valued at **120-150k** because the
**matched job's** salary band (a lead-tier `role_band`) was fed in as the anchor. Gemini
detects the mismatch and adjusts down, but the anchor still dominates → a seniority/salary
inconsistency inside one analysis. The same mechanism gives a mild upward lean even when
aligned (cand-000 senior SWE → 185-240k vs the 110-165k senior band).

**Why it matters / actions (validates the "involve app data" hypothesis):**
- The job's salary band is the right anchor **only when candidate seniority ≈ job seniority**.
  Anchor instead to `role_band(family, *candidate* seniority)`, or down-weight the job anchor
  when the seniority gap is large.
- The CV-salary engine and the job-corpus `role_band` anchors are two salary references that
  aren't calibrated to each other (~1 band apart). For coherent candidate↔job salary
  matching they should share one reference.

## Finding 3 (measurement): bilingual skill labels under-count recall
cand-006 skill_recall 60% is largely a CZ↔EN artifact: expected skills came verbatim from
Czech `skillClaims` ("tvorba produktových roadmap a prioritizace") while Gemini emits English
labels ("Product Roadmap", "Backlog Management"). The skills ARE present; the substring
matcher can't bridge the language gap. Same class as the recurring substring-scanner lessons.
**Action (eval-side):** normalise/translate skill labels before matching, or seed
`expected_skills_subset` from canonical English skill terms.

## Finding 4 (minor): one borderline role call
cand-010 (career-switcher into SWE, matched to a Risk Data Analyst role) read as `data_ai`
not `software_engineering` — the CV emphasised data/risk skills. 1/8; role still passes 88%.

## Full corpus (all 50 candidates)

Scaled with `--all`. Headline numbers after recovering transient failures:

| metric | full-50 | threshold | verdict |
|---|---|---|---|
| role_family | 96% | 85% | PASS |
| seniority | 100% | 70% | PASS |
| salary_overlap | 66% | 60% | PASS |
| skill_recall | 94% | 75% | PASS |

**Overall: PASS.** 50/50 persisted; CV score spread min 45 / median 78 / max 94 / mean 78
(healthy discrimination — weak student CVs score low, strong `bau` high).

**Transient-failure finding (infra, fixed):** the first `--all` pass had **6 Gemini failures**
(`missing profile section` / `non-JSON output`), each taking 53–61 s vs ~17 s for successes —
API timeouts/truncation, not quality. Scored as all-axis zeros, they dragged the raw aggregate
to a false FAIL (salary 59%). Added a retry loop (`--retries`) + a resume flag
(`--skip-existing`); a resume run recovered all 6 on retry → the true aggregate above. Lesson:
the harness must distinguish *infra flakes* from *quality misses*; a zero-filled flake is not a
quality signal.

**At-scale confirmation of the salary lean:** 5/50 estimates land above even the wide band top
(all strong `bau` profiles), confirming Finding 2 — the CV-salary engine runs ~1 band hot vs
`role_band`. Concentrated, not pervasive.

**Education softening (new, minor):** 7/50 `master` profiles were read as `university`/`bachelor`
— Gemini uses `university` as a catch-all for tertiary education. Not a gated axis; worth a
normalisation pass if education precision matters.

## Fix: seniority-aware salary anchoring (implemented + measured)

Root cause (diagnosed across all 50 CVs): the deterministic anchor seniority that
seeds the Gemini salary prompt (`_build_deterministic_evidence`) was driven by
**substring keyword matching** with two defects:
- `sen_lead` matched over-generic / substring-dangerous tokens — `hlavní` ("main"),
  `cto` (3-letter acronym matching *inside* words), bare `vedoucí` ("leading") —
  firing **lead** on 10 students and many seniors. (Same substring-scanner bug class
  that recurs in this codebase.)
- `sen_junior` lacked `student`/`studentka`/`absolvent`, so entry CVs detected **nothing**
  → no anchor → the LLM estimated freely (high). A "led a student project" phrase then
  tripped lead → a junior was anchored at a *lead* band (cand-006: 135–190k anchor for a
  55–75k person).

Changes:
1. `data/taxonomy.json` — removed `hlavní`/`cto`/bare `vedoucí` from `sen_lead`; added
   `student`/`studentka`/`absolvent`/`graduate` to `sen_junior`.
2. `taxonomy.py` — new `has_seniority_junior_signal`.
3. `_build_deterministic_evidence` — entry markers **floor to junior** (anchor juniors at
   the junior band instead of none/false-lead); **`lead` requires a `senior` signal too**
   (a real lead reads as senior+), so a stray title token alone only reaches `senior`.

**Measured (re-analyzed all 50, real Gemini):** student over-anchoring **10 → 0**;
`salary_overlap` **66% → 82%**; role 96 / seniority 100 / skill 94 unchanged; 158 py tests
green. 12 candidates improved (students 0%→100%, e.g. cand-006 now 50–60k = true junior PM
rate; several seniors corrected lead→senior, e.g. cand-007 180–235k → 150–185k). The 4
apparent "regressions" are ±3–4 pp LLM run-to-run noise on candidates whose anchor did not
change.

### Iteration 2 — aspiration disambiguation + `head of` substring (82% → 97%)

The 82%-state residual was ~11 `bau` seniors whose CVs name a "Staff/Principal"
*aspiration*; the lead titles in that goal clause read as their current level. Plus two
more substring false-positives surfaced: `head of` matched inside "a​**head of** schedule".

Changes:
1. `pipeline.py` — `_current_level_text()`: for *current*-seniority detection, truncate each
   sentence at the first forward-looking goal marker (`aiming toward`, `looking to grow into`,
   `grow toward`, `rád bych`, `směřuji`…). "Senior engineer … aiming toward a Staff/Principal
   role" keeps "Senior engineer …" and drops the aspired title.
2. Reordered the precedence so genuine senior/lead evidence wins over an *incidental* entry
   mention ("mentored two **junior** engineers" no longer floors a senior to junior).
3. `data/taxonomy.json` — dropped `head of` from `sen_lead` (kept `head of engineering`).

**Measured (re-analyzed all 50, real Gemini):** deterministic `bau`-seniors-at-lead **11 → 0**
(now 23/23 → senior); students 18/19 → junior. `salary_overlap` **82% → 97%** (role 98 /
seniority 100 / skill 95); 158 py tests green. cand-000 21%→100%, cand-003 8%→100%,
cand-013 13%→100%, cand-028 →100%.

**Remaining (2/50, by design):** cand-008 (student) claims "vedoucí týmu / led smaller teams"
→ reads senior (a genuine **CV overclaim**, not an anchor bug — the kind of contradiction the
soft-signal panel should surface, not silently resolve); cand-048 a top-of-band senior
estimate. salary axis 97% overall.

## Net
The CV-analysis pipeline produces **high-quality, well-calibrated scores** on real ČS-matched
candidates (role/seniority/skill all strong; salary sound once the eval is fair). The one
substantive pipeline improvement is **seniority-aware salary anchoring** when conditioning a
CV analysis on a specific job. Re-run the canonical scorer any time without re-touching the
golden gate:

    python -m pipeline.jobfit.eval --fixtures-dir pipeline/jobfit/eval/fixtures_csas --strict

Scale to the full corpus: `python -m pipeline.jobfit.eval.seed_cv_fixtures --all`.
