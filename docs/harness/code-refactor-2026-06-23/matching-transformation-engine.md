> Total: 6 findings (0c critical, 1h high, 3m medium, 2l low)

## 1. Dead descendant graph: `_DESCENDANTS` + `descendants()` + half the child-edge build are test-only
- **Severity**: High
- **Category**: dead-code
- **File**: pipeline/jobfit/taxonomy.py:180-205, 500-502
- **Scenario**: `descendants()` (taxonomy.py:500) and the maps that back it are referenced ONLY by `tests/test_taxonomy_graph.py` in product. Confirmed with `grep -rn "descendants" pipeline/ --include=*.py` → the only non-`_DESCENDANTS`/non-`def` hits are `test_taxonomy_graph.py:42-43`; `grep -rn "_DESCENDANTS"` → defined at :203, read only at :502 (inside `descendants()`). The scorer (`term_match_score`, taxonomy.py:527-529) uses only `_ANCESTORS`, never the descendant direction. So `_CHILDREN` (:180), `_CHILD_EDGES` (:184), the `_DESCENDANTS` half of the transitive-closure pass (:203-205), and the public `descendants()` are import-time work + API kept alive purely by a unit test.
- **Root cause**: A symmetric ancestors/descendants API was built (taxonomy v3) but only the ancestors direction was ever wired into matching; the descendants direction never found a product consumer.
- **Impact**: Dead computation runs at every import of the core module, plus a public function that reads as "used by the engine" but isn't — a maintenance trap (someone "fixing" descendant edges affects nothing real). It also masks that the graph is effectively a one-directional (parent) lookup.
- **Fix sketch**: Either (a) delete `descendants()`, `_DESCENDANTS`, `_CHILDREN`, `_CHILD_EDGES` and the descendant test, or (b) if the symmetric API is intended public surface, keep `descendants()` but build `_DESCENDANTS` lazily. Note `_CHILDREN`/`_CHILD_EDGES` exist ONLY to feed `_DESCENDANTS` — they go with it. Do NOT touch `_ANCESTORS` (load-bearing for scoring).

## 2. Triple-identical `_normalize` (NFC + casefold) across taxonomy / ats / profiling
- **Severity**: Medium
- **Category**: duplication
- **File**: pipeline/jobfit/taxonomy.py:125, pipeline/jobfit/ats.py:204, pipeline/jobfit/profiling.py:122
- **Scenario**: All three are byte-identical: `unicodedata.normalize("NFC", text).casefold()` (profiling's is named `_normalize_for_matching`). Confirmed via `grep -rn 'unicodedata.normalize("NFC", text).casefold()' pipeline/` → exactly these 3 hits. Edge semantics are identical (same NFC form, same casefold, no strip), so this is a true merge candidate, not a near-miss. `ats.py` calls it 8×; `profiling.py` calls it once. (Note: `soft_signals._norm` adds `re.sub(r"\s+"," ",...)` — DIFFERENT, do not merge it in.)
- **Root cause**: No shared text-normalization home; each module grew its own private copy of the canonical CV/JD fold.
- **Impact**: Three copies of the foldng rule that MUST stay in lock-step (taxonomy term lookup, ATS keyword matching, and the regex profile builder all assume the same normalization). A future change (e.g. NFKC, or adding strip) applied to one silently diverges the matching surfaces — exactly the class of bug this core is sensitive to.
- **Fix sketch**: Make `taxonomy._normalize` the one authority (it already owns the term graph that depends on it), expose it (or a small `text.py` util), and have `ats`/`profiling` import it. Behavior-preserving since the bodies are identical. Importing a leading-underscore name cross-module is the only wrinkle — rename to a public `normalize_text` when promoting.

## 3. `_DIMENSION_KEYS` duplicated as a private constant in matching.py and weight_proposal.py
- **Severity**: Medium
- **Category**: duplication
- **File**: pipeline/jobfit/matching.py:52, pipeline/jobfit/weight_proposal.py:28
- **Scenario**: Both define `_DIMENSION_KEYS = ("skills", "career", "personal")` identically. `grep -rn "_DIMENSION_KEYS" pipeline/jobfit/*.py` shows the two definitions plus uses in each. `weight_proposal.py:24` ALREADY does `from .matching import MatchCandidate, propose_weights, score_job, weight_bounds, weights_for` — so a shared import is one symbol away.
- **Root cause**: The weight-proposal layer needed the same slot tuple and copied it rather than importing.
- **Impact**: The tuple's ORDER and membership are part of the weight contract (it drives `resolve_weights`' simplex projection and the LLM proposal coercion `{k: float(raw[k]) for k in _DIMENSION_KEYS}`). Two copies can silently disagree if a fourth slot or a reorder is ever introduced — and `weight_proposal._coerce` would then build a weight dict the matcher can't consume.
- **Fix sketch**: Delete weight_proposal's copy; add `_DIMENSION_KEYS` to its existing `from .matching import ...` line (promote to a public name like `DIMENSION_KEYS` if you dislike importing a private). Pure dedup, no numeric change.

