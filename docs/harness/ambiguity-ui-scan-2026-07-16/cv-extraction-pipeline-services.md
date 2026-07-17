# CV Extraction & Pipeline Services — ambiguity-guardian + ui-perfectionist scan

> Total: 6 findings (0 critical, 2 high, 3 medium, 1 low)

This context is a Python backend with no rendered UI surface, so all findings come from the Ambiguity Guardian lens (the brief explicitly allows this).

## 1. Blind screening fails OPEN when the name isn't detected — model sees the real name while the pipeline claims "identity redacted"
- **Severity**: High
- **Lens**: ambiguity
- **Category**: blind-mode-name-fail-open
- **File**: `pipeline/jobfit/redact.py:129` (with `pipeline/jobfit/pipeline.py:131-135`)
- **Scenario**: A recruiter enables blind screening for a CV whose name doesn't satisfy `_guess_name_line`'s narrow heuristic — a single-token name, a 5+-token name (common with multiple surnames/degrees), a name below the first 8 lines, a lowercase or non-Latin-script name. `redact_pii` returns `detected_name=None`, masks only emails/phones/links, and the full real name flows to Gemini verbatim inside the "redacted" text. The pipeline still records "Blind screening active — identity redacted before scoring" and the final result shows `name: None`.
- **Root cause**: The empty-text case was made fail-closed (gemini.py raises), but the undetected-name case was left fail-open: `redact_pii` has no signal for "I could not find a name to redact", and the pipeline note's headline claim doesn't depend on the `name` category actually being in `redaction.categories`. Re-attachment (`profile.name = redaction.detected_name`) then erases the name the recruiter needs, because the LLM was separately instructed to null it.
- **Impact**: The one identity signal blind mode exists to hide reaches the model while the recruiter is told the assessment was blind — a false fairness/compliance claim — and the recruiter-facing result loses the candidate's name entirely (name=None), so the double failure is easy to misread as "anonymous candidate" rather than "redaction miss".
- **Fix sketch**: Have `redact_pii` report `name_detected: bool` explicitly. In `analyze_cv`, when blind is requested and no name was detected, either (a) degrade the note honestly ("blind screening PARTIAL — no name detected/redacted; verify") and keep `profile.name` from the LLM-visible text, or (b) fail closed like the empty-text path. At minimum, never emit the "identity redacted" headline when `"name"` is absent from `redaction.categories`.

## 2. Grounded runs are told to fetch "Prague/Czech tech salary signals" — directly contradicting the own-market salary rules in the same prompt
- **Severity**: High
- **Lens**: ambiguity
- **Category**: contradictory-prompt-directives
- **File**: `pipeline/jobfit/gemini.py:517`
- **Scenario**: A recruiter analyzes a US-based candidate against a US JD with grounding enabled. The prompt's salary rules (gemini.py:573-574) and the `market_evidence` schema (gemini.py:111, "the candidate's own market, not assumed Czech") demand the candidate's own market/currency — but `grounding_line` instructs: "Use grounded web results to fill market_evidence with current Prague/Czech tech salary signals." The model must disobey one of the two.
- **Root cause**: `grounding_line` predates the multi-market overhaul (the neutral per-currency ceilings, "do NOT convert to CZK" rules) and was never updated; it also hardcodes "tech" although the prompt explicitly supports nurses, tradespeople, accountants, etc.
- **Impact**: Exactly the grounded runs — the ones marketed as highest-confidence (`confidence: grounded`) — get steered toward Czech tech comparables for non-Czech, non-tech candidates. Depending on which instruction the model favors, `market_evidence` is either wrong-market or silently ignores the directive; either way the behavior is nondeterministic across generations.
- **Fix sketch**: Rewrite `grounding_line` market-neutrally: "Use grounded web results to fill market_evidence with current salary signals for THIS candidate's role and market (per the salary rules below)." Keep the non-grounded branch's confidence capping as is.

## 3. The interview kit hardcodes an "AI feature you shipped" question for every candidate, including explicitly supported non-tech roles
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: role-family-blind-template
- **File**: `pipeline/jobfit/interview.py:202-218`
- **Scenario**: A nurse, accountant, or electrician (role families the Gemini prompt explicitly instructs not to shoehorn into tech, and which the credential gate exists for) gets a mock-interview kit containing "Take one AI/automation feature you shipped to production. How did you evaluate quality before and after release?" with a scaffold about datasets, regression checks, and prompt/version control. Technical scaffolds elsewhere assume "architecture and the tradeoffs", "scale, latency, reliability".
- **Root cause**: `_technical_questions` appends the AI-delivery question unconditionally — it is the only always-present technical question — and the STAR scaffolds bake in software-engineering vocabulary, while nothing consults `candidate.role_family` even though it's already on the profile and used one function up for `role_label`.
- **Impact**: For the growing non-tech share of candidates the kit reads as broken/off-target, undermining trust in the rest of the analysis; the candidate preparing from it rehearses questions no interviewer for their role would ask.
- **Fix sketch**: Gate the AI/automation question (and the architecture-flavored scaffold wording) on a technology-ish `role_family` (e.g. software_engineering/data_ai), and substitute a role-neutral quality question ("a delivery where you had to prove quality/safety before release") otherwise. `role_family` is already available on `CandidateProfile`, so this is a small conditional, not a redesign.

