# High Fix Wave 3 — double-submit / pending / confirmation guards

> 6 findings closed in 4 commits, one mental model: *guard the action — confirm the
> destructive ones, single-flight the double-fireable ones, and don't lose an in-flight write.*
> No new i18n strings (all surfaces are hardcoded-English or reuse existing copy).
> Baseline preserved: tsc **0**, `next build` ✓, unit **1019/1019**, i18n parity (2824 keys).

## Commits

| Commit | Findings | Fix |
|---|---|---|
| `d09445d` | tasks #1, #2 | **BackupCard** "Replace N tables & restore" overwrote the whole multi-workspace DB on one click under a passive warning — now requires typing **REPLACE** to enable apply. **TasksTab** active-task Cancel (a DELETE that kills a running job) fired unguarded — now an inline confirm + a "Canceling…" pending state. |
| `678688a` | analysis-result #3 | **DispositionEditor** debounce cleared its timeout on unmount, cancelling a still-pending save (type a reason → close report → lost). Added a mount-once unmount flush via a **keepalive PATCH** (ref-backed so it reads the latest value). |
| `a146861` | dev-case #2 | **DevTab/CaseDetail** Publish + Run-lifecycle only disabled after their follow-up poll, so a double-click in the gap minted duplicate postings+tokens / launched two lifecycle runs. Added single-flight guards (`publishingCase` / `runningLifecycle`) that early-return and relabel the buttons during the request. |
| `ae538f2` | offers | **Offer page** hid a salary of exactly `0` behind `offer.salary ?` — switched to `!= null` so a 0 renders honestly. (The "0 hours left" half was already safe: `offerHoursRemaining` rounds up, so 0 only ever means actually-expired.) |

## Already-safe catches (no fix needed, verified)
- **CV-add double-fire** (cv-analysis): the intake is already serialized via `addCvSeqRef`
  (each add chains off the prior) and content-hash-deduped, so two near-simultaneous drops
  can't both append. Only a sub-100ms hash lacks a spinner — not worth a pending indicator.
- **Offer "0 hours left"**: `offerHoursRemaining` uses `Math.ceil` + `Math.max(0, …)`, so a
  live offer always reports ≥1h; 0 implies expired, which renders the expired state.

## Pattern catalogue additions
16. **Disable on the request, not on the result.** A button gated by a flag that only
    flips after the follow-up reload/poll is double-clickable in the gap — guard with an
    in-flight ref/state that early-returns on re-entry.
17. **Destructive + irreversible ⇒ typed confirmation**, not a one-click button under a
    passive warning (whole-DB restore, bulk delete).
18. **Flush debounced saves on unmount with `keepalive`** (or `sendBeacon` for POST) — a
    plain `clearTimeout` cleanup silently drops the pending write on navigation.

## What remains
Double-submit theme is essentially closed for the frontend. Backend siblings (their own
waves): comms `received_count` retry inflation + per-process resend dedup (needs a shared
store), the LLM-layer double-billing on repair/truncation. Other open High themes: the
**a11y** cluster (~25) and backend silent-failure Highs.
