# Offers & Onboarding — bug-hunter + ui-perfectionist scan

> Context: Generate, send, and finalize candidate offers via a tokenized public offer page (accept/decline), plus the accepted-offer-token onboarding hand-off.
> Files reviewed: 12 of 12 (+ 6 dependencies: pipeline/[id] route, onboarding route, onboarding-candidate, onboarding-store, random-id, comms-dispatch sig)
> Total: 5

Note on the two seeded probes: the offer token is minted with **`randomToken("tk")`** — the CSPRNG helper (24 bytes / ~192 bits, `random-id.ts:31`), **not** `randomId()` — so token entropy is sound. Expiry **is** enforced server-side at accept: `respondToOffer` calls `expireOfferIfDue` first and the route 410s a lapsed offer (`offer-finalize.ts:21`, `route.ts:33`) — not merely rendered. Accept is CAS-guarded single-fire (`markOfferResponded`), so double-hire / duplicate `candidate.hired` is already prevented. Those are clean; the findings below are what remains open.

## 1. Re-extending an offer silently keeps the ORIGINAL terms while the re-sent letter shows the corrected ones

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: state-corruption / silent-wrong-result
- **File**: `app/_lib/offers-store.ts:289-297` + `app/api/pipeline/[id]/route.ts:46-91` + `app/_lib/offer-finalize.ts:163-172`
- **Scenario**: A recruiter extends an offer at 100k, then realizes the number was wrong (typo, negotiated raise, wrong currency), edits the draft to 120k, and clicks "extend" again to re-send. `getOrCreateOpenOffer` finds the still-`extended` row and returns it verbatim with `created: false` — the offer row's `salary`/`currency`/`expires_at` are **never updated**. But `extendOffer` re-runs `dispatchOffer(entry, draft, link, …)` with the **fresh** `draft` (120k). So the new letter states 120k while the binding accept page (`offerView` reads the stale `offer.salary` = 100k) and the offer-of-record still say 100k. `sealDecisionSafe` is also skipped (`if (created)`), so the corrected terms are never recorded in the decision SoR.
- **Root cause**: The idempotency dedup ("re-extend re-sends the SAME link") conflates "same candidate/entry" with "same terms". There is no supersede path — an open offer's terms are immutable, but the dispatch text is recomputed from the live draft, so the two diverge on any re-extend after an edit.
- **Impact**: A candidate can accept a legally-binding compensation figure that differs from the letter they were emailed. On a money-bearing, irreversible accept this is a real contractual dispute, not cosmetic.
- **Fix sketch**: In `getOrCreateOpenOffer`, when an open offer exists **and** the incoming terms differ, either UPDATE the row's salary/currency/expires_at (and re-seal) inside the same transaction, or expire the old offer and mint a fresh one. Make "the letter and the offer-of-record are minted from one snapshot" a structural invariant — never recompute the dispatch body independently of the stored row.

