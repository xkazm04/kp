# Communications & Inbound Channels — Tri-Lens Scan
> Total: 5
> Severity: 1 Critical / 2 High / 2 Medium / 0 Low
> Lens: 3 bug / 1 ui / 1 biz

## 1. Inbound webhook accepts unlimited duplicate/replayed leads — no payload idempotency
- **Lens**: 🐛 Bug Hunter
- **Severity**: Critical
- **Category**: Replay / duplication / trust-boundary
- **Value**: impact 9/10 · effort 4/10 · risk 3/10
- **File**: `app/api/channels/inbound/[token]/route.ts:88-116`, `app/_lib/lead-intake.ts:146-211`
- **Scenario**: An ad platform / Zapier / Make integration retries a failed POST (their default on a slow/timeout response), or a misconfigured form fires twice. The receiver has no request-level idempotency: each POST runs full `intakeLead`. The first call creates the entry and fires the acknowledgement; the retry hits `findApplicationByApplicant`, takes the "duplicate" branch, and `recordAutomationEvent(..., "re_applied", ...)` — but for a brand-new lead whose first POST is still in flight, two concurrent inserts race. The dedupeKey backstop (`created === false`) only catches the *second* DB write; both requests still ran the candidate-facing ack path, and `re_applied` events pile up on every replay. There is also no de-dup window: the same lead legitimately re-submitted 50× (board re-syndication) inflates the entry's history with 50 `re_applied` rows.
- **Root cause**: Idempotency is delegated entirely to email-identity dedup downstream; the public endpoint carries no idempotency key (e.g. provider `event_id` / `leadgen_id`) and no "seen this delivery already" check. `recordChannelWebhookReceipt` is unconditional, so every replay is also counted as a distinct lead.
- **Impact**: Duplicate acknowledgement emails to candidates; audit-trail noise; inflated `receivedCount` / time-to-first-lead metrics; under provider retry storms a single flaky response amplifies into N candidate emails.
- **Fix sketch**: Extract a stable delivery id from common provider fields (`field_data` `leadgen_id`, top-level `id`/`event_id`) in `lead-payload.ts`; persist `(token, delivery_id)` UNIQUE and short-circuit a repeat with `200 {result:"duplicate"}` BEFORE intake. Absent an id, hash (token+email+normalized-payload) within a short window. Keeps the no-ghost contract while collapsing replays.

## 2. Body-size cap trusts the spoofable `content-length` header — no real stream limit
- **Lens**: 🐛 Bug Hunter
- **Severity**: High
- **Category**: Trust-boundary / resource exhaustion
- **Value**: impact 6/10 · effort 3/10 · risk 3/10
- **File**: `app/api/channels/inbound/[token]/route.ts:58-65`
- **Scenario**: The 64 KB guard reads `request.headers.get("content-length")` and rejects only if that number is too big. A caller that omits the header (chunked transfer) or lies (sets `content-length: 10` then streams 50 MB) bypasses the check entirely — `await request.json()` then buffers the whole body into memory. The comment claims it "fail[s] closed on junk before buffering it," which is not what the code does.
- **Root cause**: The cap is enforced against an attacker-controlled header, not against bytes actually read off the wire. There is no streaming/aborting body reader.
- **Impact**: Memory-pressure / DoS vector on a public, unauthenticated-by-anything-but-token endpoint; the documented protection is illusory (success-theater in the guard comment).
- **Fix sketch**: Read the body with a hard byte budget — stream `request.body` through a counting reader that aborts past `MAX_INBOUND_BODY_BYTES`, or `await request.text()` then enforce `Buffer.byteLength(text) <= MAX` before `JSON.parse`. Treat a missing/zero `content-length` as "must measure," not "allow."

