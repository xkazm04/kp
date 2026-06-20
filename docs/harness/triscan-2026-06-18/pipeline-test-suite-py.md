# Pipeline Test Suite (Python) — Tri-Lens Scan
> Total: 5
> Severity: 0 Critical / 4 High / 1 Medium / 0 Low
> Lens: 3 bug / 0 ui / 2 biz

_UI Perfectionist lens: N/A for a Python test suite — skipped by design._

## 1. Pedigree-neutrality fairness probe is success-theater — it can't detect a regression
- **Lens**: 🐛 Bug Hunter (primary) | 🚀 Business Visionary
- **Severity**: High
- **Category**: Contract test that doesn't pin the contract
- **Value**: impact 8/10 · effort 3/10 · risk 2/10
- **File**: `pipeline/jobfit/eval/matching_eval.py:186-197` (asserted via `test_fairness.py:35-38`)
- **Scenario**: `_probe_pedigree` swaps `education_detail` from `"Computer Science, Charles University"` to `"Computer Science, Local Community College"` and asserts the top-score delta `<= 3`. But `transform.py:61-64` only inspects `education_detail` for *field-relevance* terms (`_FAMILY_DEGREE_TERMS`), never the university NAME. Both strings contain "Computer Science" and neither carries prestige weight, so the delta is structurally 0 — the probe passes no matter what the scorer does with pedigree.
- **Root cause**: The probe varies a string the scoring path provably ignores for the dimension it claims to test. It asserts an outcome (delta≈0) that is guaranteed by construction, not by the fairness logic.
- **Impact**: The brand-promise fairness guarantee ("prestige doesn't move the score") is unprotected. If someone later wires university prestige into scoring, this green probe gives false assurance and ships discriminatory ranking. The fairness table is the brief's centerpiece, so a hollow probe undermines the whole gate.
- **Fix sketch**: Make the probe vary something the scorer *could* react to (e.g. inject a prestige token into a field that feeds `score_*`, or add a real `pedigree` signal) and assert neutrality there. Add a positive control: confirm a *demonstrated-skill* swap DOES move the score, proving the probe has discriminating power.

