# API contracts — the route boundary and the Python boundary

The rest of `docs/architecture/` explains **why** the system is shaped the way it
is. This file is the other half: the two interfaces an agent has to get right
before it can change anything, written down once instead of re-derived from a
handler each time.

There are exactly two, and they are the two seams where a wrong guess is
expensive:

1. **HTTP** — `app/api/**/route.ts`. What a response looks like, who is allowed
   to call it, what throttles it, and what may go on the wire.
2. **The spawned Python pipeline** — `app/_lib/python-runner.ts` ↔
   `pipeline/jobfit/*_cli.py`. A per-request subprocess with a wire protocol of
   its own ([ADR 0003](decisions/0003-spawned-python-pipeline.md)).

This is a **contract**, not an endpoint list. The endpoints are the tree
(`app/api/**`), and a list of them here would be stale within a week; what
follows is the set of rules every one of them already follows, so reading one
handler tells you how the other ~150 behave.

---

## 1. The HTTP contract

### 1.1 Response envelopes

Every handler answers through one of four helpers in
[`app/_lib/api-response.ts`](../../app/_lib/api-response.ts). Which one it picks
is a claim about what happened, and they are not interchangeable:

| Helper | Body | Use it when |
| --- | --- | --- |
| `jsonOk(body, status = 200)` | the payload as-is | it worked |
| `jsonError(err, fallback, status = 500)` | `{ error }` | the message is already client-safe — validation, a business rule |
| `safeJsonError(err, route, code, status = 500)` | `{ error, code }` | the catch can surface a **store** error. Logs the real one server-side under `[route] CODE`, sends a generic message |
| `jsonRefusal(code, status)` | `{ error, code }` | an expected **decision** — an expired offer, a closed posting. Logs nothing |

Two registries back the coded forms, and the split between them is the load-
bearing part:

- **`STORE_ERRORS`** — a store failure is an *accident whose real message must be
  hidden*. A thrown `better-sqlite3` / `fs` error carries `SQLITE_CORRUPT`,
  `UNIQUE constraint failed: jds.slug`, the absolute DB path. `safeJsonError`
  is what keeps that off the wire; `jsonError` on a store path is an
  information-disclosure leak.
- **`REFUSAL_ERRORS`** — a refusal is a *decision whose message IS the
  information the caller needs*. "This offer has expired" is the answer, not a
  fault, and it must reach a candidate on a public token surface.

`code` is the machine-readable half and the client never renders `error`
directly: `app/_lib/use-error-message.ts` resolves `errors.<CODE>` from the
locale catalogs, so **adding a code means adding four catalog entries in the
same change** — `npm run i18n:check` pins both registries to `messages/*.json`
and fails otherwise. `error` stays canonical English, for the server log and for
API consumers.

> **When you add an endpoint**, you add a code to the right registry rather than
> re-deriving the safe pattern in the handler. That is the whole reason the
> registries are exported constants and not strings at the call site.

**What holds this, and what it does not hold yet.**
[`app/api/error-response-contract.test.ts`](../../app/api/error-response-contract.test.ts)
walks every module under `app/api/**` and fails when a catch block shapes a
thrown error's own `.message` into a client response body. It is a **ratchet**,
not a wall: a route that is not on its `LEAK_CEILING` may not leak at all, a
listed route may not leak *more* than its number, and a route that drops below
its number is a note rather than a red build. Adding a line to the ceiling to
turn a build green is the one thing the file exists to prevent — migrate the
handler instead. `EXEMPT` is for a response whose raw message is genuinely the
answer (today: `/api/health`, and only behind `trusted`), one reason per entry.

It replaced two hand-listed arrays that between them pinned eight of ~200
handlers ([`jds/error-message-hygiene.test.ts`](../../app/api/jds/error-message-hygiene.test.ts),
[`apply/apply-error-hygiene.test.ts`](../../app/api/apply/apply-error-hygiene.test.ts)
— both still stand, and both are stricter about their own routes than the
ratchet is). Those two key on `NextResponse.json({ error: … })`, so neither
could see a raw message pushed into a results array on its way to the client;
`/api/schedule/invite/bulk` was leaking that way past both of them.

