---
id: "0008"
title: A row declares its own outcome — no green lies
status: accepted
date: 2026-09-07
supersedes: []
superseded-by: null
tags: [api, comms, honesty]
sources:
  - app/_lib/comms-truth.ts
  - app/_lib/comms-delivery-truth.test.ts
  - app/features/settings/integrations/integrationsCatalog.test.ts
---

## Context

Two classes of outcome are easy to lie about in a recruiting platform:

1. **Comms delivery** — did the message actually reach the candidate?
2. **Integration events** — does this webhook event fire today?

Both are high-stakes. A recruiter who sees a green "sent" badge next to a
rejection letter they *think* was delivered stops re-sending. An ATS operator
who subscribes to `offer.declined` because the settings panel says it fires
will wonder why their system never hears about withdrawn offers.

The temptation in both cases is to optimise for a positive initial impression:
call every recorded row "sent", call every visible event "live". The real
failure surfaces later, in a context where the original display claim is long
forgotten.

The pre-principle state of this codebase illustrates both failure modes:

- **Comms**: `status` was set from the relay dispatch return code, but the
  fallback for "no relay configured" was silently an optimistic value — a row
  could read `sent` on a workspace with no outbound relay, meaning the candidate
  received nothing.
- **ATS events**: the webhook settings panel had a hand-written footnote
  (`candidate.hired fires today; the others are reserved`) with no code that
  compared the claim against the actual dispatch sites. The footnote drifted: by
  the time `candidate.rejected`, `offer.accepted`, and `offer.declined` had
  gained emit sites, the panel still said they were reserved — and operators who
  had wired those events were told they would not fire.

## Decision

**Every row that makes a delivery or liveness claim must derive that claim from
the code, not from a human-authored label.**

Two concrete applications of the same principle:

### Comms delivery states (`comms-truth.ts`)

A comms row carries one of three terminal states:

| State | Meaning | When |
| --- | --- | --- |
| `sent` | A relay took the message (HTTP 2xx) | Relay configured AND accepted |
| `queued` | Recorded in the outbox; nothing will deliver it | No relay configured |
| `failed` | Relay configured but the send dead-lettered | Relay rejected the message |

`queued` is never a progress state — it is terminal. A workspace with no relay
delivers nothing, and the UI says so in those words rather than using "sent" or
"prepared" language that implies receipt. `bounced` is a post-delivery negative
receipt from the relay provider and maps to `failed` for display.

The `deliveryClaim()` function in `comms-truth.ts` is the single resolver;
no surface may construct a delivery label by any other means.

### ATS webhook event rows (`integrationsCatalog.test.ts`)

A subscribable event row carries a `status` field — `live` or `reserved`:

- **`live`** — the event has at least one `dispatchAtsEvent("<id>")` call
  in the production source tree. A row may not claim `live` if no such site
  exists; the catalog contract test fails in both directions (live row with
  no site = fail; reserved row with an emit site = fail).
- **`reserved`** — the event id is registered so an operator can plan their
  integration before the hook exists, but the panel says clearly it does not
  fire yet.

The test (`integrationsCatalog.test.ts`) walks `app/_lib` and `app/api` for
emit sites on every build, so the claim stays true without a human remembering
to update a footnote.

## Consequences

- **Adding a new comms delivery path** must route through `deliveryClaim()`.
  A catch that falls back to a positive string without going through that
  function is wrong by construction.
- **Adding a new ATS event id** requires adding it to `SUBSCRIBABLE_EVENTS`
  (server) and `SUBSCRIBABLE_EVENT_ROWS` (client) in the same change. Its
  status starts as `reserved`. The catalog test then gates promotion to `live`
  on the existence of a real emit site.
- **Removing an emit site** without removing the event id demotes the row to
  `reserved` automatically — the test catches the stale `live` claim on the
  next build.
- The principle is deliberately narrow: it applies to rows that make a
  binary claim on screen ("fired" / "live" / "sent"). It does not govern
  score display, analysis confidence, or other continuously-valued outputs.

## What would change our mind

- A test infrastructure that can prove delivery end-to-end at the unit level
  (stub transports with tracked calls) would let us replace the status field with
  a live assertion rather than a declared enum. That would be strictly stronger
  than the current approach and would be a reason to extend this ADR, not
  abandon it.
- If the ATS event catalog became large enough that the regex-walk in
  `integrationsCatalog.test.ts` became a maintenance burden, a decorator or
  registration pattern would be a valid replacement — provided it closes the
  same gap (a live claim must resolve to an actual call site).
