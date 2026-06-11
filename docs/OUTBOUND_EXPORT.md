# OUTBOUND_EXPORT — the kp → ATS/relay export contract (E8)

> kp deliberately ships **no per-ATS connectors**. Instead it exposes two
> stable, documented JSON surfaces a thin relay (Zapier/Make/n8n, a serverless
> function, or an ATS's inbound webhook) maps onto any system:
> **push** — the `kp.comm.v1` envelope POSTed for every outbound candidate
> message; **pull** — `GET /api/pipeline` for bulk candidate sync.
> Code: `app/_lib/comms-envelope.ts` (shape, pinned by `comms-envelope.test.ts`),
> `app/_lib/comms.ts` (delivery). Delivery semantics (statuses, retry,
> dead-letter, the recipient contract) live in `docs/COMMS_DELIVERY.md`.

## 1. Push — the `kp.comm.v1` envelope

When `COMMS_WEBHOOK_URL` is set, every candidate-facing message the pipeline
sends is POSTed to that URL as JSON:

```json
{
  "schema": "kp.comm.v1",
  "to": "jana@example.cz",
  "subject": "Offer — Backend Engineer",
  "body": "Hi Jana,\n\n…",
  "kind": "offer",
  "ref": "m-appl-jana-example-cz-job-1",
  "sentAt": "2026-06-11T12:00:00.000Z",
  "candidate": {
    "id": "prof-123",
    "label": "Jana Nová",
    "email": "jana@example.cz",
    "locale": "cs",
    "sourceChannel": "quick-apply"
  },
  "job": { "id": "job-1", "title": "Backend Engineer" },
  "stage": "Offer"
}
```

| Field | Stability | Meaning |
|---|---|---|
| `schema` | always `"kp.comm.v1"` | Version marker. v1 evolves **additively only** (new optional fields); a breaking change bumps the string. Branch on it. |
| `to`, `subject`, `body`, `kind`, `ref` | legacy flat fields | The pre-envelope wire shape, preserved verbatim — a relay written against the old bare payload keeps working. `to` follows the recipient contract (COMMS_DELIVERY §4): a real address when one was captured, else a display-name/id identifier. `ref` is the pipeline entry id for pipeline comms (use it for idempotency/threading); other refs (dev-case, slot) pass through. |
| `sentAt` | always present | ISO timestamp of the send attempt. |
| `candidate` | `null` when `ref` isn't a pipeline entry | `email` is the captured contact (E4) — prefer it over `to` for delivery. `label` is the display name (null when anonymous). `locale` is the language the candidate applied in (`en`/`cs`) — the body is already written in it. `sourceChannel` is the E3/E5 attribution (`apply` / `quick-apply` / `email` / `boards`, null for recruiter-sourced). |
| `job` | `null` when `ref` isn't a pipeline entry | The role the message concerns. |
| `stage` | `null` when `ref` isn't a pipeline entry | Pipeline stage at send time (`Accepted` → `Screened` → `Interview` → `Offer` → `Hired`). |

### Kind vocabulary

Open list (treat unknown kinds as pass-through). The pipeline dispatchers emit:

| `kind` | Fired when |
|---|---|
| `acknowledgement` | An application/lead landed (carries the enrichment link for quick-apply leads). |
| `outreach` | Recruiter outreach draft dispatched. |
| `rejection` | Human or policy reject decision. |
| `offer` | Recruiter extended the drafted offer (body carries the secure response link). |
| `interview_confirmation` | Candidate self-booked a slot. |
| `interview_reminder` | Timed reminder before a confirmed interview. |
| `interview_invite` | AI voice-screen link delivered. |
| `onboarding` | Candidate accepted → Hired. |

Dev-case comms (intake acks, case invites) flow through the same channel with
their own kinds and `candidate: null`.

### Mapping guidance (any ATS)

- **Deliver** to `candidate.email ?? to` (when `candidate.email` is null and
  `to` isn't an address, your directory maps name → address, or you park it).
- **Upsert the person** on `candidate.id` (stable profile id), fall back to
  `ref` (stable per applicant × role).
- **Log an activity** of type `kind` against the person; `job.title` + `stage`
  give the requisition and funnel position; `sourceChannel` feeds your own
  source reports.
- **Idempotency**: kp retries transient relay failures (COMMS_DELIVERY §3), so
  dedupe on (`ref`, `kind`, `sentAt`) if your sink isn't idempotent.
- Respond **2xx** quickly; non-retryable 4xx dead-letters the message on kp's
  side (visible in the Outbox + comms.log).

## 2. Pull — bulk candidate sync

`GET /api/pipeline` returns `{ entries: PipelineEntryView[] }` — the same
contract the kp board renders (single source: `PipelineEntry` in
`app/_lib/db.ts`). Relevant fields for an ATS sync:

```
id, candidateId, candidateLabel, archetype, roleFamily,
jobId, jobTitle, stage, matchScore, status,        // funnel position + outcome
contact, locale,                                   // deliverability (E4)
sourceChannel, sourceCampaign, sourceVariant,      // attribution (E3/E5)
intakeDegraded, intakeDegradedReason,              // thin-lead flag
createdAt, stageChangedAt
```

`status` distinguishes terminal closes: `active` | `rejected` (company-side) |
`declined` (candidate-side). Poll + diff on `stageChangedAt` for incremental
sync; the push envelope above is the realtime complement.

## 3. Compatibility promise

- `kp.comm.v1` and the `PipelineEntryView` field list above only **gain**
  fields within a version; nothing listed here is renamed or removed without a
  version bump (envelope) or a documented migration note (pipeline view).
- The envelope shape is pinned by `app/_lib/comms-envelope.test.ts`; treat that
  test as the executable spec.