## 3. Resend has no in-flight/duplicate guard server-side — double-fire sends two candidate emails
- **Lens**: 🐛 Bug Hunter
- **Severity**: High
- **Category**: Race condition / duplication in dispatch
- **Value**: impact 6/10 · effort 3/10 · risk 3/10
- **File**: `app/api/comms/[id]/resend/route.ts:16-34`, `app/features/sub_dev/OutboxSection.tsx:16-27`
- **Scenario**: The Comms Center / Outbox `ResendButton` disables on `busy`/`done`, but that is purely client-side. Two recruiters viewing the dead-letter list (or one double-click that races the state set, or a retried fetch) both POST `/resend` for the same outbox id. The route does zero dedup: it re-reads the original and unconditionally calls `sendComm`, appending a fresh row each time and — with a relay configured — actually delivering N copies of the same offer/rejection to the candidate.
- **Root cause**: Resend is intentionally append-only with no idempotency key and no "a newer OK row already exists for this (ref,kind)" pre-check (the `recovered` derivation exists only in the *read* path, not the write path).
- **Impact**: A candidate receives duplicate offer/rejection emails; the append-only audit log can't tell an intentional re-send from an accidental storm.
- **Fix sketch**: Before dispatching, re-derive recovery server-side: if a newer `sent`/`queued` row already exists for `(ref, kind)` since the failed row, return `409 {recovered:true}` instead of re-sending. Optionally accept a client-supplied idempotency key to collapse double-clicks.

## 4. Inbound receipt counted before email validation — "leads received" overstates real leads
- **Lens**: 🐛 Bug Hunter
- **Severity**: Medium
- **Category**: Silent metric inflation / success-theater
- **File**: `app/api/channels/inbound/[token]/route.ts:67-86`
- **Value**: impact 4/10 · effort 2/10 · risk 2/10
- **Scenario**: `recordChannelWebhookReceipt(token)` runs on *every* JSON body, then the route may still 422 ("no email mappable") or 410 (role closed after the receipt) or decline on KO. The Channels tab shows `receivedCount` and time-to-first-lead built off these stamps, so a probe, a health-check ping, or a malformed integration that never produces a usable lead all read as "received" and can set `firstReceivedAt` — making a webhook look productive when zero real candidates landed.
- **Root cause**: The receipt is deliberately stamped for "anything received" (per the comment) but the same counter is surfaced in the UI as the lead/liveness signal, conflating "got a POST" with "got a lead."
- **Impact**: Misleading recruiter dashboard (received count, first-lead latency); a noisy source looks healthy; hard to spot a webhook that's connected but never mapping a real lead.
- **Fix sketch**: Keep the raw receipt stamp but add a separate `accepted_count`/`first_accepted_at` incremented only on `result === "accepted"`, and surface that (or both) in `ChannelsTab`/`WebhookConnect` so "received" means leads, not pings.

## 5. Comms Center has no per-kind/recipient filter, search, or pagination beyond a 60-row slice
- **Lens**: 🎨 UI Perfectionist
- **Severity**: Medium
- **Category**: Scalability / findability of comms states
- **File**: `app/features/sub_channels/CommsCenter.tsx:87-117`, `app/api/comms/route.ts:25`
- **Value**: impact 5/10 · effort 4/10 · risk 2/10
- **Scenario**: The API returns up to 200 rows; the UI sorts dead-letters first then `.slice(0, 60)`. On any active workspace, a recruiter looking for "what did Jane receive?" or "show me all rejections" has only a binary failed-only toggle and must eyeball a 60-row firehose. Older messages silently vanish past 60 with no "showing 60 of N" affordance or load-more, and there's no per-candidate or per-kind filter even though the API already supports `?entry=` and the DB supports `kind`.
- **Root cause**: The center was built failed-first for triage; the everyday "audit one candidate's comms" and "filter by kind" use cases (which the backend already supports) were never surfaced, and the 60-cap is silent.
- **Impact**: Comms Center is a triage board, not a usable comms log; recruiters fall back to the Dev tab or server logs — the exact gap this panel was meant to close (per its own W6-2 comment).
- **Fix sketch**: Add a kind filter (chips) and a candidate search bound to the existing `?entry=`/`kind` params; show "showing X of N" with a load-more (raise `limit` or paginate). Reuse `coerceOutboxStatus` for a status segmented control rather than only the failed toggle.