The scan cannot see a message that reaches the wire through a helper in another
module, and it does not judge whether a `jsonError` call site's message is
genuinely client-safe. Those stay review's job. §1.2 and §1.4 of this contract
already had repo-wide guards
([`route-tenancy-coverage.test.ts`](../../app/api/route-tenancy-coverage.test.ts),
[`rate-limit-contract.test.ts`](../../app/api/rate-limit-contract.test.ts));
this section had none until now.

### 1.2 Who may call it

Authorisation is **fail-closed and stated in two places on purpose**:

- [`proxy.ts`](../../proxy.ts) gates *every* path except the allow-list in
  [`app/_lib/auth/public-routes.ts`](../../app/_lib/auth/public-routes.ts). A
  forgotten recruiter route stays gated (safe); a forgotten public route sends a
  candidate to `/login` (visible, fixable). Never the other way round.
- Sensitive handlers re-check with `requireOperator()` from
  [`app/_lib/auth/require-operator.ts`](../../app/_lib/auth/require-operator.ts)
  — defense in depth for routes that write secrets or spawn Python, so a matcher
  gap or a mistaken allow-list entry cannot reach them:

  ```ts
  const denied = await requireOperator();
  if (denied) return denied;          // a 401 NextResponse, already shaped
  ```

Four facts about that gate that are easy to get wrong:

- `KP_OPERATOR_PASSWORD` unset = **open mode**, and `isOperator()` returns
  `true`. That is deliberate (local single-operator use); production fails
  closed unless `KP_ALLOW_OPEN=1`.
- A **demo session** is a valid signature and is *not* an operator. `/api/demo`
  mints an anonymous cookie scoped to `DEMO_WORKSPACE`; `isOperator()` rejects
  it explicitly, which is what keeps the whole-DB export/import routes shut.
- The allow-list matches **by path segment**, never by string prefix
  (`underPath`). An entry ending in `/` matches strict descendants only. This is
  why a newly added child route inherits its parent's gating instead of
  escaping it — the bug class that once made `/api/schedule/invite/bulk` public.
- **`/` is public** (since 2026-09-03), and it is the one entry matched EXACTLY:
  `PUBLIC_PAGES_EXACT`, not `PUBLIC_PAGES`. A `"/"` in the segment list would end
  in a slash and `underPath` would match every path in the app — the whole gate
  off. It is public because `app/page.tsx` already renders the marketing landing
  for an anonymous visitor and the workspace only once `hasEnteredWorkspace()`
  says so; in password mode the proxy never let that branch run, so every
  marketing link and OG unfurl on the site's own front door met a login form. What
  the root can render anonymously is the static landing — the workspace behind it
  is a client shell whose every `/api/*` call is still gated.

**A session is not an authorisation.** `requireOperator()` answers "is this a
trusted operator", which on a TEAM deployment every member satisfies. A route
that returns other members' data needs a capability, through
`requireCapability(cap)` from
[`app/_lib/auth/current-user.ts`](../../app/_lib/auth/current-user.ts) — 401
unauthenticated, 403 under-privileged, resolved live from the DB membership.
`GET /api/feedback` is the worked example (2026-09-03): it is a read of
colleagues' free-text messages *with* their reply addresses and it required only a
session, so every viewer and recruiter in the workspace could read all of it. It
is now `members:manage`, the same bar as the member and invite lists — and the
`/control` section that renders it resolves the same capability server-side, so
the UI and the API cannot drift apart. Pick the capability by what the data IS,
not by which role happens to visit the page.

