# /scan-sweep `--challenge` — kp, challenge-r06 (2026-09-23)

Method: full (strategy challenge, skill 3.5.1, cohort 8 hosts + 3 riders, waves of 6/6/4 + 1 follow-up).
Scouted during r05's builds; built after r05 closed. Deck approval: in advance for the loop.
Models: scouts, builders, coordinator = claude-opus-5-5; critic = claude-fable-5-1.

## Scores

| | |
| --- | --- |
| idea_score (critic, 16 cards) | ambition 4.44 / grounding 4.88 / falsifiability 4.56; 0 premise-false, 0 void, 4 revise |
| execution_score | **15 / 16 flawless** (11 / 16 strict) |
| landed / partial / demoted / reverted | 16 / 0 / 0 / 0 |
| acceptance cases | 173 written, 165 red before, 173 green after |
| integration failures / coordinator fixes | 4 / 4 (three combined-growth perf settles, one barrel import) |
| lines changed | 12,503 (builders' count) |
| tokens | scouts 1.80M, critic 0.25M, builders 3.65M (incl. one follow-up) |
| builds wall clock | ~80 min |

Delta vs r05: idea score up on all three axes (3.69/4.50/4.19 -> 4.44/4.88/4.56); flawless 14 -> 15,
strict unchanged at 11. The 5 non-strict cards each carried declared guard cases (behaviour that must
NOT change), not a red-before miss.

Not flawless: devcase-session-api/A — its new `session-key.test.ts` imported the `app/_lib/db.ts`
barrel, taking the no-slack importer ceiling 27 -> 28; the coordinator moved it to the
`db/devcase.ts` slice (9989ad4c7). Every builder brief after W1 names the rule.

## What moved

- **Integrity (the transitions nobody owned):** re-adding a candidate is now a transition — only a
  named human door reopens a closed entry, with a `reinstated` event; hired agents move through one
  legal-transition table with a status CAS and a ledger row per move; bulk confirms sign the exact
  cohort they name, so a 30 s poll can no longer widen what one click fires.
- **Security / privacy:** each dev-case attempt gets a CSPRNG session key (sha256 at rest) — a
  shared apply link no longer lets one applicant write into another's session; entry ids stop
  embedding the applicant's email and erasure frees the identity.
- **Truthful delivery:** every candidate dispatcher returns `sent | queued | failed | refused`;
  a dead-lettered offer is not "out" (502 `OFFER_NOT_DISPATCHED`, approval stays); the offer gate
  previews the exact letter and its delivery forecast from the same composer the send uses.
- **Measurement honesty:** both analytics delta windows fold through one cohort function, tiled
  and age-matched, with thin deltas withheld below n=5; calibration labels come from the furthest
  stage reached on the ledger; the metric pack preview says how many more observations each thin row
  needs and roughly when.
- **Fairness:** a name-neutrality registry proves 38 of 41 candidate-typed scorers (3 letter
  drafters exempt with reasons); Fair Rank keys identity on candidate id, so a namesake knockout can
  no longer erase an eligible hire.
- **Candidate / recruiter UX:** status page names what is waiting on the candidate and re-sends it;
  close warns who is mid-case and mid-case candidates learn intake closed without losing work; agent
  roster rows name the next move with one action; bulk move previews what it sets off.

## Owner notes

- **Behaviour change (candidate-apply-flow/A):** an erased person whose ATS link was FORGOTTEN (a
  disconnect that drops links) now re-imports as a NEW entry instead of answering "erased". While the
  link exists the sync still answers "erased"; the erased row is never reopened, re-contacted or
  relinked.
- **Deliberate existence signal (status resend):** success, cooldown and no-address answer
  identically; only an attempted-and-failed send answers `STATUS_RESEND_UNDELIVERED` (saying "sent"
  would be a lie). Documented in `docs/features/compliance/README.md`.
- **Perf trend:** `app/page.tsx` gained 5 modules this run (three in W2 alone); task-hub routes keep
  growing ~2-7 KB per wave from shared store modules (db/pipeline.ts, core.ts, api-response.ts).
- `python-runner-concurrency` went BROKEN (fails alone) during W2 and green again in W3; the kill
  code is unchanged since 2e4883486 — environment, still the owner's quarantine call.

## Side fixes / follow-ups

21593fce5 profiles-lineage de-flake (the test raced the millisecond; product correct). Its sibling
subtest still silently skips on a same-ms save — in the loop's owed list.

## Not verified

No browser pass over the new surfaces (offer-letter preview pane, metric-pack preview, roster next
move, in-flight close warning, intake-closed banner, bulk-move preview, status next-action card);
no `npm run build`. Both are in the loop's owed list.
