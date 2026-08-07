# Dev Case Pipeline (Python) — ambiguity-guardian + ui-perfectionist scan

> Total: 6 findings (0 critical, 2 high, 3 medium, 1 low)

*(This context is a headless Python engine with no direct UI surface, so all findings come from the ambiguity lens; several have direct downstream UI consequences, noted per finding.)*

## 1. Seed coerce guarantees DECISIONS.md but not README.md — a candidate can receive starter files with no assignment in them
- **Severity**: High
- **Lens**: ambiguity
- **Category**: missing-invariant-enforcement
- **File**: `pipeline/jobfit/devcase/seed_materializer.py:167`
- **Scenario**: The seed prompt (`build_prompt`, line 138) commands "Always include README.md (brief + tasks + timebox) and DECISIONS.md". `_coerce` exists precisely because the LLM doesn't reliably follow instructions — and it backfills only `DECISIONS_FILE` (lines 167–170). If the model returns a valid tree that omits README.md, the coerced seed ships to the candidate with source files and a decisions log but no brief, no task list and no timebox anywhere in the materials.
- **Root cause**: The two "always include" files from the prompt have asymmetric enforcement: the decisions log has a producer-side guarantee, the README has none. The deterministic fallback (`deterministic_seed`) always builds a README, so the gap only exists on the LLM path — the path that actually ships in production.
- **Impact**: A candidate unpacks the seed and cannot see what they are being asked to do (or sees it only if the TS side separately renders the brief — an undocumented assumption this module silently leans on). Comparability also breaks: some candidates get the README, some don't, depending on model mood.
- **Fix sketch**: Mirror the DECISIONS guarantee: after the file loop, if no `README.md` (casefold) is present, prepend the same README `deterministic_seed` builds (reusing its rendering), evicting the last non-mandatory file when at `MAX_SEED_FILES`. Alternatively, treat a README-less payload as coerce-failure and return the deterministic skeleton, which is at least honest and complete.

## 2. LLM-path probe coercion collapses "not assessed" into a graded failure — the exact None/False conflation the observed path was fixed for
- **Severity**: High
- **Lens**: ambiguity
- **Category**: missing-vs-false-conflation
- **File**: `pipeline/jobfit/devcase/reflect.py:266`
- **Scenario**: `assess_tooling`'s `coerce` builds one outcome per authoritative probe; for a probe the judge model omitted (or returned `handledWell: null` for), `bool(o.get("handledWell", False))` and `bool(o.get("detected", False))` record a definitive `detected=False, handledWell=False`. Downstream, `evaluate.deterministic()` deliberately distinguishes `isinstance(handledWell, bool)` ("assessed") from `None` ("no signal") — a distinction added because a hardcoded False "used to halve the judgment dimension" (evaluate.py:156–171, process_events.py:90–93). After this coerce, every outcome is a bool, so an unassessed probe counts as assessed-and-failed: it drags `handled` down and re-triggers the "Probe handling unclear" concern, and the public `ProbeOutcome` panel renders "missed probe" rather than "not judged".
- **Root cause**: The None-means-unknown contract was retrofitted onto `ProbeOutcome` consumers (evaluate, process_events) but not onto the LLM-path producer, which still force-casts to bool. `tooling_from_events` bypasses coerce entirely, which is why the observed path kept its `None`.
- **Impact**: Wrong numbers on the fairness-critical judgment dimension whenever evaluate falls back after a successful LLM tooling step (mixed runs), plus misleading probe-results UI and mint_followups picking the "you shipped an undocumented call" question phrasing for probes that were simply not mentioned by the judge.
- **Fix sketch**: In `coerce`, preserve tri-state: `hw = o.get("handledWell"); "handledWell": hw if isinstance(hw, bool) else None` (same for a missing outcome: emit `handledWell=None`, `detected=False`, note "not assessed by the model"). The evaluate/mint consumers already handle `None` correctly, so no other change is needed.

## 3. Two disagreeing sources of truth for the timebox: model default 4.0h vs the documented 2.0h hard cap, and the validator checks neither
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: divergent-constants
- **File**: `pipeline/jobfit/devcase/models.py:182`
- **Scenario**: `design.py` declares `_MAX_TIMEBOX_HOURS = 2.0` as a HARD cap with a documented rationale ("a half-day take-home drives a 40–60% drop-off", UAT M8) and clamps LLM output to it. But `CaseScenario.timebox_hours` defaults to `4.0` — double the cap — so any case constructed or round-tripped without an explicit timebox (TS-side construction, older stored cases, tests) silently carries a value the product decided is harmful. `seed_materializer` then prints that number straight into the candidate's README (`Timebox: ~4h`), and `lifecycle_eval._check_case:100` only validates `> 0`, so nothing ever flags it.
- **Root cause**: When the cap was tightened from the original 4h regime (case-design v5), the model default and the lifecycle validator were not updated with it; the cap lives only inside `design.py`'s coerce path.
- **Impact**: Candidates on default-constructed/legacy cases see a take-home twice the length the product's own research says loses 40–60% of strong seniors; the eval harness certifies such cases as reliable.
- **Fix sketch**: Move the cap to `models.py` (e.g. `MAX_TIMEBOX_HOURS = 2.0` next to the model), set the field default to a value ≤ the cap (1.5, the medior timebox), import it in `design.py`, and add `timeboxHours <= MAX_TIMEBOX_HOURS` to `_check_case` so a stored 4h case surfaces as a reliability issue instead of shipping.

