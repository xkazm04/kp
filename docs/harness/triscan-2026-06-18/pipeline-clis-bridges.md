# Pipeline CLIs & Script Bridges — Tri-Lens Scan
> Total: 5
> Severity: 0 Critical / 3 High / 2 Medium / 0 Low
> Lens: 4 bug / 0 ui / 1 biz

> 🎨 UI Perfectionist: **N/A** for this context — these are headless Python CLIs spawned by the Next.js API (argv/stdin in, one JSON line out). There is no rendered surface to critique. All findings come from 🐛 Bug Hunter (primary) and 🚀 Business Visionary.

> Scope note: the Node↔Python seam is, on the whole, hardened well — `python-runner.ts` already caps the child's output buffer (64 MB), enforces a 10-min hang timeout, forces UTF-8 stdio for Czech diacritics, wires `AbortSignal`→SIGKILL, and `parsePythonJson` tolerates trailing interpreter shutdown chatter. The findings below are the residual gaps in that otherwise-solid bridge. No trivial nits included; the genuine count came to 5.

## 1. CLI error taxonomy collapses every failure to 500 — user-fixable bad input is indistinguishable from an engine outage
- **Lens**: 🐛 Bug Hunter
- **Severity**: High
- **Category**: Error propagation / success-theater inversion (honest-status contract violated)
- **Value**: impact 7/10 · effort 3/10 · risk 2/10
- **File**: `pipeline/jobfit/_cli.py:74` (`emit_error` hard-codes `status=500`); `pipeline/jobfit/recruiter_cli.py:99`, `winnability_cli.py:74`, `group_compare_cli.py:52`, `jobs_cli.py:52`, `market_salary_cli.py:132`
- **Scenario**: A recruiter posts a candidate list with one malformed `jobId` or a truncated/invalid JSON body to `/api/jobs/[id]/candidates`, `/winnability`, or `/api/match`. The CLI raises `ValueError("job not found: …")` or `json.JSONDecodeError` — both squarely user-correctable — but the envelope is stamped `{"status": 500}`. `python-runner.parseStderrError` trusts that embedded status, so the UI shows a generic "engine failure, retry" instead of "that job doesn't exist / fix your input." The user retries the same bad input forever.
- **Root cause**: `emit_error()` and the bare `except Exception → status 500` blocks predate the honest taxonomy. Only `profile_cli.py`, `campaign_cli.py`, and `extract_cli.py` correctly split `ValueError → 400/exit 2` vs `Exception → 500/exit 1` (and document it as the intended pattern). The rest never got migrated.
- **Impact**: Whole product surfaces (Match, recruiter ranking, winnability, JD ingest, salary) misclassify their most common failure (bad/stale input) as a server fault — degrades diagnosability, inflates "engine error" alerting, and blocks the inline field-level hints the editor could show.
- **Fix sketch**: Give `emit_error` a `status` param and a `ValueError`→400/`exit 2` branch (mirror `profile_cli.py:69-80`). In each CLI, catch `(ValueError, json.JSONDecodeError)` → `emit_error(exc, status=400)` before the generic 500. Add `code` (`invalid_input`/`engine_error`) for parity with the migrated three.