## 2. An empty onboarding submit permanently marks intake "submitted" and kills the one-shot pre-boarding reminder

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: validation-gap / silent-failure
- **File**: `app/onboarding/[token]/OnboardingClient.tsx:185-200` + `app/_lib/onboarding-candidate.ts:52-63` + `app/_lib/onboarding-store.ts` (`saveIntake`, `duePreboardingReminders:298-311`)
- **Scenario**: The onboarding Submit button is always enabled (`disabled={submitting}`) with no "fill at least one field" guard. If a candidate taps Submit with everything blank (misclick, keyboard, curiosity), `submitCandidateIntake` builds `clean = {}` and calls `saveIntake(run.id, {})`, which unconditionally `INSERT … ON CONFLICT` writes an intake row with empty answers. From then on: `candidateOnboardingView` reports `submitted: true` (recruiter sees "intake submitted" but it's empty), and `duePreboardingReminders` — whose `LEFT JOIN … WHERE i.run_id IS NULL` excludes any run that has an intake row — will **never** send the one-shot nudge that would have re-prompted them.
- **Root cause**: "Submitted" is modeled as "an intake row exists", and an empty payload still creates that row. The single most valuable safety net (the reminder) is suppressed by the exact accident it exists to catch.
- **Impact**: A hire's pre-boarding record stays permanently empty with no recovery prompt; the recruiter's hand-off tab shows false completion. Silent data loss on the accept→day-one window.
- **Fix sketch**: Disable Submit until at least one field is non-empty (client), and have `submitCandidateIntake` return `ok:false` / skip `saveIntake` when `clean` is empty (server) so no intake row — and no reminder suppression — results from a blank submit.

## 3. Onboarding page renders a bare "Loading…" line — the exact first-paint anti-pattern the offer page already fixed

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: missing-ui-state / CLS
- **File**: `app/onboarding/[token]/OnboardingClient.tsx:135-136`
- **Scenario**: While `GET /api/onboarding/candidate/[token]` resolves, the whole card body is `<p className="text-center text-sm text-steel">{tCommon("loading")}</p>` — one muted line in an otherwise empty card. When the view arrives the card jumps from one line to the full welcome + questionnaire height. The sibling **offer** page (`OfferClient.tsx:174-193`) was already upgraded to a shape-mirroring `<Skeleton>` block; this newly-added onboarding page reintroduced the bare-text version.
- **Root cause**: The Skeleton treatment was applied to the offer page but not copied to the onboarding page when it was added, so the design-system loading pattern is inconsistent across the two candidate-facing token pages.
- **Impact**: A new hire's first impression is a near-blank box that visibly reflows — feels broken/unofficial and is a measurable CLS hit on a high-trust page.
- **Fix sketch**: Replace the `<p>loading` with a `<Skeleton>` block that mirrors the loaded layout (monogram/eyebrow bars + intro + 3-4 field rows + button), matching `OfferClient`. Reserve card min-height so the swap doesn't jump.

## 4. The terminal success swap has no `aria-live` / focus move on either candidate page — SR users hear silence after acting

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: a11y / live-region
- **File**: `app/offer/[token]/OfferClient.tsx:233-249` + `app/onboarding/[token]/OnboardingClient.tsx:151-162`
- **Scenario**: After the candidate's most consequential action, the buttons are replaced in place by a success card — the offer "🎉 accepted" block and the onboarding "saved" block. Error banners carry `role="alert"` and the decline confirm is an `alertdialog`, but neither **success** card has `role="status"`/`aria-live`, and focus is not moved. A screen-reader user clicks Accept, hears the button's `aria-busy`, then nothing — no confirmation the offer was accepted or that an onboarding next-step CTA appeared; they must re-navigate to discover the outcome. (This was flagged for the offer page in the 2026-06-20 scan #6 and is still absent in the rewritten client, and the new onboarding page repeats it.)
- **Root cause**: Live-region treatment was applied to error/confirm paths but not the positive terminal swap, on both new client components.
- **Impact**: The success of an irreversible, high-stakes action is un-announced to assistive tech on both pages.
- **Fix sketch**: Wrap each success card in `role="status" aria-live="polite"`, and on accept move focus to the onboarding CTA (`OfferClient`) / to the "saved" heading (`OnboardingClient`). Extract a shared `<TerminalOutcomeCard>` so both pages get the announcement for free.

## 5. Offer countdown uses the candidate's local clock, so it can disagree with server-enforced expiry

- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: edge-case / clock-skew
- **File**: `app/offer/[token]/OfferClient.tsx:269-280` (`offerHoursRemaining(offer.expiresAt)` with the default `nowMs = Date.now()`)
- **Scenario**: The "X hours left" copy and the coral <48h urgency styling are computed on the client from `Date.now()`. A candidate whose device clock is skewed/back-dated sees the wrong remaining hours; an offer the **server** already considers expired can still render "12 hours left" with live Accept/Decline buttons. The accept is correctly server-enforced (submit 410s), so there is no security hole — but the button is a dead affordance and the candidate reasonably complains "it said I still had time."
- **Root cause**: The deadline instant is absolute (server-stamped ISO), but the "remaining" derivation is evaluated against the untrusted client clock rather than a server-provided `now`/remaining value.
- **Impact**: Misleading countdown and a dead Accept button under clock skew; no data risk. Pure UX correctness.
- **Fix sketch**: Have the GET response include the server's `now` (or precomputed `hoursRemaining`) and render the countdown from that, so the displayed time-left always agrees with the server's expiry decision.
