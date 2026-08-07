> Total: 6 findings (0c critical, 2h high, 2m medium, 2l low)

## 1. stdio-reconfigure + error-envelope boilerplate hand-rolled in most CLIs despite a shared `_cli.py`
- **Severity**: High
- **Category**: duplication
- **File**: pipeline/jobfit/_cli.py:23 (`configure_stdio`), :74 (`emit_error`) vs the duplicating CLIs below
- **Scenario**: `_cli.py` was created precisely to own UTF-8 stdio setup and the `{error,status}` stderr envelope ("live in ONE place", per its module docstring), yet adoption is partial. `grep -rln "sys.stdout.reconfigure" pipeline/jobfit/*_cli.py` shows the `if hasattr(sys.stdout,"reconfigure"): sys.stdout.reconfigure(...)/sys.stderr.reconfigure(...)` block copy-pasted in **9** files (automation_cli, campaign_cli, group_compare_cli, jobs_cli, profile_cli, profile_draft_cli, recruiter_cli, winnability_cli — all re-implement it; only extract_cli/match_cli/matrix_cli/reasoning_cli/market_salary_cli/cli.py call `configure_stdio()`). `grep -rln 'json.dumps({"error"'` shows the error envelope hand-rolled in **12** of 13 CLIs; only match_cli, matrix_cli, reasoning_cli call `emit_error()`.
- **Root cause**: `_cli.py` was retrofitted onto an existing fleet (its docstring names only match/reasoning/matrix as the consolidation targets) and never back-ported to the other 9. A second, real blocker: `emit_error(exc, status)` always `return 1` and emits only `{error,status}` — it supports neither the 400→exit-2 convention nor the `code` field (`ERR_INVALID_INPUT`/`ERR_ENGINE`) that profile_cli/campaign_cli/automation_cli/extract_cli/cli.py rely on, so those CLIs literally cannot adopt it as written.
- **Impact**: The bridge's stdio behaviour (the `errors="strict"` vs `"replace"` policy that decides whether a Czech-diacritic byte crashes or substitutes — and it IS inconsistent: jobs_cli uses `errors="replace"`, market_salary uses `configure_stdio(errors="replace")`, but campaign/profile/recruiter/winnability/group_compare use bare `reconfigure(encoding="utf-8")` = strict) and the error contract live in 9-12 places. A contract change (e.g. adding a `code` to every envelope, or fixing the strict/replace split) needs editing a dozen files and will drift.
- **Fix sketch**: Extend `emit_error` to accept `code: str | None = None` and derive the exit code from status (`2` for 4xx, `1` otherwise) so it can serve the full fleet; then replace the 9 hand-rolled reconfigure blocks with `configure_stdio(...)` and the 12 hand-rolled envelopes with `emit_error(exc, status=..., code=...)`. Pick one default codec-error policy and pass it explicitly where a CLI needs the other.

## 2. matrix_cli re-implements the `--jobs-json` corpus-augment that `load_jobs_arg` already provides
- **Severity**: Medium
- **Category**: duplication
- **File**: pipeline/jobfit/matrix_cli.py:48-58 vs pipeline/jobfit/_cli.py:55-71 (`load_jobs_arg`)
- **Scenario**: `_cli.py:load_jobs_arg(jobs, jobs_json)` does exactly: `corpus = load_corpus(jobs)`; build `by_id`; for each rec in `jobs_json`, `by_id[Job.model_validate(rec).id] = job`; return values — "overrides win on id collision". matrix_cli.py:48-58 reproduces that block verbatim (load_corpus, `by_id = {j.id: j for j in corpus}`, the `Job.model_validate(rec)` loop). matrix_cli already imports from `._cli` (line 24: `configure_stdio, emit_error`) so the helper is in scope. The identical "mirrors recruiter_cli's --job-json escape hatch" comment appears in both `_cli.py` and matrix_cli, confirming they are the same logic.
- **Root cause**: `load_jobs_arg` was extracted for match_cli/reasoning_cli; matrix_cli's pre-existing inline copy was left because matrix then further mutates the dict (job-id selection/dedupe on `by_id`), which `load_jobs_arg`'s list return doesn't directly expose.
- **Impact**: Two copies of the corpus-merge semantics; a change to override precedence or to the seed-corpus loading must be made twice and they can silently diverge (the bug class this whole CLI set already had — "Match ranking didn't see DB jobs").
- **Fix sketch**: Have `load_jobs_arg` (or a sibling `load_jobs_by_id` returning the `{id: Job}` dict) be the single source; matrix_cli calls it then does its job-id selection over the returned dict. Keeps matrix's extra logic, removes the duplicated merge.

