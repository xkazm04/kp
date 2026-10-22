# Built-in SMTP sending (send from your own mailbox)

A keyless owner with no public https relay can still send candidate letters: kp signs in to a
mailbox the owner already has and submits each letter itself over SMTP. It is the second
outbound transport, beside the webhook relay, behind the same capability resolver. The wider
delivery contract (statuses, the send gate, the outbox) is in [comms/README.md](./comms/README.md).

## Entry points

- **Channels tab → Delivery relay level → "Send from your own mailbox"**
  (`app/features/hiring/channels/night/setup/SetupSmtp.tsx`, state in `useSmtpSetup.ts`, pure
  decisions in `smtpSetup.ts`).
- `GET /api/comms/smtp`: the public view (`hasPassword`, never the password), the sender's
  health (`configured | unconfigured | unreadable`) and `active` (`relay | smtp | none`).
- `POST /api/comms/smtp`: save (version-checked, `org:manage`, 30/10 min per IP), or
  `{ "unsuppress": "<address>" }` to take an address off the suppression list.
- `POST /api/comms/smtp/test`: one test letter from the mailbox to the same mailbox, answered
  with the real outcome (`ok`, the server's reply `code` and `text`, the `stage`). `org:manage`,
  20/10 min per IP. Under `KP_NO_COMMS_EGRESS=1` it answers `sealed` and dials nothing.

All three are operator-only, like `/api/comms/relay`.

## Presets

| Preset | Server | Port | Security | Note |
|---|---|---|---|---|
| Gmail | `smtp.gmail.com` | 465 | implicit TLS | Needs an **app password** (Google account, Security, App passwords). The normal password gets a 535. |
| Seznam | `smtp.seznam.cz` | 465 | implicit TLS | Mailbox password, or an app password with two-step sign-in. |
| Office 365 | `smtp.office365.com` | 587 | STARTTLS | The tenant admin may need to allow SMTP AUTH for the mailbox. |
| Other server | typed | typed | TLS or STARTTLS | No plain-text mode is offered or stored. |

A preset fills in host, port and security on the server (`SMTP_PRESETS` in
`app/_lib/comms-smtp-store.ts`), and a host sent beside a preset is ignored. The owner types only
the address and the password. The address is the From of every letter, the login name and the
recipient of the test letter.

## Precedence

`resolveTransport()` (`app/_lib/comms-relay.ts`) answers in this order:

1. `KP_NO_COMMS_EGRESS=1` gives **none**, whatever is configured.
2. **Relay**: `COMMS_WEBHOOK_URL`, then the stored relay.
3. **SMTP**: the stored sender, when host, port, security, address and a decryptable password exist.
4. **None**: the local outbox (`queued`), exactly as before T6.

The relay wins when both are configured. It is the integration someone built on purpose (it can
map `kp.comm.v1` onto an ATS), and an install that already had one keeps delivering the same way.
The card says so (`status.precedence`) rather than implying the mailbox is in use.

`isRelayConfigured()` now means "a letter can leave" (relay or SMTP), so every `sent` / `queued`
claim stays true. The confirm-to-send backlog offer (`comms-backlog.ts`) still keys off the
relay's own health; sending queued letters through SMTP is a separate item (T7).

## Delivery (`SmtpChannel` in `app/_lib/comms.ts`)

The client is `app/_lib/comms-smtp.ts`: `node:net` and `node:tls`, no dependency. It does implicit
TLS or STARTTLS, EHLO, AUTH PLAIN (or LOGIN), MAIL FROM, RCPT TO, DATA with dot-stuffing, and QUIT,
with a 10 s timeout on every step. **AUTH is never sent over a plain connection**: a STARTTLS
server that does not offer STARTTLS is refused before any credential leaves the process.

The message is RFC 5322: a UTF-8 subject as encoded-words, a base64 `text/plain; charset=UTF-8`
body, `Date`, and `Message-ID: <messageId@sender-domain>` (the same delivery identity the outbox
row and the relay envelope carry). It also carries `List-Unsubscribe` and
`List-Unsubscribe-Post: List-Unsubscribe=One-Click`, taken from `buildCommEnvelope` so they match
what the relay receives. Unlike the relay, kp sets these headers on the real message.

| Outcome | Status | Detail on the row |
|---|---|---|
| Server answers 250 after the end-of-data dot | `sent` | none; the reply is on the attempt log |
| 4xx, timeout, network error | retried under `COMMS_RELAY_RETRY` (3 attempts), then `failed` | `smtp 421 at mail: …` |
| 5xx at RCPT or DATA | `failed` at once, address **suppressed** | `bounced: smtp 550 at rcpt: …; <addr> is now on the suppression list` |
| 5xx elsewhere (e.g. AUTH 535) | `failed` at once, no suppression | `smtp 535 at auth: …` |
| Message from another organization | `failed`, nothing dialled | the F-2 sentence naming both org ids |
| No email address on record | `failed`, nothing dialled | `refused: no_address …` |
| Suppressed address | `failed`, nothing dialled | `refused: suppressed …` with the date and code |
| Host resolves to a private address | `failed`, nothing dialled | `smtp no reply at connect: … non-public address` |

A synchronous rejection is `failed`, not `bounced`. In `comms-status.ts`, `bounced` stays the
asynchronous receipt a relay files later, so the outbox vocabulary is unchanged. The host is
resolved at send time, every answer must be public, and the client dials that vetted address
(TLS still checks the name). This is the same SSRF posture as the relay.

## Redaction

- The password is AES-256-GCM at rest through `encryptAtsSecret` (`KP_ATS_SECRET_KEY`, else
  `KP_SECRET`). Without a key, saving a password is refused (`field: "encryptionKey"`).
- No API response carries it. GET and POST return `hasPassword` only, and a refusal returns the
  code plus the `field` it concerns, never the store's prose.
- The save door parses its body apart from the store work and never logs a JSON syntax error,
  because that error would quote the body.
- Every reply text passes through `redactSecrets` twice, in the client and in the channel. The
  password and its base64 forms are stripped from outbox details, the attempt log, the
  dead-letter alert and `comms.log`, even if a server echoes them.
- An undecryptable password (a rotated key, a restore) reads `unreadable` on the card and on the
  wire, is logged once without the password, and sends nothing. Letters queue until the password
  is entered again.

Pinned by `app/_lib/comms-smtp.test.ts` (fake server: the plain path, the STARTTLS refusal,
no AUTH over plain, 4xx and 5xx, timeouts, dot-stuffing, header injection),
`app/_lib/comms-smtp-store.test.ts` (encryption at rest, never logged, presets, precedence, seal),
`app/_lib/comms-smtp-channel.test.ts` (the real send path) and
`app/api/comms/smtp/smtp-route.test.ts`.

## Data model

`comms_smtp_config` (`app/_lib/comms-smtp-store.ts`, its own lazy connection): one row
(`id = 1`) holding preset, host, port, security, address, from name, the encrypted password,
`version`, `owner_org_id` and two bounded JSON lists. `suppressed` holds at most 500 addresses
(normalized to lower case). `attempts` holds the last 10 attempts with outcome, stage, reply code
and text. The suppression list and attempt log are returned only to the owner org's operators.
Tenancy: exempt and org-owned like `comms_relay_config` (`app/_lib/tenancy.ts`), not carried by
an org backup.

## Known gaps

- Mailbox sign-in with OAuth (Google, Microsoft) is not built. Gmail needs an app password.
- STARTTLS over a real TLS handshake is not unit-tested (Node cannot mint a test certificate
  without a dependency). The refusal path is tested.
- Queued letters from before SMTP was set up are not sent automatically (T7).
