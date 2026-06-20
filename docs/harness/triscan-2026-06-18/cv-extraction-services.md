# CV Extraction & Pipeline Services — Tri-Lens Scan
> Total: 5
> Severity: 1 Critical / 3 High / 1 Medium / 0 Low
> Lens: 4 bug / 0 ui / 1 biz

UI Perfectionist lens is N/A for this Python pipeline (no rendering layer here) and was skipped, as instructed. The five findings below are ranked by VALUE (high impact, low effort, low risk).

## 1. Blind screening silently sends the original file (with name + photo) when local extraction fails
- **Lens**: 🐛 Bug Hunter
- **Severity**: Critical
- **Category**: PII privacy boundary / silent fallback
- **Value**: impact 9/10 · effort 2/10 · risk 2/10
- **File**: `pipeline/jobfit/pipeline.py:114-137` + `pipeline/jobfit/gemini.py:398-440`
- **Scenario**: Recruiter enables `blind=True` to screen anonymously. The CV is an encrypted, scanned, or pypdf-incompatible PDF (a common real case). `_extract_pre_pass` catches the failure and returns `pypdf_text=""`. `redact_pii("")` yields empty text, so `blind_text=""`.
- **Root cause**: In gemini.py, `blind = bool(blind_text and blind_text.strip())` evaluates `False` for empty redacted text, so the code path falls back to `parts=[types.Part.from_bytes(data=path.read_bytes(), ...)]` — it uploads the **original file** (name, contact, photo) to the model. Meanwhile pipeline.py has already appended the sanity note "Blind screening active — identity redacted before scoring," which is now a false statement.
- **Impact**: The exact privacy guarantee blind mode sells is broken precisely when extraction is hardest, and the audit trail affirmatively lies about it. Identity reaches the LLM; the recruiter believes it did not.
- **Fix sketch**: When `blind` is requested but the redacted text is empty/too short, do NOT silently fall back to the file upload. Either fail the analysis with a clear "blind screening requires extractable text" error, or proceed text-only with an explicit "blind screening DEGRADED — could not extract text" warning, and never emit the "identity redacted" note in that case.

## 2. Name leaks into the model whenever the CV header isn't a clean 2–4 word name line
- **Lens**: 🐛 Bug Hunter
- **Severity**: High
- **Category**: PII under-redaction
- **Value**: impact 8/10 · effort 3/10 · risk 3/10
- **File**: `pipeline/jobfit/redact.py:43-83`
- **Scenario**: CV header is "Jane Doe – Senior Backend Engineer" (name + role on one line), or "Jane Doe | jane@x.com" (has @), or the name sits below a logo/contact block past line 8, or contains a digit ("Jane Doe, MSc 2018"). `_guess_name_line` rejects all of these (>40 chars, contains `@`, has a digit, >4 tokens, or a title word), returning `None`.
- **Root cause**: Name detection is a narrow header heuristic with no fallback. When it returns `None`, the `if detected_name:` block is skipped entirely — the name is never masked anywhere, yet the (still-emitted) redacted text is what blind mode feeds the model, and `categories` simply omits "name" without flagging the miss as a failure.
- **Impact**: Blind screening leaks the candidate's name in a large share of real-world CV layouts, defeating the anti-bias purpose; the only signal is the absence of "name" in a categories list the recruiter must notice.
- **Fix sketch**: Loosen detection (strip a trailing " – role"/" | contact" suffix before the token test; widen the header window), and when no name is found on a blind run, surface an explicit "could not locate/redact a name — identity may leak" warning rather than silently proceeding.

