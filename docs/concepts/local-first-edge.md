# Local-first KP with a costless edge — the middle ground between "laptop" and "SaaS"

Status: **L0 and L1 SHIPPED** (2026-08-22); L2–L4 remain proposals. What is built
is documented as behaviour in `docs/features/comms/README.md` §11 (contracts,
known gaps), `docs/architecture/self-hosting.md` §7b (egress, threat model) and
`edge/README.md` (deploying the Worker). This document stays the DESIGN: the
reasoning, the rungs not yet climbed, and the registry path. Deviations taken
during the build are recorded in §11.

The architecture it fixes: how a self-hosted, laptop-run KP keeps the power of local execution (local
LLM CLIs on a subscription, connector keys that never leave the machine, one
SQLite file of truth) **and** still behaves like an always-on service where it
must — inbound events, candidate-facing pages, and a nudge when work has piled
up — without reintroducing a hosted SaaS in the path. It also fixes the path by
which this pattern is forged into the AI registry (`../../../ai-registry`) so
other apps can follow it, the README changes that turn it into a supported setup,
and the `/onboarding` skill that walks a newcomer through every dependency.

Related, already shipped: `docs/architecture/self-hosting.md` (container, egress
inventory, `KP_OFFLINE`), `docs/features/comms/README.md` (relay, outbox truth,
inbound receivers), `docs/features/pipeline/README.md` (scheduler heartbeat).

---

## 1. The constraint, stated precisely

"Local-first breaks when the device is off" is too coarse. Walk the product and
only **three** classes of work actually need the machine to be on at a moment the
operator does not choose:

| Class | Examples in KP today | Why it cannot wait |
|---|---|---|
| **A. Inbound pushes that do not wait** | Board/ATS webhooks and the relay's delivery receipts (`app/api/channels/inbound/[token]/route.ts`, `app/api/comms/callback`) | The sender retries a few times, then gives up. A missed POST is a lost lead or a lost bounce. |
| **B. Candidate-facing pages** | `schedule/[token]`, `status/[token]`, `apply/[id]`, `interview/[token]` | Hit by *candidates*, on their clock. A dead link at 22:00 is the worst first impression a hiring process can make. |
| **C. Proactive nudging** | nothing yet | Nobody tells the operator that 3 applications and a bounce arrived while the studio was closed. |

Everything else — LLM triage, scoring, decision passes, comms composition,
devcase evaluation, analytics — is **operator-paced**. It tolerates hours of
latency, and it is exactly the work where the local Claude CLI + local keys is
the strongest possible engine (subscription-billed, no key custody, no egress
beyond the provider). **Email ingestion is not in class A**: a mailbox is already a
durable queue; polling it on wake loses nothing.

So the design rule is: **do not move compute to the cloud; move buffering and a
read-only projection there.** The cloud layer's entire job is to be a good
answering machine.

## 2. The architecture

```
candidates / boards / mail ──▶  EDGE (store-and-forward, costless)       LOCAL (source of truth)
                                ├ inbound log   (append-only, signed)  ─drain─▶ SQLite, automation pass,
                                ├ heartbeat     + push nudge                    Claude CLI, every key
                                ├ public projection (signed per-token   ◀─publish─ snapshot of the
                                │   snapshots; serves class-B pages)             public surfaces
                                └ outbound relay (what resolveRelay already targets)
```

Four rules keep it honest and keep it local-first rather than "SaaS with a
laptop attached":

1. **The edge holds no secrets** except one per-tenant HMAC key. The existing
   `x-kp-signature` scheme (relay + ATS webhooks, `app/_lib/comms-relay.ts`,
   `webhook-idempotency.ts`) becomes the envelope signature in both directions.
   Provider keys, calendar tokens, the decision-chain HMAC key, `KP_SECRET`: never
   leave the local host.
2. **The edge holds no truth.** It is a log plus a projection. Local SQLite stays
   canonical; on wake, local drains the log in order and reconciles. Every edge
   row carries a nonce and a monotonic sequence, so the drain is idempotent and
   resumable (the same rule `webhook-idempotency.ts` already states: idempotency
   persists only for work that succeeded).