**The same rule binds WRITES, and a ratchet holds the line.** As of 2026-09-03 the
ten highest-consequence write doors ask a capability before they mutate anything:
`pipeline:write` for `POST /api/pipeline/{command,batch,stage-migration}`,
`/api/decisions/{screen-wave,config}`, `/api/automation/{schedule,run,[task]}`,
`/api/schedule/invite/bulk` and the JD writes (`/api/jds/{save,generate}`, `PATCH
/api/jds/[slug]`); `org:manage` for the installation-configuration doors
`/api/comms/relay`, `/api/ats/{connections,config}`, `/api/edge/{drain,pair}` and
`/api/llm/keys/test`. The gate is
`requireCapabilityCoded(cap, requireCapability | requireOrgCapability |
requireWorkspaceCapability)` from `app/_lib/api-response.ts`, which re-shapes the
auth layer's bare 403 into the coded refusal `FORBIDDEN_CAPABILITY` **carrying the
capability as data** (`{ error, code, capability }`) so the client can name the
missing permission in the reader's language; 401 (no session) passes through
unchanged, and open mode is unaffected because every gate folds to owner there.
Behaviour is pinned by `app/api/write-capability-gate.test.ts` (real handlers,
throwaway DB, real signed viewer/recruiter/owner sessions).
`app/api/route-capability-coverage.test.ts` is the ratchet — the authorisation
sibling of `route-tenancy-coverage.test.ts`. It walks every `app/api/**/route.ts`
exporting POST/PUT/PATCH/DELETE and demands either a capability-gate call or a line
in its `ALLOWED` map with a reason; it was seeded with the 118 mutating doors that
were ungated the day it landed (31 structural exemptions — public token surfaces,
webhooks, self-service, the guided-sim sandbox — and 87 marked "slice 2 candidate",
i.e. not yet judged). The count is printed on every run and may only FALL: closing a
door means deleting its line, and a NEW ungated mutating route is red immediately.

**A public route's payload is split by that gate, not by convenience.**
`/api/health` is on the allow-list, so the verdict a monitor gates on
(`ok`/`db`/`seeds`/`clock` + the status code) is public and everything else rides
`isOperator()`: the deployment-wide table counts, the queue, `degradedReasons`
(whose seed entries quote absolute server paths) and — since 2026-09-03 — the
`engines` preflight map, which is SECRET PRESENCE (is a Gemini key configured, is
a `claude` CLI installed on this host). The detail is **omitted, never blanked**:
an empty `degradedReasons` beside a 503 is a confident lie. It is also no longer
COMPUTED for an untrusted caller — the seven unscoped `COUNT(*)`s collapse to one
`LIMIT 1` existence probe, the single fact the public verdict depends on.
Pinned by `app/api/health/health-exposure.test.ts`.

### 1.3 Public token surfaces carry a projection, not a row

`/schedule/[token]`, `/interview/[token]`, `/offer/[token]`, `/status/[token]`,
`/data/[token]` and `/apply/[id]` are **capability links, never sessions**. The
response is an explicit field allowlist — see `publicInviteView` in
[`app/api/schedule/[token]/route.ts`](../../app/api/schedule/[token]/route.ts),
which is the shape to copy. Serialising a store row onto a public wire is how
`entryId`, a reconcile reason or an internal note reaches a candidate.

### 1.4 What throttles it

[`rateLimit(key, { limit, windowMs })`](../../app/_lib/rate-limit.ts) is an
in-process fixed-window counter. Every **open** route that spends money or
spawns a subprocess calls it, and *where* the call sits matters: it goes after
any branch that must keep serving freely (a cache hit is not a spend) and before
the expensive work.

The same applies to every **public token door** that writes or discloses —
`/api/status`, `/api/offer`, `/api/data`, `/api/invite`, `/api/schedule` and the
apply routes all throttle **per token AND client** (``<door>:${clientIpFrom(...)}:${token}``),
BEFORE the token lookup, so a leaked or logged link caps what one holder can make
the store do per minute and a flood never reaches the store. A GET counts when it is
not a pure read (`/api/offer` runs `expireOfferIfDue` on every hit). The erasure POST
(an irreversible scrub) and the invite POST (a user, a membership and a session) were
the last two doors without one; closed 2026-09-01.

