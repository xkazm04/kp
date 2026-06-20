# Offers & Onboarding — Tri-Lens Scan
> Total: 5
> Severity: 1 Critical / 2 High / 2 Medium / 0 Low
> Lens: 2 bug / 2 ui / 1 biz

## 1. Accept on a stale offer token mis-advances (or resurrects) the entry — no stage/terminal guard
- **Lens**: 🐛 Bug Hunter (primary)
- **Severity**: Critical
- **Category**: State corruption / asymmetric guard
- **Value**: impact 9/10 · effort 3/10 · risk 3/10
- **File**: `app/_lib/offer-finalize.ts:62`
- **Scenario**: An entry has an open offer (token live; offers never expire). The recruiter then *rejects* the candidate, or the entry otherwise leaves the Offer stage. The candidate later opens the still-live link and clicks Accept. `markOfferResponded` flips the offer row to `accepted` (its CAS only guards the offer row, not the entry), then `actOnPipelineEntry(entryId, "accept", …)` runs with **no `expectedStage` and no terminal/Hired guard**.
- **Root cause**: The decline path is guarded (`markEntryStatus` refuses terminal/Hired entries and logs — offers-store.ts:256-271), but the *accept* path has no symmetric guard. `actOnPipelineEntry`'s accept branch (db/pipeline.ts:1248-1256) blindly advances ONE stage from `row.stage`, ignoring `row.status`. On a `rejected` entry (status `rejected`, stage `Offer`) it sets stage→`Hired` while status stays `rejected` — a closed-out candidate is resurrected to Hired and `dispatchOnboarding` fires. If the entry sits at a non-Offer stage, accept advances the wrong stage (e.g. Screened→Interview) yet the offer reads `accepted`.
- **Impact**: Hired/onboarding triggered for a rejected or wrong-stage candidate; offer-row status and pipeline status/stage diverge silently; onboarding comms sent to someone the company already passed on. Real money + reputational exposure on a public endpoint.
- **Fix sketch**: Pass `{ expectedStage: "Offer", actor: "system" }` to `actOnPipelineEntry`, OR gate accept behind a terminal-status/`stage === "Offer"` check mirroring `markEntryStatus`. If the entry isn't a live Offer-stage row, treat as already-resolved (return recorded status, skip Hired+onboarding) and log — never advance.

## 2. Onboarding silently skipped when the Hired transition is a no-op
- **Lens**: 🐛 Bug Hunter (primary)
- **Severity**: High
- **Category**: Silent failure / data loss
- **File**: `app/_lib/offer-finalize.ts:67,85`
- **Scenario**: Candidate accepts an offer whose entry is already at the Hired stage (e.g. a prior accept on a sibling link advanced it, then this token's CAS still wins because it's a different token — or a manual stage move to Hired happened first). `actOnPipelineEntry` returns the entry but takes the "already at terminal stage" branch (db/pipeline.ts:1257-1263), returning a non-null entry — so `hired` is truthy and onboarding *does* fire. The mirror failure: if `actOnPipelineEntry` returns `null` (missing row / future CAS miss), both `recordPipelineOutcome` and `dispatchOnboarding` are skipped with **zero reconcile signal**, yet the offer row is already `accepted`.
- **Root cause**: Onboarding/outcome are gated on `if (hired)` truthiness only; a `null` return (claimed offer but entry vanished/guard-blocked) leaves the accept recorded with no onboarding and no `onboarding_failed`/reconcile event — unlike the dispatch-throw path, which DOES record a reconcile event (lines 88-98).
- **Impact**: A candidate sees "Offer accepted — People team will be in touch" but no onboarding is dispatched and nothing flags it for an operator. Dead-end hire.
- **Fix sketch**: When `claimed` but `hired` is null, record an `onboarding_failed`/`hire_reconcile_needed` automation event so the gap is operator-visible, matching the existing dispatch-failure reconcile pattern.