## 4. Authenticity screen's buzzword/specificity heuristics are English-only, but a Czech CV still receives the affirmative "language reads specific and concrete" verdict
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: english-only-heuristic-silent-pass
- **File**: `pipeline/jobfit/authenticity.py:26-39`
- **Scenario**: A templated, buzzword-stuffed Czech CV ("výsledkově orientovaný", "týmový hráč", "proaktivní"...) is analyzed. `_BUZZWORDS` contains only English phrases, so `buzz_hits` is 0; with a couple of dates present the digit check passes too. The trust ledger then shows the positive line "Authenticity checks passed — language reads specific and concrete" and the UI derives a "high" trust band.
- **Root cause**: The pipeline is bilingual by design everywhere else (mojibake repair, Czech aspiration cues, Czech metric verbs in soft_signals `_METRIC_RE`), but `_BUZZWORDS` was written English-only, and the clean path asserts a positive claim about the language rather than admitting the screen didn't apply.
- **Impact**: The exact population the product targets (Czech CVs) systematically scores "high" on the buzzword dimension of the trust band regardless of content — an asymmetric screen presented to recruiters as language-neutral, quietly inflating trust for one locale.
- **Fix sketch**: Add the common Czech equivalents to `_BUZZWORDS` (soft_signals already demonstrates the bilingual-tuple pattern). Alternatively/additionally, soften `_CLEAN` to claim only what was checked ("no generic-phrasing or plausibility flags raised") so the positive line stops overstating the screen's coverage.

## 5. `registry._eval` silently returns False for an unknown condition operator — a typo in archetypes.json disables a detection rule with no error
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: silent-config-typo-swallow
- **File**: `pipeline/jobfit/registry.py:145`
- **Scenario**: Someone edits `archetypes.json` (the module's docstring advertises "adding an archetype is a data change") and writes `"gt": 3` instead of `"gte": 3`, or misspells `"truthy"`. `_eval` falls through every recognized key and returns `False`: the signal/contradiction never fires, candidates silently stop routing to that archetype, and detection falls back to the low-confidence default more often.
- **Root cause**: `_eval`'s final `return False` conflates "condition evaluated false" with "condition not understood". This contrasts sharply with the same file's weights validation (registry.py:39-57), which was added precisely because a hand-edited data typo "silently rescaled every score" — the same fail-fast reasoning applies to detection conditions but wasn't extended to them.
- **Impact**: A latent misroute that no test or runtime error surfaces (tests enforce known signal *names*, per the docstring, but an unknown *operator* key inside `when` evaluates to a quiet False). Downstream, mis-archetyped candidates are scored under the wrong weight vector — the exact failure the weights guard was built to prevent, reintroduced through the condition syntax.
- **Fix sketch**: In `_eval`, after checking the known operator keys, `raise RuntimeError(f"unknown condition {cond!r} in archetypes.json detection rules")` instead of returning False; run the validation once at import over `_DETECTION["signals"]`/`contradictions` (same pattern as `_validate_archetype_weights`) so a typo fails the build, not the candidate.

## 6. The blind-mode "Analysis halted" repair note is unreachable — it is appended to a result that is never built
- **Severity**: Low
- **Lens**: ambiguity
- **Category**: dead-degradation-note
- **File**: `pipeline/jobfit/pipeline.py:137-141`
- **Scenario**: Blind mode is on and extraction yields no text. `analyze_cv` appends the carefully worded note "Blind screening could not run: … Analysis halted to avoid sending the original file to the model." to `repairs` — then calls `analyze_profile_with_gemini` with `blind_text=""`, which raises `RuntimeError` (gemini.py:539-545). The exception propagates, no `AnalysisResult` is constructed, and `repairs` (with its note) is discarded; the user sees only the exception message.
- **Root cause**: The fail-closed refactor put the authoritative guard in gemini.py but left a parallel explanatory note in pipeline.py on the assumption it would surface in `sanity_checks` — which only exist on the success path.
- **Impact**: Harmless at runtime (the RuntimeError message is good), but the code misleads maintainers: it reads as if the halt reason is recorded in the result ledger, and a future edit that softens the gemini-side raise would leave this note as the only (never-shipped) warning. Dead code masquerading as a safety net.
- **Fix sketch**: Delete the `else` branch's `repairs.append` and instead raise the descriptive error right there in `analyze_cv` (before the Gemini stage), keeping the gemini.py guard as defense-in-depth — the halt then happens where the comment says it does, and no phantom note remains.
