# Offers & Onboarding — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀3 / 🚀2 | Severity: C0/H4/M1/L0

## 1. Offer expiry is silent: no `offer_expired` event, and it never even reaches the candidate timeline
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: silent state change / observability
- **File**: app/_lib/offers-store.ts:181
- **Observation**: `lapseExpiredOffers` (and the lazy `expireOfferIfDue`, line 165) flip an open offer to `status='expired'` via a bare `UPDATE` with **no `recordAutomationEvent`** — unlike every sibling transition (`offer_sent` comms-dispatch.ts:240, `offer_accepted` offer-finalize.ts:71, `offer_declined` offer-finalize.ts:148, `offer_reminder_sent`). A grep confirms **no `offer_expired` event exists anywhere**. Worse, expiry never stamps `responded_at`, and `candidate-timeline.ts:71` only emits an offer status item `if (offer.respondedAt)` — so a lapsed offer renders as **"extended" forever** and never surfaces as expired even on the candidate's own timeline.
- **Why it matters**: The recruiter gets zero signal that a live offer died — the headcount is silently frozen on a dead link with no re-engagement trigger. Any accept-rate / funnel analytics built on the automation-event stream treat an expired offer as "still pending" indefinitely, corrupting the denominator of the product's stated key metric. A lost hire vanishes with no audit trail.
- **Recommendation**: Have `lapseExpiredOffers`/`expireOfferIfDue` record an `offer_expired` automation event (and add it to the events catalog in messages/en.json ~line 2867), stamp a terminal timestamp the timeline reads, and fire a recruiter notification so a lapsed offer becomes an actionable re-engage prompt, not silence.
- **Effort**: S

## 2. Binary accept/decline only — no counter-offer / negotiation path caps the accept rate
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: conversion lever / unmet user pain
- **File**: app/offer/[token]/page.tsx:316
- **Observation**: The public offer page offers exactly two outcomes — Accept, or Decline (terminal + irreversible: `markEntryStatus(...,'declined')` offer-finalize.ts:147, copy "This cannot be undone." messages/en.json:554). There is no "Request changes / Discuss terms / Counter" path. A declined entry goes to a terminal status, and the pipeline's offer flow can't re-enter (stage gate), so a near-miss on salary or start date is thrown away as a hard NO.
- **Why it matters**: A large share of real-world declines are negotiable, not final. Offer accept-rate is explicitly the core conversion metric for this context; a one-click "I'd accept if we can talk about X" that pings the recruiter (instead of closing) directly recovers offers that currently convert to a permanent decline. This is the single biggest accept-rate lever in the flow.
- **Recommendation**: Add a third "Discuss / counter" action that records a non-terminal `offer_counter` event, notifies the recruiter, and keeps the offer open — letting the recruiter revise and re-extend the same entry rather than reinstating from a dead `declined` state.
- **Effort**: M

## 3. `OFFER_TTL_MS` is a hardcoded global 7 days — the "recruiter's primary lever" the comment promises doesn't exist
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: magic constant / documented-intent contradiction
- **File**: app/_lib/offer-policy.ts:9
- **Observation**: `OFFER_TTL_MS = 7 days` is one global constant, stamped identically at mint for every offer (offers-store.ts:129). The module header (offer-policy.ts:1-6) states "A deadline is the recruiter's primary tool to force a candidate decision" — yet no code path lets a recruiter set, shorten, or extend it; `extendOffer` (app/api/pipeline/[id]/route.ts:22) passes no deadline. The reminder lead (`OFFER_REMINDER_LEAD_MS = 48h`, line 15) is likewise fixed with no recorded rationale for 7d/48h.
- **Why it matters**: The documented intent and the actual capability contradict each other — a clarity trap for the next engineer. Business-wise, "exploding offers" (a tight, role-specific window) are a known accept-rate accelerant for in-demand roles, while exec/senior offers often need weeks; one hardcoded 7-day window serves neither and leaves a proven conversion lever unbuilt.
- **Recommendation**: Make the TTL (and reminder lead) a per-offer input on `createOffer`/`extendOffer` with the 7d/48h constants as defaults; expose it in the offer-draft UI. Document why the defaults are what they are.
- **Effort**: M

## 4. `offer-policy.ts` governs only timing — the offer's money has no policy gate (no salary cap / approval threshold)
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: governance gap / misleading abstraction
- **File**: app/api/pipeline/[id]/route.ts:45
- **Observation**: The context gist says offers are "gated by offer policy," but the only policy module (`offer-policy.ts`) encodes TTL + reminder timing — nothing about the offer's *terms*. `extendOffer` writes whatever the draft carried: `salary: Number(draft.recommended) || null` with **no ceiling, band check, or second-approval threshold**. A draft (or a tampered/overridden figure) above budget is extended to the candidate on a single recruiter click.
- **Why it matters**: For a hiring SaaS, an offer that exceeds the role band or a budget ceiling with no second sign-off is a real financial-governance hole, and the module name "offer-policy" gives a false sense that such a gate exists — tribal knowledge that the policy is timing-only is undocumented.
- **Recommendation**: Either rename the module to `offer-expiry-policy` to stop overpromising, or (better) add a terms policy: a band/budget ceiling that flags out-of-policy salaries for a second approval before `extendOffer` dispatches. Record the policy decision on the sealed decision (already sealed at route.ts:52 — add the policy verdict to it).
- **Effort**: M

## 5. Offer conversion is invisible — "offers out" is surfaced but accept-rate / time-to-accept is not
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: dark capability / value left on the table
- **File**: messages/en.json:1117
- **Observation**: The dashboard surfaces `offersOut` ("N offers awaiting response") but there is **no accept-rate, decline-rate, expiry-rate, or time-to-accept metric anywhere** (grep for `acceptRate`/`accept_rate` returns nothing). The raw funnel data already exists as automation events (`offer_sent`, `offer_accepted`, `offer_declined`) — the conversion KPI the context is literally built around is computable today but never aggregated or shown.
- **Why it matters**: Accept rate is the headline outcome metric of this whole context; without it recruiters can't see which roles/salary bands/markets convert, can't A/B the deadline or copy, and can't justify the salary-band engine's ROI. It's a high-value analytic sitting one rollup away from data already captured — classic kp "built but never surfaced."
- **Recommendation**: Add an offers KPI rollup (accept / decline / expired / pending counts + median time-to-accept, sliceable by job and salary band) from the existing automation events — first emit `offer_expired` (finding 1) so the denominator is honest.
- **Effort**: M