## 3. Public offer page renders no error UI when the offer link is invalid/404
- **Lens**: 🎨 UI Perfectionist (primary)
- **Severity**: High
- **Category**: Error state / candidate trust
- **File**: `app/offer/[token]/page.tsx:57-63`
- **Scenario**: A candidate opens a mistyped, revoked, or non-existent token. GET returns `{ error: "This offer link is not valid." }` with 404. The page does `r.json()` then `if (p.error) throw` → caught → `setLoadError(t("loadFailed"))` ("Could not load this offer."). That's the same generic copy used for a transient network blip — a candidate facing a genuinely dead link gets a vague "could not load" with no guidance and no way forward.
- **Root cause**: The fetch chain collapses all GET failures (404 not-found, 500, network) into one `loadFailed` string; there's no distinct not-found/invalid-link state with a "contact the hiring team" affordance, even though the expired state got exactly that treatment.
- **Impact**: On a money-bearing, phone-opened public page, the most common failure (stale/wrong link) reads as a broken site. Erodes trust at the highest-stakes moment of the candidate journey.
- **Fix sketch**: Branch on `r.status === 404` to render a dedicated "invalid offer link" card (mirroring the expired card) with a contact-the-team line; reserve `loadFailed` for transient errors and add a retry button there.

## 4. Accept/decline buttons can double-fire on a slow network (no client-side in-flight lock across reloads/back)
- **Lens**: 🎨 UI Perfectionist (primary)
- **Severity**: Medium
- **Category**: Idempotency UX / mobile
- **File**: `app/offer/[token]/page.tsx:66-94,235`
- **Scenario**: On a flaky phone connection, the candidate taps Accept; the spinner shows but the POST stalls. They background the tab / hit back / re-open the link, see fresh buttons (state reset), and tap again. The server CAS makes this *safe* (second POST returns `alreadyResponded`), but the loser path returns `ok:true` with the recorded status, so the UI flips to "accepted/declined" — fine. The real gap: there's no optimistic confirmation and no "you already responded" reconciliation if the first POST actually succeeded but the response was lost — the candidate has no certainty their decision landed.
- **Root cause**: `pending` lock is in-memory only; a reload clears it. The page never re-reads offer status after a failed/ambiguous POST, so a candidate who lost connectivity mid-accept can't tell whether it registered.
- **Impact**: Anxiety + support pings ("did my acceptance go through?") on the most important click of the funnel; on mobile this is the common case, not the edge.
- **Fix sketch**: On `responseError`, re-fetch GET and reconcile `result` from the authoritative status; show a subtle "already recorded as accepted" confirmation if the server says so.

## 5. No expiry reminder or post-accept onboarding next-step — offers lapse silently
- **Lens**: 🚀 Business Visionary (primary)
- **Severity**: Medium
- **Category**: Capability gap / journey dead-end
- **File**: `app/_lib/offers-store.ts:171-176`
- **Scenario**: An offer has a 7-day TTL and `lapseExpiredOffers` exists "the reminder heartbeat calls this" — but there's no reminder comm before lapse and no nudge as the deadline nears. A candidate who simply forgets loses a live offer with zero follow-up; the company loses a hire to silence. On accept, the page promises "our People team will be in touch" but there is no actual onboarding artifact (no e-sign, no checklist link, no scheduling handoff) — `dispatchOnboarding` is a single deterministic welcome comm.
- **Root cause**: The expiry policy is built (TTL, lapse sweep, countdown copy) but the *proactive* half — a T-48h reminder email and an onboarding next-step (e-sign / first-day handoff) — was deferred. The countdown only shows if the candidate happens to re-open the page.
- **Impact**: Employers expect expiry reminders and an onboarding handoff as table stakes; their absence costs accepted-offer conversion and makes the post-accept moment a dead-end. High differentiation value, modest effort (the dispatch + heartbeat plumbing already exist).
- **Fix sketch**: Add a `dispatchOfferReminder` fired by the heartbeat at T-48h for still-`extended` offers (dedupe via a `reminded_at` column); extend `dispatchOnboarding` to carry an e-sign/checklist link so accept lands on a concrete next step, not just a promise.