## 3. `profile_draft_cli` carries ~190 lines of pure draft-assembly logic that belongs in a module
- **Severity**: Medium
- **Category**: structure
- **File**: pipeline/jobfit/profile_draft_cli.py:30-238 (DRAFT_SCHEMA, `_clean_str`/`_str_list`/`_as_bool`/`_one_of`, `build_draft`, `_extract`)
- **Scenario**: At 270 lines this is by far the largest "thin" CLI (next is automation_cli at 164; the median is ~80). Only ~30 lines (`main`) are CLI plumbing; the rest is the Gemini draft schema, five sanitization helpers, the pure `build_draft` mapper, and the `_extract` LLM call. The file's own docstring says the LLM call "is isolated from the pure `build_draft` assembly so the mapping/routing is unit-tested" (tests/test_profile_draft.py) — i.e. tests already import logic out of a CLI entry point, the tell-tale sign it should be a module. Every sibling (campaign/jobs/recruiter/match/...) keeps its logic in a `campaign.py`/`jobs.py`/`recruiter.py` and the `_cli.py` stays thin.
- **Root cause**: The draft feature was built directly in the CLI rather than a `profile_draft.py` module, breaking the established CLI-thin / logic-in-module convention this package otherwise follows.
- **Impact**: Inconsistent with the rest of the fleet; the CLI is hard to scan for its actual entry-point behaviour; importing `build_draft` for tests reaches into a `_cli` module.
- **Fix sketch**: Move `DRAFT_SCHEMA`, the `_*` sanitizers, `build_draft`, and `_extract` into a new `pipeline/jobfit/profile_draft.py`; leave profile_draft_cli as a ~30-line thin wrapper like its siblings; repoint the test import.

## 4. Exit-code contract inconsistency: a `status:400` returns exit 2 in most CLIs but exit 1 in `profile_draft_cli` and `jobs_cli`
- **Severity**: Low
- **Category**: cleanup
- **File**: pipeline/jobfit/profile_draft_cli.py:257-258; pipeline/jobfit/jobs_cli.py:42-53
- **Scenario**: profile_cli (:76), campaign_cli (:66), extract_cli (:27), cli.py (:72), automation_cli all map a user-correctable failure to `status:400` AND `return 2` — the convention profile_cli's docstring documents ("exit 2 for 400 ... so python-runner's parseStderrError can tell user-fixable bad input from a real engine outage"). But profile_draft_cli prints `{"error":"No notes supplied.","status":400}` then `return 1` (line 258), and jobs_cli folds an empty-ad `ValueError` ("ingest requires non-empty ad text") into its single `except` that emits `status:500` / `return 1` — a 400-class condition surfaced as 500.
- **Root cause**: These two CLIs predate / didn't pick up the honest 400/exit-2 taxonomy added to profile_cli/campaign_cli; the empty-input check in jobs_cli sits inside the broad `except Exception` rather than a dedicated 400 branch.
- **Impact**: The TS bridge can't distinguish bad input from engine fault for these two endpoints (a missing-notes draft or empty-ad ingest looks like a server outage), undercutting the documented contract.
- **Fix sketch**: In profile_draft_cli return 2 for the 400; in jobs_cli raise/catch the empty-text case as a 400 (exit 2). Folds naturally into finding #1's `emit_error(status, code)` upgrade.

## 5. Five `scripts/*.py` terminal wrappers are not invoked by the app — human-only dev tools, flag as such
- **Severity**: Low
- **Category**: dead-code (verify-before-removing)
- **File**: scripts/analyze.py, scripts/compare.py, scripts/interview.py, scripts/jobfit.py, scripts/salary.py (+ their `scripts/_common.py`)
- **Scenario**: A repo-wide grep for any code (`*.ts/tsx/js/mjs/json/toml/yaml/Makefile`, excluding node_modules / `.claude/worktrees` / `docs/`) invoking these five scripts returns **nothing**. The only references are README.md (lines 173-192, a "Terminal scripts" table) and `context-map.json` (lines 962-966, registry metadata) and each script's own usage docstring. They import their OWN `scripts/_common.py` (ANSI/box renderers, `add_common_args`, `run_analysis`) and call `pipeline.jobfit.service.analyze` directly — a parallel terminal-UI layer, NOT spawned by any Next.js route or `package.json` script (package.json invokes `python -m pipeline.jobfit.*`, never `scripts/*.py`).
- **Root cause**: Intentional human-facing CLI explorers documented in the README, never wired into the app — legitimate, but indistinguishable at a glance from dead bridge code, and they duplicate the analyze invocation/arg surface that the in-app `cli.py` covers.
- **Impact**: NOT dead code (documented dev tools) — do not delete. But the overlap (`add_common_args`/`run_analysis` vs cli.py's analyze flags) is maintenance surface that drifts from the real pipeline, and a future reader may mistake them for live bridges (or vice-versa).
- **Fix sketch**: Leave in place; keep the README "developer terminal tools, not used by the app" note prominent. If consolidation is wanted later, have them shell `python -m pipeline.jobfit.cli` and render its JSON rather than re-importing `service.analyze`, so there's one analyze entry point.

## 6. Stray inline comment fragment in `automation_cli.py`
- **Severity**: Low
- **Category**: cleanup
- **File**: pipeline/jobfit/automation_cli.py:64
- **Scenario**: `grep -rn "^[[:space:]]*#.*(import|from|print|def|return|if|for)"` over the in-scope files surfaces one stray comment-only line: automation_cli.py:64 `# from a missing --job-id argument, which the caller guards as a 400.` — a continuation fragment beginning with "from" that reads as orphaned out of context (no leading clause line visible in the grep, worth eyeballing for a truncated/dangling comment). No `TODO`/`FIXME`/`HACK`/`XXX` exist anywhere in scope (grep clean), and no genuinely commented-out code blocks were found — so cleanup cruft is minimal; this is the only item.
- **Root cause**: Likely an edit that removed the first half of a two-line comment, leaving the trailing clause.
- **Impact**: Cosmetic; a confusing dangling comment. Negligible.
- **Fix sketch**: Read automation_cli.py:60-66 in context; either restore the comment's lead clause or merge into the preceding line so it reads as one complete sentence.
