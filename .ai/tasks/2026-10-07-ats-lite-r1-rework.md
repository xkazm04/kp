# ATS egress rework: the two must-address lines of council-lite r1

Date: 2026-10-07 · Charter: accepted-idea-delivery · Feature slug: `ats-candidate-egress` · Reviewed head: `e2858518`

## Reconcile

On the base, `decision` in the `kp.ats.v1` record held only kind, reasonCode, actor, hash, policy version and time — no rationale anywhere in `ats-*.ts`. The POST path checked the owner org only in `dispatchAtsEvent` and the retry sweep, both before the slot wait. Nothing was built yet.

## Line 1 — "value: Goal 4: what is sent out carries a code and a hash, not the reasons"

`decision.rationale` + `decision.rationaleWithheld`, additive (`ATS_SCHEMA_VERSION` stays `kp.ats.v1`). `getAtsRecordResult` passes the sealed record's rationale; `buildAtsRecord` decides release.

Writer audit (every `sealDecisionSafe` site): `reject`/`holdout` (screen-wave: rank, cohort size, score, threshold, approver), `autoRatifiedScreening`, `match_fit`, `scorecard` (human and AI), `offer` are server-built from the candidate's own facts or aggregates, and are released. NOT released: group-eval `lead`/`advisory` (its sealed text names the runner-up, another candidate), `accept` (recruiter free text `detail`), schedule, reinstate and reversal codes, calibration. An unknown code is withheld by default.

`piiWithheld` records withhold the rationale whole (`null` + `rationaleWithheld: true`) rather than mask it: masking free text for a name is a guess, and the code and sealed hash still say what was decided. Inbound projection needed no change (the input field is optional).

Tests: `app/_lib/ats-egress-reasons.test.ts` (screening rejection, scored decision, absent, withheld kinds, piiWithheld with name and contact). Docs: integrations README and `comms/outbound-export.md`.

## Line 2 — "robustness: The org boundary on the webhook is checked before the queue wait, not at the POST"

`deliveryStillJustified` now receives the vetted URL from `deliver` and, as its first step (synchronous, directly before the fetch), re-reads the config and asserts: owner org still equals the entry's org (else terminal, `crossOrgRefusal` vocabulary), and URL still equals the vetted one (else retryable, reason carries no URL). The test ping passes no freshness check and is unchanged.

Tests in `app/_lib/ats-egress-org-scope.test.ts`: re-point during the slot wait, re-point during the DNS resolve (both: zero fetches, row dead-lettered with both org ids, no candidate data; both fail with the check disabled), and a URL change under the same owner (retryable).

## Not in this task

The should-change items stay queued: the `candidate.hired` transition re-assert, a longer retry ladder, an erasure event, undici lookup pinning, scoped delivery/config reads, the legacy plaintext secret, the connections ALTER.
