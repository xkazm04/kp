# Pipeline CLIs & Script Bridges — ambiguity-guardian + ui-perfectionist scan

> Total: 6 findings (0 critical, 2 high, 3 medium, 1 low)

## 1. Malformed `--weights` JSON aborts the whole match run, contradicting the flag's own contract
- **Severity**: High
- **Lens**: ambiguity
- **Category**: documented-behavior-mismatch
- **File**: `pipeline/jobfit/match_cli.py:58`
- **Scenario**: A caller passes a recruiter weight override that isn't valid JSON (a truncated shell quote, a trailing comma, `skills:0.5`). The `--weights` help text says "ignored if not a JSON object" and the inline comment says "A malformed --weights must not abort the match — coerce a non-object to None". Instead, `json.loads(args.weights)` raises `JSONDecodeError`, which falls into the blanket `except Exception → emit_error(exc)` and the ENTIRE match run dies with a 500.
- **Root cause**: Only the valid-JSON-but-not-an-object case is coerced to `None` (`isinstance(parsed, dict)` check at line 60-62); the parse itself sits inside the same `try` as the match and is not guarded.
- **Impact**: An optional tuning knob can take down the primary ranking — the Match tab shows an engine error instead of the archetype-baseline results the code explicitly promises. Latent today (the TS route serializes the object), but any new caller or manual invocation trips it.
- **Fix sketch**: Wrap the weights parse in its own `try/except (ValueError, TypeError)` that sets `weights = None` on failure, optionally printing a plain-text stderr note like `load_jobs_arg` does for skipped job rows. That makes runtime behavior match both the help text and the comment.

