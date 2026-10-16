---
id: "unassigned"
title: Every workspace-scoped route enters through route(...); the session is the first refusal, guards come next, the handler's own gates last
status: accepted
date: 2026-10-16
supersedes: []
superseded-by: null
tags: [api, tenancy, auth, rate-limit, billing, fail-closed]
sources:
  - app/_lib/auth/workspace-context.ts
  - app/_lib/auth/route-guards.ts
  - app/_lib/auth/workspace-context.test.ts
  - app/api/route-workspace-coverage.test.ts
  - app/api/rate-limit-contract.test.ts
---

## Context

Two hundred and sixty non-public route files each opened with
`const ws = await currentWorkspace()` (297 call sites) and each decided for itself
when to refuse. The resolver is correct, but the convention was copy-paste: a new route
that forgot the call, or forgot to pass `ws` on to a store function that **defaults its
tenant** (`listPipeline(workspaceId = DEFAULT_WORKSPACE_ID)`), silently read the default
team. `route-tenancy-coverage.test.ts` catches the second half after the fact; nothing
caught the first. Rate limits and billing gates had the same shape: per-route calls pinned
by source-text matching in `rate-limit-contract.test.ts`, and no check at all that a paid
route carries a meter gate.

One fact shaped the design: `currentWorkspace()` **never returns null**. Outside a
request, or with no cookie, it falls back to the default workspace. A wrapper that
"401s on null" would therefore never refuse. The refusal has to be the session rule that
`proxy.ts` already applies to every non-public route, re-asserted at the handler.

## Decision

### 1. One entry: `route(...guards)(handler)`

```ts
export const GET  = withWorkspace(async (ws: string, request: Request) => { ... });
export const POST = route(withRateLimit({ key: ({ request }) => `tts:${clientKey(request)}`, limit: 60, windowMs: 600_000 }),
                          withMeterGate("ai_candidates"))(
  async (ws: string, request: Request, { params }: Ctx) => { ... });
```

`withWorkspace = route()`. The handler receives the resolved workspace as its **first**
argument and its own arguments after it, unchanged. The workspace step is always the
outermost layer of a chain: it cannot be left out of `route(...)`.

### 2. Refusal order (uniform, and the part that changed)

1. **Session.** `KP_OPERATOR_PASSWORD` set and no live session (missing, forged,
   expired, revoked): `401 { error: "Unauthorized" }`, the envelope `requireOperator`
   already uses. Open mode never refuses here and resolves the default workspace.
2. **Guards, in the order written in `route(...)`**: `withRateLimit` (429, coded
   `TOO_MANY_REQUESTS`, optionally with `Retry-After`), `withMeterGate` (402,
   `BILLING_QUOTA_EXCEEDED` with `meter` and `plan` as data). The first written refuses
   first.
3. **The handler's own gates**: `requireOperator`, the capability seat (403), body
   validation (400), existence (404).

Before, a handler that resolved its workspace mid-body refused in whatever order its
author wrote. Now an unauthenticated caller meets the 401 before any other answer, so a
route no longer tells an anonymous caller "429" or "400" or "404" first. In password mode
the proxy already turned such a caller away before the handler existed, so the observable
change is confined to the defense-in-depth path (a matcher gap, a non-HTTP dispatch) and
to tests that drove a handler with no cookie.

### 3. What is NOT wrapped

The routes listed in `public-api-surface-contract.test.ts` (37) authenticate by a
capability link, a webhook signature or nothing at all. Wrapping them would 401 a
candidate. `route-workspace-coverage.test.ts` fails if a public route imports the
wrapper, and fails if a non-public route handler is not behind it.

### 4. Guards are only for the FIRST refusal

A guard runs before every gate the handler owns. A limiter that has to stay behind a
cheaper refusal (`servedBefore` in `rate-limit-contract.test.ts`: the TTS cache replay,
the foreign-JD 404, a sub-minimum search query) remains a call in the body, and the
contract keeps pinning it as text. A meter gate whose units come from the parsed body
(`minUnits: freshCount`) likewise stays in the body. Only a limiter or a gate that was
already the first thing the handler did moves to the chain, and the contract row for it
is migrated to pin the chain declaration (`chain: true`), not deleted.

## Consequences

- A new route cannot reach a store with a guessed tenant: the ratchet requires the
  wrapper, and the handler has no other way to get a workspace.
- `currentWorkspace()` stays exported for server components, background tasks that carry
  their workspace explicitly, and the wrapper itself. The ratchet forbids it in route
  files outside the allowlist.
- The 401-first order is uniform and documented here. A test that pinned a different
  order for an unauthenticated caller was updated only where it matched this section.
- Review flag: this is tenant isolation. The review surface is `workspace-context.ts`
  (35 lines of logic) and the cross-workspace tests, not 260 mechanical rewrites.
