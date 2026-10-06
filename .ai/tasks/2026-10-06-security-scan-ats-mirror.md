# Security scan — the screening wave's ATS mirror, and the close/reopen write lock

Scope: exactly two commits on `main`, and the code they call.

- `e00ada3c` — *fix(ats): the screening wave's auto-rejects reach the ATS, and the webhook note stops denying events fire*
- `708456da` — *fix(pipeline): close and reopen hold the write lock from BEGIN*

Last scan before these: `c81dd401`. Scanned on branch
`autopilot/codebase-security-scan-f0aba5ab` (cut from the `main` tip `8560ff94`).

**Outcome: no fix was applied.** Every question below is either `ok` or a `finding`.
Nothing met the fix policy's bar ("small and unambiguous, test-first"): the two
findings worth acting on (F-1, F-2) are design decisions about what a mirrored
event means, not one-line corrections, and the two test-coverage gaps (F-4, F-5)
cannot be closed without an injection seam this scan is not authorised to add.
Severities are mine; the ranking question (whether F-1 is acceptable in a
single-tenant self-host, which is every shipped deployment today) is the
operator's.

---

## A. `e00ada3c` — outbound candidate data

New caller: `app/_lib/screen-wave.ts:631`

```ts
void dispatchAtsEvent("candidate.rejected", updated.id, workspaceId);
```

### A1. Tenant isolation — **ok (read side)** / **finding F-1 (destination side)**

*Can an entry from another workspace be mirrored to this workspace's endpoint, or
the reverse?*

The read side is correctly scoped, in three independent places:

- The wave's cohort, the drift pre-check (`screen-wave.ts:510`,
  `getPipelineEntry(e.id, workspaceId)`) and the commit
  (`screen-wave.ts:583`, `actOnPipelineEntry(…, workspaceId)`) all carry the
  session workspace, which the route takes from `currentWorkspace()`
  (`app/api/decisions/screen-wave/route.ts:56`) and never from the body.
- `dispatchAtsEvent` resolves the tenant as `workspaceId ?? getEntryWorkspace(entryId)`
  (`ats-egress.ts:275`) — the wave always supplies it, so the fallback is not taken.
- The record build reads the entry through `getPipelineEntry(entryId, workspaceId)`
  (`ats-egress.ts:62`); job and decision reads then key off `entry.workspaceId`
  (`ats-egress.ts:64-65`). A foreign entry id yields `null` → a *failed ledger row*
  (`ats-egress.ts:285-297`), never a POST.

Source-level enforcement exists and would catch a regression:
`app/_lib/db/pipeline-tenancy.test.ts:65` requires every `pipeline_entries`
statement in `db/pipeline.ts` to carry `workspace_id` *in a predicate* (the
`isScoped` helper at :50 rejects a column that appears only in the SELECT list,
with its own non-vacuity test at :55).

**F-1 (medium) — the destination is deployment-global, and the wave is the first
unattended bulk producer on it.** `getAtsConfig()` reads a single row with no
workspace column (`ats-config-store.ts:122`), declared org-level on purpose
(`app/_lib/tenancy.ts:424-425`: `ats_config`, `ats_delivery` are EXEMPT —
"the org's outbound ATS webhook integration (one endpoint)"). So in a deployment
with more than one workspace, **workspace B's auto-rejected candidates — name,
contact, match score — are POSTed to the endpoint workspace A configured.** That
is pre-existing by design and not introduced here; what `e00ada3c` changes is the
volume and the attendance. Before it, the only `candidate.rejected` producer was a
recruiter's click (`pipeline-entry-action.ts:573`), i.e. one human act at a time.
Now one approved wave mirrors a whole cohort with no human at the keyboard per
candidate.

Suggested fix: give `ats_config` a `workspace_id` and scope `getAtsConfig()` in
`dispatchAtsEvent`, or — cheaper, and no schema change — refuse the dispatch when
the resolved tenant is not the workspace that owns the config row, and say so in
the ledger reason. Either way it is a schema/behaviour decision, out of this
scan's fix policy. Until then the integrations panel should state that the webhook
is deployment-wide; `docs/features/integrations/README.md` is the place.

### A2. Minimisation — **ok, with F-2 noted below**

