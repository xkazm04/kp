# Connect — the connector catalog

One server-side catalog of everything kp can talk to, with **one health vocabulary**.
Code: `app/_lib/connect/` (`catalog.ts`, `probes.ts`); API: `GET /api/connect`.
The hub UI that mounts it is a later change (comms channels scope C5); nothing under
`app/features/` reads it yet.

## Rows

| id | what | egress class | saved by |
| --- | --- | --- | --- |
| `comms_relay` | outbound delivery relay | `candidate_message` | `/api/comms/relay` (or `COMMS_WEBHOOK_URL`) |
| `ats_webhook` | outbound ATS mirror webhook | `candidate_record` | `/api/ats/config` |
| `calendar` | Google Calendar free/busy (per workspace) | `schedule_read` | the OAuth landing |
| `ats_inbound:<provider>` | inbound ATS connection (`recruitee`, `recruitis`, `teamio`) | `credentialed_read` | `/api/ats/connections` |

The catalog is **data over existing stores**: each row's fields are read from the store that
already keeps them. It holds no credential and adds no table. A secret field is write-only
exactly as in its store: the row carries `hasSecret`, never a value.

```jsonc
{ "id": "ats_inbound:recruitee", "label": "...", "egress": "credentialed_read",
  "fields": [ { "key": "baseUrl", "secret": false, "value": "https://…" },
              { "key": "apiToken", "secret": true, "hasSecret": true } ],
  "health": "unverified", "lastOkAt": null, "lastFailure": null }
```

## Health words

Exactly one per row, decided in this order:

1. `sealed` — `egressSealed()` (`KP_NO_COMMS_EGRESS=1`). Every row, whatever is configured.
2. `not_configured` — nothing saved (keyless: every row).
3. `failing` — the store itself knows it is broken (revoked or undecryptable calendar grant,
   unreadable relay signing secret), or the last probe against the current configuration failed.
4. `unverified` — saved, but no probe has run against this configuration. A re-save, or a
   process restart, returns a row here.
5. `connected` — the last probe against the current configuration succeeded.

`lastOkAt` / `lastFailure` come from the probe memory (below) or, for the calendar grant, from
the health the calendar edge already records (`healthAt`).

## Probe contract

`probe*()` in `probes.ts` returns one of `sealed | not_configured | http{ok,status} | failed{reason}`
and never throws. Every probe checks the seal first, so a sealed process makes **0 network calls**.

- `probeRelay()` / `probeAtsWebhook()` — the signed test pings that `POST /api/comms/relay/test`
  and `POST /api/ats/test` used to hold inline; those routes now call them and keep their responses.
- `probeAtsInbound(provider)` — an authenticated, read-only `GET` of the connection's base URL.
  SSRF-vetted (https, public host, resolved), redirects are not followed, the body is dropped.
- `probeCalendar(ws)` — a 1-hour free/busy read through the existing calendar edge. `null`
  (unknown) is a failure, never a free hour.

`probeConnector(id, ws)` runs one and records the verdict. `GET /api/connect` never probes.

## Probe memory

No schema. Verdicts live in a bounded in-process map (512 entries) keyed by workspace and
connector and stamped with the configuration version they ran against. After a restart every
configured row reads `unverified` until probed again.

## Gating

`GET /api/connect` is operator-only (`requireOperator`) inside `withWorkspace`, like the
settings routes it summarizes.

## Known gaps

- No route triggers `probeConnector` yet (the hub, C5, will); durable `lastOkAt` across
  restarts needs a column and waits for the operator.
- Slack, Teams, Greenhouse and Lever rows are not here (S1 excluded; S3 follows S2).
