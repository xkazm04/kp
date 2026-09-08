# Outbound export — the kp → ATS/relay contract (E8)

> kp deliberately ships no per-ATS connectors. Instead it exposes two stable,
> documented JSON surfaces a thin relay (Zapier/Make/n8n, a serverless
> function, or an ATS's inbound webhook) maps onto any system: **push** — the
> `kp.comm.v1` envelope POSTed for every outbound candidate message; **pull**
> — `GET /api/pipeline` for bulk candidate sync. Code:
> `app/_lib/comms-envelope.ts` (shape, pinned by `comms-envelope.test.ts`),
> `app/_lib/comms.ts` (delivery). Delivery semantics (statuses, retry,
> dead-letter, the recipient contract, relay configuration) live in
> [README.md](./README.md).

## 1. Push — the `kp.comm.v1` envelope

When a relay is configured (env `COMMS_WEBHOOK_URL` or the Channels-tab relay
config), every candidate-facing message is POSTed to it as JSON:

```json
{
  "schema": "kp.comm.v1",
  "to": "jana@example.cz",
  "subject": "Offer — Backend Engineer",
  "body": "Hi Jana,\n\n…",
  "kind": "offer",
  "ref": "m-appl-jana-example-cz-job-1",
  "messageId": "msg-9f2c1a4e",
  "sentAt": "2026-06-11T12:00:00.000Z",
  "candidate": {
    "id": "prof-123",
    "label": "Jana Nová",
    "email": "jana@example.cz",
    "locale": "cs",
    "sourceChannel": "quick-apply"
  },
  "job": { "id": "job-1", "title": "Backend Engineer" },
  "stage": "Offer",
  "listUnsubscribe": "<https://hire.example.com/api/stop/ob-Kx3…>",
  "listUnsubscribePost": "List-Unsubscribe=One-Click"
}
```

| Field | Stability | Meaning |
|---|---|---|
| `schema` | always `"kp.comm.v1"` | Version marker. v1 evolves additively only (new optional fields); a breaking change bumps the string. Branch on it. |
| `to`, `subject`, `body`, `kind`, `ref` | legacy flat fields | The pre-envelope wire shape, preserved verbatim. `to` follows the recipient contract (README §4): a real address when captured, else a display-name/id identifier. `ref` is the pipeline entry id for pipeline comms (idempotency/threading); other refs (dev-case, slot) pass through. |
| `messageId` | additive in v1; always present on a real delivery (null only on the `relay.test` ping) | **The delivery identity.** One id per logical message, sent verbatim on every retry attempt of that message, and mirrored in the `Idempotency-Key` request header. Dedupe on this. It is inside the signed body, so you can verify it rather than trust the header. |
| `sentAt` | always present | ISO timestamp of the send attempt. Constant across the retry ladder (the timestamp is signed), so it is not an attempt counter. |
| `candidate` | `null` when `ref` isn't a pipeline entry | `email` is the captured contact — prefer it over `to` for delivery. `label` is the display name (null when anonymous). `locale` is the candidate's applied language (`en`/`cs`) — the body is already written in it. `sourceChannel` is the attribution (`apply` / `quick-apply` / `email` / `boards`, null for recruiter-sourced). |
| `job` | `null` when `ref` isn't a pipeline entry | The role the message concerns. |
| `stage` | `null` when `ref` isn't a pipeline entry | Pipeline stage at send time (`Accepted` → `Screened` → `Interview` → `Offer` → `Hired`). |
| `listUnsubscribe`, `listUnsubscribePost` | additive in v1; both `null` together, or both set | **The unsubscribe obligation, and it is yours to discharge.** See below. |

### `List-Unsubscribe` — the one thing the relay MUST do

ePrivacy Art. 13(4) requires every commercial message to carry a valid address at which
the recipient can decline further messages; in kp's primary market
§ 7(4)(c) with § 11(2)(a)(4) of the Czech zák. č. 480/2004 Sb. makes failing to do so a
standalone offence, fine up to 10,000,000 Kč (German UWG § 7(2) No. 2 is the same duty).
In mail that address is the `List-Unsubscribe` header (RFC 2369) plus, for one-click,
`List-Unsubscribe-Post` (RFC 8058).

**kp cannot set those headers, and this is deliberate rather than an omission.** kp's
relay abstraction is an HTTP POST of this JSON document to your receiver — there is no
SMTP client and no MIME header seam anywhere in the codebase, and the HTTP request
headers on that POST are a conversation with *you*, not with the recipient's mail client.
Putting `List-Unsubscribe` among them would place the value where no mail agent will ever
read it, which is worse than not shipping it because it looks done.

So the two values travel as data, **pre-formatted exactly as the headers must appear**.
Copy them verbatim onto the message you compose:

```
List-Unsubscribe: <https://hire.example.com/api/stop/ob-Kx3…>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

`listUnsubscribe` is already angle-bracketed per RFC 2369 §2. The URL is a public,
token-authed POST endpoint that records the opt-out and answers 200 — the RFC 8058
requirement — accepts the `List-Unsubscribe=One-Click` form body, and is **idempotent**,
so a provider's unattended POST and a human's click cannot disagree. Both fields are
`null` for an entry-less comm (no candidate identity to opt out) and for an anonymized
entry (already unreachable); they are present-and-null rather than absent, so a receiver
can read them unconditionally. A receiver that only knows the legacy flat shape ignores
them, as with every other additive v1 field.

The body of every candidate letter also carries a human-readable link to the same
`/stop/<token>` page, `?lang=`-pinned to the language the letter is written in. The
header is what a mail client offers; the footer is what a person clicks. Full mechanics:
[README.md §7b](./README.md).

### Kind vocabulary

Sourced from a single test-enforced list (`comms-envelope.ts`:
`KNOWN_COMM_KINDS`) — `comms-envelope.test.ts` greps every `kind: "…"` passed
to `sendComm`/`sendCandidateComm` in `comms-dispatch.ts` and asserts set
equality, so this list cannot silently drift from the dispatchers:

`acknowledgement`, `outreach`, `rejection`, `ko_decline`, `offer`,
`offer_reminder`, `interview_confirmation`, `interview_reminder`,
`interview_invite`, `interviewer_brief`, `schedule_invite`.

(`onboarding` and `onboarding_reminder` were retired with the post-hire
onboarding module. A relay may still receive them from an outbox replay of
historical rows — the list is documentation, not enforcement, and unknown kinds
pass through.)

Treat unknown kinds as pass-through (dev-case comms flow through the same
channel with their own kinds and `candidate: null`).

### Mapping guidance (any ATS)

- **Deliver** to `candidate.email ?? to` (when `candidate.email` is null and
  `to` isn't an address, your directory maps name → address, or you park it).
- **Upsert the person** on `candidate.id` (stable profile id), fall back to
  `ref` (stable per applicant × role).
- **Log an activity** of type `kind` against the person; `job.title` + `stage`
  give the requisition and funnel position; `sourceChannel` feeds your own
  source reports.
- **Idempotency**: kp retries transient relay failures (README §3), and an
  attempt that timed out or lost its connection MAY already have been accepted
  by you. Dedupe on `messageId` (equivalently, the `Idempotency-Key` header):
  it is constant across every attempt of one message and unique across
  messages. Answer the repeat with the original outcome. (`ref` is the pipeline
  entry, shared by every message about that candidate — it is not an identity.)
- Respond **2xx** quickly; a non-retryable 4xx dead-letters the message on
  kp's side (visible in the Outbox + `comms.log`). Each attempt is abandoned
  after **10s** (`KP_COMMS_RELAY_TIMEOUT_MS` overrides), so a connection you
  accept and then hold open is dead-lettered as `timeout after 10000ms` rather
  than stalling the recruiter's click.

### The `kp.ats.v1` envelope beside it

`app/_lib/ats-webhook.ts` is the second sender built on this file's signing helpers — the
lifecycle webhook (`candidate.hired` / `candidate.rejected` / `offer.accepted` /
`offer.declined`), documented in full in
[../integrations/README.md](../integrations/README.md#ats--hris-write-back-outbound). It
now carries the same idempotency contract as `kp.comm.v1` above: an `Idempotency-Key`
header mirrored into the body as `idempotencyKey` (the delivery-ledger row id), constant
across every attempt, with `sentAt` frozen at the delivery's creation so a redelivery is
byte-identical. The one difference from the comm envelope: the ATS ladder reaches ~30
minutes, so `X-Kp-Timestamp` (the SIGNED instant) is re-stamped per attempt while `sentAt`
stays put — freezing both would push every late retry outside the 300-second verification
window. `sentAt` is therefore not a signature input there and the two fields are equal only
on the first attempt.

## 2. Pull — bulk candidate sync

`GET /api/pipeline` returns `{ entries: PipelineEntryView[] }` — the same
contract the kp board renders (single source: `PipelineEntry` in
`app/_lib/db.ts`). Relevant fields for an ATS sync:

```
id, candidateId, candidateLabel, archetype, roleFamily,
jobId, jobTitle, stage, matchScore, status,        // funnel position + outcome
contact, locale,                                   // deliverability
sourceChannel, sourceCampaign, sourceVariant,      // attribution
intakeDegraded, intakeDegradedReason,              // thin-lead flag
createdAt, stageChangedAt
```

`status` distinguishes terminal closes: `active` | `rejected` (company-side) |
`declined` (candidate-side). Poll + diff on `stageChangedAt` for incremental
sync; the push envelope above is the realtime complement.

## 3. Compatibility promise

- `kp.comm.v1` and the `PipelineEntryView` field list above only **gain**
  fields within a version; nothing listed here is renamed or removed without
  a version bump (envelope) or a documented migration note (pipeline view).
- The envelope shape is pinned by `app/_lib/comms-envelope.test.ts`; treat
  that test as the executable spec.
