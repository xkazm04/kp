# /scan-sweep `--challenge` — kp, challenge-r05 (2026-09-23)

Method: full (strategy challenge, skill 3.5.1, cohort 8 hosts + 2 riders = 10 contexts, waves of 6/6/4).
Scouted during r04's builds; built after r04 closed. Deck approval: in advance for the loop.
Models: scouts, builders, coordinator = claude-opus-5-5; critic = claude-fable-5-1.

## Scores

| | |
| --- | --- |
| idea_score (critic, 16 cards) | ambition 3.69 / grounding 4.50 / falsifiability 4.19; 0 premise-false, 0 void, 11 revise |
| execution_score | **14 / 16 flawless** (11 / 16 strict) |
| landed / partial / demoted / reverted | 16 / 0 / 0 / 0 |
| acceptance cases | 197 written, 190 red before, 197 green after |
| integration failures / coordinator fixes | 6 / 4 (three perf settles, one docstring) |
| lines changed | 12,141 (builders' count) |
| tokens | scouts 1.80M, critic 0.27M, builders 3.55M |
| builds wall clock | ~123 min |

Not flawless: analytics-metrics/B (junctioned the checkout's node_modules into a scratch worktree to
measure perf; `git worktree remove` followed the junction and deleted `.bin` and the @-scoped packages
before `@sentry` from the SHARED checkout — the builder repaired it with `npm install`; the brief now
forbids the junction), tests-pipeline-automation/A (left one stale "hand-mirrored" docstring).

**Coordinator error, recorded:** the broken local install surfaced four implicit-any errors in the Sentry
hooks. I diagnosed them as a lockfile defect and "fixed" them with local structural types (232d7158e).
The lockfile pins the nested `@sentry/core` 10.71 correctly; against the correct install those types
were themselves TS2322 errors — the fix would have broken CI's typecheck. Reverted in 42daecab4 once the
install was whole. Lesson: after any node_modules repair, re-derive a type error against `npm ci`'s tree
before blaming the lockfile.

One constitution waiver on the record (c2c6829d6): the new billing-alerts route is gated by
`requireOrgCapability('org:manage')`, which the route-auth-posture lens does not recognise.

## What moved

- **Billing (no charge changed — golden parity fixture, reused by both cards):** money alerts the app wrote
  and nobody read now reach the org owner with a resolve door; meters state their real reset date and a
  pace forecast.
- **Security / integrity:** a per-kind task door table generalises the analyze-path fix (9e834cf04) to all
  nine server-only kinds; ATS delivery claims are leased (a crash mid-POST can no longer strand a hire);
  command-bar verbs go through the one entry-action core (sealed decision, named actor, ATS event, guards).
- **Fairness / scoring:** the dev-case evaluation runs through one pipeline the CI fairness gate certifies,
  observed sessions included; the headline is the weighted sum of its dimensions and a missing dimension
  lowers confidence instead of being imputed as 50.
- **Recruiter UX:** undo a command-bar reject wave; one candidate population for roster/matrix/retire;
  counted bulk refresh of stale unedited profiles; analytics goals for custom columns and a dwell band of
  everyone waiting now; task rows state their replay verdict; ATS applications importable.
- **Gates tightened:** Python skip gate checks skips by identity; 11 cross-language constants generated.

## Side fixes during this run (outside the cards, found by r06/r07 scouts)

43f92ced0 hire-from-need body workspace (security) · 5075b3b08 devcase close rejected promoted submitters.

## Not verified

No browser pass; no `npm run build`. Flakes: `python-runner-concurrency` (pre-existing),
`profiles-lineage.test.ts` (flaked once under load, passes 6/6 alone — follow-up builder queued in r06).