**Sizing, when the key can degenerate.** With `KP_TRUSTED_PROXY` unset — the
default for a directly-exposed self-host — `clientIpFrom` returns
`SHARED_CLIENT_KEY` for *every* caller, so a per-IP bucket is one bucket for the
whole deployment. For an abuse-containment door that is the safe failure
(over-throttle). For a door whose refusal DENIES A FEATURE to every colleague at
once it is not, and there are two honest answers: skip the degenerate bucket
(`/api/auth/login` does, because its per-account bucket is the real defense), or
set a ceiling people cannot plausibly reach. `/api/search` — the command palette,
five leading-wildcard `LIKE` scans per hit and the heaviest read per byte of input
in the app — took the second at 3000/10min (2026-09-03). A tight number there
would have let one script take the palette away from everyone.

**One door, many prices.** A route that fans out to *several kinds of work* needs
more than one bucket. `POST /api/tasks` is the case: one handler in front of every
kind in `HANDLERS`, and for a year one bucket — 120 starts / 10 min / IP, a number
calibrated for the cheapest thing that comes through it (the Decisions queue fires
one POST per accepted review, so a 50-card bulk accept is a legitimate 50-request
burst). The same 120 admitted 120 repo clones, 120 board-wide screen sweeps and 120
cohort evaluations. [`app/_lib/task-budget.ts`](../../app/_lib/task-budget.ts)
classifies every kind as **cheap** (120/10min IP), **metered** (30/10min IP +
90/hour per WORKSPACE) or **agent** (6/10min IP + 15/hour per workspace); both
`POST /api/tasks` and `POST /api/tasks/[id]/retry` apply the class budget on top of
the door's own bucket, under the SAME keys, so replaying is not a way to double an
allowance. An unclassified kind falls to the tightest class, and a test parses
`HANDLERS` and fails on a kind that has no class. The per-workspace half is the one
that actually bounds spend: it survives an IP rotation and it is the tenant whose
allowance is drawn down — see the `SHARED_CLIENT_KEY` note above for why the IP
half alone is the wrong unit for a team.

Pick the key deliberately:

- per-IP (`clientIpFrom(request.headers)`) for abuse containment;
- per-**token** where candidates legitimately share a NAT — a timed assessment
  must not throttle a whole office;
- and read the `SHARED_CLIENT_KEY` note before choosing per-IP on a route where
  a tripped bucket would deny service to everyone.

The call sites are **pinned by a contract test**,
[`app/api/rate-limit-contract.test.ts`](../../app/api/rate-limit-contract.test.ts):
it asserts both the source-level guard (key template, limit, the shared
`{ error: RATE_LIMITED_ERROR }` 429 envelope) and the real limiter's behaviour
at the route's exact config. Moving or re-keying a limiter means updating that
test deliberately — not deleting the assertion. It also walks the whole tree for
one rule no per-route spec can express: **every route that reaches `startTask` must
throttle first.** Its `UNTHROTTLED_ENQUEUE` ratchet is now **empty**: the three
dev-case routes it carried (`devcase/control`, `devcase/lifecycle`,
`devcase/lifecycle/[id]/approve`) enqueue an `agent`-class `lifecycle` run *directly*
— never through `POST /api/tasks` — and did so with no limiter at all until
2026-09-03. All three now call the shared
[`enforceTaskBudget(kind, ip, workspaceId)`](../../app/_lib/task-budget.ts) under the
**same keys** as the task doors (``tasks-start:${cls}:${ip}`` /
``tasks-start-ws:${cls}:${ws}``), so a direct enqueue and a dock enqueue draw on one
allowance and refuse with the same `TASK_BUDGET_EXHAUSTED` 429. Placement is
per-route and deliberate: after the cheap refusals, before the spend — the create
door budgets *before* the `case_designs` meter debit, the approve gate *before* the
approve transition (a refused resume must not leave a case approved but unrun), and
the reconcile sweep budgets *each* lifecycle it resumes (one POST could otherwise
enqueue 50 runs on a single slot), reporting `budgetExhausted` when it stops early.
A new line on that ratchet is a hole waiting to be closed, never an exemption.