## 4. Observed-path probe detection substring-matches prose against file paths — "detected" is structurally near-always false
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: unit-mismatch
- **File**: `pipeline/jobfit/devcase/process_events.py:98`
- **Scenario**: A candidate works the case in the Live Work Surface; `tooling_from_events` decides `detected` per probe via `(where in tp) or (tp in where)` against event file paths. But `CoverProbe.where` is authored as prose — the design prompt and deterministic template produce values like "the brief", "the under-documented area in the materials", "a result that passes a shallow check" (design.py:316–331), and models.py documents it as "which task / file / requirement it lives in". Prose never substring-matches a path like `src/billing/legacy.py`, so every probe reports "observed: probe area not opened/edited" even for a candidate who worked exactly those files.
- **Root cause**: The observed path assumes `where` is a path fragment while the producer contract allows (and in practice yields) free-form location prose; nothing normalizes or bridges the two vocabularies. The reverse test `tp in where` even lets a short path like `"a"` spuriously match.
- **Impact**: The ground-truth path — preferred specifically because it is "deterministic ground truth, higher confidence (0.8)" — emits a confident-looking all-probes-missed signal: no "worked the embedded probe areas" strength, misleading probe-results panel, and mint_followups always taking the not-handled question branch for in-product candidates.
- **Fix sketch**: Match on tokens, not raw substrings: extract path-like tokens from `where` (segments containing `/`, `.ext`, or backtick-quoted names) and compare those against event paths; when `where` contains no path-like token, emit `detected=None`-style "not locatable from process events" rather than a confident false. Longer term, give `CoverProbe` an optional machine-matchable `paths: list[str]` that the seed materializer fills in when it plants each trap.

## 5. `expected_keys` JSON pinning is documented as an anti-injection guarantee, but "any key present, last wins" is trivially satisfiable by the injected object
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: overclaimed-guarantee
- **File**: `pipeline/jobfit/claude_cli.py:348`
- **Scenario**: Call sites across the pipeline state that `expected_keys` "pins the answer by shape so an adversary-authored submission can't slip a trailing injected JSON object past the parser and inflate/suppress these scores" (evaluate.py:47–49, provenance.py:137–143, reflect.py, design.py). The implementation keeps every candidate dict carrying *any one* of the expected keys and returns the *last* (`keyed[-1]`). An adversarial DECISIONS.md/commit payload that gets the model to echo `{"dimensionScores": {...all 100...}}` after its genuine answer carries an expected key and therefore wins — the selector prefers the injected object precisely because it trails.
- **Root cause**: The mechanism was built against the benign failure mode (a few-shot schema echo *before* the answer, an injected object *lacking* the schema) and the comments were written as if it also closes the adversarial one. The real injection defense is the `fenced_untrusted` wrapper plus the system prompt; `expected_keys` adds little against an attacker who has read this code (it is in the product's public premise that submissions are adversary-authored).
- **Impact**: A latent trust gap: future maintainers reading "#3 is closed by expected_keys" may relax the fencing or reuse `_extract_json` in a context without a fence, believing shape-pinning is a security control. Score inflation/suppression on eval steps remains possible via echo-style injection.
- **Fix sketch**: Tighten the selector for eval-shaped answers (require *all* expected keys, and when several qualify keep the last *fenced* one or flag ambiguity as a `ClaudeCliError` so the run degrades loudly to deterministic). Independently, correct the comments at the call sites to describe expected_keys as echo-robustness, with the fence as the injection control, so the two defenses aren't conflated.

## 6. Deterministic fallback scores candidates with unexplained magic weights (architecture is hard-floored at 40 and capped at 75)
- **Severity**: Low
- **Lens**: ambiguity
- **Category**: magic-numbers
- **File**: `pipeline/jobfit/devcase/evaluate.py:164`
- **Scenario**: When the provider is down, real candidates are scored by `framing = 0.55*rbw + 0.45*0.5`, `architecture = 0.4 + 0.35*fluency`, `transfer = 0.5*fluency + 0.5*verif`. Nothing explains why framing carries a fixed 22.5-point pedestal, or why architecture can never leave the 40–75 band regardless of evidence — in a module where every other constant (MIN_VERIFY_MARGIN, MISSING_DIMENSION_SCORE, LOW_CONFIDENCE, the 2h cap) gets a paragraph of rationale, these hiring-decision weights get none.
- **Root cause**: The formulas encode implicit judgments ("we have no architecture signal in a trace, so anchor near the midpoint and lean on fluency") that were never written down; they are also load-bearing for the eval gates — submission_eval's thresholds were tuned against exactly these outputs ("the deterministic landscape clears them comfortably (verify lead ~18.8 …)", submission_eval.py:69–71) — so an innocent-looking retune silently invalidates the gate margins.
- **Impact**: Future maintainers can't distinguish a calibrated weight from an arbitrary one; changing any coefficient shifts real fallback-mode candidate scores and the eval-gate headroom with no test or comment to say what invariant was broken.
- **Fix sketch**: Name the constants (e.g. `_ARCH_BASE = 0.4  # no structural signal in a commit trace; anchor near neutral, let fluency move ±35`) with one line of rationale each, and note beside them that submission_eval's MIN_* margins were tuned against these values so retuning requires re-running the deterministic landscape.