## 2. No test exercises a real Gemini-shaped failure: malformed/missing keys, wrong types, schema drift
- **Lens**: 🐛 Bug Hunter (primary)
- **Severity**: High
- **Category**: Missing coverage of high-risk LLM-JSON parsing
- **Value**: impact 8/10 · effort 4/10 · risk 2/10
- **File**: `pipeline/jobfit/tests/test_gemini_truncation.py:94-149` (gap), `pipeline/jobfit/gemini.py` (~28KB untested for malformed-but-complete payloads)
- **Scenario**: `test_gemini_truncation.py` only tests *truncated* JSON (MAX_TOKENS) and *clean* JSON. There is no test for the far more common production failure: a STOP-finished response that is valid JSON but the WRONG SHAPE — `score.total` as a string `"80"`, `salary.minimum` missing, `job_fit` absent, an extra top-level key, or `null` where a list is expected. `_score_from_payload`/`_salary_from_payload` are unit-tested for empties, but the `grounded_answer` → payload boundary (where Gemini's real-world drift lands) is not.
- **Root cause**: The truncation tests over-fit one failure mode. The contract "Gemini returned plausible-but-malformed JSON" — the dominant real incident — is unpinned.
- **Impact**: A Gemini schema/format drift (string-vs-int, dropped key) sails through CI and surfaces as a runtime crash or a silently-zeroed score in front of a recruiter. Score/salary integrity is the product.
- **Fix sketch**: Add `grounded_answer` cases with `parse_json=True` for: type-coerced fields, a missing `expected_key`, a `null` array, and an extra key. Assert the documented degrade (flag in sanity_checks / clamp), not a bare crash. Reuse the existing `_FakeClient` harness.

## 3. PII redaction is tested only on one happy CV — no false-positive / false-negative coverage on a privacy boundary
- **Lens**: 🐛 Bug Hunter (primary) | 🚀 Business Visionary
- **Severity**: High
- **Category**: Under-tested security/privacy boundary
- **Value**: impact 7/10 · effort 3/10 · risk 2/10
- **File**: `pipeline/jobfit/tests/test_redact.py:1-55` vs `pipeline/jobfit/redact.py:27-58`
- **Scenario**: `test_redact.py` runs four assertions against ONE fixture. Two high-risk paths are untested: (a) **false positives** — the `_PRONOUN` regex matches Czech `on|ona|jeho` as whole words, so a CV mentioning a product/company token or the word "on" (English preposition is excluded, but `ona`/`pan` collide with names/words) could corrupt substantive text; (b) **false negatives / name-leak** — `_guess_name_line` only scans the first 8 lines and needs 2-4 title-case tokens, so a name in a sidebar, a single-name header, or a lowercased name leaks straight to the LLM. Neither failure mode has a test.
- **Root cause**: A single golden CV proves the regexes fire once; it proves nothing about over-redaction or under-redaction — the two ways a blind-screening privacy feature actually fails.
- **Impact**: Over-redaction silently degrades the score (substance masked → lower match); under-redaction defeats the entire blind-screening compliance claim by leaking identity to the model. Both are reputational/legal.
- **Fix sketch**: Add cases for: a name beyond line 8, a lowercase/single-token name (assert leak is at least flagged), the Czech `on/ona/pan` collision with real words, and a CV where redaction must NOT touch a skill that contains a stop-token. Assert `categories` reflects exactly what changed.

## 4. The deterministic eval thresholds are unguarded against being weakened to triviality
- **Lens**: 🚀 Business Visionary (primary) | 🐛 Bug Hunter
- **Severity**: Medium
- **Category**: Quality gate can be silently lowered
- **Value**: impact 6/10 · effort 2/10 · risk 1/10
- **File**: `pipeline/jobfit/eval/thresholds.py:14-45`, consumed by `test_fairness.py:19-22`
- **Scenario**: `test_metrics_meet_thresholds` asserts `agg >= THRESHOLDS[metric]`, reading the threshold table itself. If someone drops `role_relevance_at5` from 0.60 to 0.05 (or `skill_recall` to 0.10) to make a red build green, the test still passes — it validates "we cleared whatever bar we set," not "the bar is meaningful." `_validate()` only checks the number is in `[0,1]`, so `0.0` is legal and would make the gate vacuous.
- **Root cause**: The contract test pins outcomes to a mutable in-repo constant with no floor. A weakened gate is indistinguishable from a passing one.
- **Impact**: Matching/fairness quality can silently erode over time via threshold creep — the classic way an LLM product's quality bar rots without anyone noticing. Business-critical for ranking fairness.
- **Fix sketch**: Add a guard test asserting each threshold stays at/above a committed floor (e.g. `MATCHING_THRESHOLDS["role_relevance_at5"] >= 0.60`), so lowering a gate requires a deliberate two-line edit + review, mirroring the codegen `--check` pattern already used for prompt-version sync.

## 5. Prompt-version sync test covers only REASONING; CASE_EVAL / TRANSFER / FOLLOWUPS versions have no cross-side guard
- **Lens**: 🚀 Business Visionary (primary) | 🐛 Bug Hunter
- **Severity**: High
- **Category**: Missing coverage — silent cache/version drift
- **Value**: impact 7/10 · effort 4/10 · risk 3/10
- **File**: `pipeline/jobfit/tests/test_prompt_version_sync.py:28-36` (only `REASONING_PROMPT_VERSION`)
- **Scenario**: The sync test guards exactly one constant. But `devcase/evaluate.py` stamps `CASE_EVAL_PROMPT_VERSION`, `TRANSFER_PROMPT_VERSION`, and `FOLLOWUPS_PROMPT_VERSION` into output (asserted present in `test_devcase_evaluate.py:32,40,132`). `test_devcase_evaluate.py` only asserts these equal *themselves* (`ev["promptVersion"] == CASE_EVAL_PROMPT_VERSION`) — a tautology that can never fail. If any of these prompts changes without bumping the version (or if a Node-side consumer caches on them), stale evaluations are served with no test catching the drift.
- **Root cause**: The cross-language version-coupling pattern was applied to one prompt and not generalized to the other three versioned prompts the devcase pipeline emits.
- **Impact**: A changed devcase evaluation/transfer/followup prompt silently reuses cached results → wrong interview kits and transfer scores for real candidates, with a green suite. Devcase is a differentiating feature.
- **Fix sketch**: Either (a) extend the sync test to assert each Python prompt-version constant matches its committed Node/cache-side counterpart, or (b) add a content-hash guard test that fails when a prompt template body changes without its version constant changing (codegen `--check` style). Drop the self-equality tautologies.
