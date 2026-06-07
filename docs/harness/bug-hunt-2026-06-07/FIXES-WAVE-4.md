# Bug Hunt Fix Wave 4 — Voice interview end-of-call & connection timing

> 2 commits, 6 findings closed (3 high, 2 medium, 1 low). All in `VoiceInterview.tsx`.
> Baseline preserved: tsc 0→0 · `next build` ✓ · unit 585→585 · python 474→474. No regressions.

## Commits

| # | Commit | Findings | Severity | Theme |
|---|---|---|---|---|
| 1 | `c60184a` | voice #1 + #4 + #5 | High + High + Medium | End-of-call transcript integrity |
| 2 | `a338c9e` | voice #2 + #3 + #6 | Medium + High + Low | Connect/teardown hygiene |

## What was fixed

**Commit 1 — the transcript (the only interview record, feeding the scorecard and Interview→Offer gate) was lost silently three ways:**
1. **ElevenLabs had no last-answer protection** (the OpenAI path has a VAD grace window). `end()` synchronously finalized, latching `finalizedRef` and POSTing `turnsRef` before the SDK delivered the candidate's closing answer via `onMessage` (~hundreds of ms after `endSession()`). Now `end()` defers finalize to `onDisconnect` (which fires after that final message), with a fallback timer if `onDisconnect` never lands.
4. **`finalize()`'s POST was fire-and-forget** with a swallowed `catch` and no `res.ok` check — a flaky-network failure lost the whole transcript with zero signal. Now `persistTranscript` stashes to `sessionStorage`, retries with backoff (stopping on 4xx), uses `keepalive`, and surfaces a banner if every attempt fails.
5. **Unmount during a live call** (tab close / back-nav) tore down transport without persisting — for OpenAI nothing was POSTed at all. Now the unmount path `sendBeacon`s the partial transcript as `"failed"` so it's recorded, not vanished.

**Commit 2 — connect/teardown races around the 30s timeout:**
2. **`getUserMedia` mic leak** — the permission prompt can sit open for seconds; if the timeout/unmount tore down meanwhile, the resolved `MediaStream` was wired into an already-closed pc and left the mic hot. Now stop the tracks if the connection was torn down/replaced before the stream arrives.
3. **Late `onConnect` zombie-live** — a connect that completed just after the timeout latched `finalizedRef` and flipped the call to "live" anyway; the candidate ran a full interview that `End()` then refused to POST (so it looked successful but persisted nothing). `onConnect` and the OpenAI go-live step now bail when `finalizedRef` is set.
6. **Stale session capability refs** — `start()` didn't clear `sessionIdRef`/`sessionTokenRef`, so a failed re-connect could let `finalize` POST against the previous session's id. Reset with the other per-call refs.

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| `next build` | ✓ | ✓ |
| `npm run test:unit` | 585 | 585 |
| `npm run test:python` | 474 (4 skipped) | 474 (4 skipped) |

## Patterns established (catalogue items 13–15)

13. **A provider's end-of-call event lags the spoken audio — defer finalize to it.** Don't snapshot/POST a transcript synchronously on hang-up; wait for the provider's disconnect/close event (with a fallback timer) so the final, lagging message is captured. The OpenAI grace window and the new ElevenLabs `onDisconnect` deferral are the same pattern.
14. **The only durable write must not be best-effort.** A single fire-and-forget `fetch` with a swallowed `catch` silently loses the whole record. Stash locally, retry with backoff, check `res.ok`, and use `keepalive`/`sendBeacon` so an unload still persists.
15. **A timeout/abort flag and the live-UI state must never be able to disagree.** When a connect timeout latches a "done" flag, every late-success path (`onConnect`, post-dial go-live) must re-check it and bail — otherwise the UI shows a live session the system has already abandoned.

## Cumulative status (waves 1–4)

| Wave | Theme | Closed |
|---|---|---|
| 1 | Duplicate side-effects & double-firing | 6 |
| 2 | Python numeric & LLM-boundary safety | 6 |
| 3 | Analyze run lifecycle & task cancellation | 4 + Data#1 (analyze) |
| 4 | Voice interview end-of-call & connection timing | 6 |

Pattern catalogue: 15 items. **22 / 51 findings fully closed** (+ Data#1 partial). No criticals remain.

## What remains

W5 dev-case provenance (7 — WIP overlap, re-read `evaluate.py`/`models.py` first), W6 silent failures (4), W7 status/uniqueness guards (6), W8 board/form UI (11) — 29 findings open per `INDEX.md`, plus the Data#1 signal-forward for the 5 non-analyze handlers.
