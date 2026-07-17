# Offers & Onboarding — ambiguity-guardian + ui-perfectionist scan

> Total: 5 findings (0 critical, 1 high, 3 medium, 1 low)

## 1. Offer terminal transitions hard-code the default workspace, so a non-default-team candidate's response silently never lands
- **Severity**: High
- **Lens**: ambiguity
- **Category**: tenancy-default-param-dropped
- **File**: `app/_lib/offer-finalize.ts:67` (accept) and `app/_lib/offer-finalize.ts:148` (decline)
- **Scenario**: With multi-workspace tenancy (KP_MULTI_WORKSPACE / tenancy.ts allowlist, which lists `offers` as verified), a candidate whose pipeline entry belongs to a non-default workspace accepts their offer. The offer row flips to `accepted` and the page says "accepted" — but `actOnPipelineEntry(offer.entryId, "accept", …)` omits its trailing `workspaceId` param (defaults to `DEFAULT_WORKSPACE_ID`, `db/pipeline.ts:1615,1619`), so the by-id read matches nothing, `hired` is null, and the code records a **misdiagnosed** `offer_accept_blocked: "accepted on a closed entry"` event — no Hired transition, no onboarding run, no welcome dispatch. The decline path is identical: `markEntryStatus(offer.entryId, "declined")` never passes a workspace, and `offers-store.ts:379-385` filters `AND workspace_id = ?` with the default — the decline is dropped and the warn log blames a "stale/duplicate offer decline".
- **Root cause**: `createOffer` carefully stamps the entry's `workspace_id` onto the offer row (`offers-store.ts:151-157`), but `rowToOffer` (`offers-store.ts:100-122`) never maps it into `OfferRow`, so `respondToOffer` literally cannot pass the right tenant even if it wanted to. Both terminal writes fall back to optional-parameter defaults, and `offers-store.test.ts` only exercises the default workspace, so nothing pins the cross-workspace path.
- **Impact**: On any non-default workspace, the single most consequential candidate action in the product half-completes: the offer says accepted but the hire never materializes (or the decline never closes the entry), with audit events that actively point operators at the wrong cause. Dormant today, guaranteed breakage the day multi-workspace is switched on — despite `offers` being on the "verified scoped" allowlist.
- **Fix sketch**: Add `workspaceId` to `OfferRow` (map `r.workspace_id` in `rowToOffer`), then thread it through both terminal calls: `actOnPipelineEntry(offer.entryId, "accept", undefined, { actor: "system" }, offer.workspaceId)` and `markEntryStatus(offer.entryId, "declined", offer.workspaceId)`. Extend `offers-store.test.ts` with a non-default-workspace entry proving both transitions fire (they fail today).

