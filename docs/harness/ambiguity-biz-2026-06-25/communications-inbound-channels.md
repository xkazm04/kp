# Communications & Inbound Channels — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀2 / 🚀3 | Severity: C1/H2/M1/L1

## 1. Default deployment silently delivers nothing — recruiter Comms Center gives no relay-not-configured warning
- **Lens**: 🚀 Business
- **Severity**: Critical
- **Category**: silent capability gap / core-promise
- **File**: app/_lib/comms.ts:97
- **Observation**: `getCommsChannel()` returns the local `OutboxChannel` whenever `COMMS_WEBHOOK_URL` is unset (comms.ts:97-99), and every candidate-facing message is then recorded as `queued` — documented as a "terminal dev success state" that nothing ever dequeues (comms-status.ts:13-18). The recruiter-facing Comms Center is the surface where a recruiter reasons about "did the candidate get this?", yet it never checks whether a relay exists: `load()` calls only `/api/comms` (CommsCenter.tsx:54-66), and `/api/comms` returns no `relayConfigured` flag (api/comms/route.ts:50). The only place that warning lives is the Dev tab's OutboxSection — not the production recruiter view.
- **Why it matters**: On any deployment where the operator forgot/never knew about the env var, EVERY offer, rejection, interview invite and ack sits in a local table forever while the recruiter sees benign grey `queued` badges (CommsCenter.tsx:27-31) and believes candidates were contacted. This is a total, invisible comms outage on the product's core promise (reach the candidate) — candidates ghosted, recruiter unaware.
- **Recommendation**: Have `/api/comms` return `relayConfigured: Boolean(process.env.COMMS_WEBHOOK_URL)` (already done in api/devcase/comms/route.ts:13) and render a loud banner in CommsCenter when false: "No delivery relay configured — these messages are NOT being sent to candidates." Bonus: surface a one-field relay-URL setting in the workspace UI so it isn't ops-only tribal knowledge.
- **Effort**: S

