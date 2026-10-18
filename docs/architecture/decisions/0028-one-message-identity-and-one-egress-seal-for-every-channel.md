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
  - app/_lib/comms-receipt.ts
  - app/_lib/db/outreach-letters.ts
  - app/_lib/outreach-release.ts
  - app/_lib/automation-run.ts
  - app/api/outreach-letters/[id]/route.ts
---

**Status: accepted, partially implemented.** Landed on main: the egress seal (C3,
`d588df42a`), the message identity (C1, `c578b7704` and its follow-ups) and the
server half of the human release (C2a, `d0c1d1345`..`9987b30f3`) and the per-candidate
release card (C2b, first half, `02840920d`). **Decided, not built:**
the bulk dry-run sheet (C2b, second half), then C4, C5, C6, S2, S3, L1 and L2 in the
build order below.

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

### 1. One message identity (C1 - landed)

The `messageId` that `sendComm` mints is persisted on `dev_outbox.message_id`. Receipts
match that exact row instead of the time-window heuristic in `comms-view.ts`. A delivered
receipt stamps a last-delivered time. A resend reuses the id and the `Idempotency-Key`
(the ATS side already keys on the row id, see `app/_lib/ats-delivery-lease.test.ts`).

What landed: `c578b7704` adds the nullable `dev_outbox.message_id` column and an index
(`app/_lib/db/core.ts`), has `sendComm` store the id, and matches receipts to the row by
exact id (`app/_lib/comms-receipt.ts`, `app/_lib/comms-view.ts`, the callback route). The
red-first tests are `748940d57` and `3bc7d0dec`. Hardening that followed: `defd1ad63` (the
resend door refuses a relay receipt row), `cef1e3841` (the relay probe vets its target
with the delivery's resolved guard), `0bc49d90e` (the callback refuses a receipt for
another org's ref) and `f6f0deb2a` (an exact-id delivered receipt no longer stamps a
queued row, only sent or failed ones). Rows written before the column existed have a
null `message_id` and keep the old heuristic.

### 2. One egress seal (C3 - landed in `d588df42a`)

The predicate is a shared gate, `egressSealed()` in `app/_lib/egress-seal.ts`, promoted
from a relay-private check. Relay send, ATS delivery, calendar calls, the pull pass and
both probe routes check it before the network, and so does every future connector. With
`KP_NO_COMMS_EGRESS=1` they make 0 calls. A sealed boundary answers its own "no
information" shape, never a failure: a sealed ATS delivery stays queued (no attempt
spent), a sealed calendar read is unknown, a sealed pull skips, a probe says `sealed`.
`sealed` is distinct from `not configured`, and the hub must show the two apart. It is
deliberately not `KP_OFFLINE`, which would also cut the Claude CLI.

### 3. Human release (C2 - C2a and the C2b release card landed, bulk sheet pending)

Every candidate-affecting message is human-approved through a revision-bound
compare-and-swap that names the approver. First outreach drafts instead of sending.

**Constraint that forced the design.** A named human releases every message that
affects a candidate, and the keyless start must keep working: no key, relay or
service may be needed to draft, approve and release (keyless the release is `queued`
in the local outbox).

**C2a, landed.** A dedicated `outreach_letters` store (`d0c1d1345`,
`app/_lib/db/outreach-letters.ts`, DDL in `core.ts`) holds a first-contact draft, one row
per application, with a revision and the `message_id` minted at draft time. Approve is a
CAS on id, team, revision and `drafted`, naming the approver, and a stale revision is
refused (`app/api/outreach-letters/`, `59044dda9`). Release goes through the ordinary
send path under the drafted message id (`59044dda9`, `app/_lib/outreach-release.ts`), so C1
and C2 share one identity from draft to receipt. Every outreach door (the drawer task,
batch outreach, sourcing Reach-out) now holds the letter and sends nothing
(`804bfa671`, `app/_lib/automation-run.ts`). Erasure blanks a held letter's subject and
body (`1dd5e199c`). The behaviour is documented in `docs/features/comms/README.md` §8a
(`e4d319c3c`).

**Alternatives that lost.** Staging the draft on `entry.automation` would share state
with the screening and offer gates, so a gate write could clobber a draft and the reverse.
A resumable wave worker is premature while no wave is gated.

**What the security scan found.** Scan `4b3553a4` found one release defect, fixed in
`9987b30f3`: a release that dead-lettered leaves a failed outbox row that the resend door
re-sends under the same message id, recording no `outreach_sent` marker, so a later
release delivered the first contact twice. The release now closes the letter as
released when a sent or queued outbox row already carries its message id. Related
test hygiene: `c12e70121`.

**C2b release card, landed** (`02840920d`). The candidate drawer renders the exact letter,
its forecast and state, Approve (the rendered revision) and Release, so a held letter is
releasable in the product. **C2b bulk dry-run sheet, decided and not built.**

### 4. Bounded services

No paid APIs and no service beyond Slack, Teams, Greenhouse and Lever. Each channel reads
`not configured` and falls back to `dev_outbox`, so the two-minute local start stays
keyless. Credentials stay server-side under AES-GCM and the API returns `hasSecret` only.
Chat payloads never carry candidate names, contacts, letter bodies or capability tokens,
and chat holds no approval authority. These rules bind any chat channel that is ever
approved; none is approved today.

### 5. Build order

C1, C3 -> C4 -> C5; C1 -> C2 -> C6 -> L1; C3 + C4 -> S2 -> S3; C1 + C5 -> L2.

S1 (a Slack and Teams desk for the hiring team) was excluded by the operator on 2026-10-17: Slack and Teams remain permitted services, but no chat channel is built.

## Alternatives that lost

- **Storing the outreach draft on `entry.automation`.** It would share state with the
  screening and offer gates.
- **Interactive chat approval buttons.** They need a public callback URL a local install
  lacks, and cannot name a kp user on a keyless start.
- **Resumable outreach waves now.** Premature before any wave is gated.

## Consequences

- A new outbound connector must call `egressSealed()` before its network call; one that
  does not reopens the hole C3 closed.
- Receipt matching is exact for rows that carry a `message_id`; older rows stay heuristic.
- A new door that contacts a candidate for the first time must write a held letter and
  not call `sendComm`; one that does reopens what C2a closed.
- Until the bulk dry-run sheet lands, batch outreach has no bulk release: each letter is
  released one by one from its drawer; update this state as each step ships.
- Reopen if: a local install gains a public callback URL and a way to name a kp user
  keylessly, which removes the reason chat approval lost.