3. **PII at the edge is ciphertext.** The apply page encrypts CV uploads in the
   browser to the local install's public key (the edge serves the key, never
   holds the private half). The edge cannot read CVs — which is fine, because
   reading CVs is LLM work and LLM work is local by design.
4. **The honesty vocabulary is extended, never bent.** `queued` / `sent` /
   `failed` (`docs/features/comms/README.md` §status) gains siblings:
   `held-at-edge` (candidate action or inbound event buffered, local not yet
   seen it) and `deferred-to-local` (edge acknowledged, decision pending the
   studio). Candidate copy says "we've received your pick — confirming shortly",
   never a green lie. Same `one-authority-per-vocabulary` discipline as today.

**The unification that makes this worth doing:** the hosted KP becomes *the same
edge plus KP running the "local" runtime for you* in a container. One code path,
where the local runtime is the user's laptop, a home box, or a hosted container.
Onboarding convenience (SaaS) and OSS power stop being two products — the edge
is identical, only the owner of the runtime differs.

## 3. The ladder — each rung ships on its own

| Rung | What | Cost | Closes |
|---|---|---|---|
| **L0 — pull on wake** ✅ | Pull sources on the scheduler tick, through the shared intake core | 0 | board/bridge ingestion (late but complete) |
| **L1 — mailbox + heartbeat + nudge** ✅ | Cloudflare Worker: inbound receiver + Email Routing → D1 log; signed drain/ack; heartbeat from the clock; cron nudge to ntfy/webhook | 0 (free tier) | class A, class C |
| **L2 — public projection** | local publishes signed per-token snapshots; edge serves `schedule/status/apply`, appends candidate actions with a tentative confirmation; local reconciles | 0 | class B |
| **L3 — deterministic edge subset** | port the keyless fallbacks: ack templates, receiver-token routing, per-IP limits, dedupe | 0 | immediate acks |
| **L4 — cloud brain (opt-in)** | (a) the user's own scheduled Claude Code cloud agent works the edge queue on their subscription; (b) BYO provider key at the edge (reintroduces custody — opt-in only); (c) hosted KP | user's | offline LLM work |

Recommendation: **build L1 + L2 on Cloudflare**, skip L4(b), describe L4(a) as the
on-brand offline-LLM answer. And state the cheap escape hatch plainly in the
README: local-first ≠ laptop — a Raspberry Pi / NAS / always-on mini-PC running the
same `next start` collapses the whole problem, and the Docker image already exists.

### 3.1 L0 — pull on wake (local only)

- On `register()` in `instrumentation.ts` (after the egress guard), and on each
  `tickScheduler` (`app/_lib/scheduler.ts`), run a **pull pass** before the
  automation pass: poll configured pull sources (IMAP mailbox for the Email
  intake channel, any board API that supports listing) and feed results through
  the same `intakeLead` / `ingestCvApplication` core the inbound receiver uses
  (`app/_lib/lead-intake.ts`, `app/_lib/cv-intake.ts`). Nothing new in the
  domain; only a new *source* of the same events.
- Gap it leaves: webhooks (lost), candidate pages (down), nudges (none).

### 3.2 L1 — the edge as answering machine

**Edge side** (one Worker, one `wrangler.toml`, deployable to the user's own
Cloudflare account — "your infra, someone else's electricity"):

```
edge/
├── wrangler.toml           # name, D1 binding `kp_edge`, routes, cron, email handler
├── src/index.ts            # fetch(): POST /in/<token> (webhook) · POST /relay/callback
│                           #          GET  /drain?since=<seq> (local pulls, signed)
│                           #          POST /heartbeat          (local pushes, signed)
│                           #          POST /ack?upto=<seq>     (local confirms)
│                           # email(): Email Workers handler → log row {kind:"mail", raw}
│                           # scheduled(): cron → if unread>0 && now-lastSeen>N → nudge
└── schema.sql              # events(seq, tenant, kind, nonce, received_at, body, acked)
                            # tenants(id, hmac_key_id, last_seen_at, nudge_target, nudge_cooldown_until)
```