## 2. "sent" means "relay accepted the POST", not "candidate received it" — no bounce/engagement feedback path
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: deliverability / reputation / monetization
- **File**: app/_lib/comms.ts:73
- **Observation**: The WebhookChannel marks a message `sent` on any HTTP 2xx from the relay (`if (r.ok) return { status: "sent" }`, comms.ts:73), which the Comms Center renders as success-green (CommsCenter.tsx:29, `sent: "bg-moss/15 text-moss"`). There is no inbound callback for the asynchronous outcomes that actually matter for email — bounce, spam-complaint, deferral, open, click, reply. A `grep` across the channel/comms code finds no `bounce|delivered_at|opened|complaint` handling at all. The envelope flows one-way out; nothing comes back.
- **Why it matters**: A recruiter sees a green "sent" offer that in reality hard-bounced (typo'd/captured-wrong address, full mailbox) and never chases it — the candidate goes silent at the most reputation-sensitive moment. Conversely, candidate engagement (did they open the offer? click the scheduling link?) is exactly the premium "deliverability & engagement analytics" + nudge-automation trigger competitors charge for, and it's value left entirely on the table.
- **Recommendation**: Add a relay status-callback endpoint (the relay POSTs delivered/bounced/opened keyed by `ref`+`kind`) and a fourth, distinct `bounced` state so the Comms Center can flag undeliverable offers separately from `sent`. Tie opens/clicks into the candidate timeline as an upsell-grade engagement feed.
- **Effort**: M

## 3. Sourced / recruiter-added candidates have no deliverable address — their comms dead-letter with no recruiter-visible signal
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: unreachable-recipient / addressing
- **File**: app/_lib/comms.ts:19
- **Observation**: The recipient contract states `msg.to` is "a human label / candidate id / the literal 'candidate' — never an email, because the data model stores none" (comms.ts:19-23); `candidateRecipient` only yields a real address when an inbound `contact` was captured, otherwise falling back to the name and finally the literal `"candidate"` (comms-dispatch.ts:60-66). Only inbound-applied leads (E4/APP2) carry `contact`; proactively-sourced and manually-added candidates do not. With a real relay, every comm to those candidates resolves to a name a mail provider cannot deliver to, and dead-letters. Nothing in the Channels UI flags an entry as unaddressable before send.
- **Why it matters**: Proactive sourcing is a headline channel (ChannelsTab CHANNELS includes `sourcing`, `manual`), yet with delivery actually turned on, none of those candidates can be reached — the whole sourcing→outreach loop produces dead-letters. The mitigation (capture/enrich an address) exists but is invisible to the recruiter, so the gap is discovered only after candidates silently never reply.
- **Recommendation**: Show a per-entry "no deliverable address" indicator in the Comms Center / candidate drawer and a quick "add email" affordance for sourced/manual entries, so a recruiter sees the addressing gap before dispatching rather than as a buried dead-letter.
- **Effort**: M

## 4. Inbound webhook auth is a URL-embedded token only — no payload-signature verification, undocumented "URL won't leak" assumption
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: hidden trade-off / abuse surface
- **File**: app/api/channels/inbound/[token]/route.ts:18
- **Observation**: The route header documents "The CSPRNG token is the only auth" (route.ts:18-23) and the DB layer reaffirms "The token is the ONLY gate on this public, side-effecting endpoint" (db/channels.ts:72-73). A `grep` for `signature|hmac|x-signature|secret` across the channels routes returns nothing — provider HMAC signatures (which most ad/board webhooks send) are neither required nor verified. The token rides in the receiver URL the recruiter copies around (ChannelsTab copyUrl), so it can leak via browser history, referrer headers, screen-shares or logs, and the trade-off that this is acceptable is never written down.
- **Why it matters**: A leaked token lets anyone POST leads, and each accepted lead dispatches a candidate email (route.ts comment, line 40) — a spam/abuse vector that emits from kp's own sending domain, harming deliverability reputation, and pollutes the pipeline + the Channels lead metrics. The 60/min token+IP rate limit blunts volume but not a distributed or low-and-slow abuse.
- **Recommendation**: Document the threat model explicitly (token = bearer secret, must stay server-to-server) and add optional per-webhook HMAC verification (shared secret at creation, verify an `X-Signature` header) so integrations that can sign are authenticated beyond a guessable-if-leaked URL.
- **Effort**: M

## 5. `KNOWN_COMM_KINDS` export-schema list is already stale vs the kinds dispatchers actually emit
- **Lens**: 🌀 Ambiguity
- **Severity**: Low
- **Category**: doc/code drift
- **File**: app/_lib/comms-envelope.ts:25
- **Observation**: `KNOWN_COMM_KINDS` enumerates 8 kinds "the pipeline dispatchers emit today" and is part of the documented `kp.comm.v1` export contract (comms-envelope.ts:25-34, docs/OUTBOUND_EXPORT.md). But comms-dispatch.ts emits at least three more that are absent from the list: `ko_decline` (comms-dispatch.ts:220), `schedule_invite` (comms-dispatch.ts:292) and `offer_reminder` (comms-dispatch.ts:396). The comment hedges that the list is "documentation-adjacent, not enforcement … a relay should treat this list as open," but it is still presented as the kind vocabulary an integrator maps against.
- **Why it matters**: An integrator building their ATS mapping off the documented list will silently under-handle the missing kinds (e.g. route an `offer_reminder` or `ko_decline` as "unknown"), and the list's authority erodes — exactly the tribal-knowledge drift the single-source-of-truth comment was meant to prevent.
- **Recommendation**: Either complete the list to match every `kind:` literal in comms-dispatch.ts (and pin it with a test that asserts dispatcher↔list parity, mirroring the comms-status enum lock), or drop the per-kind enumeration in favor of "kinds are open; here are the categories" so the doc can't go stale.
- **Effort**: S
