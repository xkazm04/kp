# Pipeline CLIs & Script Bridges — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀3 / 🚀2 | Severity: C0/H1/M3/L1

Scope: the 10 `pipeline/jobfit/*_cli.py` entry points + `_cli.py` glue + the 5
`scripts/*.py` terminal renderers, read against their TS callers
(`app/_lib/*-run.ts`, `app/_lib/python-runner.ts`, `app/api/**`). Most "dark
capability" flags in this context turned out to be wired (`--blind`, `--weights`,
`--weights-llm`, `--embeddings`, `--no-llm`, winnability coach), so the evidence
skews toward ambiguity/contract findings with two genuine business levers.

## 1. Honest 400/500 error taxonomy is only adopted by 3 of 10 CLIs — the rest collapse user-fixable errors into a scary 500
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: error-contract / UX consistency
- **File**: pipeline/jobfit/_cli.py:74 (and reasoning_cli.py:62, recruiter_cli.py:99, winnability_cli.py:74, group_compare_cli.py:52, jobs_cli.py:52, market_salary_cli.py:132)
- **Observation**: `profile_cli.py:69-80` and `campaign_cli.py:63-69` implement an explicit, documented taxonomy — a `ValueError` (bad JSON / failed pydantic validation) returns `{status:400, code:"invalid_input"}` with exit code 2, a real fault returns `{status:500, code:"engine_error"}` exit 1 — and `python-runner.ts:261-282` + `PipelineError.code` (python-runner.ts:36-44) actively consume it so the UI can show an inline field hint vs. a "retry/escalate" banner. But `_cli.py:emit_error` hardcodes `status=500`/exit 1, and `match_cli`, `reasoning_cli`, `matrix_cli` (via `emit_error`) plus `recruiter_cli`, `winnability_cli`, `group_compare_cli`, `jobs_cli`, `market_salary_cli` wrap **every** exception — including clearly user-/caller-correctable ones like the literal `raise ValueError("job not found: …")` at reasoning_cli.py:55, recruiter_cli.py:51, winnability_cli.py:51 — into a 500 with no `code`.
- **Why it matters**: A recruiter who pastes a malformed candidate, references a stale `--job-id`, or sends an empty matrix gets a red "engine error — try again" instead of a fixable 400 hint. The fix machinery already exists and is proven on two CLIs; the contract is just half-applied, which is exactly the inconsistency `profile_cli.py`'s own docstring brags about having solved ("instead of seeing every failure as a 500").
- **Recommendation**: Extend `_cli.py:emit_error` to accept a status (default 500) and add a tiny helper that maps `ValueError`/`json.JSONDecodeError`/pydantic `ValidationError` → 400 `invalid_input` (exit 2) and "not found" → 404; route every CLI's `except` through it. Treat `job not found` as 404, not 500.
- **Effort**: S

## 2. The flagship `analyze` CLI's `--stream` SSE pathway is fully built but no route invokes it
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: dead capability / tribal knowledge
- **File**: pipeline/jobfit/cli.py:43 (arg), :12-18 (`_emit_event`, with hand-tuned Windows CRLF/SSE-separator care), :53/:68-82 (stage/result/error SSE branches)
- **Observation**: `cli.py` carries a complete server-sent-events implementation — per-stage `{"type":"stage"}` progress, a final `{"type":"result"}`, and even a comment explaining the raw-bytes write that keeps the `\n\n` SSE separator intact on Windows. Yet the only TS caller, `analyze-run.ts:50-59` (`cliArgs`), never appends `--stream`, and a repo-wide grep for `--stream` finds zero consumers. The route instead buffers via `Promise.all` with a coarse per-CV `onProgress`. So the most-engineered progress surface, on the single longest user wait in the product (a 10-30 s grounded LLM analysis), is dead code.
- **Why it matters**: Either this is unexplained dead code (an ambiguity/maintenance trap — future readers can't tell if it's load-bearing) or it's a shipped-but-unwired UX win. Real-time "Extracting… / Scoring… / Estimating salary…" streaming is a meaningful perceived-performance and retention lever during the analysis spinner.
- **Recommendation**: Decide and document: either wire `--stream` into a streaming analyze route (the SSE shape is ready) and delete the buffered progress, or remove the `--stream` branch and note in the docstring why progress lives on the TS side.
- **Effort**: M (wire) / S (remove + document)