## 2. Split-brain error taxonomy: half the CLI fleet reports user-fixable bad input as a 500 engine outage
- **Severity**: High
- **Lens**: ambiguity
- **Category**: inconsistent-error-contract
- **File**: `pipeline/jobfit/jobs_cli.py:51`
- **Scenario**: A user submits a malformed record to `/api/jds/save` (or a bad payload reaches group_compare / winnability / recruiter / match). `profile_cli.py`, `profile_draft_cli.py`, and `campaign_cli.py` carefully map `ValueError`/`ValidationError`/`JSONDecodeError` to `{"status":400,"code":"invalid_input"}` + exit 2 ("HONEST status" per their docstrings). But `jobs_cli.py:51-53`, `group_compare_cli.py:56-58`, `winnability_cli.py:84-86`, `recruiter_cli.py:98-100`, and `match_cli.py:64-65` (via `emit_error`'s default `status=500`) collapse the exact same user-correctable failures into `{"status":500}` + exit 1, with no `code` field at all.
- **Root cause**: The 400/500 taxonomy was retrofitted CLI-by-CLI (each converted file carries a "mirrors profile_cli.py" comment) and the campaign never reached the other five entry points; `_cli.emit_error` — the shared consolidation point — only knows the 500 shape.
- **Impact**: For half the endpoints, the TS seam (`python-runner.parseStderrError`) and the UI tell the user "engine fault, retry/escalate" for input they could fix in one edit — the precise failure mode the profile_cli docstring says the taxonomy exists to prevent. Same bug class, opposite behavior, depending on which tab you're in.
- **Fix sketch**: Teach `_cli.emit_error` the taxonomy once: map `ValueError` (covers `ValidationError` + `JSONDecodeError`) to `{"status":400,"code":"invalid_input"}`/exit 2 and everything else to `{"status":500,"code":"engine_error"}`/exit 1, then have all eight CLIs route their handlers through it. Delete the per-file copies of `ERR_INVALID_INPUT`/`ERR_ENGINE`.

## 3. recruiter_cli / winnability_cli silently drop entries their docstrings promise are "RECORDED, not silently dropped"
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: silent-drop-vs-documented-audit
- **File**: `pipeline/jobfit/recruiter_cli.py:64`
- **Scenario**: The winnability docstring says a malformed CV is "skipped — but RECORDED, not silently dropped — so the coach scores, and honestly reports, the exact same pool". But an entry that is not a dict (`recruiter_cli.py:56-57`, `winnability_cli.py:57-58`) or is a dict with NEITHER `profile` nor `candidate` key (`recruiter_cli.py:64-65`, `winnability_cli.py:65-66`) hits a bare `continue` — it never lands in `skipped`. Only pydantic validation failures are recorded.
- **Root cause**: The row-level-isolation fix (bug-ui-scan-2026-07-09 #4) instrumented the `except` path but left the two pre-existing structural `continue`s untouched; the ~25-line parsing loop is also duplicated verbatim across both files instead of living in `_cli.py` beside `load_candidate_arg`.
- **Impact**: A caller bug that emits `{"label": "...", "profil": {...}}` (typo'd key) shrinks the ranked/assessed pool with zero trace — exactly the dishonest denominator the `skipped` channel was built to prevent. The duplication also means the next fix has to be applied twice (this finding is itself evidence: both copies share the gap).
- **Fix sketch**: Record both structural rejects into `skipped` with reasons like `"entry is not an object"` / `"entry has neither 'profile' nor 'candidate'"`. Then extract the whole loop into a shared `parse_candidate_entries(raw) -> (candidates, skipped)` helper in `_cli.py` used by both CLIs.

## 4. compare.py table columns misalign because cell width math counts invisible ANSI escape codes
- **Severity**: Medium
- **Lens**: ui
- **Category**: terminal-table-alignment
- **File**: `scripts/compare.py:43`
- **Scenario**: A user runs `python scripts/compare.py cv-a.pdf cv-b.pdf --jd jd.txt` in a color terminal. Score cells are built as `f"{color}{int(value):>3}{RESET}/100"` (line 126-127) — 7 visible chars but ~16 raw chars — then padded/truncated by `_cell(text, width)` using `len(text)`. Colored cells get ~9 chars less padding than plain `—` cells, so columns drift left and right row by row; worse, a long colored value can be truncated mid-escape-sequence, leaving the rest of the table bleeding that color.
- **Root cause**: `_cell`/`_row` measure raw string length, not display width. The header row proves the author knew: line 96 hand-compensates with `col_width + len(BOLD) + len(RESET)` — a fix applied to exactly one row of the table.
- **Impact**: The one script whose entire purpose is a side-by-side visual comparison renders a ragged grid whenever colors are enabled (the default in a TTY), undermining the "every script looks the same" promise in `_common.py`'s module docstring.
- **Fix sketch**: Add a `visible_len(s)` helper to `scripts/_common.py` that strips `\x1b\[[0-9;]*m` before measuring, and use it in `_cell` for both padding and truncation (truncate the visible text, then re-apply `RESET`). Drop the header-row hand-compensation once cells measure correctly.

## 5. market_salary_cli fabricates research context from phantom defaults the sibling CLI explicitly forbids
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: phantom-defaults
- **File**: `pipeline/jobfit/market_salary_cli.py:98`
- **Scenario**: The JD builder asks for a market band before the recruiter has filled in seniority or role family. The CLI silently substitutes `"medior"`, `"software_engineering"`, and `"a mid-size company"` (lines 98-101), researches THAT role, and returns a confident-looking band with citations — or, on fallback, the medior software-engineering taxonomy band — with nothing in the output marking any input as assumed.
- **Root cause**: Blanket `or`-defaults chosen for prompt convenience. `campaign_cli.py`'s header comment states the project's own rule — "Blank-fill (absent fact) rather than default-fill (phantom fact)... the campaign's honesty rule must never advertise" DEFAULT_POLICY phantoms — but this CLI predates/escaped that rule.
- **Impact**: A recruiter can anchor a real salary offer on a band computed for a different seniority and a different field than the actual role, with `"confidence": "medium"` attached. Wrong-decision risk, and it is invisible: the response never says which fields were defaulted.
- **Fix sketch**: Either reject a request missing `seniority`/`roleFamily` with the 400/invalid_input envelope (the JD builder always has both), or keep the defaults but include an `"assumed": ["seniority", "roleFamily", ...]` array in the result and cap `confidence` at `"low"` whenever it is non-empty, so the UI can badge the estimate.

## 6. Six CLIs hand-roll stdio reconfiguration instead of using the consolidation module built for exactly that
- **Severity**: Low
- **Lens**: ambiguity
- **Category**: partial-consolidation-drift
- **File**: `pipeline/jobfit/recruiter_cli.py:28`
- **Scenario**: `_cli.py`'s docstring says stdio/encoding behavior should "live in ONE place" via `configure_stdio()`. Yet profile_cli (36-38), jobs_cli (24-26), recruiter_cli (28-30), campaign_cli (33-35), group_compare_cli (32-34), winnability_cli (30-32), and profile_draft_cli (256-258) each repeat the `hasattr(sys.stdout, "reconfigure")` block by hand — and drift has already started: jobs_cli passes `errors="replace"` while its six siblings use the implicit strict policy.
- **Root cause**: `_cli.py` was introduced for match/reasoning/matrix and the remaining CLIs were never migrated; copy-paste kept the old blocks alive.
- **Impact**: The policy split is user-visible at the margin: a payload containing a lone surrogate (JSON `\ud800` escapes survive `json.dumps(ensure_ascii=False)`) crashes the strict CLIs with a raw `UnicodeEncodeError` — no error envelope for the TS seam to parse — while jobs_cli degrades gracefully. Any future stdio fix must be applied in seven places.
- **Fix sketch**: Replace each hand-rolled block with `from ._cli import configure_stdio; configure_stdio()` (passing `errors="replace"` where jobs_cli needs it), leaving one definition of the behavior. Two-line change per file, no behavior change beyond unifying the error policy decision.