### 1.5 Uploads, timeouts and tenancy

- **Upload size** is a route-boundary contract in
  [`app/_lib/upload-constraints.ts`](../../app/_lib/upload-constraints.ts),
  pinned by [`app/api/upload-size-contract.test.ts`](../../app/api/upload-size-contract.test.ts).
  It bounds the *input*; `PYTHON_MAX_BUFFER_MB` bounds the subprocess's *output*.
  They are different limits and neither substitutes for the other.
- **`export const maxDuration`** is serverless-only. A self-hosted `next start`
  will not kill a long handler, so the real bound is whatever timeout the route
  passes to its own child process or fetch.
- **Tenancy**: any query behind a route must be workspace-scoped, and the
  allowlist in [`app/_lib/tenancy.ts`](../../app/_lib/tenancy.ts) is fail-closed
  — a new persistent table is a reported gap until it is scoped and listed.

### 1.5b Response headers every route carries

Two producers, deliberately split, because one of them cannot be static:

| Producer | Headers | Why there |
| --- | --- | --- |
| [`next.config.ts`](../../next.config.ts) `headers()` | `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy` | Same value for every request, so a build-time config holds them |
| [`proxy.ts`](../../proxy.ts) `buildCsp()` | `Content-Security-Policy-Report-Only` | Carries a **per-request nonce**, which a build-time config cannot mint |

**Never put a CSP back into `next.config.ts`.** Two `Content-Security-Policy`
headers on one response are two policies *both* applying, and the effective
result is neither author's.
[`app/shell-headers.test.ts`](../../app/shell-headers.test.ts) fails if one
reappears, and `e2e/shell.spec.ts` asserts exactly one arrives over the wire.

**How the nonce reaches the markup.** `proxy()` mints 16 random bytes per
request, sets the *forwarded request*'s `Content-Security-Policy` header (Next's
renderer greps that header for `'nonce-…'` and stamps it onto every script it
emits — framework bundles, the RSC payload's inline chunks) and an `x-nonce`
request header, then sets the *response*'s report-only header. `app/layout.tsx`
reads `x-nonce` for the one inline script this app writes by hand (the pre-paint
theme bootstrap). Nothing else needs nonc­ing by hand. The policy deliberately
does **not** use `'strict-dynamic'`: that would ignore the host allow-list and
block the env-gated Plausible include.

**Why it is still report-only, and what flipping it costs.** The policy is
otherwise ready to enforce — `script-src` no longer carries `'unsafe-inline'`
(the theme script was its only reason), and `frame-ancestors 'none'` is declared
for the enforce day. Enforcement is an **owner decision, not an agent's**: a
wrongly-enforced policy on `/interview/[token]` kills a candidate's live voice
call, and a self-hosted voice deploy (`ELEVENLABS_BASE_URL` → your own origin)
serves from a host `connect-src` does not yet name. To flip: verify report noise
is clean in a real deploy, add any deploy-specific voice origin, then rename the
header in `withCsp()` to `Content-Security-Policy`.

### 1.6 The checklist for a new route

1. `jsonOk` / `safeJsonError` (+ a `STORE_ERRORS` code) / `jsonRefusal` (+ a
   `REFUSAL_ERRORS` code) — never a bare `NextResponse.json({ error })`.
2. Four locale entries for any new code, in the same change.
3. Public? Add it to `public-routes.ts` with the reason, and answer with a
   projection. Sensitive? `requireOperator()` at the top.
