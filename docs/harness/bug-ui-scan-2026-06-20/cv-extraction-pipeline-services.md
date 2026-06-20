# CV Extraction & Pipeline Services — Bug Hunter scan

> Context: Parse and extract structure from CVs via Gemini, score soft signals, run analysis pipeline orchestration and the long-running service, with redaction and i18n of prompts.
> Files reviewed: 13 of 15
> Total: 7 findings — Critical: 1, High: 3, Medium: 2, Low: 1

## 1. Blind-screening name re-attachment uses substring `.replace`, leaking identity into the LLM payload

- **Severity**: High
- **Category**: silent-failure / privacy-boundary
- **File**: `pipeline/jobfit/redact.py:94-101`, consumed at `pipeline/jobfit/pipeline.py:120-150`
- **Scenario**: A candidate's name is a common substring (e.g. first name "Al", "An", "Jan", or a surname that appears as a normal word like "Young", "Black", "Mason"). `_guess_name_line` only fires when the top-8 lines contain a 2–4 token title-cased line; if the header is letter-spaced, image-only, or formatted as "DOE, Jane", `detected_name` is `None`. When `detected_name` is `None`, `redact_pii` masks email/phone/URL/pronouns but **does not mask the name anywhere** — yet `pipeline.py:127` still appends the "identity redacted" note as long as `redaction.text` is non-empty, and the full name remains in the blind text sent to Gemini.
- **Root cause**: The redactor assumes a recognizable header name line exists. Name masking is all-or-nothing on `_guess_name_line`, but the "blind active" note only checks that *some* text survived — so a failed name detection silently produces a non-blind analysis labelled as blind.
- **Impact**: Blind screening (a fairness/compliance feature, idea-b8d711c4) silently leaks the candidate's name to the scoring model while telling the recruiter it was redacted. The recruiter trusts an assurance that is false for an entire class of CVs.
- **Fix sketch**: When blind is requested but `detected_name is None`, record an honest "name could not be located — blind redaction incomplete" warning (do not claim "name" in categories), and consider failing closed like the empty-text branch already does. Separately, mask the name via word-boundary regex consistently rather than substring `.replace`.

## 2. `re.sub(rf"\b{re.escape(token)}\b", ...)` over `[NAME]` after earlier tags can corrupt the blind text / mismatched masking

- **Severity**: Medium
- **Category**: edge-case / ordering
- **File**: `pipeline/jobfit/redact.py:95-117`
- **Scenario**: Name redaction runs first and replaces the name (and each ≥3-char token) with the literal `[NAME]`. Then the pronoun pass runs `_PRONOUN.subn("[REDACTED]", redacted)`. A name token like "Her" / "His" / "Miss" / "Mr" (real surnames and given names exist — "Miss", "May", "Mr." abbreviations) that survived as a standalone token, or a name equal to a pronoun, interacts unpredictably: a candidate literally named "Miss" or "May" gets double-processed, and ordering means the categories list can claim "gendered terms" for what was actually a name token. More practically, a single-letter or 2-char first name (skipped by the `len(token) >= 3` guard at line 99) is never masked even though the full-line replace at line 95 may not match a reflowed later mention.
- **Root cause**: Redaction passes are applied sequentially over already-tagged text without treating the inserted tags as atomic, and the `>= 3` token guard silently leaves short names unmasked.
- **Impact**: Inconsistent redaction; short names leak; category labels can misattribute what was masked. Lower blast radius than #1 but compounds the same trust problem.
- **Fix sketch**: Tokenize once, redact against the original text in a single pass with non-overlapping spans, and protect already-inserted `[NAME]`/`[REDACTED]`/`[EMAIL]` tokens from later passes (e.g. exclude bracketed placeholders from the pronoun/age regexes).

## 3. `_extract_pdf` swallows per-page extraction failures, so a partially unreadable PDF yields a silently truncated "successful" extraction