## 3. `group_compare_cli` has no `--lang` flag — the "Compare all candidates" AI summary is English-only inside a bilingual (en/cs) product
- **Lens**: 🚀 Business
- **Severity**: Medium
- **Category**: i18n / market credibility
- **File**: pipeline/jobfit/group_compare_cli.py:36-39 (parser exposes only `--input-json` and `--no-llm`)
- **Observation**: Every sibling LLM CLI takes `--lang` — `reasoning_cli.py:41`, `market_salary_cli.py:84`, `campaign_cli.py:39`, `profile_draft_cli.py:248` — and `market_salary_cli.py:27-33` explicitly localizes its fallback to avoid "the exact mixed-language seam the bilingual i18n closed." `group_compare_cli` alone omits it, so the comparative `headline`/`keyPoints`/`recommendation` it generates (the recruiter's headline decision artifact for a role, persisted with no cache to re-localize) always comes back in English even when the whole UI is Czech.
- **Why it matters**: This is the document a hiring manager reads to pick between finalists. An English summary dropped into a Czech workspace is the precise credibility/quality gap the rest of the codebase spent effort closing — it undercuts the bilingual positioning that differentiates kp in the CZ/SK market and erodes trust at the highest-stakes moment.
- **Recommendation**: Add `--lang` to `group_compare_cli`, thread it into `group_compare.generate()` and its prompt (mirror `reasoning_cli`), and pass `input.lang` from `app/_lib/group-eval-run.ts`. Keep canonical code/enum values English as the other CLIs do.
- **Effort**: M

## 4. A `timeout=120` magic number is copy-pasted into 6 CLIs, uncoordinated with the 600 s TS backstop, with no named constant or rationale
- **Lens**: 🌀 Ambiguity
- **Severity**: Low
- **Category**: magic number / config drift
- **File**: pipeline/jobfit/reasoning_cli.py:57 (also recruiter_cli.py:91, jobs_cli.py:46, campaign_cli.py:54, group_compare_cli.py:47, profile_draft_cli.py:221)
- **Observation**: Each CLI calls `resolve_provider(<use_case>, timeout=120)` with a bare literal `120` and no comment on why 120 s, what it bounds, or that it differs from the wall-clock backstop the TS runner applies (`python-runner.ts:87`, `DEFAULT_TIMEOUT_MS = 600_000`). Two uncoordinated timeout layers exist: the provider call is cut at 120 s well before the 600 s process SIGKILL, but nothing documents that relationship.
- **Why it matters**: A legitimately slow grounded Gemini call (>120 s) is silently truncated at the provider layer and degrades to a fallback, looking like a model failure rather than a timeout — and a maintainer tuning one number won't know the other exists. Pure tribal knowledge encoded as a repeated literal.
- **Recommendation**: Hoist a single named constant (e.g. `PROVIDER_TIMEOUT_S` in `llm/__init__` or `_cli.py`) with a one-line rationale and its relationship to the TS backstop; import it everywhere instead of re-typing `120`.
- **Effort**: S

## 5. The grounded, source-cited market-salary engine is reachable only through the JD builder — a standalone, metered "Salary Benchmarking" surface is left on the table
- **Lens**: 🚀 Business
- **Severity**: Medium
- **Category**: monetization / productization
- **File**: pipeline/jobfit/market_salary_cli.py:116-128 (grounded answer + up to 8 cited `sources` + `confidence`), :36-46 (deterministic taxonomy fallback), :83/:98-101 (`--no-grounding`)
- **Observation**: `market_salary_cli` is a self-contained compensation engine: it returns a monthly CZK band, a `confidence` rating, a grounded `summary`, and up to 8 cited web `sources`, with a clean `--no-grounding` deterministic-taxonomy fallback. Its **only** caller is `app/_lib/jd-build-run.ts:83`, which uses it to pre-fill one salary line of a job ad. The richest, most sellable output of the whole pipeline — cited live market comp data, the thing recruiters pay Glassdoor/Levels.fyi for — is buried as a JD-form helper.
- **Why it matters**: A standalone "what does this role pay?" lookup (role + seniority + stack → cited band) is an obvious acquisition hook and a natural premium boundary: the engine already splits grounded-LLM-with-citations (the differentiator) from the free taxonomy table (`--no-grounding`), mirroring the existing `meterAllows("ai_candidates")` metering pattern (`app/_lib/reasoning-run.ts:63`, `automation-run.ts:154`). Exposing it as its own metered endpoint/widget monetizes an asset that already exists.
- **Recommendation**: Add a thin `/api/salary/benchmark` route + a small lookup UI that calls `market_salary_cli` directly; meter the grounded path and serve the deterministic band free as the freemium tier. No engine work — it already returns the full payload.
- **Effort**: M
