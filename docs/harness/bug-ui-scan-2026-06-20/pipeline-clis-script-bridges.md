# Pipeline CLIs & Script Bridges — Bug Hunter scan

> Context: Command-line entry points that the Next.js API shells out to (analyze, profile, match, reasoning, jobs, recruiter, matrix, salary, campaign, winnability) plus the Node↔Python spawn bridge and the thin `scripts/` wrappers.
> Files reviewed: 24 of 21 listed (+ 7 Node-side bridge callers the manifest references but lists elsewhere: `python-runner.ts`, `analyze-run.ts`, `reasoning-run.ts`, `recruiter-run.ts`, `group-eval-run.ts`, `automation-run.ts`, `job-ingest.ts`, plus routes `/api/match`, `/api/profile`, `/api/matrix`, `/api/extract-text`)
> Total: 7 findings — Critical: 0, High: 3, Medium: 3, Low: 1

The bridge core (`spawnPython`) is genuinely well-hardened: argv arrays (never `shell:true`, so no command injection), UTF-8 forcing, a 600s hang backstop, a 64 MB output ceiling, abort wiring, and a tolerant `parsePythonJson`. The findings below are the residual sharp edges — process/temp-dir leaks on the routes that *don't* opt into the hardening, and a couple of parse/stderr-contract assumptions that fail on adversarial child output.

## 1. /api/match, /api/profile and /api/matrix spawn Python without an abort signal or timeout override — abandoned requests orphan the child and leak the temp dir