## 3. `_PRONOUN` redaction clobbers the English preposition "on" (and similar), corrupting the text scored
- **Lens**: 🐛 Bug Hunter
- **Severity**: High
- **Category**: PII over-redaction / extraction corruption
- **Value**: impact 7/10 · effort 2/10 · risk 2/10
- **File**: `pipeline/jobfit/redact.py:27-30,96-99`
- **Scenario**: A blind-mode CV says "worked **on** the payments platform"; with the Czech pronoun `on` in the same case-insensitive `\b…\b` alternation, this becomes "worked **[REDACTED]** the payments platform." Likewise `her`/`his` are sometimes legitimate ("inHERent" is safe via `\b`, but "her team" — possessive describing a team — is masked).
- **Root cause**: Czech gender pronouns (`on`, `ona`) collide head-on with high-frequency English function words; the single language-agnostic regex is applied to every CV regardless of detected language, so an English CV is shredded by the Czech tokens.
- **Impact**: Blind scoring runs on degraded text — every "on" gone — which lowers extraction fidelity and skews the very score/salary the product's value rests on, invisibly. The existing test happens to avoid a standalone "on", so this is uncaught.
- **Fix sketch**: Gate the Czech-only pronoun tokens (`on`, `ona`, `pan`, `pani`…) behind a Czech-text signal (reuse `_czech_signal_score` or the detected lang), or drop the ones that are also common English/short function words; keep the unambiguous honorifics. Add a test with "worked on …".

## 4. `_select_payload` can return a citation/example object over the real analysis when grounding is on
- **Lens**: 🐛 Bug Hunter
- **Severity**: High
- **Category**: Malformed/ambiguous JSON parsing → wrong payload
- **Value**: impact 7/10 · effort 4/10 · risk 3/10
- **File**: `pipeline/jobfit/gemini.py:495-512,438-460`
- **Scenario**: With `use_grounding=True` there is no `response_mime_type`, so the model returns JSON embedded in prose and may emit several objects. The analysis schema's top-level keys (`profile`, `score`, `salary`, …) are passed as `expected_keys`, but a grounded answer can echo a partial **example** of the same schema (e.g. a small `{"profile": {...}, "score": {...}}` snippet) inside its reasoning. `rank()` orders by *count of matched keys*, then size, then position.
- **Root cause**: Ranking treats "carries some schema keys" as the discriminator; two objects sharing the schema shape tie on key-count, after which the larger or later one wins — which is not guaranteed to be the genuine final payload versus an elaborated example/echo. There is no validation that the chosen object's values are well-formed (e.g. `score` is a dict of ints, `profile.raw_text` non-empty).
- **Impact**: A grounded analysis can be built from an example/echo object — fabricated or partial data presented to the recruiter as the real assessment (success-theater). Hard to notice because the result is structurally valid.
- **Fix sketch**: Tighten selection: require a minimum fraction of `expected_keys` AND a shape check on a couple of anchor fields (`score` is an int-valued dict, `profile.raw_text` is a non-trivial string); prefer the object that passes validation over the merely largest. Log a sanity-check note when multiple schema-shaped candidates were seen.

## 5. No cross-check that Gemini's extracted text matches the local extraction — fabrication/hallucination goes unflagged
- **Lens**: 🚀 Business Visionary
- **Severity**: Medium
- **Category**: Extraction trust / transparency
- **Value**: impact 7/10 · effort 4/10 · risk 3/10
- **File**: `pipeline/jobfit/pipeline.py:188-192,329-348`
- **Scenario**: Gemini reads the file bytes itself and returns `profile.raw_text`. `compare_extraction_quality` compares only *letter-spacing hit counts* and *lengths* between the pypdf text and the Gemini text — it never checks whether the Gemini text actually corresponds to the document. A confident hallucination (wrong employer, invented skills, a different person's content from a multi-CV PDF) produces clean-looking, well-formed output that sails through.
- **Root cause**: The quality comparison measures formatting artifacts, not content fidelity. There is a deterministic pypdf extraction available (`pypdf_text`) and a deterministic skill detector (`detected_skills`), but no overlap/agreement signal between what the rules saw and what the model claims it saw.
- **Impact**: Extraction reliability and trust are the core product value; an undetected hallucinated extraction silently corrupts score, salary, and job-fit for a real hiring decision. A cheap agreement signal would convert a hidden failure into a visible "verify" flag.
- **Fix sketch**: When pypdf text is non-empty, compute a token/skill overlap ratio between `pypdf_text` and Gemini's `raw_text` (and between `detected_skills` and `profile.skills`); below a threshold, append a sanity-check warning ("Gemini extraction diverges sharply from the document text — verify before trusting"). Pure, deterministic, free to run.