- **Auth**: every local↔edge call is HMAC-signed with the tenant key + timestamp +
  nonce (the `comms/callback` receipt guard, reused). Inbound webhooks use the
  existing CSPRNG receiver tokens (`app/_lib/db/channels.ts`) — the edge validates
  the token against the tenant's published token list (itself a signed, public
  projection: token → job id + open/closed; nothing else).
- **Email**: Cloudflare **Email Routing** delivers `<token>@<your-domain>` to the
  Worker's `email()` handler; the Worker stores the raw MIME as a log row. This is
  precisely what `EMAIL_INBOUND_DOMAIN` promises today and cannot deliver without
  a mail provider — the edge *is* the mail provider now.
- **Heartbeat**: the app POSTs `{at, version, unreadSeen}` from the scheduler
  heartbeat. The Worker's cron (free) computes `unread = count(events where
  seq > lastAckedSeq)` and, past the threshold and outside a cooldown, pushes a
  nudge: **ntfy.sh** topic (free, self-hostable), **Web Push** (VAPID, free — the
  operator subscribes from the Getting-started card), or plain email via the
  same Email Routing. The nudge says *what* is waiting ("3 applications, 1
  bounce") and deep-links to the Channels tab — `proactive-nudges` discipline:
  one identity per nudge, cooldown, quiet window.
- **Drain**: `GET /drain?since=<seq>` returns events in order; local applies each
  through the existing cores inside one IMMEDIATE transaction per event, records
  the nonce, then `POST /ack?upto=`. A crash mid-drain replays from the last ack —
  idempotent by the nonce.

**Local side** — the seams already exist, the deltas are small:

| Seam | Today | Delta |
|---|---|---|
| `app/_lib/comms-relay.ts` `resolveRelay()` | env → stored config → nothing | edge URL becomes the third fallback; a configured edge *is* a relay (outbound envelopes POST to `/relay/out`, the edge forwards to the operator's mail provider or holds them) |
| `app/api/channels/inbound/[token]` | the public receiver *is* the app route | the route stays (direct mode); a new `app/_lib/edge-drain.ts` client consumes the same payloads from the edge log |
| `instrumentation.ts` + `scheduler.ts` | heartbeat → automation pass | heartbeat → `drainEdge()` → heartbeat POST → automation pass |
| `app/_lib/auth/public-routes.ts` | allow-list of open routes | `/api/edge/*` is **not** public — the drain is outbound from local; nothing new opens on the local host |
| `.env.example` | — | `KP_EDGE_URL`, `KP_EDGE_TENANT`, `KP_EDGE_SECRET` (or stored, encrypted under `KP_SECRET`, editable on the Channels tab next to `ChannelsRelayConfigCard`), `KP_NUDGE_TARGET` |
| Channels tab | relay card, receivers list | an **Edge card**: connected / last drain / unread at edge / nudge target; receivers show both the direct URL and the edge URL |
| `docs/features/comms/README.md` status table | `queued`/`sent`/`failed` | + `held-at-edge`, `deferred-to-local`, with the same "is this terminal?" column |

Rate limiting: the **edge** now fronts the public receiver, so per-IP / per-token
limits are enforced there first (Worker-side counters in D1/DO). The local
`rateLimit()` call sites stay as defense in depth, and
`app/api/rate-limit-contract.test.ts` must pin the new edge-drain path
deliberately (it spends no money, but it spawns the CV extraction subprocess on
drained file events — so it keeps a limiter).

### 3.3 L2 — the public projection

What the edge needs to serve the class-B pages **without a database of truth**:

- **Published snapshot per token**, signed by local, written on every change
  (invite created, slot booked, status changed, job closed): exactly the fields
  `publicInviteView` and its siblings already allow-list — the projection rule is
  "what the public route would have returned", serialized ahead of time.
  `schedule/[token]` is then a static-ish page hydrated from
  `/projection/<token>`; `status/[token]` the same; `apply/[id]` needs only the
  job's public card + the open/closed bit + the KO-step definitions.
- **Candidate actions** (slot pick, apply submit, status ack) append to the
  event log with `held-at-edge`, and the page shows the tentative state ("held
  for you — confirming"). Local drains, applies through `actOnPipelineEntry` /
  the schedule store inside an IMMEDIATE transaction, detects collisions (two
  candidates held the same slot while the studio was closed → second gets the
  existing "slot taken, pick again" path), then re-publishes the snapshot; the
  edge flips the page to confirmed. Honest delay, no double-booking.
- **Voice interviews stay out of scope** for L2: `interview/[token]` needs a live
  realtime provider and the local key broker; the edge serves a "studio offline —
  reschedule" page for it.

Projection security (`sync-replication/projection-security` in the registry):
the edge serves only what a logged-out candidate could already fetch today;
internal ids stay off the wire (existing convention); snapshots expire with the
token.

### 3.4 L3 — deterministic subset at the edge

The codebase's "degrades gracefully keyless" property makes this portable by
construction: the deterministic fallbacks of the ack/routing paths have no LLM
and no secrets, so they can run in the Worker: immediate acknowledgement emails
from the existing templates (`compose-at-the-locale-layer` — templates ship as
part of the published projection, in the candidate's locale), receiver-token
routing, KO-step evaluation for the apply form (pure functions in
`app/_lib/apply.ts`). Anything touching an LLM, a score, a decision, or a CV body
stays `deferred-to-local`.

### 3.5 L4 — cloud brain, three honest options

- **(a) User's own scheduled cloud agent.** A Claude Code scheduled routine on the
  operator's subscription, given read access to the edge queue and the public
  projection, producing *proposed* decisions into the log; local applies them on
  wake through the same human-approval gates the automation pass already has.
  No key custody by KP, no new infra — and entirely on-brand for "the LLM CLI is
  the engine".
- **(b) BYO provider key at the edge.** Works, but reintroduces key custody at
  the edge — opt-in only, clearly labelled, and never the default.
- **(c) Hosted KP.** The edge + a KP-run container. Same code, as above.

## 4. Threat model, briefly

- Edge compromise yields: the inbound log (lead JSON, raw mail — PII), the
  projection (already public per token), the per-tenant HMAC key (can forge
  events → local still applies them through the same validation doors and the
  same approval gates), ciphertext CVs (unreadable). It does **not** yield any
  provider key, calendar token, decision-chain key, or the database.
- Mitigations that are free: encrypt lead JSON bodies the same way as CVs (the
  edge needs only the token + a size for routing); short retention on acked rows
  (`data-retention`); nudge payloads carry counts, never names.
- Residual: the edge *sees* raw inbound mail before encryption. Stating this in
  `self-hosting.md` §egress inventory is required; an operator with a strict
  residency need chooses the region-pinned Worker or stays at L0.

## 5. What it costs

All of L1–L3 fits Cloudflare's free tier for a single-operator install, per the
current published limits (Workers 100k requests/day, 10 ms CPU; KV 1 GB / 100k
reads / 1k writes per day; D1 5 GB / 5M row reads / 100k row writes per day;
Durable Objects on the free plan with SQLite storage; cron triggers included;
free-plan Workers are limited to 50 external subrequests per invocation). Queues
are the one binding to check against the current free allowance before relying
on them — the log is in D1 precisely so Queues are optional. Email Routing is free
on a zone the operator owns. Sources: [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[Durable Objects free tier changelog](https://developers.cloudflare.com/changelog/2025-04-07-durable-objects-free-tier/),
[2026 subrequest limits changelog](https://developers.cloudflare.com/changelog/2026-02-11-subrequests-limit),
[free-tier overview](https://www.srvrlss.io/provider/cloudflare/).

The only thing that is not free is a domain, and the operator needs one anyway
for candidate links. ntfy.sh is free (and self-hostable); Web Push is free.

## 6. Registry path — forging this as a pattern other apps can follow

The AI registry (`C:\Users\kazda\kiro\ai-registry`, `knowledge/software-engineering/`)
already holds the neighbours this pattern composes: `sync-replication`
(projection-security, conflict policy), `webhook-ingestion` (ingress topology,
dedup), `delivery-guarantees` (atomic claiming, non-delivery ledgers),
`outbound-notifications`, `proactive-nudges`, `credential-vault`
(brokered-egress). What it lacks is the **composition** — the decision of what
must be online vs what can wait, and the "edge holds no truth, no secrets"
contract. That is one new subject, forged per `docs/forge-brief.md`:

```
bundle:      software-engineering
category:    backend-platform / data-layer          (4 subjects today; room under the cap)
subject:     local-first-edge
definition:  Keeping a single-operator app's truth and compute on a device the
             operator owns while a costless store-and-forward edge answers for it
             when the device is off — for inbound events, public pages and nudges.
techniques:  capability-partition            (the three classes; what may wait)
             store-and-forward-edge          (log + projection; no truth, no secrets)
             heartbeat-and-wake-nudge        (presence, thresholds, cooldown, deep link)
             signed-public-projection        (publish the allow-listed view ahead of time)
             drain-and-reconcile             (ordered, idempotent, transactional apply; collisions)
             deferred-state-vocabulary       (held / deferred siblings; no green lie)
laws:        failure-not-empty-success, one-authority-per-vocabulary, identity-survives-reuse
applications (cite this repo freely):
             node--store-and-forward-edge.md    (the Worker + edge-drain client, once built)
             process--capability-partition.md   (the class A/B/C walk as a method)
shared_with: sync-replication (projection-security), webhook-ingestion (ingress-topology),
             proactive-nudges (nudge-identity-dedup)
```

Two more lanes get an artifact:

- `practices/local-first-edge/` — `PRACTICE.md` (dimension: operations) with
  `starter/edge/` = the generic Worker skeleton (`wrangler.toml`, `index.ts`,
  `schema.sql`) with every app-specific value as `<...>`; an adopting repo copies
  it and fills the routes. This is the "path other apps can follow" in its most
  literal form.
- `skills/onboarding/` — the generic form of the skill in §8 (reads a repo's
  `.env.example` + a small capabilities manifest; asks, writes, verifies, reports).
  kp keeps a project-tier copy (`.claude/skills/onboarding/SKILL.md`); nearest
  wins, per `registry.yaml` `lanes.skills.resolution`.

Order: forge the subject **after** L1 lands (the application layer must cite real
code; the upper layers can be drafted now from the rungs above), and seed the
`usage/` + `signals/` lanes from kp's first install that runs the skill.

## 7. README update plan

`README.md` changes (same change as the first shipped rung, not before):

1. **"Run it yourself" gains a third paragraph** — *"Laptop, home box, or
   hosted"*: the three runtime owners, the one-liner that a Pi/NAS running
   `next start` is a full install, and a pointer to the new §"Always-on with a
   free edge".
2. **New section "Always-on with a free edge (optional)"** right after "Bring your
   own model", mirroring its table style: *You want* → *What to do* → *Cost*:
   - nothing online → nothing; messages queue, candidates see the direct pages
     only while the studio runs (today's behaviour, stated honestly);
   - webhooks + email + a nudge when work waits → `npx wrangler login`,
     `npm run edge:deploy` (new script wrapping `wrangler deploy` from `edge/`),
     paste the printed `KP_EDGE_*` into `.env.local` or the Channels → Edge card;
     Email Routing: point `<anything>@<your-domain>` at the Worker — free;
   - candidate pages up 24/7 → same deploy, toggle "publish projection" on the
     Edge card (L2).
   Each row names the exact free-tier allowance it fits in, and the honesty
   sentence: *the edge holds no keys and no database; your laptop stays the
   truth.*
3. **"Optional keys" table** gains `KP_EDGE_URL / KP_EDGE_SECRET` and
   `KP_NUDGE_TARGET` rows, and the Voice row gains the `ELEVENLABS_BASE_URL`
   (self-hosted Gravitone) alternative it already supports.
4. **"Environment reference"** gains the `/onboarding` line: *"Or let the
   agent do it: `claude` → `/onboarding` walks every dependency and writes
   `.env.local` for you."*
5. `docs/architecture/self-hosting.md` — new §"Edge companion" with the egress
   inventory row (what leaves the host: signed envelopes to the edge; what the
   edge sees), and the `KP_OFFLINE` interaction (`KP_OFFLINE=1` disables the
   edge client — air-gapped means air-gapped).
6. `docs/features/comms/README.md` — the status-vocabulary table rows, the Edge
   card, receiver URLs in both modes.
7. `scripts/docs/feature-doc-map.json` — `edge/**` + `app/_lib/edge-*.ts` →
   `docs/features/comms/README.md` (or a new `docs/features/edge/README.md` if
   L2 grows it past comms).
8. `.env.example` — the new block, with the same comment register as the rest.

## 8. The `/onboarding` skill — design

**Job:** take a fresh clone to a running, honestly-labelled KP in one
conversation: resolve every runtime dependency, ask for the connector keys the
operator *wants* to use, acknowledge — per feature — what stays limited without
them, write `.env.local`, verify by running the app, and hand back a capability
matrix that matches what the UI will say. It never invents a command (it reads
`package.json`, `requirements.txt`, `.env.example`) and never echoes a secret.

**Lives at** `.claude/skills/onboarding/SKILL.md` (project tier, written with this
concept). The full procedure is there; the shape:

| Step | What happens | Tooling |
|---|---|---|
| 0 Mode | Ask once: *developer on a laptop* / *self-host for a team* / *evaluating* — sets which groups are offered and whether `KP_OPERATOR_PASSWORD` + `KP_SECRET` are required or recommended | one `AskUserQuestion` |
| 1 Runtime probe | Node ≥ 20, npm, Python ≥ 3.11 + `requirements.txt`, `git`; optional: Claude Code CLI present **and** logged in (`claude -p` smoke), Docker, `wrangler`, Ollama/LM Studio on :11434. Report a table; fix what is fixable (`npm install`, `pip install -r`), name what is not | shell |
| 2 Capability groups | Batched select questions, one per group, each option stating *what you get* and *what stays limited*: **LLM engine** (Claude CLI · local server · provider key · none → deterministic), **CV extraction** (`GEMINI_API_KEY` or not), **Voice** (ElevenLabs · OpenAI Realtime · self-hosted Gravitone · off → voice hides itself), **Comms** (edge · relay URL · none → outbox says *not being sent*), **Calendar** (Google OAuth or link-based only), **Observability** (LightTrack / Sentry / none), **Edge** (deploy now / later / never), **Billing** (explicitly *not for self-host* — skipped unless mode = hosted) | `AskUserQuestion`, multi-group |
| 3 Keys | For each accepted group, ask for the value(s) with the exact var names from `.env.example`; write/merge into `.env.local` (preserve unknown lines, never overwrite a set value without asking); for ElevenLabs offer `node scripts/setup-eleven-agent.mjs`; for the edge run the wrangler flow; `KP_SECRET` generated if missing | `Edit`/`Write` on `.env.local` only |
| 4 Verify | `npm run schemas:gen`, boot `npm run dev` (dev-guard prints the live port), probe `/api/health`, `/api/comms/capability`, `/api/llm/config`; one keyless smoke; stop nothing the user started | shell, background |
| 5 Matrix | Print *feature → on / limited / off → why → what to set later*; the same truth the Getting-started card and the Channels banner will show. Offer `/onboarding edge` and `/onboarding voice` as re-entrant sub-flows | text |

Principles carried from the registry's `ci-bootstrap` / `agent-guidance`: measure
before you change, never invent a command, "not configured" is a real outcome
reported as itself, and an instruction file whose commands fail is worse than
none — so the skill re-runs its probes at the end, not just the start.

Generic form for the registry: the kp-specific table in step 2 moves into a
small manifest the skill reads (`onboarding.capabilities.json`: group → vars →
feature → limited-without text → verify URL), so an adopting repo ships the
manifest and the skill stays unchanged.

## 9. Open questions

- **Multi-device / multi-operator.** Two laptops draining one edge is a
  conflict surface this design does not address; `KP_MULTI_WORKSPACE` installs
  should run the runtime on one always-on host. State it, do not solve it here.
- **Retention at the edge.** Acked rows: delete after N days; unacked rows: keep
  until drained, but alert past a ceiling (the nudge escalates).
- **Web Push vs ntfy** as the default nudge: Web Push needs the browser the
  operator uses; ntfy needs an app. Offer both; default to whichever the
  onboarding step confirms works.
- **Region pinning** for EU operators: Workers run at the edge everywhere; D1
  has a location hint. Document; do not promise residency at the edge.

## 10. Next steps, in order

1. Ship **L0** (pull pass in the scheduler tick) — zero infra, closes email.
2. Write `.claude/skills/onboarding/SKILL.md` ✅ (this change) and run it on a
   fresh clone; fold what it teaches back in.
3. Build **L1** (`edge/` Worker + `edge-drain.ts` + Edge card + env + docs +
   README §7) — the minimum the user asked for: "notify that the local app needs
   to run", plus webhooks and email no longer lost.
4. Forge the registry subject + practice starter + generic skill (§6).
5. **L2** projection, beginning with `schedule/[token]` (highest candidate pain).
6. Decide L4(a) after watching how often the nudge fires in practice.

---

## 11. Build notes — what L0/L1 actually shipped, and where it deviates

Recorded here because a design doc that quietly disagrees with the code is worse
than no design doc.

- **IMAP was dropped from L0.** §3.1 named it; it needs a mail client plus a MIME
  parser, i.e. a dependency decision rather than a code decision, and L1's Email
  Routing handler answers the same need with no dependency at all. L0 shipped as a
  generic HTTP pull contract instead (`GET ?since=` → `{events, cursor}`), which
  covers board APIs and any mail-to-JSON bridge. Better trade than planned.
- **Sealing shipped in L1, not later.** §2 rule 3 promised ciphertext at the edge
  "for CV uploads"; the build generalized it to EVERY stored body (RSA-OAEP-wrapped
  AES-256-GCM, `app/_lib/edge-crypto.ts`), and made it opt-in per install via
  `POST /api/edge/pair`. Unsealed remains a legitimate state and the UI says which
  one is true rather than implying the safer one.
- **Mail is headers-only.** Stronger than the doc's threat model (which accepted
  raw MIME at rest, encrypted). The cost is real and stated everywhere it is felt:
  an emailed CV becomes a lead with a subject line, and the enrichment link does
  the rest. Carrying attachments is a genuine feature, not a tweak.
- **The receiver contract was extracted, not duplicated.** `app/_lib/inbound-lead.ts`
  is now the one door; the route keeps only the HTTP-shaped parts. This was the
  precondition that made three arrival paths safe, and it is pinned by
  `channels-receiver-contract.test.ts`.
- **No new status vocabulary locally.** `held-at-edge` / `deferred-to-local` from §2
  rule 4 live on the WIRE (the Worker answers `202 {result:"held"}`) rather than in
  `OUTBOX_STATUSES`; outbound delivery truth was never in question, and adding
  statuses nothing transitions would have been the drift the vocabulary rule exists
  to prevent.
- **Pull sources have no UI yet** (`PATCH /api/channels/webhooks` only), while the
  edge got a full Channels card. Listed in the comms doc's Known gaps.
- **Tenancy:** `edge_config` is deployment-level and EXEMPT (sibling of
  `comms_relay_config`); the clock's pull sweep is a named, narrow exemption in
  `channels-tenancy.test.ts`, while the recruiter-facing half stays scoped.

Next rung, unchanged: **L2** (signed public projection so `schedule/[token]` and
friends survive a closed studio), starting with scheduling.
