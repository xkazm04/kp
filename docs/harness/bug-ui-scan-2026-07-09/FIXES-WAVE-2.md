# Fix Wave 2 — "The guard exists; the call site doesn't use it"

> 3 commits, 3 Critical findings closed (+1 High folded in).
> Baseline preserved: tsc 0 → 0 · node unit 1366 → **1376** (+10) · python 781 → **793** (+12) · `next build` ✓ · `schemas:check` ✓.

This wave deviates from the INDEX's original plan (which had GDPR second). Three of the five
remaining Criticals share a mental model tighter than any theme in the INDEX:

**kp already contains the correct primitive for each of these bugs. The call site reaches for
the wrong one, and nothing forces the right one.**

- `assertPublicHttpsEndpoint` exists in `safe-url.ts` — the ATS webhook validator never called it.
- `randomToken()` exists in `random-id.ts`, whose own comment says to use it for access gates —
  the public credential token used `randomId()`.
- `is_offline()` exists — `OpenAIProvider.available()` short-circuited past it.

A codebase that knows the right answer and doesn't reach it has a *discoverability* problem, not
a knowledge problem. Each fix therefore closes the seam rather than the instance.

## Commits

| # | Commit | Finding | Severity | Where |
|---|---|---|---|---|
| 1 | `042aa78` | ats-integration-egress #1 (+ shared-utility-libraries #2, partly) | Critical | `ats-config-store.ts`, `ats-egress.ts`, `ats-egress-guard.ts` (new), `+7 tests` |
| 2 | `fec48ca` | shared-utility-libraries #1 | Critical | `db/skill-profiles.ts`, `db/core.ts`, `skill-profile/[token]/verify`, `+3 tests` |
| 3 | `5259173` | llm-provider-layer-python #1 | Critical | `llm/base.py`, `llm/offline.py`, 4 adapters, `elevenlabs_backend.py`, `+12 tests` |

## What was fixed

### 1. ATS webhook SSRF

`validateUrl` checked the URL *scheme* — and permitted `http:` — never the destination. Since
`POST /api/ats/test` fetches the webhook and **returns the target's status code**, an operator
could aim it at `169.254.169.254` (cloud metadata), `127.0.0.1`, or any RFC-1918 host and read
the result. A working SSRF probe with a response channel.

Now validated at the config-write boundary *and* re-validated immediately before every outbound
fetch, because write-time validation alone is insufficient: a URL can be stored before a rule
tightens, and DNS can change under a stored value. The pre-fetch guard additionally **resolves
the hostname and rejects non-public resolved addresses**, closing DNS rebinding at this boundary.

**Deliberately not fixed inside `safe-url.ts`.** That module is imported by three `"use client"`
components (`ExtractionTab`, `SalaryTab`, `LibrarySavedJdsLedger`), so pulling `node:dns` into it
would break the client bundle in `next build` while leaving `tsc` clean. Verified by grep before
accepting the constraint; the new guard is a server-only module and imports `node:dns` lazily so
it stays loadable under `node --test`.

**Caveat recorded in-file:** resolve-then-fetch is still TOCTOU — `fetch` re-resolves. Hard IP
pinning needs a custom undici dispatcher, out of scope. The remaining `assertPublicHttpsEndpoint`
DNS-rebind gap on the `llm-config.ts` path stays open (shared-utility-libraries #2).

### 2. A guessable token guarding a public PII page

`db/skill-profiles.ts` minted the public credential token with `randomId("dsp")` — the explicitly
non-crypto helper. That token is the sole auth on `/skill/[token]` and its verify endpoint. On its
own that is bad; combined with the sibling finding that the verify endpoint is an unauthenticated
404-vs-200 existence oracle, guessing becomes practical rather than theoretical. Two subagents
found the two halves independently, in different contexts, and neither could see the other's report.

The PK stays `randomId` (internal, non-gating). The public value is now a separate `access_token`
column holding ~192 bits of CSPRNG. **Backward compatible by construction**: additive column,
legacy rows keep `access_token = NULL` and stay addressable by their original PK, so no
already-shared link breaks, and re-issuing a legacy credential returns its original token instead
of silently rotating it.

Verify responses are now shape-identical for "no such credential" and "found but invalid/revoked",
so the endpoint no longer confirms existence by shape. **Rate-limiting the oracle remains open.**

### 3. `KP_OFFLINE` was advisory, not authoritative

The no-egress seal sold to air-gapped installs was defeated by a cloud base URL:
`OpenAIProvider.available()` short-circuited `is_offline()` whenever any `base_url` resolved.
CVs and candidate PII egressed while the seal reported as on.

Fixed at **one chokepoint**, not per adapter. `TextProvider` gains an `_offline_egress_url()` hook;
a hard guard runs at the top of `complete()`, so even a direct call fails closed before a client is
constructed. **An adapter that does not override the hook is treated as cloud-only and blocked by
default** — a future adapter inherits the seal instead of having to remember it.

`is_local_url()` permits what offline mode exists to allow: loopback, private/link-local IPs, unix
sockets, single-label and `.local`/`.internal`/`.lan` hostnames (Ollama, vLLM, docker service
names). Any public FQDN or IP is refused.

**Behavior change worth review:** with `KP_OFFLINE` set, a cloud `*.openai.azure.com` endpoint is
now sealed off. That is the point of the seal, but it will surface for anyone running offline mode
against cloud Azure.

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| node unit | 1366 | **1376** (+10) |
| python | 781 OK (4 skip) | **793 OK** (4 skip) |
| `schemas:check` | ✓ | ✓ (no Pydantic model changed) |
| `next build` | ✓ | ✓ |

Every one of the three fixes was verified **non-vacuous**: each subagent confirmed its new test
fails against the pre-fix code before finishing. This is now a standing requirement for this
scan's fixes, because the scan itself found a tautological assertion
(`assertGreaterEqual(x, out["qualified"] and 0)`) that had guarded the winnability coach's headline
invariant for months while always reducing to `x >= 0`.

## Patterns established (catalogue items 5–8)

5. **The right primitive exists and nothing forces its use.** `assertPublicHttpsEndpoint`,
   `randomToken`, `is_offline` were all present and all bypassed. When you fix one instance, ask
   what would have *forced* the call site to reach for it — a base-class chokepoint, a type that
   only the safe constructor can produce, a lint rule. Fix the seam, not the instance.
6. **Validate at the write boundary AND at the use boundary.** A value stored before a rule
   tightened is a value that never met the rule. DNS makes this concrete: the host that validated
   at write time is not necessarily the host you connect to.
7. **`tsc` cannot see the client/server boundary.** `safe-url.ts` typechecks perfectly with
   `node:dns` in it and fails `next build`, because three `"use client"` components import it.
   Before adding a node builtin to a shared `_lib` module, grep for `"use client"` importers.
8. **Two halves of one vulnerability can live in two contexts.** A weak token (shared-utilities)
   and an existence oracle (skill-matrix) are each merely bad; together they are a breach. Scan
   reports are per-context; the composite risk only appears at triage. Read across the reports.

## What remains

Criticals: **7 of 9 closed.** Open: GDPR erasure missing transcripts + comms
(`privacy-consent-provenance` #1) and refunds never clawed back (`billing-engine-webhooks` #1) —
both in flight as Wave 3.

Then 62 Highs, per the INDEX wave plan.
