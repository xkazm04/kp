# The KP edge — an answering machine for a studio that is switched off

KP runs on a machine you own. That machine is off most of the day, and three things
cannot wait for it:

- a **webhook** from a job board or ad platform (the sender retries a few times, then
  gives up — a lost lead);
- a **candidate email**;
- a **delivery receipt** for a message that bounced.

This is a ~250-line Cloudflare Worker that accepts those on your behalf, holds them
in order, and hands them to your install the next time it wakes. It also notices when
your install has been quiet while things are waiting, and tells you to start it.

**It holds no truth and no secrets.** No candidate database (the log is deleted as it
drains), no provider keys, no session secrets — one shared HMAC key whose entire
power is "may talk to this queue". Once your install publishes a sealing key, the
Worker cannot even read what it stores: bodies are AES-256-GCM sealed under a key
wrapped to your public RSA key, and the private half never leaves your machine.

It deploys to **your own** Cloudflare account. KP does not host it, cannot see it,
and bills nothing for it. Design and rationale: `../docs/concepts/local-first-edge.md`.

## What it costs

Nothing, at single-operator volume, on Cloudflare's free plan — Workers requests, a
D1 database, a cron trigger and Email Routing are all included. You need a domain on
Cloudflare, which you want anyway for candidate-facing links.

## Deploy

```bash
cd edge
npm install -g wrangler          # or: npx wrangler …
wrangler login

wrangler d1 create kp-edge       # paste the printed database_id into wrangler.toml
wrangler d1 execute kp-edge --remote --file=./schema.sql

# The shared secret. Generate it once and keep the SAME value on both sides.
openssl rand -hex 32             # → copy this
wrangler secret put KP_EDGE_SECRET

wrangler deploy                  # prints https://kp-edge.<your-subdomain>.workers.dev
```

Then, in your install's `.env.local`:

```bash
KP_EDGE_URL=https://kp-edge.<your-subdomain>.workers.dev
KP_EDGE_SECRET=<the same value you just put>
# Optional: where "you have mail" goes. Any endpoint that accepts a POST body —
# an ntfy.sh topic is free and needs no account on either side.
KP_NUDGE_TARGET=https://ntfy.sh/<a-topic-only-you-know>
```

Restart the app. The clock drains the edge and sends a heartbeat on every tick, and
the Channels tab shows the pairing, the cursor and the last error.

Both halves can also be configured in the UI (Channels → Edge) and stored encrypted
under `KP_SECRET`; the env vars win when both are set, exactly like the comms relay.

## Point your sources at it

| Source | Where it goes | What changes |
| --- | --- | --- |
| Board / ad-platform webhook | `https://<worker>/in/<receiver-token>` | Instead of your laptop's URL. Same JSON body; answers **202 `{result:"held"}`** because the eligibility decision has not happened yet. |
| Candidate email | Cloudflare **Email Routing** → this Worker | Route `<receiver-token>@your-domain` to the Worker. Headers only are kept (sender + subject), never the body or attachments. |
| Relay delivery receipts | `https://<worker>/relay/callback` | Bounces recorded even if they arrive at 03:00. |

Receiver tokens come from Channels → Add receiver in the app; the same token works
for both the direct URL and the edge URL, so you can move a source over and back.

## Sealing (recommended)

Publish your install's public key once — the app does this for you when you enable
sealing on the Channels → Edge card, or by hand:

```
POST /pair   {"publicJwk": "…"}      (HMAC-signed, like every install→edge call)
```

From then on every stored body is sealed. Events already stored in cleartext stay
cleartext (re-sealing them would be theatre — they have already been at rest
unsealed), and your install reads both forms.

## The protocol, in full

Install → edge calls are signed: `x-kp-timestamp` (epoch ms, ±5 min) and
`x-kp-signature` = HMAC-SHA256 of `<timestamp>.<signed>` in hex, where `<signed>` is
the request body for a POST and the path+query for a GET. Same scheme as KP's comms
relay and ATS webhook.

| Route | Auth | Purpose |
| --- | --- | --- |
| `POST /in/<token>` | the receiver token itself | Accept a JSON lead → 202 held |
| `POST /relay/callback` | open | Accept a delivery receipt → 202 held |
| `GET /drain?since=&limit=` | signed | Events in sequence order + `pending` |
| `POST /ack {upto}` | signed | Delete applied events; the install is now the record |
| `POST /heartbeat {at,nudgeTarget}` | signed | "I am awake" — resets the nudge |
| `POST /pair {publicJwk}` | signed | Publish the sealing key |
| `GET /status` | open | Liveness + pending count. No candidate data. |

The mirror image lives in `../app/_lib/edge-drain.ts` and `../app/_lib/edge-crypto.ts`.
A change to either side is a change to both.

## What it deliberately does not do

- **No CV attachments.** Mail is stored as headers only, so an emailed CV arrives as
  a lead with a subject line; the acknowledgement's enrichment link turns it into a
  candidate. Carrying attachments means storing the body, which is the one thing this
  design refuses to do.
- **No candidate-facing pages.** A candidate who opens a scheduling link while your
  studio is off still sees nothing. That is L2 in the concept doc (the edge serves a
  signed projection your install publishes) and is not built yet.
- **No decisions.** Nothing here scores, screens, replies or emails. Every one of
  those needs the database and the models, which live on your machine.
