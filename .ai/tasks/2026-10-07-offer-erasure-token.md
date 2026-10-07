# Offer erasure: revoke the token, close the open row

**Must-address (offer-lifecycle-management lite r1, head 41e9b3e9):** "robustness:
Erasure leaves a live offer token: an erased candidate's open offer can still be
accepted." `scrubEntryLinkedPii` masked `candidate_label` and `payload_json` but kept
the token and the `extended` status, so a POST accept on the old link ran
`respondToOffer`: entry to Hired, hire meter debited, `candidate.hired` sent to the ATS.

**How it is met** (`app/_lib/db/pipeline.ts`, offers block, same synchronous transaction):
for every offer row of the erased entry, `token = NULL` (the old link answers
`OFFER_NOT_FOUND`/404), a row still `extended` moves to `expired` (the terminal state the
deadline sweep reaches anyway, so no reminder, resend, nudge, expiry event or open-offer
reader picks it up), and a later `expires_at` is clamped to the erasure moment. No new
status. Salary and currency are retained as before. `OfferRow.token` is now
`string | null`; readers skip a null token and never build `/offer/null`
(`offer-reminders.ts`, `candidate-next-action-server.ts`, `pipeline-entry-action.ts`).

**Log fix (should-change):** `offer-reminders.ts` printed `token ${offer.token}` on a
failed dispatch; it now logs the offer id and the entry id.

**Tests:** `app/_lib/offer-erasure.test.ts` (new), `erasure-full-scrub.test.ts` and
`offer-reminders-failed.test.ts` (log carries no token).

**Side effect:** the analytics offer leg will now count an erased open offer as expired.

**Not fixed here:** other token doors (e.g. `schedule_invites`) were not audited.