4. Spends money or spawns a process on an open path? `rateLimit()`, plus its row
   in the contract test.
5. Read → compute → write? `db.transaction(...).immediate()` or a compensating
   `WHERE` plus a `res.changes === 0` skip — and never `await` inside the
   transaction.

---

## 2. The spawned-Python contract

kp launches the jobfit pipeline **per request** rather than running it as a
service (a deliberate, recorded decision —
[ADR 0003](decisions/0003-spawned-python-pipeline.md)). Everything crossing that boundary goes
through [`app/_lib/python-runner.ts`](../../app/_lib/python-runner.ts), and the
protocol is small enough to state in full.

### 2.1 The wire

| Direction | Shape |
| --- | --- |
| in | `argv`. Large inputs are written to a temp workdir and passed as `--input-json <path>` (`createWorkdir` / `persistFile`), never on the command line |
| in | env: `KP_LLM_CONFIG` (the routing from [`app/_lib/llm-config.ts`](../../app/_lib/llm-config.ts)), plus a per-call LLM-usage sidecar path |
| out, success | **one** `json.dumps` line on **stdout**, an object or array |
| out, failure | a JSON object on the **last non-empty stderr line**: `{ error, status, code }` |
| out, side channel | NDJSON LLM-usage records to the sidecar file, folded into the `llm_usage` ledger after the child settles |

`parsePythonJson` scans stdout's non-empty lines **from the end** and returns the
first that parses to an object or array. That is not defensive noise: libraries
print warnings *before* the result and the interpreter prints *after* it
(`atexit`, `ResourceWarning`, asyncio "Event loop is closed"), so "the last line"
would fail an otherwise-successful run. Bare scalars are skipped so a stray `42`
cannot masquerade as the payload.

`parseStderrError` turns the failure line into a `PipelineError` carrying
`status` and `code`, so a handler can tell a user-fixable 400 (render an inline
hint) from a 500 engine failure (retry / escalate) instead of collapsing both
into one message. **Exit code 2 means 400** — that is how argparse usage errors
and validation failures arrive without a JSON line.

The `code` is a CLOSED vocabulary with one home per side:
[`_cli.ERROR_CODES`](../../pipeline/jobfit/_cli.py) (`invalid_input`,
`not_found`, `engine_error`, `timeout`) and `PYTHON_ERROR_CODES` in
[`python-runner.ts`](../../app/_lib/python-runner.ts), pinned to each other by
`pipeline/jobfit/tests/test_cli_error_envelope.py`. It is chosen at the RAISE
site (`_cli.not_found(...)` / `invalid_input(...)` / `CliError`) and printed by
`_cli.emit_error`, so “that job is not in the corpus” and a real engine fault
stop reaching the browser as the same anonymous 500 — a code the runner had to
GUESS back out of the status. A CLI that re-spells the words as local `ERR_*`
literals is a shrinking holdout list in that test, never a new entry.

### 2.2 The caps

Both are backstops, not deadlines, and both **kill the child and reject**:

- `timeoutMs` — 10 minutes by default (`PYTHON_CMD` picks the interpreter).
- `maxBufferBytes` — 64 MB of combined stdout+stderr, `PYTHON_MAX_BUFFER_MB` to
  override. Without it a chatty child accumulates its whole output in the Node
  heap and can OOM the server process, taking down every route rather than the
  one that spawned it.

A caller may also pass an `AbortSignal` to cancel early — and it is not a
substitute for a budget: the signal fires when the *caller* gives up, the
deadline when nobody does.

**Every kill is a TREE kill.** `child.kill()` signals one pid, and the CLIs shell
out (the Claude CLI adapter, `git` in a repo scan), so a timeout used to leave the
grandchild running — holding the CPU and the provider connection the kill was
meant to reclaim. `killProcessTree` signals the child's whole process group on
POSIX (it is spawned `detached`, so everything it forks inherits the group) and
runs `taskkill /T /F` on Windows. On Windows the direct kill is the *fallback*,
not a companion: killing the child first orphans its descendants before taskkill
can enumerate them.

