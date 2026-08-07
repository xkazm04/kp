# Pipeline CLIs & Script Bridges — bug-hunter + ui-perfectionist scan

> Context: Command-line entry points the Next.js API shells out to (analyze, profile, match, reasoning, jobs, recruiter, matrix, salary, campaign, winnability) plus the `spawnPython`/`parsePythonJson` bridge and the thin `scripts/` wrappers.
> Files reviewed: 19 of 21 (+ ~12 Node-side bridge callers/routes referenced from other contexts: `python-runner.ts`, `analyze-run.ts`, `reasoning-run.ts`, `recruiter-run.ts`, `group-eval-run.ts`, `automation-run.ts`, `jd-build-run.ts`, `job-ingest.ts`, and the `/api/{match,matrix,profile,profile/draft,extract-text,jobs/[id]/{campaign,winnability}}` routes)
> Total: 5

The bridge is genuinely hardened since the 2026-06-20 scan: `match`/`profile`/`matrix` now pass `{ signal }` (prior #1 largely closed); `--weights` and `--limit` are sanitized in TS before argv; every stdout consumer but one uses `parsePythonJson`. I probed command/argument injection hard and found it **well-contained** — `spawn` uses argv arrays (no shell), user strings are always the *value* of a preceding `--flag` (a single token argparse never re-splits), a leading-`-` value makes argparse *error* rather than mis-execute, and every file-path token is an absolute `mkdtemp` path. The one raw `JSON.parse(stdout)` (profile/draft route) is the sibling agent's finding and is not re-reported here. The residual sharp edges below are on the **job-corpus trust boundary** and the two spawn sites that still skip the hardening.

## 1. One malformed job record in the `--jobs-json` corpus override aborts the ENTIRE match / matrix / reasoning run for all candidates

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent-failure / edge-case (poison pill)
- **File**: `pipeline/jobfit/_cli.py:66-71` (`load_jobs_arg`), `pipeline/jobfit/matrix_cli.py:54-57`; consumed by `match_cli.py:54`, `reasoning_cli.py:52`, fed from `app/_lib/db/jobs.ts:353` (`getJobsByIds`) / `:382` (`listCorpusJobs`)
- **Scenario**: A recruiter opens the Match tab / Fit Matrix / "Explain fit" for a pool. The route hands the live DB corpus to the CLI as `--jobs-json`. If **any one** of those DB job rows has a null/missing `company`, `location`, `title`, or `id`, Python's `Job.model_validate(rec)` raises a `ValidationError` — which propagates uncaught to the top-level `except → emit_error` → exit 1 → the route 500s. Every candidate's ranking fails, not just the bad job's column.
- **Root cause**: These CLIs carefully isolate a malformed *candidate* (matrix `missingCandidates`, recruiter `skipped`) but the job-corpus augmentation loop has **no per-record isolation** — it validates in a bare `for rec in json.loads(...)`. The TS side never validates either: `getJobsByIds`/`listCorpusJobs` only `safeRowParse` the stored `payload_json` (valid-JSON check), and `Job` requires `company`/`location` as non-optional `str` (`jobs.py:114-115`). So a job persisted by any path that didn't blank-fill (import, legacy, partial ingest) is a poison pill the system does nothing to defend against.
- **Impact**: A single bad row silently disables the core matching surface for the whole workspace — a hard 500 with a `ValidationError` message `parseStderrError` can't classify (generic 500, no actionable `code`). Recruiter-reachable: ingest/import an underspecified job → every match breaks.
- **Fix sketch**: Wrap the per-record `Job.model_validate(rec)` in a try/except in `load_jobs_arg` and `matrix_cli`, collect bad ids into the existing `missing`/skipped channel, and keep going — mirror the per-candidate isolation these same CLIs already implement so one row can never poison the batch.

## 2. /api/profile/draft spawns a Gemini LLM child with no signal, no timeout, and no maxDuration — orphaned child + recruiter-notes workdir leaked on abort

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: resource-leak / silent-failure
- **File**: `app/api/profile/draft/route.ts:33` (`spawnPython([... profile_draft_cli ...])` — no opts), workdir written at `:26-28` (`notes.json`)
- **Scenario**: A recruiter clicks "AI draft", then closes the modal / navigates away before the ~seconds-long Gemini call returns. Nothing tells the child to stop: unlike `reasoning-run`, `analyze-run`, `extract-text`, `matrix`, `match`, and `campaign` (all of which pass `{ signal: request.signal }`), this route passes **no options at all**. The child runs to completion — or to the 600s backstop — burning a Gemini call whose result is discarded.
- **Root cause**: The hardening pattern is opt-in per call and this LLM route was missed. It also sets no `export const maxDuration`; on a serverless deploy the platform kills the function at its default budget *before* the child settles, so the `finally { cleanupWorkdir }` never runs and `notes.json` — the recruiter's free-text intake notes (candidate PII) — is left in `os.tmpdir()`. (Prior #1 named `/api/profile`, not `/api/profile/draft`; this is the remaining unfixed LLM spawn.)
- **Impact**: Per abandoned draft: one orphaned Gemini child holding a worker slot up to 600s, a wasted paid call, and — on serverless — a PII-bearing temp file that never gets cleaned.
- **Fix sketch**: Pass `{ signal: request.signal }`, add `export const maxDuration`, and derive `timeoutMs = (maxDuration - 5) * 1000` exactly as `extract-text/route.ts:23,60-63` does, so an abandoned request SIGKILLs the child inside the function budget and cleanup always runs.

## 3. [STILL-OPEN] spawnPython never closes the child's stdin, so any CLI that falls back to sys.stdin.read() hangs for the full 600s on a missing-flag regression

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: latent-failure / timing
- **File**: `app/_lib/python-runner.ts:119-134` (default stdio; `child.stdin` is never `.end()`ed); fallbacks at `pipeline/jobfit/_cli.py:47-51`, `profile_cli.py:46`, `profile_draft_cli.py:254`, `jobs_cli.py:37,41`, `recruiter_cli.py:42`, `winnability_cli.py:42`, `group_compare_cli.py:44`, `market_salary_cli.py:88`
- **Scenario**: A refactor drops/renames a CLI's input flag (e.g. `--input-json`/`--candidate-json`) so argparse leaves it `None`. The CLI falls back to `json.loads(sys.stdin.read() or "{}")`. But `spawn(...)` uses default stdio — the child's stdin is an **open pipe that the bridge never writes to or closes** — so `sys.stdin.read()` blocks forever waiting for EOF.
- **Root cause**: The "path else stdin" convenience (fine for a human piping at a terminal) is a trap under the bridge, where stdin is an unfed, never-closed pipe. A missing-argument *programming* error silently degrades into an indefinite read instead of a fast, attributable failure. Still literally true on `main`: no `stdio` option and no `child.stdin.end()` anywhere in `python-runner.ts` (prior scan #4, unresolved).
- **Impact**: The child hangs to the 600s timeout (or, on the no-signal route in #2, until the platform kills the function), presenting as a mysterious slow/timed-out endpoint that burns a worker slot with no useful error.
- **Fix sketch**: In `spawnPython`, call `child.stdin?.end()` immediately after spawn (or use `stdio: ["ignore", "pipe", "pipe"]`) so an unfed stdin reads EOF instantly and a missing-flag bug fails fast instead of hanging.

## 4. winnability_cli silently drops malformed candidates, so the winnability grade is computed over a smaller pool than the recruiter sees

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure / state-corruption
- **File**: `pipeline/jobfit/winnability_cli.py:64-67` (`except Exception: continue`)
- **Scenario**: A recruiter grades a draft JD's winnability against a pool of, say, 10 candidates. Two candidates have a partially-extracted profile that fails `CandidateProfileV2.model_validate` / `build_match_candidate`. `winnability_cli` catches each with a bare `except: continue` — **no id, label, or reason recorded** — so `assess_winnability` runs over 8, not 10. The result ("eligible/qualified counts, loosen-gate and demote-must-have deltas") is reported as if the whole pool were assessed.
- **Root cause**: Asymmetric isolation. `recruiter_cli` (`:66-71`) records dropped entries in `skipped` and `matrix_cli` (`:87-88`) records them in `missingCandidates` — but `winnability_cli`, which the docstring says "scores the exact same pool the recruiter ranking does," drops silently. The counts a coaching/gating decision depends on are therefore computed over an invisibly reduced denominator.
- **Impact**: Wrong gating advice on a decision surface: "3 of 10 qualify → loosen the language gate" may really be "3 of 8," and the recruiter has no signal that two candidates were never scored. Silent, non-reproducible (depends on which CVs are malformed).
- **Fix sketch**: Collect dropped entries into a `skipped`/`missingCandidates` list (id + label + reason) and return it alongside the assessment — reuse the exact shape `recruiter_cli`/`matrix_cli` already emit — and surface a "N not assessed" note in the UI so the denominator is honest.

## 5. profile_draft_cli collapses user-correctable bad input into a scary 500 engine_error, breaking the honest 400/500 taxonomy its own docstring promises

- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: error-handling
- **File**: `pipeline/jobfit/profile_draft_cli.py:262-264` (blanket `except Exception → status 500`); contrast `profile_cli.py:69-80`
- **Scenario**: The AI returns a payload that fails validation, or the input JSON is malformed. `profile_draft_cli` has a single blanket `except Exception` that stamps **every** failure as `{"status": 500, "code"-less}` — so a user-correctable condition surfaces in the Profile editor as a generic "retry/escalate" 500 instead of an actionable 400.
- **Root cause**: Inconsistency with its sibling. `profile_cli.py` deliberately splits `except ValueError` (→ 400 `invalid_input`, exit 2, editor shows a field hint) from `except Exception` (→ 500 `engine_error`), and its docstring documents that intent — but `profile_draft_cli` never adopted the split despite claiming the same taxonomy. (Minor related nit: the empty-notes branch at `:258-259` returns exit code `1` with a JSON `status:400`; the route guards empty text first so it's unreachable, but the exit/status mismatch should be `2`/consistent.)
- **Impact**: A recruiter with a thin/odd note gets an alarming engine-failure toast rather than "add more detail," and any UI branching on `code` gets nothing. No data loss.
- **Fix sketch**: Mirror `profile_cli`: add `except ValueError as exc:` → `{status:400, code:"invalid_input"}` exit 2 (pydantic `ValidationError` and `json.JSONDecodeError` are both `ValueError`) before the catch-all `except Exception` → `{status:500, code:"engine_error"}`.
