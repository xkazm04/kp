# Intake lite rework — candidate-application-intake, council round 1 (ready 0.695)

Charter `accepted-idea-delivery`. Owner decision (ask 1df7d0a0): **keep the knockout automatic and say so** —
no recruiter queue or review step in front of the decline.

Reconciled against main 73d802b9c: none of the three lines was already fixed.

| # | Must-address line | Commit | Pin |
| --- | --- | --- | --- |
| 3 | craft: An unauthenticated repeat on a known address renews that person's consent and retention window | `80e63e9fc` — quick door passes proof `none` always | `reapply-capability-gate.test.ts` (new case: consent unchanged, no `re_applied`, no consent event) |
| 1 | value: A knockout decline tells the candidate nothing about why, and offers no person to contest it | `eba4a4517` — `failedKo`/`failedKoNames`/`reviewByEmail` on both doors, `ApplyDeclineDetail`, decline email at both doors (deferred) naming the must-have + review route | `app/api/apply/[id]/ko-decline-door.test.ts` |
| 2 | craft: The candidate-facing AI disclosure says 'a rejection is always a person's' while the knockout gate rejects with no person | `7e4760e8e` — 8 claim sites × 4 locales, Art. 14 summary, conformity pack + backlog | `ai-disclosure-copy.test.ts` (new exception pin), `trust-posture.test.ts`, `MarketingClaims.test.ts` |

## Decisions worth knowing

- The server can vouch for handing a message to a relay, never for delivery: `reviewByEmail` = address in hand AND
  `isRelayConfigured()`, and the copy says "we're emailing", not "we emailed". With it false the screen points at the
  hiring team directly.
- `notifyDecline` on `intakeLead` is now a no-op (kept so `inbound-lead.ts`, outside this scope, still compiles).
- `ko_declined` / `recordKnockoutDecline` / the `auto` class in `decision-attribution.ts` are unchanged; no address
  is stored in the event.
- Beyond the four named sites, four more claims were false for the same reason and were reworded: `legal.privacy.ai.sealed`,
  `about.gates.noteRejection`, `landing.proof.cards.sealed.body`, `landing.trust.art.human.lockedNote`, plus the recruiter
  `decisions.compliance.covered1`. Left alone on purpose: `interview.voice.consent` (about the interview outcome),
  `diagrams.steps.decide.summary` (the pipeline gate).
- `docs/features/intake/README.md` is the role-intake doc; the full decline contract lives in
  `docs/features/candidates/README.md` (the doc `feature-doc-map.json` couples the apply door to), with a pointer from intake.

## Out of scope (not touched)

craft-3 declined-name retention, craft-4 answers across a restart, value-2 unscored quick-apply stubs, dedupe by name.
