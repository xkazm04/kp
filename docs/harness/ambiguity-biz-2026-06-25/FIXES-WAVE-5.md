# Ambiguity+Business Fix Wave 5 — Comms & candidate-experience reliability

> 5 commits, 5 findings closed (3 Critical + 2 High; W5-3 is a Phase-1 partial with a documented Phase-2).
> Baseline preserved: tsc 0 · JS unit 1032 → 1033 · Python untouched · en/cs parity OK. 0 regressions.

The candidate-facing promise: reach the candidate, capture their answers, keep them informed. Each fix closes a way that promise silently broke.

## Commits

| # | Commit | Finding | Sev | Files |
|---|---|---|---|---|
| 1 | `d5b55b4` | silent total comms outage when no relay is configured | C | api/comms/route.ts, CommsCenter.tsx, en/cs.json |
| 2 | `726ae51` | whisper-1 drops the in-flight final answer from the scored transcript | C | voice/openai.ts, VoiceInterview.tsx |
| 3 | `82835ec` | 2-slots/day global scheduling cap (Phase 1: config-driven times) | C | schedule-slots.ts, schedule-slots.test.ts |
| 4 | `324e152` | offer expiry silent — no event, never on the timeline | H | offers-store.ts, candidate-timeline.ts, decision-attribution.ts(+test), en/cs.json |
| 5 | `8d91ae0` | status-tracking link never emailed (lost on tab close) | H | api/apply/[id]/route.ts, comms-dispatch.ts, en/cs.json |

## What was fixed

1. **Silent comms outage (C).** With `COMMS_WEBHOOK_URL` unset (default), every message is recorded `queued` in the local outbox and nothing delivers — yet the recruiter Comms Center showed benign grey badges. `/api/comms` now returns `relayConfigured` and CommsCenter renders a loud red banner when false ("these messages are NOT being sent to candidates").

2. **Whisper drops the final answer (C).** The realtime input transcription model was hardcoded `whisper-1`, which emits only the final `.completed` (no `.delta`s), so the finalize fallback that reads the streamed delta buffer for a candidate's last answer was provably empty — a slow closing answer (the "most decision-relevant" turn) silently dropped from the scorecard. Added `OPENAI_REALTIME_TRANSCRIPTION_MODEL` (default the streaming `gpt-4o-transcribe`, overridable back to whisper-1) so the fallback populates, plus a log when the grace expires empty.

3. **Scheduling cap (C, Phase 1).** Offered times were hardcoded to two/day and collision is global, capping the whole org at 2 interviews/day. **Phase 1 (safe, zero-risk):** offered times are now config-driven via `KP_INTERVIEW_TIMES` (validated/deduped/sorted, safe fallback), liftable without code. **Phase 2 (deferred, documented in code):** a per-interviewer/per-job availability model + real-calendar conflict avoidance, so two free hosts can share a wall-clock time and an interviewer isn't double-booked. Collision remains global/host-blind.

4. **Silent offer expiry (H).** Lapsing flipped status with no event, never stamped a terminal time, and the timeline only renders an offer item on `respondedAt` — so a dead offer read as "extended" forever and analytics counted it as pending. Both lapse paths now record an `offer_expired` event (race-safe `RETURNING`), the timeline surfaces it at the deadline (reads existing `expires_at`), and the kind is registered everywhere (DECISION_META + writer-coverage test + en/cs labels).

5. **Status link never emailed (H).** The unguessable status token was returned only as JSON for an in-page button — close the tab and it was gone forever. The apply route now mints the link once (shared by the JSON and the ack), and the acknowledgement email appends it via a new `ack.statusLine` key. The email is now the durable touchpoint.

## Verification

| Gate | Before | After |
|---|---|---|
| tsc --noEmit | 0 | 0 |
| JS unit (`node --test`) | 1032 | 1033 |
| Python | 694 OK / 4 skip | (untouched) |
| i18n en/cs parity | OK | OK |

## Patterns established (catalogue items 10–12)

10. **A degraded-default that silently no-ops must shout on the surface that consumes it.** A "queued forever" local fallback (no relay) or a "fallback buffer that's always empty" (whisper-1) is worse than an error — it reads as success. Surface `relayConfigured`/log the empty drop where a human reasons about the outcome.
11. **A silent terminal state needs an event, a timestamp, AND a render path.** Offer expiry failed all three; sibling transitions had all three. When adding a status flip, mirror the full trail (event → registered kind → timeline item) or it's invisible to the recruiter and corrupts the funnel denominator.
12. **The durable touchpoint is the email, not the tab.** An unguessable token surfaced only in-page dies on tab close; put it in the email body (the candidate's record) for any "track your X" feature.

## What remains

Comms/candidate-experience tail is largely closed. Deferred with cause: the scheduling per-host availability model (W5-3 Phase 2). Remaining INDEX themes: GDPR/audit (W4), dark-capability activations (W6), the tenancy read-scoping follow-up (W2 cont.), the BYOM monetization decision (W3), and the Med/Low tail.
