# Channels "listening" expectation (idea 99804867) + reconcile of c8940649

## Reconcile verdicts

- **c8940649 (analysis persistence warning): already on main** as `c1f70b1ed`
  (`app/features/tools/analyze/analyzeUnsavedWarning.ts` + the AnalyzeTab notice; the commit is an
  ancestor of `main`). Nothing built; close through reconciliation.
- **99804867 (listening needs a time expectation + auto-progress): NOT on main, built.**
  - `ChannelsState` `listening` (`app/_lib/getting-started.ts`) has no UI consumer: the only reader
    of `/api/me/getting-started` is `useSetupUnfinished.ts`, which reads `setupFinished` only.
    `JobsLifecycleStrip.tsx` mentions "channels listening" in a comment only.
  - The user-visible waiting state is the Channels receiver card (`verdict === "waiting"`). Commits
    15941b126 (health verdict) and f8fa0a865 (one liveness contract) gave it a verdict and a static
    sentence, with no expectation, no elapsed time and no refresh: a first lead only showed after a
    manual reload or an unrelated live-refresh.

## What changed (commit 8ea465193)

- `receiverWaiting.ts` (pure): `waitingReceivers`, `waitingFor(createdAt, now)` (elapsed + stalled
  after 10 min) and `startWaitPoll` (timer-injectable; 20 s; skips while the tab is hidden; stops
  itself once nothing waits; returns an idempotent stop).
- `useWaitingPoll.ts`: hook over it, torn down on unmount; supplies a `now` that advances per poll.
- `useChannelsData.ts`: the receivers read is split out as `reloadWebhooks`, so the poll re-reads
  only `GET /api/channels/webhooks` (not the 201 KB jobs list). No API/response/schema change.
- `SetupReceivers.tsx` / `SetupReceiverCard.tsx`: a waiting card says the state turns to "reached"
  by itself when the first request arrives, promises no time, shows the endpoint's age (from the
  existing `createdAt`), and after 10 min adds a caution note with a button that opens the existing
  setup-steps panel.
- 4 new `channelsNight.setup.receiver.*` strings (`waitingNext`, `waitingSince`, `waitingStalled`,
  `waitingStalledAction`) in en/cs/de/fr.
- `receiverWaiting.test.ts`: listening shows expectation/elapsed, stalled threshold, hidden tab
  skipped, a poll returning verified flips the state and the poll stops, stop on unmount.

Not done: the getting-started `channels` field is unchanged and still has no surface; adding one is
a separate product decision.

## Gates

- `npm run typecheck`: pass (schemas:gen rewrote three `*.generated.ts` files with no real change;
  restored, not committed).
- `npm run lint`: 0 errors (49 existing warnings).
- `npm run test:unit` (full): 12754 pass, 0 fail.
- `npm run i18n:check`: OK, 4 locales in parity.
- Not run (stated as red on main, not mine): `test:perf`, `test:docs`.