## 2. "Material change" on re-extend excludes the job title, so the accept page can render a different role than the re-sent letter
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: silent-materiality-assumption
- **File**: `app/_lib/offers-store.ts:308-311` (termsChanged) and `:319-324` (UPDATE column list)
- **Scenario**: A recruiter notices the offer letter says "Senior Backend Engineer" but the role is "Staff Backend Engineer" (or the candidate label is misspelled), fixes the draft, and re-extends. The re-dispatched letter is minted from the live draft, but `termsChanged` only compares `salary` and `currency` — a title-only correction is classified "not material", so the stored row (which `offerView` → `OfferClient` renders as the page's `<h1>`) keeps the old title and even the refreshed `payload_json` is skipped. Worse, when salary *does* change alongside a title fix, the UPDATE writes `salary, currency, expires_at, payload_json` but never `job_title` or `candidate_label` — so the binding accept page permanently shows the stale role next to the corrected number.
- **Root cause**: The comment defines the invariant as "the accept page and the letter are one snapshot", but "material" was silently narrowed to two columns. The definition of which fields constitute the offer-of-record is undocumented, and the UPDATE's column list drifted from the INSERT's.
- **Impact**: A candidate can accept an offer page whose role title (the thing they're accepting a job *as*) differs from the letter they were emailed — precisely the divergence this code block exists to prevent, just on a different field. Disputes here are contractual, not cosmetic.
- **Fix sketch**: Include `jobTitle` (and `candidateLabel`) in the `termsChanged` comparison and add both columns to the UPDATE. Alternatively, document explicitly that title/label are immutable per offer row and force a new offer for those changes — but pick one and state it; today the code implies snapshot-consistency it doesn't deliver.

## 3. Short-TTL offers trigger the "deadline approaching" reminder immediately — offer email and nudge arrive a minute apart
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: policy-interaction-unhandled
- **File**: `app/_lib/offers-store.ts:234-249` (dueOfferReminders window) with `app/_lib/offer-policy.ts:13` (OFFER_TTL_DAYS_MIN = 1) and `:47` (48h lead)
- **Scenario**: A recruiter uses the documented "exploding offer" lever and extends with `ttlDays: 1` (or 2). The offer's `expires_at` (now+24h) is already inside the reminder window (`> now AND <= now + 48h`) at mint time, so the next heartbeat tick (~60s later) CAS-claims and sends the T-48h "your offer is about to expire" nudge — the candidate receives the offer email and an urgency reminder essentially simultaneously, and their one-shot reminder is burned before it could ever serve its purpose.
- **Root cause**: `OFFER_TTL_DAYS_MIN` (1 day) and `OFFER_REMINDER_LEAD_MS` (48h default) were designed independently; nothing in `isOfferReminderDue`/`dueOfferReminders` considers the offer's *creation* time, so any offer whose whole lifetime fits inside the lead window is "due" from birth. The policy file documents each constant but not their interaction.
- **Impact**: For exactly the high-pressure offers where tone matters most, the candidate gets what reads as an instant nag (or a duplicate email), and the genuinely useful mid-window nudge can never happen. Recruiters get no signal this occurred.
- **Fix sketch**: In `dueOfferReminders`, add a minimum age guard (e.g. `created_at <= now - X` or require `expires_at - created_at > leadMs`), or scale the effective lead to `min(leadMs, ttl/2)` in `isOfferReminderDue`. Document the chosen rule in offer-policy.ts next to the two constants.

## 4. Deadline countdown is a one-shot snapshot — a tab left open shows stale "hours left" and a hardcoded 48h urgency threshold
- **Severity**: Medium
- **Lens**: ui
- **Category**: stale-time-display
- **File**: `app/offer/[token]/OfferClient.tsx:291-302`
- **Scenario**: A candidate opens the offer Friday evening ("18 hours left", steel-colored since… actually coral) and leaves the tab open while deciding. The copy never changes: `hoursRemaining` is computed once server-side at GET and never re-fetched or ticked, so hours later the page still asserts the old figure — potentially "2 hours left" long after the offer expired. Only on pressing Accept do they discover the truth via the 410 → expired card swap. Separately, the urgency color flips at a hardcoded `hrs <= 48` while the actual reminder lead is deployment-configurable (`KP_OFFER_REMINDER_LEAD_HOURS`, 1–168h), so a deployment with a 24h lead shows "urgent coral" for a window twice its real policy.
- **Root cause**: The (correct) clock-skew fix moved the computation to the server but left no refresh mechanism on the client, and the 48 literal duplicates `defaultOfferReminderLeadHours()`'s default rather than deriving from server data.
- **Impact**: On the single most time-sensitive page in the product, the time display is only trustworthy at first paint. A candidate can believe they have hours they don't — the exact harm the server-computed countdown was built to prevent, reintroduced by staleness instead of skew.
- **Fix sketch**: Return `serverNow` alongside `hoursRemaining` in `offerView`, compute a client-server clock offset once, and tick the displayed hours locally from `expiresAt + offset` (skew-safe and live); additionally refetch on `visibilitychange`. Have the server include the reminder-lead hours in the view (or a boolean `urgent`) so the coral threshold follows deployment policy instead of a magic 48.

## 5. Onboarding Submit is disabled with no explanation of why
- **Severity**: Low
- **Lens**: ui
- **Category**: unexplained-disabled-control
- **File**: `app/onboarding/[token]/OnboardingClient.tsx:218-233` (gate defined at `:60`)
- **Scenario**: A new hire lands on the pre-boarding questionnaire; before typing anything, the Submit button sits at 60% opacity and does nothing when clicked. There is no helper text, no validation message, and — because disabled buttons are removed from tab order and fire no events — a screen-reader or keyboard user gets zero feedback about what would enable it. The blank-submit guard (`hasAnyIntakeAnswer`) is a sound server-mirrored rule, but its UI expression is silence.
- **Root cause**: The `canSubmit` gate was added as a data-integrity fix (blank intake rows killed the one-shot reminder) with `disabled={… || !canSubmit}` as the whole UX; the sibling offer page's careful state messaging wasn't mirrored here.
- **Impact**: A confused hire on their highest-goodwill day may assume the page is broken and close the tab — exactly the drop-off the pre-boarding reminder machinery exists to fight, and that reminder only fires once.
- **Fix sketch**: Keep the gate but add a persistent hint below the button (e.g. "Answer at least one question to submit") wired via `aria-describedby`, or switch to an enabled button that, on empty submit, shows the inline validation message and focuses the first field. Either preserves the server rule while making the requirement perceivable.