**And every spawn passes an admission door.** There is one process-wide ceiling —
`KP_PYTHON_MAX_CONCURRENT`, default 4 — because an unbounded fork-per-request is a
denial of service against the Node server the other 200 routes share. A caller
waits up to `KP_PYTHON_QUEUE_WAIT_MS` (default 20 s) for a slot and is then refused
with a `PipelineError` carrying **503 / `ENGINE_BUSY`**, which the routes forward
like any other engine refusal. It is a decision, not a fault: the engine is
healthy, it is saturated, and `errors.ENGINE_BUSY` says so in the reader's
language. Sizing guidance: [self-hosting §3b](./self-hosting.md#3b-sizing-the-python-engine).

**A route that spawns states its own budget.** Ten minutes is the right bound for
a repo scan and the wrong one for a Save button: a wedged sub-second CLI
inheriting the default holds the operator on a spinner for nine minutes past the
point the answer was useful. Name the value (`const PROFILE_ROUTE_TIMEOUT_MS =
60_000`), pass it as `timeoutMs`, and answer the overrun **by name** — the runner
delivers a deadline as a rejected `result` whose message
[`isSpawnTimeoutMessage`](../../app/_lib/intake-run.ts) is the one place that
reads, and the route turns it into its own `jsonRefusal("<AREA>_TIMEOUT", 504)`.
A deadline WE set is a DECISION the reader can act on (retry), not a store fault
to hide behind a generic 500. Live examples: `INTAKE_TURN_TIMEOUT`,
`PROFILE_BUILD_TIMEOUT`, `JOB_WINNABILITY_TIMEOUT`.

### 2.3 Types are generated, not written twice

`npm run schemas:gen` (`python -m pipeline.jobfit.codegen`, also run by
`npm run typecheck` and `npm run build`) renders
`app/_lib/schemas.generated.ts` and `app/_lib/taxonomy.generated.ts` from the
Python models. `npm run schemas:check` fails when they are out of date.

So the payload types on both sides of this boundary already have one source.
**Do not hand-write a TypeScript mirror of a pipeline model** — add it to the
Python model and regenerate.

### 2.4 The CLIs

Every entry point is a `python -m pipeline.jobfit.<name>_cli` module and every
one follows §2.1. Today: `cli`, `extract_cli`, `match_cli`, `profile_cli`,
`profile_draft_cli`, `winnability_cli`, `agentfit_cli`, `automation_cli`,
`campaign_cli`, `companion_cli`, `group_compare_cli`, `intake_cli`, `jobs_cli`,
`market_salary_cli`, `recruiter_cli`, `repo_scan_cli`, `devcase.devcase_cli`,
`llm.test_cli`. A new one is a new module with the same protocol — the runner
needs no change.

All of them build that protocol from the shared scaffold in
[`pipeline/jobfit/_cli.py`](../../pipeline/jobfit/_cli.py) rather than
re-implementing it: `configure_stdio()` (UTF-8 on both streams, each guarded
separately so a harness that replaces one does not crash the CLI before line
one) and `emit_error()` (the envelope above, plus the exit code — **2 for a 400**,
1 otherwise).

### 2.5 Keyless is a supported state

Every CLI has a deterministic fallback path and must answer, not crash, without
API keys. That is a product property with its own record
([ADR 0004](decisions/0004-keyless-degradation-is-a-product-property.md)) and its
own CI gate (`npm run test:eval:automation`, which passes `--no-llm`), so "it
needs a key" is never an acceptable reason for a 500.

---

## Known gaps

- There is no generated, machine-readable inventory of routes (method, auth
  class, limiter, response codes). This document states the rules every route
  follows; finding *which* routes exist is still a walk of `app/api/**`.
- Request **body** schemas are validated per handler rather than declared, so
  the accepted fields of a given endpoint still come from reading it.
