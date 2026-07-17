# Fix Wave 1 — Access / capability / injection boundaries

> 6 findings closed in 6 atomic commits (1 Critical + 5 High).
> Baseline preserved: tsc 0 → 0 errors; node unit suite 2315 → 2336 pass, 0 fail, 0 regressions.
> Branch: `vibeman/ambiguity-ui-wave1` (off `main`).

## Commits

| # | Commit | Finding closed | Severity | Files |
|---|---|---|---|---|
| 1 | `62012d1` | safe-url SSRF numeric-IP bypass | High | `safe-url.ts` (+test) |
| 2 | `7d7e89d` | pipeline `?entry=` ungated PII leak | High | `pipeline/events/route.ts` (+tenancy test) |
| 3 | `ea25feb` | schedule PATCH join-link injection | High | `schedule/route.ts` (+new test) |
| 4 | `48f19be` | github href stored-XSS via schema | High | `schemas.ts` (+new test) |
| 5 | `58db48c` | org permission-delegation strip | High | `org/members/[userId]/route.ts` (+new test) |
| 6 | `97dee5b` | **onboarding blur-autosave data-loss** | **Critical** | `onboarding-store.ts`, `OnboardingTab.tsx` (+tests) |

## What was fixed

1. **safe-url SSRF (numeric IP encodings).** `assertPublicHttpsEndpoint`'s `isIpLiteralHost` only caught dotted-quad IPv4 / IPv6, so `https://2130706433/`, `https://0x7f000001/`, and `https://127.1/` slipped past and the OS resolver expanded them back to loopback. Now rejects any host made only of digits+dots or a `0x` hex literal (a real DNS host carries a TLD letter). Closes the standalone store-time gate in `ats-config-store`.
2. **Pipeline `?entry=` leak.** `GET /api/pipeline/events?entry=<id>` returned an entry's full un-anonymized recruiter history (labels, archetype, rejection detail) with no `requireOperator()` gate — unlike the operator-gated sibling `[id]`/`timeline` routes serving the same PII. It was also dead code (the drawer uses the gated `/timeline` bundle). Removed; the tenancy test now source-guards that it stays gone.
3. **Schedule join-link injection.** `PATCH /api/schedule {token, meetingUrl}` sets the trusted "Join" link on the recruiter agenda + both calendar events, but required only the candidate's own token — no `currentWorkspace()`, no `invite.workspaceId` check. A token holder could inject a phishing link into the recruiter surface (and cross-tenant edit). Now mirrors the POST guard: resolve tenant, load invite, 404 on mismatch before writing.
4. **GitHub href stored-XSS.** `githubAnalysisSchema.profileUrl` / `topRepositories[].url` were bare `z.string()`, but the persisted-report path (`PATCH /api/analyses/[slug]`) accepts client URLs later rendered as `<a href>`. A `javascript:`/`data:` value was stored and clickable. Both fields now flow through an `httpUrlOrBlank` transform that blanks non-http(s) at the schema choke point.
5. **Org permission-delegation strip.** Editing a member's permissions rebuilt the whole override then filtered *all* grants to the actor's caps — so a partial delegate toggling one unrelated switch silently dropped a teammate's pre-existing `team:manage`. Delegation is now applied to the *delta*: a grant survives if the actor can delegate it OR it already existed on the member.
6. **Onboarding blur-autosave data-loss (CRITICAL).** `saveIntake` wholesale-replaced `answers_json`; the recruiter form's unconditional blur PATCH (with a stale `{}` snapshot) destroyed the candidate's submitted intake and minted an empty row that suppressed the pre-boarding reminder. `saveIntake` now merges non-blank keys over the stored row and no-ops on empty; the UI PATCHes only the field that actually changed.

## Verification

| Gate | Before | After |
|---|---|---|
| tsc --noEmit | 0 errors | 0 errors |
| node unit suite | 2315 pass / 0 fail | 2336 pass / 0 fail |

## Patterns established (catalogue items 1–6)

1. **Numeric-IP SSRF bypass** — an IP-literal guard that only matches dotted-quad/IPv6 misses integer/hex/short-form encodings the resolver still expands to an IP. Rule: reject any host that is all digits+dots or a `0x` hex literal (real DNS names carry a letter).
2. **Authz-parity gap on a sibling branch** — when N routes serving the same PII are gated "the same way," a later-added branch on one of them (esp. a query-param branch) silently ships ungated. Grep every read of the sensitive primitive, not just the obvious route.
3. **Capability-boundary drift by comment** — a handler asserting "the candidate never reaches this route" while the only credential it requires *is* the candidate's token. Verify the guard, not the comment; mirror the sibling handler that got it right.
4. **Two validated paths, different invariants** — the same data validated by two schemas/helpers where only one vets a security property (URL scheme). Fix at the shared schema choke point so every producer/consumer inherits it.
5. **Full-recompute strips untouched state** — a "send the whole desired set, server rebuilds it" API caps/filters the full recompute, silently dropping pre-existing state the actor didn't touch. Apply the policy to the delta, not the recompute.
6. **Blur-autosave last-write-wins** — an unconditional onBlur PATCH that replaces (not merges) server state destroys concurrently-submitted data with a stale form snapshot. Merge at the store + dirty-check at the field + never persist an empty row.

## What remains (deferred from Wave 1, with cause)

- **dev-submissions-live-work-surface #1 (Critical — guessable dev-session write route).** DEFERRED: `app/api/devcase/session/[id]/route.ts` is under active uncommitted WIP on `main` (a new `dev-session-integrity.test.ts` and `session/[id]/chat/` subroute), strongly indicating the user is already hardening this exact route. Fixing it here would collide. Revisit once that WIP lands.
- **guided-pipeline-simulation #1 (High — public `/api/demo` PII exposure).** DEFERRED to the tenancy wave: it's a half-built-tenancy architectural change (the `demoSessionAllowed()` flag vs. ~28 unscoped tables), not a self-contained boundary fix.
- The workspace/tenancy-scoping theme (Wave 2) — the single biggest cluster — is untouched and is the recommended next wave.