## 2. Streaming analyze path emits an error event then `return 0` — a successful exit code over a failed run (success-theater)
- **Lens**: 🐛 Bug Hunter
- **Severity**: High
- **Category**: Exit-code lies / latent success-theater
- **Value**: impact 6/10 · effort 2/10 · risk 3/10
- **File**: `pipeline/jobfit/cli.py:68-78` (both the 400 and 500 branches under `if args.stream: … return 0`)
- **Scenario**: Run analyze with `--stream` (the SSE mode). On any failure it writes `{"type":"error",…}` to stdout and `return 0`. A Node consumer that (correctly) checks `exitCode !== 0` to detect failure — the exact pattern every *non*-stream consumer uses (`analyze-run.ts:122`, `match/route.ts:67`) — sees exit 0 and treats the run as a success, then tries to `parsePythonJson` the SSE frames and 502s, or worse silently proceeds. The failure is encoded only inside an stdout event a generic consumer won't parse.
- **Root cause**: The streaming branch conflates "the SSE transport delivered cleanly" with "the analysis succeeded." For a process boundary the exit code is the contract; an in-band error event is advisory, not authoritative. (Today `--stream` has **no TS consumer** — verified: no `--stream` in `app/`. So this is latent, not live — but it is a loaded footgun the moment streaming is wired up, and it directly contradicts the codebase's own exit-code discipline.)
- **Impact**: Any future streaming integration inherits a bridge that reports failure as success. Given KP already standardizes on `exitCode !== 0` everywhere else, this lone exception is a trap.
- **Fix sketch**: After emitting the SSE error event, `return 2` (400) / `return 1` (500) to match the non-stream branch and the rest of the fleet, so the exit code stays the source of truth even in stream mode.

## 3. `matrix_cli` doesn't validate `--profiles-json` is a list — an object payload yields a silently EMPTY fit matrix, no error
- **Lens**: 🐛 Bug Hunter
- **Severity**: High
- **Category**: Untrusted-input shape / silent empty result (success-theater)
- **Value**: impact 6/10 · effort 2/10 · risk 2/10
- **File**: `pipeline/jobfit/matrix_cli.py:47` (load) → `:81` (`for i, pr in enumerate(profiles_raw)`)
- **Scenario**: If `--profiles-json` ever holds a JSON **object** instead of an array (a serialization regression on the TS side, a `{"profiles":[…]}` wrapper, a single profile not wrapped in a list), `enumerate(dict)` iterates the dict's **keys** (strings). Each `pr` is a `str`, `isinstance(pr, dict)` is False (line 82), so every profile is silently skipped. The CLI then prints a perfectly well-formed `{"candidates":[], "cells":[], …}` with exit 0. The recruiter sees an empty Fit Matrix and concludes "no candidates fit" — when in truth the input shape was wrong.
- **Root cause**: The other entry points guard their collections (`recruiter_cli.py:55`, `winnability_cli.py:54` use `raw.get("candidates") or []`; `group_compare_cli.py:45` asserts `isinstance(context, dict)`), but `matrix_cli` trusts the top-level shape and only guards each element. A non-list top level degrades to "zero valid rows" rather than an error — exactly the success-theater the module's own docstring warns against for vanished rows.
- **Impact**: A whole-matrix silent emptiness in a hiring decision tool, attributed to candidates rather than to the bug — the most dangerous failure mode for a recruiting product (you can't tell "no fit" from "didn't run").
- **Fix sketch**: After `json.loads`, `if not isinstance(profiles_raw, list): raise ValueError("--profiles-json must be a JSON array of profiles")` (caught by the existing `emit_error`, ideally as a 400 once finding #1 lands).

## 4. `--job-description-text` / `--company-text` passed as raw argv with no length guard — a long JD can blow the OS command-line limit
- **Lens**: 🐛 Bug Hunter
- **Severity**: Medium
- **Category**: Oversized input / Windows CreateProcess limit
- **Value**: impact 5/10 · effort 4/10 · risk 3/10
- **File**: `app/_lib/analyze-run.ts:55,57` (`args.push("--job-description-text", …)` / `"--company-text"`) → consumed by `pipeline/jobfit/cli.py:28,30`
- **Scenario**: A recruiter pastes a very long JD / company overview inline (no file). The full text is shoved onto the child's **command line**. Windows `CreateProcess` caps a command line at ~32,767 chars; a long JD + an already long arg vector pushes past it and `spawn` fails with an opaque error (or, on POSIX, the combined `argv+env` hits `E2BIG`). The carefully-built `MAX_FILE_BYTES` (8 MB) input contract that governs *uploads* does NOT govern *inline text* — those go via argv, not a temp file, so they bypass the size discipline entirely.
- **Root cause**: Two ingestion paths with asymmetric limits: file inputs are persisted to a temp file and passed by path (`--job-description-path`); inline text is passed by value on argv with no cap. The bridge already prefers files when present — it just never falls back to a temp file for *oversized* inline text.
- **Impact**: Large-but-legitimate inline JDs fail with a cryptic spawn error instead of running; the failure is hard to diagnose (it doesn't look like a Python error at all). Low frequency, but a real reliability cliff for power users.
- **Fix sketch**: At the boundary, if inline text length exceeds a threshold (e.g. 16 KB), write it to a temp file in `workdir` and pass it as `--job-description-path` / `--company-path` instead of `--…-text` (the temp-file plumbing already exists for uploads). Or reject with a clear 400 over the documented cap.

## 5. No correlation/request id flows into the Python layer — bridge failures are hard to trace across the Node↔Python seam
- **Lens**: 🚀 Business Visionary
- **Severity**: Medium
- **Category**: Observability / diagnosability of the product backbone
- **Value**: impact 5/10 · effort 4/10 · risk 2/10
- **File**: `app/_lib/python-runner.ts:91-107` (`spawnPython` env/args); `app/_lib/analyze-run.ts:120` (spawn site has `p.requestId` but doesn't pass it down)
- **Scenario**: Node holds a `requestId` (`analyze-run.ts` logs it via `baseAnalyzeLog`), but nothing forwards it into the child. When a CLI fails — a swallowed-then-500'd error from finding #1, an LLM-provider hiccup, a parse failure — the Python-side stderr line and the Node-side request log share no common key. An operator triaging "why did this recruiter's match 500" must correlate by timestamp across two logs, and the Python error has no run context at all.
- **Root cause**: The bridge passes data *down* (input JSON, `KP_LLM_CONFIG` env, `--lang`) but no trace identity. `spawnPython` already merges a per-spawn `env` — the hook exists, it's just unused for tracing.
- **Impact**: The Node↔Python bridge is the product's spine (every score, match, salary, JD passes through it). Without a shared correlation id, every cross-boundary failure costs manual log-stitching — slow MTTR on exactly the failures finding #1 makes more frequent. As volume grows this is the difference between "grep the id" and "guess by time."
- **Fix sketch**: Pass `KP_REQUEST_ID` via the existing `spawnPython({ env })` hook; have `_cli.configure_stdio`/`emit_error` read it from `os.environ` and include it in every stderr envelope (`{"error","status","code","requestId"}`). Stamp it on Python's own log lines too. Cheap, additive, and pays back immediately during incident triage.