- **Severity**: High
- **Category**: silent-failure
- **File**: `pipeline/jobfit/extractors.py:167-184` (and the degrade path `pipeline/jobfit/pipeline.py:890-906`)
- **Scenario**: `page.extract_text()` is wrapped in `or ""`, so a page that pypdf cannot decode contributes an empty string and the loop continues. If pages 2–9 of a 10-page CV fail to extract (mixed encodings, embedded fonts, partial corruption) but page 1 yields a header, `extract_text` returns a short but non-empty string. The deterministic pre-pass treats this as a normal extraction (no exception → no "extraction failed" note), priming Gemini's evidence with a near-empty skill/seniority read. In blind mode this same truncated text becomes the *entire* document the model scores.
- **Root cause**: Per-page failures are indistinguishable from genuinely empty pages. There's no signal for "we extracted far fewer pages/chars than the document contains," so partial extraction masquerades as complete extraction.
- **Impact**: A candidate is scored on a fraction of their CV with no flag. In blind mode the assessment is produced against a truncated document. The only existing guardrail (`len(raw_text) < 120` → "short text" note at pipeline.py:163) misses the common case where the header alone exceeds 120 chars.
- **Fix sketch**: Track pages attempted vs pages that yielded text; when a meaningful fraction extract empty, append a "partial extraction (N of M pages unreadable)" sanity note. Catch and count per-page exceptions rather than letting `extract_text() or ""` flatten them to silence.

## 4. Truncated-JSON recovery (`_repair_truncated_json`) can accept a structurally complete but semantically wrong payload

- **Severity**: Medium
- **Category**: edge-case / data-integrity
- **File**: `pipeline/jobfit/gemini.py:589-624` and `627-681`
- **Scenario**: When Gemini hits `MAX_TOKENS`, `_parse_truncated` first tries `_parse_json`, accepting it if it carries all `expected_keys`. But `_parse_json` → `_select_payload` ranks by *number of matched top-level keys*. A truncated analysis response often contains the early keys (`profile`, `score`, `salary`, `market_evidence`, `strengths`…) fully formed while `job_fit` and the tail are cut off mid-stream. `usable()` requires `wanted <= candidate.keys()` — the full `ANALYSIS_RESPONSE_SCHEMA.keys()` — so an early-truncated body fails `usable` and falls to `_repair_truncated_json`, which closes brackets at the *longest parseable prefix*. That prefix can legitimately parse to a dict that has all top-level keys but whose arrays (e.g. `recommendations`, `job_fit.missing_skills`) were silently cut to whatever fit before the cap, with no truncation flag propagated downstream.
- **Root cause**: Recovery optimizes for "is this valid JSON with the right top-level shape" rather than "is this the *complete* answer." A salvaged object that satisfies the key-set check is treated as fully trustworthy; the `MAX_TOKENS` finish reason is not surfaced into the result's sanity checks.
- **Impact**: A recruiter sees an analysis (score, salary, missing-skills, interview kit) silently built from a truncated model response — e.g. a missing-skills list cut short reads as "fewer gaps than reality." No "this was truncated" note reaches `sanity_checks`.
- **Fix sketch**: When a payload is obtained via `_repair_truncated_json` (or any `MAX_TOKENS` path that still returns data), thread a `truncated=True` flag into `analyze_cv` and append an explicit "analysis response was truncated at the token cap — review for missing detail" sanity check rather than returning it as a clean result.

## 5. Letter-spacing collapse regex runs on every PDF/DOCX with no run-count cap — pathological-input CPU blowup

- **Severity**: Critical
- **Category**: latent-failure / resource-exhaustion (DoS)
- **File**: `pipeline/jobfit/extractors.py:131-184`, `73-80` (`clean_text` → `re.sub(r"[ \t]+", " ", …)`)
- **Scenario**: `_extract_pdf` calls `collapse_letter_spacing("\n".join(pages))` on up to `MAX_TEXT_CHARS = 2_000_000` characters. The pattern `(?<!L)(?:L\s){2,}L(?!L)` is applied to the whole document with `re.sub`. A hostile or degenerate PDF that extracts as a single 2 MB run of `"a a a a a … "` (single letters separated by single spaces — exactly the letter-spaced pathology this is meant to fix, but at extreme length) forces the engine into very long backtracking/scanning over one gigantic match. Combined with `clean_text`'s repeated full-document `re.sub` passes and `repair_text_encoding`'s `text.encode("cp1250").decode("utf-8")` round-trip on a 2 MB buffer, a single crafted upload can pin a CLI worker's CPU for a long time. The `MAX_PDF_PAGES`/`MAX_TEXT_CHARS` caps bound memory but **not** regex/CPU time, and there is no per-extraction wall-clock timeout (only the 90s *Gemini network* timeout, which is a different stage).
- **Root cause**: Size caps were chosen to bound memory ("a real CV is tiny"), but the text-repair regexes have super-linear behavior on adversarial spacing and run unconditionally on the full capped buffer. The threat model assumed benign-but-malformed CVs, not a crafted upload aimed at the extractor.
- **Impact**: An attacker who can upload a CV (this engine backs the public apply/extract-text flows per the manifest) can exhaust a worker's CPU with one file — a denial-of-service against the analysis pipeline. No auth gate exists at this layer; the gate is upstream in the Next.js routes.
- **Fix sketch**: Lower the practical text budget for the repair passes (real CVs are < ~100 KB), bound the number of letter-spaced runs repaired, and/or run extraction under a hard CPU/wall-clock timeout in the worker. Reject documents whose extracted text is overwhelmingly single-letter-token (a strong corruption/attack signal) instead of trying to "repair" megabytes of it.

