---
id: "0028"
title: Every channel shares one message identity and one egress seal, and a person releases what reaches a candidate
status: accepted
date: 2026-10-17
supersedes: []
superseded-by: null
tags: [comms, channels, egress, idempotency, human-in-the-loop, keyless]
sources:
  - app/_lib/egress-seal.ts
  - app/_lib/comms.ts
  - app/_lib/comms-view.ts
  - app/_lib/comms-relay.ts
  - app/_lib/ats-delivery-store.ts
  - app/_lib/pull-pass.ts
  - app/_lib/calendar/edge-fetch.ts
---

**Status: accepted, partially implemented.** Only the egress seal (C3) has landed
(`d588df42a`). The message identity (C1) and the human release (C2) are decided and
**pending**; the rest is the approved build order, not the state of the code.

## Context

The operator approved a communication-channels scope on 2026-10-17 (the scope file is
gitignored, so its points are restated here). Three defects motivate it:

- **Two identities for one message.** `sendComm` mints a `messageId` (`app/_lib/comms.ts`,
  "the DELIVERY IDENTITY"), but `dev_outbox` has no `message_id` column
  (`app/_lib/db/core.ts`). A delivery receipt is therefore matched to its send by the
  heuristic in `app/_lib/comms-view.ts` (the receipt "cannot say WHICH send of that kind
  bounced"), not by the row it belongs to.
- **A seal that covered one boundary.** `KP_NO_COMMS_EGRESS=1` sealed only the comms relay;
  ATS delivery, calendar, the pull pass and both probes still dialled out.
- **Release authority was implicit.** Nothing says that a message affecting a candidate is
  released by a named person, or that a chat channel may never be that person.

## Decision

### 1. One message identity (C1 - decided, pending)

The `messageId` that `sendComm` mints is persisted on `dev_outbox.message_id`. Receipts
match that exact row instead of the time-window heuristic in `comms-view.ts`. A delivered
receipt stamps a last-delivered time. A resend reuses the id and the `Idempotency-Key`
(the ATS side already keys on the row id, see `app/_lib/ats-delivery-lease.test.ts`).

### 2. One egress seal (C3 - landed in `d588df42a`)

The predicate is a shared gate, `egressSealed()` in `app/_lib/egress-seal.ts`, promoted
from a relay-private check. Relay send, ATS delivery, calendar calls, the pull pass and
both probe routes check it before the network, and so does every future connector. With
`KP_NO_COMMS_EGRESS=1` they make 0 calls. A sealed boundary answers its own "no
information" shape, never a failure: a sealed ATS delivery stays queued (no attempt
spent), a sealed calendar read is unknown, a sealed pull skips, a probe says `sealed`.
`sealed` is distinct from `not configured`, and the hub must show the two apart. It is
deliberately not `KP_OFFLINE`, which would also cut the Claude CLI.

### 3. Human release (C2 - decided, pending)

Every candidate-affecting message is human-approved through a revision-bound
compare-and-swap that names the approver. First outreach drafts instead of sending.

### 4. Bounded services

No paid APIs and no service beyond Slack, Teams, Greenhouse and Lever. Each channel reads
`not configured` and falls back to `dev_outbox`, so the two-minute local start stays
keyless. Credentials stay server-side under AES-GCM and the API returns `hasSecret` only.
Chat payloads never carry candidate names, contacts, letter bodies or capability tokens,
and chat holds no approval authority.

### 5. Build order

C1, C3 -> C4 -> C5; C1 -> C2 -> C6 -> L1; C3 + C4 -> S1, S2 -> S3.

## Alternatives that lost

- **Storing the outreach draft on `entry.automation`.** It would share state with the
  screening and offer gates.
- **Interactive chat approval buttons.** They need a public callback URL a local install
  lacks, and cannot name a kp user on a keyless start.
- **Resumable outreach waves now.** Premature before any wave is gated.

## Consequences

- A new outbound connector must call `egressSealed()` before its network call; one that
  does not reopens the hole C3 closed.
- Until C1 lands, receipt matching stays heuristic; do not build on it as exact.
- Until C2 lands, this record is accepted for the decision and partial for the build;
  update the state as each step ships.
- Reopen if: a local install gains a public callback URL and a way to name a kp user
  keylessly, which removes the reason chat approval lost.
