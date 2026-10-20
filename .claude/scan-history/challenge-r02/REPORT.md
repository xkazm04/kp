# /scan-sweep `--challenge` — kp, challenge-r02 (2026-09-23)

Method: full (strategy challenge, skill 3.5.0, cohort 8 hosts + 11 riders = 19 contexts, waves of 6).
Deck approval: in advance for the coverage loop (operator, 2026-09-23). Excluded: none — db-jobs/A was
revised by the critic so billing stays exactly as it was (a parity test replays three-team sequences).
Models: scouts, builders, coordinator = claude-opus-5-5; critic = claude-fable-5-1.

## Scores

| | |
| --- | --- |
| idea_score (critic, 16 cards) | ambition 3.88 / grounding 4.63 / falsifiability 4.13; 0 premise-false, 0 void, 1 revise |
| execution_score | **12 / 16 flawless** (10 / 16 strict) |
| landed / partial / demoted / reverted | 16 / 0 / 0 / 0, plus 1 follow-up builder (landed) |
| acceptance cases | 179 written, 173 red before, 178 green after (1 e2e case owed a prod build) |
| integration failures / coordinator fixes | 4 / 3 (plus one combined-growth budget raise) |
| lines changed | 12,803 (builders' count) |
| tokens | scouts 1.90M, critic 0.31M, builders 3.53M |

Not flawless: analyze-engine/A (the GitHub stage registered only by its route; moved to boot in
b2717405d, which also took the route's graph back from 239/3099 to 226/3005), devcase-eval/B (a new test
value-imported the db barrel, 28/27 — 366d0e10c), db-jobs-devcase-interviews/A (left ~40 recruiter
reads on the filing team's lifecycle; follow-up builder threaded the caller's team, d7f8e1e88), llm-api/A
(its e2e acceptance case needs a prod build — owed at loop end).

## Wave size 6 (r01 used 4)

Held: 17 builders across 3 waves in one shared checkout, zero cross-builder staged-file contamination,
the mkdir lock contended but never corrupted (one coordinator mistake — an unconditional `rmdir` after a
failed `mkdir` deleted a builder's lock; restored within seconds, brief now forbids the shape). Cost: every
builder saw whole-tree gates red from siblings' uncommitted files and had to reason about it; the
integration gate on the committed tree is what decided, and it found 4 real breaks.

## Security / correctness found on the way (fixed outside the cards)

- a9bd69f62 — companion brain recall ignored workspace_id: one team's companion could surface another
  team's conversation turns (found by the llm-api scout's rider read).
- llm-api/A — sim doors could overwrite a real candidate's pending approval / read a real offer token.
- db-jobs/B — a revoke during connect still sent provider credentials; a late scorecard could overwrite a
  GDPR erasure.

## Not verified

UI surfaces (About transport, analyze restore note, schedule pending cards, model-routing chips, promote
verdict, spare toggle) were not looked at in a browser in either theme — builders may not run dev servers.
`npm run build` not run (operator dev servers hold `.next`).