## 6. `analyze_profile_with_gemini` reads `path.read_bytes()` with no size guard, defeating the extractor's `MAX_INPUT_BYTES` cap

- **Severity**: High
- **Category**: trust-boundary / resource-exhaustion
- **File**: `pipeline/jobfit/gemini.py:354`, `489`; bypasses `pipeline/jobfit/extractors.py:49-58`
- **Scenario**: `extract_text` rejects files over `MAX_INPUT_BYTES = 25 MB` via `_reject_oversized`. But the Gemini path uploads the raw file independently: `types.Part.from_bytes(data=path.read_bytes(), …)`. In the normal (non-blind) `analyze_cv` flow the pre-pass `extract_text` runs first and would raise on an oversized file — but that raise is **caught and degraded** in `_extract_pre_pass` (pipeline.py:892-897), which appends a note and returns empty text, then proceeds to call `analyze_profile_with_gemini`, which reads the entire oversized file into memory and ships it to the API. The size cap that `_reject_oversized` is meant to enforce is therefore not enforced for the actual model upload.
- **Root cause**: The oversize check lives in the *text extractor*, but the Gemini call has its own independent `read_bytes()` and the pipeline's degrade-don't-abort policy turns the extractor's rejection into a swallowed note rather than a hard stop. Two separate file reads with only one of them gated.
- **Impact**: A 200 MB "CV" (still a small enough on-disk file to upload) is fully read into memory and transmitted to Gemini, burning memory, bandwidth, and tokens, even though the documented limit is 25 MB. Pairs with #5 as a resource-exhaustion vector.
- **Fix sketch**: Move `_reject_oversized(path)` into `analyze_profile_with_gemini`/`extract_profile_text_with_gemini` before `read_bytes()`, or have `_extract_pre_pass` re-raise (not degrade) on a `ValueError` that specifically signals oversize, so the analysis aborts instead of uploading.

## 7. `_select_payload`/`_parse_json` can pick a citation/example object as the analysis payload when the real answer is absent

- **Severity**: Low
- **Category**: edge-case / silent-failure
- **File**: `pipeline/jobfit/gemini.py:544-586`
- **Scenario**: With grounding on, the model returns prose with several embedded JSON objects. `_select_payload` ranks by `(matched_expected_keys, size, index)`. If the true payload is missing or malformed but the prose contains a large stray object (e.g. an echoed schema example, or a citation blob that happens to repeat a couple of schema key names), that object wins on size/index and becomes the "analysis." Downstream, `analyze_cv` only checks `payload.get("profile")` is a dict (pipeline.py:156-158); a stray object with a `profile`-shaped key passes and produces a plausible-looking but fabricated result.
- **Root cause**: Selection is heuristic (most keys, then biggest, then last) with no minimum-match threshold — when zero candidates actually match the schema it still returns the "least bad" object rather than failing.
- **Impact**: Rare, but a grounded response whose real payload didn't materialize can yield a confident analysis assembled from an example/citation blob instead of erroring.
- **Fix sketch**: Require a minimum number of matched `expected_keys` (e.g. ≥2 core keys like `profile`+`score`) before accepting `_select_payload`'s result; otherwise raise "non-JSON / no matching payload" so the caller's existing empty-payload guard fires.
