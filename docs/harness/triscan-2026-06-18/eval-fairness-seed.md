# Evaluation, Fairness & Seed Data — Tri-Lens Scan
> Total: 5
> Severity: 1 Critical / 3 High / 1 Medium / 0 Low
> Lens: 4 bug / 0 ui / 1 biz

> UI Perfectionist lens is N/A for this Python/JSON context (no rendered surface) — skipped as instructed.

## 1. `pedigree_neutrality` fairness probe tests nothing — university name never reaches the scorer
- **Lens**: 🐛 Bug Hunter (primary) · 🚀 Business Visionary
- **Severity**: Critical
- **Category**: Success-theater fairness gate
- **Value**: impact 9/10 · effort 3/10 · risk 2/10
- **File**: `pipeline/jobfit/eval/matching_eval.py:186-197`
- **Scenario**: The probe swaps `education_detail` from `"Computer Science, Charles University"` to `"Computer Science, Local Community College"` and asserts the top-match score barely moves (`delta <= 3`). Verified at runtime: `build_match_candidate` carries only `education_level` (`"bachelor"`); the `education_detail` string holding the university name is dropped before matching, so the delta is structurally **always 0** — the probe passes regardless of whether the matcher is fair.
- **Root cause**: The probe mutates a field (`education_detail`) that is never an input to `match()`/`score_job`. It asserts an outcome that is true by construction, not by the property under test.
- **Impact**: This is the brief's centrepiece fairness guarantee ("Rizika a trade-offy", rendered as the report hero). It is green theater — a regression that *did* leak pedigree into scoring would still show a passing probe. Demo claims of "pedigree-neutral hiring" are unbacked.
- **Fix sketch**: Either (a) feed a real pedigree signal (e.g. add the university string to the matched candidate / a derived prestige feature) so the swap can actually move a score, or (b) if education name is intentionally never scored, replace the probe with an assertion *that the field is absent from the match input* and rename it (`pedigree_field_excluded`) so it states the real invariant instead of a fake delta.

## 2. `language_neutrality` probe hardcodes 2 passing cases — masks real diacritic resolution gaps
- **Lens**: 🐛 Bug Hunter (primary) · 🚀 Business Visionary
- **Severity**: High
- **Category**: Fixture masking real behavior
- **Value**: impact 7/10 · effort 3/10 · risk 2/10
- **File**: `pipeline/jobfit/eval/matching_eval.py:211-220`
- **Scenario**: The probe only checks `"strojové učení"→machine learning` and `"kubernetes"→Kubernetes`, both curated to resolve. Verified at runtime that `resolve_term("databáze")` (database) returns `None` and many common Czech surfaces are unmapped — yet the probe stays green because it never tests them. A Czech-market product whose headline fairness claim is "Czech surfaces resolve like English" is validated against a 2-item allowlist.
- **Root cause**: The probe asserts over a tiny hand-picked set chosen *because* it passes, not a representative sample of Czech skill surfaces actually present in the seed corpus.
- **Impact**: Czech candidates whose CVs use untranslated terms silently lose skill-match credit (a fairness/quality failure for the exact local market the product targets), and the probe certifies the opposite. Demo risk: a reviewer typing a real Czech skill sees no match while the gate is green.
- **Fix sketch**: Drive the probe from the distinct Czech skill surfaces present in `candidates.json` evidence/claims (or a curated representative list of 15-20), assert a minimum resolve-rate (e.g. ≥90%), and report which surfaces fail rather than a binary pass.