*What candidate fields leave?* The payload is `buildEnvelope(event, record, sentAt,
key)` (`ats-webhook.ts:90-99`) wrapping exactly `buildAtsRecord`'s return
(`ats-record.ts:191-233`):

| Group | Fields on the wire |
| --- | --- |
| `candidate` | `ref` (pipeline entry id), `candidateId`, `displayName`, `contact`, `archetype`, `piiWithheld` |
| `role` | `jobId`, `title`, `company`, `family` |
| `pipeline` | `stage`, `status`, **`matchScore`**, `enteredAt`, `stageChangedAt` |
| `decision` | `kind`, `reasonCode`, `actor`, `automated`, `sealedRecordHash`, `policyVersion`, `decidedAt` |
| `offer` | `currency`, `amount`, `status` |

Against the brief's list of internal-only data:

- **match score — LEAVES** (`ats-record.ts:212`). Deliberate and pre-existing: it
  is in the published `kp.ats.v1` contract, not something this commit added.
- **rationale — does not leave.** The wave's prose rationale
  (`screen-wave.ts:465-469`, which names the bottom-%, the rank, the score and the
  approver) rides the sealed decision record and the pipeline event detail. The
  record carries only `reasonCode` + `sealedRecordHash`.
- **reasonParams — does not leave** (`screen-wave.ts:472-480`; they go into the
  seal's `inputs` at :562, never into `buildAtsRecord`).
- **archetype — LEAVES** (`ats-record.ts:199`). Pre-existing contract field.
- **holdout status — does not leave**, and cannot: a held-out entry is removed from
  `wouldReject` before the loop (`screen-wave.ts:258-259`) so it never reaches the
  dispatch.
- `approvedBy` — the approving operator's server-derived identity
  (`route.ts:101`) — **does not leave** the record directly, but see F-2.

*Versus the recruiter-click reject:* **identical**. Both call the same
`dispatchAtsEvent(event, entryId, workspaceId)` with the same three arguments
(`pipeline-entry-action.ts:573` vs `screen-wave.ts:631`), so the shape, the
redaction and the transport are the same code. The only difference is which
decision row is `latest` when the record is built — `auto_rejected` /
`auto:screen-wave` for the wave, `rejected` / `human:…` for the click — which is
the `automated` boolean doing exactly its documented job (`ats-record.ts:147`).

**F-2 (low) — `decision.actor` now carries a named human to a third party on the
automated path.** For the wave the latest sealed record is written with
`actor: "auto:screen-wave"` (`screen-wave.ts:537`), so the actor string itself is
not a person. Worth stating because it is the opposite of what the seal's *inputs*
hold (`approvedBy` at :562) and because the recruiter path's `sealActor` is a
`human:<name>` string that *does* reach `decision.actor` on the wire for every
manual reject — an employee name sent to the customer's ATS. Pre-existing on the
click path; unchanged here. Suggested fix: project `decision.actor` to its
`human:`/`auto:` class and keep the name in the sealed record only.

### A3. Only committed rejects mirror — **ok (behaviour)** / **finding F-4 (proof)**

The dispatch sits at the end of the `wouldReject` branch, after four `continue`s
that each precede it:

| Outcome | Where it leaves the loop | Reaches :631? |
| --- | --- | --- |
| dry run (preview) | `screen-wave.ts:485-489` | no |
| recruiter-spared | `screen-wave.ts:431-448` | no |
| holdout | removed from `wouldReject` at `:258-259`, handled at `:363` | no |
| drift pre-check (`staleSkipped`) | `screen-wave.ts:511-524` | no |
| `sealFailed` | `screen-wave.ts:564-572` | no |
| CAS lost (`staleSkipped`) | `screen-wave.ts:584-597` | no |
| applied reject | falls through | **yes** |

*Do the tests prove it?* Partly. `ats-lifecycle-events.test.ts:162` drives the real
preview → approve → commit and asserts the ledger holds exactly one
`candidate.rejected` per applied reject and **none** for the spared or the two kept
entries, plus "a preview never reaches the ATS"; `:190` proves the 100%-holdout
case. Non-vacuity is explicit in both ("otherwise the commit below proves
nothing").

**F-4 (low, test coverage) — `sealFailed` and `staleSkipped` are proven by code
placement only.** No test drives a seal failure or a mid-wave drift and asserts an
empty ledger. Both are the paths where kp has *decided not to reject* and would be
telling the customer's ATS otherwise, so they are the two worth a test. Suggested
fix: a seam to make `sealDecisionSafe` return false once (the file already injects
`fetch`, so the idiom exists), and for drift a `getPipelineEntry` stub that flips
the row between the pre-check and the CAS. Not attempted here — it needs a new
injection point in `screen-wave.ts`, which is a design change, not a test.

### A4. Subscription gate — **ok**

`ats-egress.ts:266`:

```ts
if (!cfg.webhookUrl || !cfg.events.includes(event)) return;
```

This is the **first** statement of the `try`, before the ledger row is opened
(`:281`), so an unconfigured or unsubscribed deployment writes nothing at all and
POSTs nothing — the documented "no delivery was ever owed" (`:256-258`). The
subscription list itself is validated at the write boundary
(`ats-config-store.ts:161`), and `ping` is not subscribable
(`integrationsCatalog.test.ts:115`). The panel's claim that an event fires is now
pinned to the tree in both directions by `integrationsCatalog.test.ts:137`, which
walks `app/_lib` + `app/api` for `dispatchAtsEvent("<id>"` and requires
`candidate.rejected` at both `_lib/pipeline-entry-action.ts` and
`_lib/screen-wave.ts` (:178-180), with a non-vacuity assertion on the walk itself
(:175).

### A5. Egress guards on the new caller — **ok**

The new caller inherits every guard because it enters through the same
`dispatchAtsEvent` → `deliver` path; none of them is re-implemented at the call
site.

| Guard | Evidence |
| --- | --- |
| https-only, no IP literal, no internal/`.local`/`.internal` name | `assertPublicHttpsEndpoint` at `ats-egress-guard.ts:105`, run at delivery time via `ats-egress.ts:148` — *and* at config-write time (`ats-config-store.ts:155`) |
| DNS resolving to a private address | `ats-egress-guard.ts:107-120`; `isPrivateAddress` covers loopback, RFC-1918, CGNAT, `169.254/16` metadata, multicast/reserved, ULA, link-local v6 and IPv4-mapped v6 (`:27-70`) |
| rejection never contacts the target | `ats-egress.ts:148-151` returns a validation reason before the `fetch`; no status or body of an internal probe can leak back |
| `redirect: "manual"` | `ats-egress.ts:199`, with the opaque-redirect fold at `:204-210` so a 302 is a failure, not a followed hop |
| 5s timeout | `AbortSignal.timeout(5000)`, `ats-egress.ts:199` |
| signing | `ats-egress.ts:179` — `signWebhookBody(secret, body, signedAt)` over `<timestamp>.<body>` (`ats-webhook.ts:113`); a secret that cannot be decrypted is a *delivery failure*, never an unsigned send (`ats-egress.ts:173-178`) |
| no secret in logs or the ledger | the three reason shapes are the guard's operator message (host + resolved IP), `webhook endpoint responded <status>`, and `signing secret unavailable: <crypto error>` — `ats-secret.ts:88` is a format string, `:96`/`:102` rethrow node's crypto error; none echoes key or ciphertext |
| no candidate PII in logs or the ledger reason | `ats-egress.ts:294-296` and `:310` log `event`, `entryId`, `deliveryId` and `reason`. The `reason` strings that mention a candidate name a **pipeline entry id**, not a person (`:292`, `ats-record.ts:187`, `ats-egress.ts:241-246`). The PII is in `body`, which is never logged |

One residual, already stated in the code and not a regression:
`ats-egress-guard.ts:15-20` documents that resolve-and-reject is not an IP pin, so
a sub-second rebind between the guard's lookup and undici's is theoretically open
(TOCTOU). Unchanged by this commit.

### A6. Erasure and freshness — **ok for erasure** / **finding F-3 for re-open**

*Erasure:* **ok, twice over.**

- An anonymized entry is refused by the mapper itself (`ats-record.ts:184-189`),
  so the record is never built; the ledger row is dead-lettered as terminal
  (`ats-egress.ts:285-297`).
- An erasure landing *inside* the preparation window — after the record was built,
  while the SSRF re-vet awaits DNS — is caught by `consentStillPermits`
  (`ats-egress.ts:232-250`), run as the last statement before the fetch with no
  `await` after it (`:180-190`). Consent that merely *expired* in the window is a
  retryable refusal rather than a swapped body, because the prepared bytes
  over-disclose (`:242-247`). Both are already tested:
  `ats-egress-freshness.test.ts:45` and `:107`.
- The same re-read runs on every retry (`ats-egress.ts:360-371`), so a candidate
  erased between the wave and attempt 4 is dropped terminally.

**F-3 (medium) — a candidate REINSTATED between the wave and a retry is still
sent, under `candidate.rejected`, with a body that says they are active.**
`retryDueAtsDeliveries` rebuilds the record from *current* entry state
(`ats-egress.ts:360`, deliberately: "a mirror wants the latest"), and the freshness
check only gates consent and existence (`:238-248`) — never the transition that
justified the event. So after a `reinstatePipelineEntry`, attempt N+1 carries
`event: "candidate.rejected"` with `pipeline.status: "active"`, and the receiver's
own dedupe cannot help: the `Idempotency-Key` is unchanged, so a receiver that
rejected the candidate on attempt 1 sees the "same" delivery again, while one that
had not yet seen it is told to reject someone kp has put back in the funnel.

This also quietly breaks the byte-identity promise `deliver` makes at
`ats-egress.ts:152-159` ("attempt 4 is byte-identical to attempt 1 and a receiver
can dedupe on the body alone"). The test that pins it,
`ats-egress-delivery.test.ts:377`, never mutates the entry between the two
attempts, so it proves identity for a *static* entry only — which is the one case
where it is uninteresting.

Pre-existing on the recruiter-click path and in the retry ladder generally; the
wave makes it systematic, because an auto-rejected cohort is exactly the
population a recruiter reviews and partially reinstates. Suggested fix: pick one
of two, as a decision — either store the first attempt's body in `ats_delivery`
and resend those bytes (keeps the dedupe promise literally true), or extend
`FreshnessCheck` to re-assert the transition (`status` still terminal for a
`candidate.rejected`) and fail the row terminally when it no longer holds. The
second is cheaper and matches the existing "a decline on a STALE link that changes
nothing mirrors nothing" stance (`ats-lifecycle-events.test.ts:115`).

### A7. Fire-and-forget — **ok**

`void dispatchAtsEvent(...)` cannot take the process down. The function's body is
one `try` whose first statement is the config read (`ats-egress.ts:264-266`) and
whose `catch` (`:312-321`) logs and then finalizes the ledger row inside a second
`try`/`catch` — so both the happy path and the recovery path are total. There is no
statement before the `try` that could throw synchronously (`:262-263` are two
`let` declarations), and every `await` (`:299`, and the DNS resolve inside
`deliver`) is inside it. `deliver` itself is documented and written to never throw
(`:116-124`), returning a structured result.

The ledger row is opened **synchronously** (`openAtsDelivery` at `:281`, before the
first `await`), so even if the request finished and a serverless invocation froze
mid-POST, the row exists as `pending` and the lease sweep reclaims it
(`:277-279`, `reclaimExpiredAtsLeases`). Nothing is silently lost.

**F-5 (info, test coverage)** — "never throws" is asserted by prose and by
inspection, not by a test. No `assert.doesNotReject` on `dispatchAtsEvent` exists
in `app/_lib/ats-*.test.ts`. A future edit that moves a statement above the `try`,
or a store call added to the `catch` outside its inner guard, would turn this into
an unhandled rejection — which on a Node 20+ default is a process exit, during an
unattended wave. Suggested fix: one `assert.doesNotReject` per failure class
(config read throws, ledger write throws, `deliver` throws). Cheap, but it needs a
module-mock seam the file does not currently have for the store, so it is a finding
rather than a fix.

### A8. Burst — **finding F-6 (medium), reported only**

Outbound concurrency is **unbounded**. The loop fires one unawaited
`dispatchAtsEvent` per applied reject (`screen-wave.ts:631`), each of which
synchronously opens its ledger row and builds its record, then suspends into a DNS
resolve plus a POST with a 5s timeout (`ats-egress.ts:148`, `:199`). Nothing caps
the number in flight: a 200-candidate cohort yields up to 200 concurrent POSTs to
one customer endpoint, each carrying candidate PII, from a single approved click.

Two mitigating facts, both circumstantial rather than structural:

- The loop `await`s `dispatchRejection` per candidate (`screen-wave.ts:611`), so
  with a comms relay configured each iteration costs a network round-trip and the
  dispatches are spaced. **Keyless** (the project's default, where the relay is a
  deterministic local write) that spacing disappears and the fan-out is effectively
  simultaneous.
- The *retry* path is serial — `retryDueAtsDeliveries` is a `for … await` loop
  (`ats-egress.ts:346-387`) — and bounded at `MAX_ATTEMPTS = 6`
  (`ats-delivery-store.ts:23`). So only the initial wave bursts.

The route is operator-gated (`requireOperator`, `route.ts:43`), capability-checked
(`:45`), rate-limited per IP (`:86`) and single-use per approval token, so this is
not a remote amplifier — the ceiling is one cohort per approved wave. Per the
brief: reported, not redesigned.

---

## B. `708456da` — the pipeline write lock

### B1. Workspace predicate on both statements — **ok**

`closeEntriesByJobId` (`db/pipeline.ts:883`):

- SELECT `:895-898` — `WHERE job_id = ? AND status = 'active' AND stage != ? AND workspace_id = ?`
- UPDATE `:933-937` — `WHERE id=? AND status='active' AND stage != ? AND workspace_id=?`

`reopenEntriesByJobId` (`db/pipeline.ts:982`):

- SELECT `:988-991` — `WHERE job_id = ? AND status = 'role_closed' AND workspace_id = ?`
- UPDATE `:995` — `WHERE id=? AND status='role_closed' AND workspace_id=?`

Both are the tenant in a *predicate*, not in a select list, which is the
distinction `pipeline-tenancy.test.ts:50` was tightened to enforce; its sweep at
`:65` covers `db/pipeline.ts` wholesale, so dropping either clause fails
`test:unit`. The per-row `recordEvent` call derives the event's tenant from the
entry when not given (`db/core.ts:3504`), so the audit rows cannot land in
another team either. `708456da` changed only the transaction mode — no predicate
moved.

### B2. Close and publish take the workspace and actor from the session — **ok**

- `POST /api/jobs/[id]/close` — `const ws = await currentWorkspace()`
  (`route.ts:20`), passed to `closeEntriesByJobId(id, ws)` (`:47`). The handler
  reads **no body at all** (`_request` is unused, `:13`). Ownership is re-checked
  by `canWriteJobLifecycle(id, ws)` before any write (`:29`), answering 404 rather
  than 403 so the endpoint does not confirm another tenant's id exists. No actor
  is recorded by this path.
- `POST /api/jobs/[id]/publish` — `requireOperator()` first (`route.ts:74`), then
  `currentWorkspace()` (`:77`, `:86`), passed to `reopenEntriesByJobId(id, ws)`
  (`:219`). The body is parsed (`:90`) but `parsePublishBody` admits only
  `targetHires` and `langs`, both range/enum-validated — no workspace, no actor,
  no job owner.
- Both sit on the gated side of the fail-closed auth gate:
  `docs/architecture/api-reference.md:440` (`/api/jobs/[id]/close`, POST, **gated**)
  and `:445` (`/api/jobs/[id]/publish`, GET POST, **gated**), and neither appears in
  `app/_lib/auth/public-routes.ts`.

The tenancy wiring on the close route is itself pinned by
`app/api/jobs/close-tenancy.test.ts:19-20`, which fails both on a missing `ws`
argument and on a bare `closeEntriesByJobId(id)`.

### B3. Lock-hold inside the IMMEDIATE transaction — **ok**

Nothing inside either transaction awaits, spawns, or reaches the network.

- The one call that could have (`getPipelineAxis(workspaceId)`, which resolves the
  board's terminal column) is deliberately hoisted **before** `db.transaction(...)`
  opens (`db/pipeline.ts:891`, "Bound as a parameter, resolved before the
  transaction opens").
- The bodies are: one `prepare().all()`, then per row one `prepare().run()` plus
  `recordEvent` — which is a single parameterized `INSERT` and, when the tenant is
  not supplied, one point `SELECT` (`db/core.ts:3504-3526`). No loops inside the
  loop, no LLM call, no `python-runner`, no `fetch`.
- `await` inside `db.transaction()` is banned at `error` by `no-restricted-syntax`
  in `eslint.config.mjs`, so a future one is a red `npm run lint`, not a silent
  atomicity loss.

The hold is therefore O(rows withdrawn) synchronous SQLite work. That is a longer
write-lock hold than before — IMMEDIATE takes the lock at BEGIN rather than at the
first UPDATE — and on a role with thousands of in-flight entries it serialises
other `pipeline_entries` writers for that span. I do not call it a finding: it is
the explicit trade `708456da` was made for (the alternative was a
`SQLITE_BUSY_SNAPSHOT` rollback of the whole close, `pipeline-close-guard.test.ts:304`
reproduces it), the other writers *wait* their `busy_timeout` instead of failing,
and the row count is bounded by one role's pipeline.

### B4. No caller nests these in an outer transaction — **ok, still true on `main`**

Three non-test callers, checked at the tip:

| Caller | Nesting |
| --- | --- |
| `app/api/jobs/[id]/close/route.ts:47` | top level of the handler, inside a plain `try` |
| `app/api/jobs/[id]/publish/route.ts:219` | top level; the billing gate's transaction has committed before it, and `runGoLive` runs after |
| `app/_lib/stage-hooks-role-fill.ts:120` | reached via `scheduleRoleFillHook` → `afterResponse("role-fill", …)` (`:66-67`), i.e. **after the response**, outside the hiring write entirely |
| `app/_lib/rediscover.ts:101` | a comment only — no call |

`runRoleFillHook` re-reads the entry and re-compares the stage before acting
(`stage-hooks-role-fill.ts:84-89`) precisely because it runs outside the
transaction. The commit message's claim holds.

Even if a caller did nest one day, the `res.changes === 0` guards are kept for
exactly that case — better-sqlite3 turns a nested `transaction()` into a SAVEPOINT
and ignores the inner `.immediate()` — and `pipeline-close-guard.test.ts:115`
pins the guard's presence at the source so it cannot be removed as redundant.

---

## Findings summary

| id | sev | what | where |
| --- | --- | --- | --- |
| F-1 | medium | the ATS webhook destination is deployment-global, so one workspace's endpoint receives every workspace's auto-rejects; the wave is the first unattended bulk producer on it | `ats-config-store.ts:122`, `tenancy.ts:424` |
| F-3 | medium | a reinstated candidate is still mirrored as `candidate.rejected` on a retry, with a body saying `active`; the byte-identity/dedupe promise holds only for an unchanged entry | `ats-egress.ts:360`, `:152-159` |
| F-6 | medium | unbounded outbound concurrency on a wave: one POST per applied reject, none awaited, no cap (report-only per the brief) | `screen-wave.ts:631` |
| F-2 | low | `decision.actor` sends a `human:<name>` employee identity to the customer's ATS on the recruiter path (the wave's is `auto:screen-wave`) | `ats-record.ts:219` |
| F-4 | low | `sealFailed` and `staleSkipped` mirror nothing by code placement only — no test drives either | `screen-wave.ts:564`, `:584` |
| F-5 | info | `dispatchAtsEvent`'s "never throws" contract has no test; `void` on an unattended path makes a regression a process exit | `ats-egress.ts:261` |

## What I did not check, and why

- **Everything outside these two commits and the code they call**, per the brief's
  scope line. In particular: the inbound ATS direction (`app/_lib/ats/`), the pull
  door `GET /api/ats/record`, the operator-facing `GET /api/ats/deliveries`, the
  test-ping route, and the other three subscribable events' emit sites.
- **The at-rest encryption of the webhook secret** beyond confirming that a
  decrypt failure cannot send unsigned and cannot echo key material into a log or
  the ledger (`ats-secret.ts:88-102`). The cipher construction itself is
  pre-existing and untouched by `e00ada3c`.
- **The TOCTOU window in resolve-and-reject** (`ats-egress-guard.ts:15-20`). It is
  documented, pre-existing, and closing it needs a custom undici dispatcher — out
  of scope twice over.
- **Live/runtime verification.** This scan is static plus the committed tests; no
  dev server was started and no real webhook was dialled. The behavioural claims
  about the race in B are taken from `pipeline-close-guard.test.ts`'s two-connection
  replay, which runs in `npm run test:unit`.
- **The i18n copy** of the integrations note. `messages/*.json` is a do-not-touch
  path for this session, and `integrationsCatalog.test.ts:186` already pins the
  key's shape in all four locales.
