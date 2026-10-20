# ADRs for the ATS rationale and the erasure token revocations

Date: 2026-10-08 · Charter: technical-decision-capture · Docs only, no code or test changed.

## What was recorded

- **ADR 0020** (`49ce68000`): 85c810717. The ATS decision block's `rationale` /
  `rationaleWithheld` (allow-list of server-built codes, withheld whole for
  `piiWithheld` and unknown kinds) and the POST-time re-assert of the destination
  (owner org terminal, URL retryable).
- **ADR 0013 amendment** (`02f529189`): ADR 0013 governs the transition re-assert,
  not disclosure, so line 1 is a new ADR. The destination re-assert lives in 0013's
  freshness closure, so 0013 gets a dated pointer to 0020.
- **ADR 0021** (`fa1b714c9`): a7972f67d and 0e500c302 in one record: why the offer
  token is NULLed and the schedule token overwritten, and the alternatives that lost
  (new status, NULL schedule token, door check alone).

## Findings worth the owner's eye

- **The offer task record is wrong on one claim.** It says the analytics offer leg
  "will now count an erased open offer as expired". The code does not: `offer_expired`
  is emitted only by `expireOfferIfDue` and `lapseExpiredOffers` (the latter selects
  `status = 'extended'`), the erasure emits no event, and `db/analytics.ts:610` counts
  events. Whether that gap is deliberate is recorded nowhere; ADR 0021 says so and
  decides nothing.
- **Open, not decided:** the Google Calendar event of a confirmed invite keeps the
  erased candidate as an attendee. ADR 0021 lists four options for the operator.

## Gates

`npm run docs:check` passes (21 records). Commit subjects pass the commit-msg hook.
No code changed, so typecheck, lint and unit tests were not re-run (see result.json).