## 3. Seed-derived salary expectations silently widen to (40000, 250000) for any seniority lacking a benchmark band
- **Lens**: 🐛 Bug Hunter (primary)
- **Severity**: High
- **Category**: Seed/threshold drift from the data contract
- **Value**: impact 6/10 · effort 3/10 · risk 3/10
- **File**: `pipeline/jobfit/eval/seed_cv_fixtures.py:131-137` (with `data/salary_benchmarks.json:6-28` / `taxonomy.role_band`)
- **Scenario**: `LADDER` spans 6 rungs (`junior…principal`) and `expected_seniority_set` tolerates ±1 notch, so a `lead` candidate produces the set `["senior","lead","staff"]`. Verified: `role_band("software_engineering","staff")` returns `None` because `salary_benchmarks.json` defines only `junior/medior/senior/lead`. `_band_span` drops the `None`s; if *every* rung in the set is unbanded it silently falls back to the catch-all `(40000, 250000)`, an ~6x-wide band that `_range_overlap` treats as trivially containing almost any Gemini guess.
- **Root cause**: The seniority taxonomy (`LADDER`, 6 rungs) has drifted from the salary-benchmark contract (4 bands). The fallback hides the mismatch instead of failing loudly.
- **Impact**: The salary-accuracy axis of the seed-CV eval becomes a near-guaranteed pass for high-seniority candidates — success-theater on a money-sensitive metric. A real salary-extraction regression in the senior band could pass unnoticed.
- **Fix sketch**: Either add `staff`/`principal` bands to `salary_benchmarks.json` (and the taxonomy roles) or clamp `LADDER`/`expected_seniority_set` to the banded rungs. Make `_band_span` log/raise on a full miss rather than returning the wide default, so drift surfaces.

## 4. `seed_pipeline` calendar approvals never land on Interview-stage entries (dead band-aid dependency)
- **Lens**: 🐛 Bug Hunter (primary) · 🚀 Business Visionary
- **Severity**: High
- **Category**: Seed logic / stage-semantics mismatch
- **File**: `pipeline/jobfit/seed_pipeline.py:124-129`
- **Value**: impact 6/10 · effort 4/10 · risk 3/10
- **Scenario**: Calendar (interview-slot) approvals are assigned by `elif i % 9 == 0`, which (after `i % 6 == 0` consumes 0/18/…) only survives at indices 9, 27, 45. Verified in `pipeline.json`: those indices map to `FUNNEL[9]=Offer`, `FUNNEL[5]=Screened`, `FUNNEL[1]=Accepted` — so **0 of the 8 Interview-stage entries carry a `calendar` approval**. A "schedule this interview" slot is attached to Offer/Screened/Accepted candidates instead.
- **Root cause**: Approval kind is keyed on the candidate *index* modulo, completely decoupled from the `stage` it is conceptually tied to. This is precisely why `seed_interview_calendar.py` exists as a separate backfill — the primary seed can't populate the Schedule tab.
- **Impact**: The Schedule/interview-calendar demo surface is empty from the canonical seed; a slot-approval shows on candidates who aren't being interviewed, which reads as incoherent product data to a demo audience. Maintenance burden of a redundant backfill script.
- **Fix sketch**: Gate the `calendar` approval on `stage == "Interview"` (and `decision` on Screened/Offer) instead of index modulo. Then `seed_interview_calendar.py` becomes unnecessary or a thin top-up.

## 5. `entry_precision` aggregate defaults to 1.0 PASS when no early-career scenario is present
- **Lens**: 🐛 Bug Hunter (primary)
- **Severity**: Medium
- **Category**: Eval runner edge case / empty-set default
- **File**: `pipeline/jobfit/eval/matching_eval.py:245-246`
- **Value**: impact 4/10 · effort 2/10 · risk 2/10
- **Scenario**: `entry = sum(entry_vals)/len(entry_vals) if entry_vals else 1.0`. Verified: with a scenario list containing no `early_career=True` cases, every `entry_precision` is `None`, `entry_vals` is empty, and the gate defaults to a perfect 1.0 against a 0.99 threshold — a clean pass with zero evidence. The current hardcoded `SCENARIOS` (3 early-career) masks this, but the harness is a generic scorer and the per-scenario zero-match guard at line 165 was added precisely to avoid this default-to-PASS family of bug.
- **Root cause**: An empty measured set defaults to PASS rather than N/A or FAIL, inconsistent with the deliberate "score 0.0 on empty matches" decision one block above.
- **Impact**: If the scenario set is ever edited to drop early-career cases (or filtered), the strictest precision gate (0.99, the KO-remap guarantee) silently disappears while the run still reports PASS. Latent success-theater.
- **Fix sketch**: Exclude `entry_precision` from the threshold check when `entry_vals` is empty (treat as N/A and assert at least one early-career scenario exists), or default the empty case to a sentinel that fails the 0.99 gate, mirroring the line-165 convention.