- **Severity**: High
- **Category**: resource-leak / silent-failure
- **File**: `app/api/match/route.ts:65` (`spawnPython(args)` — no `{ signal }`), `app/api/profile/route.ts:54`, `app/api/matrix/route.ts:88` (and its `GET()` at `:39` takes no `request`, so it *cannot* forward a signal)
- **Scenario**: A recruiter fires a Match / profile-save / matrix build, then navigates away or closes the tab before it returns. The HTTP request aborts, but nothing tells the spawned `match_cli` / `profile_cli` / `matrix_cli` child to stop. The child runs to the 600s `DEFAULT_TIMEOUT_MS` backstop. If the route is deployed serverless, the platform kills the function at its (unset → default) `maxDuration` first — and because the process dies mid-flight, the `finally { cleanupWorkdir(workdir) }` never executes.
- **Root cause**: The hardening pattern is opt-in per call. `extract-text` (`route.ts:50-53`), `analyze-run.ts:121`, `reasoning-run.ts:84`, `recruiter-run.ts:40`, and `automation-run.ts:183` all pass `signal` (and `extract-text` also a derived `timeoutMs`), but these three routes were never wired the same way. `/api/matrix` is worse: its handler signature is `GET()` with no `request`, so the `request.signal` is structurally unavailable.
- **Impact**: Per abandoned request: one orphaned Python process holding CPU/RAM for up to 10 minutes, plus a `jobfit-*` temp dir in `os.tmpdir()` that is never cleaned (the cleanup is in a `finally` that didn't run). Under load these accumulate and can exhaust the tmp filesystem / process table — the exact failure `extract-text`'s comment (`route.ts:15-23`) was written to prevent, just not applied here.
- **Fix sketch**: Give all three an explicit `export const maxDuration`, change `/api/matrix` to `GET(request: NextRequest)`, and pass `{ signal: request.signal, timeoutMs: (maxDuration - 5) * 1000 }` into every `spawnPython` so an abandoned request SIGKILLs the child inside the function budget and cleanup always runs.

## 2. parsePythonJson scans stdout from the end and returns the FIRST JSON object it finds — a structured-JSON log line printed after the result is silently returned as the result

- **Severity**: High
- **Category**: silent-failure / edge-case
- **File**: `app/_lib/python-runner.ts:232-252` (`parsePythonJson`)
- **Scenario**: An LLM CLI (`reasoning_cli`, `market_salary_cli`, `campaign_cli`, `automation_cli`) prints its real result JSON, then an underlying SDK/library emits a *structured* diagnostic to **stdout** after it — e.g. a JSON-formatted telemetry line, a Gemini/grounding client debug object, or any `logging` handler configured to emit JSON. The result-scanner walks lines from the end and returns the *first* one that `JSON.parse`es to an object/array — which is now the trailing diagnostic, not the result.
- **Root cause**: The "scan from the end for the first object/array" heuristic (line 234) assumes all trailing chatter is non-JSON-*object* text (asyncio "Event loop is closed", `ResourceWarning`, "leaked semaphore"). That holds for interpreter teardown noise but is false for any dependency that logs JSON objects to stdout. There is no result framing (no sentinel line, no stdout/stderr channel split for the payload), so the parser cannot distinguish "the payload" from "a JSON-shaped log line."
- **Impact**: The downstream Zod/`safeParse` then rejects the wrong object — best case a 502 on a paid LLM run (`analyze-run.ts:148`), worst case the diagnostic object happens to satisfy a loose consumer (e.g. `group-eval-run.ts` reads `parsed.comparison?.headline` and silently returns `null`, degrading to deterministic output with no error). Non-deterministic: only fires when a library decides to log, so it presents as a flaky, unreproducible "matching sometimes returns nothing."
- **Fix sketch**: Frame the payload explicitly — have every CLI print a sentinel-prefixed final line (e.g. `\x1e` record separator, or `KP_RESULT:` prefix) and have `parsePythonJson` take the line bearing that marker; or route the JSON result to fd 3 / a `--out-file` path instead of sharing stdout with library logging.

## 3. parseStderrError trusts the LAST stderr line as the JSON envelope — a warning or traceback printed after the envelope downgrades a real engine error to a generic 500/400

- **Severity**: Medium
- **Category**: silent-failure / error-handling
- **File**: `app/_lib/python-runner.ts:261-282` (`parseStderrError`), consumed by every route's `if (exitCode !== 0)` branch
- **Scenario**: A CLI hits its honest-taxonomy path and prints `{"error","status":404,"code":"not_found"}` to stderr (e.g. `automation_cli` `NotFoundError`), but *then* the interpreter prints an unrelated line to stderr during teardown (a `ResourceWarning`, an asyncio "Event loop is closed", a `DeprecationWarning`, or a secondary exception traceback whose last line is a `RuntimeError:`). `parseStderrError` takes only the *last* non-empty line (line 263), fails to `JSON.parse` it, and falls through to `status = exitCode === 2 ? 400 : 500` with a generic message.
- **Root cause**: Asymmetry with `parsePythonJson`: stdout parsing scans *all* lines from the end for the first valid object, but stderr parsing inspects *only* the single last line. The structured envelope is assumed to always be the final stderr write, which the CLIs control at `return` time — but anything Python prints during interpreter shutdown lands after it.
- **Impact**: A genuine 404 ("job not found") or a user-fixable 400 (`invalid_input`) is reported to the UI as a generic 500, so the client shows "retry/escalate" instead of the actionable field-level hint the taxonomy was built to deliver (`profile_cli.py:27-33` documents that exact intent). The `code` is also lost, breaking any UI branching on it.
- **Fix sketch**: Make `parseStderrError` scan stderr lines from the end for the first that parses to an object with an `error` key (symmetric with `parsePythonJson`), so a trailing teardown line can't shadow the real envelope.

## 4. CLIs silently read stdin when their input-path argument is omitted/misspelled — a bridge bug becomes a 10-minute hang instead of a clear error

- **Severity**: Medium
- **Category**: latent-failure / timing
- **File**: `pipeline/jobfit/_cli.py:47-51` (`load_candidate_arg` → `json.loads(sys.stdin.read() or "{}")`), same pattern in `recruiter_cli.py:42`, `winnability_cli.py:42`, `group_compare_cli.py:43`, `market_salary_cli.py:88`, `jobs_cli.py:37/41`, `profile_draft_cli.py:253`
- **Scenario**: The Node side spawns the CLI but, due to a refactor/regression, fails to pass `--input-json` / `--candidate-json` (or passes a flag name the CLI doesn't recognize so argparse leaves it `None`). The CLI falls back to `sys.stdin.read()`. But `spawnPython` uses `spawn(...)` with default stdio and never writes to or closes the child's stdin — so `sys.stdin.read()` blocks forever waiting for EOF.
- **Root cause**: The "path else stdin" convenience (useful for humans piping at a terminal) is dangerous under the bridge, where stdin is an open pipe that is never fed or closed. A missing-argument *programming* error silently converts into an indefinite read instead of a fast, attributable failure.
- **Impact**: The child hangs until the 600s timeout (or, on the no-signal routes in finding #1, until the platform kills the function). Presents as a mysterious slow/timed-out endpoint with no useful error, and burns a worker slot for the whole window. A genuinely empty stdin (EOF immediately) yields `"{}"` → a validation error, which at least is fast — but an *open, unfed* pipe is the dangerous case.
- **Fix sketch**: In `spawnPython`, default to `stdio: ["ignore", "pipe", "pipe"]` (or explicitly `child.stdin.end()` right after spawn) for the file-arg CLIs so an un-fed stdin reads EOF instantly; or make the CLIs require their input flag and error fast when it's absent rather than blocking on stdin.

## 5. spawnPython's stdout/stderr encode is hard-coded to lossy UTF-8 at close, but several CLIs reconfigure their own stdout with errors="strict" — an un-encodable char crashes the child mid-write

- **Severity**: Medium
- **Category**: edge-case / encoding
- **File**: `pipeline/jobfit/_cli.py:23-32` (`configure_stdio(errors="strict")` default), used by `cli.py`, `match_cli.py`, `reasoning_cli.py`, `matrix_cli.py`, `extract_cli.py`; contrast `jobs_cli.py:25` and `market_salary_cli.py:79` which use `errors="replace"`
- **Scenario**: A CV/profile/LLM output contains a lone surrogate or a code point that can't round-trip through strict UTF-8 (rare but real with mangled PDF extraction or model output containing surrogate-pair fragments). The CLI does `print(json.dumps(..., ensure_ascii=False))`; the strict-mode stdout encoder raises `UnicodeEncodeError` *while writing the result line*. The process exits non-zero with a partial/empty stdout and a traceback on stderr.
- **Root cause**: Inconsistent codec-error policy across CLIs — the LLM-bearing result emitters (`match_cli`/`reasoning_cli`) are exactly the ones most likely to carry adversarial text yet use `strict`, while `jobs_cli`/`market_salary_cli` defensively use `replace`. `ensure_ascii=False` (chosen so Czech diacritics survive) widens the set of bytes that must encode cleanly.
- **Impact**: A single bad character turns an otherwise-successful, paid analysis/match into a 500 with a cryptic `UnicodeEncodeError` traceback (which `parseStderrError` can't parse → generic 500, compounding finding #3). Reproducible with a crafted CV.
- **Fix sketch**: Standardize on `configure_stdio(errors="replace")` for every result-emitting CLI (the result is JSON for machine consumption; a substitution char is strictly better than a crash), or `json.dumps(..., ensure_ascii=True)` on the wire and rely on the JSON `\uXXXX` escapes for non-ASCII.

## 6. automation-run passes empty-string job ids straight through to the CLI, turning a missing-FK into a confusing "job not found: " 404

- **Severity**: Low
- **Category**: edge-case / error-message-hygiene
- **File**: `app/_lib/automation-run.ts:163` (`args.push("--job-id", entry.jobId ?? "")`) and `:156` (`--current-job-id entry.jobId ?? ""`), resolved by `automation_cli.py:62-68` (`_find_job`)
- **Scenario**: A pipeline entry with a null `jobId` (a candidate not yet attached to a role) reaches an automation task. The Node side coerces the null to `""` and passes `--job-id ""`. Python's `_find_job` searches the corpus for `id == ""`, finds nothing, and raises `NotFoundError("job not found: ")` — a 404 with an empty id in the message.
- **Root cause**: The `?? ""` papers over a precondition (this task needs a job) that should be checked before spawning. An empty string is a valid argparse value, so it sails past the "missing argument" guard and only fails deep in the lookup with a message that reads as a data bug.
- **Impact**: Minor — a confusing 404 and a wasted process spawn for an entry that should have been rejected up front. No data corruption.
- **Fix sketch**: In `runAutomationTask`, guard `if (!entry.jobId && task !== 'rematch') throw new AutomationError("entry has no job", 400)` before building args, so the precondition fails fast with an honest message instead of an empty-id 404.

## 7. The usage-log sidecar path can be overridden via opts.env, reintroducing the cross-process append race the per-spawn UUID was meant to prevent

- **Severity**: Low
- **Category**: race-condition
- **File**: `app/_lib/python-runner.ts:118-132` (the `KP_LLM_USAGE_LOG` default is spread first, then `...(opts.env ?? {})` can overwrite it), ingested at `:211` / `:13-20`
- **Scenario**: A caller passes `env: { KP_LLM_USAGE_LOG: "<fixed path>" }` (or a future helper does, the way `buildLlmConfigEnv()` already injects env). Because `opts.env` is spread *after* the per-spawn UUID default, it wins. Two concurrent spawns sharing that path now both append NDJSON to the same file, and both `ingestUsageLog` runs read/delete it — interleaved writes corrupt a line and/or one ingest deletes the file mid-append.
- **Root cause**: The comment at `:117` ("opts.env can override it if a caller needs to") treats overridability as a feature, but the uniqueness guarantee (no cross-process append race, ingested exactly once, `:113-117`) depends on the path being per-spawn. The two intentions conflict.
- **Impact**: Currently latent — no caller overrides it today (`buildLlmConfigEnv` sets only `KP_LLM_CONFIG`). But it's a loaded footgun: the metering ledger silently double-counts or drops usage if any future caller sets that key. Telemetry-only, so no user-facing breakage, but it corrupts billing-adjacent data.
- **Fix sketch**: Set `KP_LLM_USAGE_LOG` *after* the `...(opts.env ?? {})` spread (or `delete` it from a caller-supplied env before merging) so the per-spawn UUID path can never be clobbered; if a caller genuinely needs a custom path, give it a dedicated typed option rather than a raw env key.