## 4. Identical `_norm` helper duplicated in transform.py and live_case.py
- **Severity**: Medium
- **Category**: duplication
- **File**: pipeline/jobfit/transform.py:106, pipeline/jobfit/live_case.py:61
- **Scenario**: Both are `def _norm(s): return s.strip().casefold()` — verified byte-identical via `sed -n` on each. Both operate on skill/must-have strings in the same matching core. `transform._norm` keys the provenance-merge dict in `build_match_candidate`; `live_case._norm` keys the must-have/transfer/gap matching in `_credited_skills`. Same edge semantics (strip + casefold, no NFC). NOTE: this is a DIFFERENT fold from finding #2 (no NFC normalization), so it must stay its own helper — don't merge the two pairs together.
- **Root cause**: Two modules in the same package independently needed "strip+casefold a skill token" and each wrote it.
- **Impact**: Low blast radius but it's the same skill-key normalization used to merge/compare skills in two scoring-adjacent paths; keeping them as one symbol prevents a future drift (e.g. one gains diacritic folding, the other doesn't, and observed-skill crediting silently diverges from provenance merging).
- **Fix sketch**: Lift to one small shared helper (e.g. a `text.py` `casefold_token`) and import in both. Behavior-identical. Verify no caller relies on the NFC-less form differing from #2's NFC form before consolidating the two families.

## 5. Duplicate `"absolvent"` entry in `_ENTRY_SIGNALS`
- **Severity**: Low
- **Category**: cleanup
- **File**: pipeline/jobfit/jobs.py:70-71
- **Scenario**: `_ENTRY_SIGNALS` lists `"absolvent",` twice on consecutive lines (confirmed `grep -n "absolvent" pipeline/jobfit/jobs.py` → lines 70 and 71, identical token). The tuple is only ever membership-tested (`any(sig in text for sig in _ENTRY_SIGNALS)`), so the second entry is a pure no-op.
- **Root cause**: Copy/paste slip when hand-curating the CZ+EN early-career signal list.
- **Impact**: Cosmetic — no scoring change (set-membership semantics). But it's a confusing artifact in a hand-edited list reviewers must trust, and a sign the list isn't de-duped/lint-checked.
- **Fix sketch**: Delete the duplicate line. No behavior change. Optionally assert uniqueness at import if these lists are edited often.

## 6. Stale "old len-guard" rationale comments outlive the removed code (NOTE-block cruft)
- **Severity**: Low
- **Category**: cleanup
- **File**: pipeline/jobfit/matching.py:351-379 (docstring + inline comments in `score_personal`)
- **Scenario**: `score_personal`'s docstring and two inline comments (e.g. ":351 `The old length guard that skipped <=3-char tokens...`", :369-372 `Dropping the old len>3 guard restores credit...`") narrate a guard that no longer exists in the function — the code now just does `tokens = [t for t in (...) if t]`. The explanation of what was removed and why is ~12 lines of historical justification for absent code. (Verified by reading the function body: no length filter remains.)
- **Root cause**: Comments documenting a past fix were left as a changelog inside the source rather than in the commit/PR.
- **Impact**: Minor — but it's the longest comment block in the hottest scorer and it explains code that isn't there, which costs every future reader time and can mislead ("is there still a guard?"). The `/5.0 saturation` NOTE at :376-378 is legitimately load-bearing (documents a live, deliberately-unchanged heuristic) and should STAY.
- **Fix sketch**: Trim the "old guard" archaeology to one line ("short skills like Go/R/C match on word boundaries via `_term_in_words`, so no length filter is needed"); keep the `/5.0` NOTE. Comment-only; zero behavior change. Don't over-trim — the word-boundary rationale itself is worth one sentence.
