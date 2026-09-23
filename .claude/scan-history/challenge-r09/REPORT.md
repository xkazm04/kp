# /scan-sweep `--challenge` — kp, challenge-r09 (2026-09-23/24)

Method: full (strategy challenge, skill 3.5.1, cohort 8 hosts, no riders left in these groups; waves of
6/6/4, each wave run as one Workflow; 5 follow-ups). Scouted and criticised during r08's builds.
Models: scouts, builders, coordinator = claude-opus-5-5; critic = claude-fable-5-1.

## Scores

| | |
| --- | --- |
| idea_score (critic, 16 cards) | ambition 3.88 / grounding 4.75 / falsifiability 4.25; 0 premise-false, 0 void, 6 revise |
| execution_score | **12 / 16 flawless** (8 / 16 strict) |
| landed / partial / demoted / reverted | 16 / 0 / 0 / 0 |
| acceptance cases | 181 written, 176 red before, 180 green after (1 e2e case written, not runnable by builders) |
| integration failures / coordinator fixes | 5 / 5 (three perf settles, one tsc break fixed, one lens waiver) |
| follow-up builders | 5 (3 in wave 2, 2 to close the run) |
| lines changed | 13,514 (builders' count) |
| tokens | scouts 1.65M, critic 0.33M, builders 5.04M (incl. follow-ups) |
| builds wall clock | ~170 min |

Delta vs r08: grounding recovered (3.88 -> 4.75) after the scout brief began demanding verified cites;
ambition is the loop's lowest (3.88) and only 6 cards needed revision. Flawless 13 -> 12, strict 9 -> 8.
The full unit suite ran CLEAN twice this run (waves 1 and 3), the first times in the loop.

Every builder now records open ends as `loop_open` — the rule is followed. The cost has moved: gaps are
named honestly and closed by follow-ups (5 this run), so "flawless" now measures how often a card's
rule reaches every surface on its own, not whether gaps are hidden. Not flawless:
- **comms-locale-optout/A** recorded the voice-screen mint as loop_open; the follow-up that closed it
  added a refusal variant the stage hook then read `.quota` from — `tsc` red on main until the
  coordinator narrowed it (7769a80b1). The first cross-follow-up break of the loop.
- **devcase-lifecycle/B** recorded two loop_open gaps: a homework arrival silently republished stopped
  intake, and a resend handed out a dead link -> 02236bb1b, ce9dd85d0.
- **voice-provider-io/B**'s route is gated by `requireHomeOrgReader` (wraps requireOperator); the lens
  matches only the literal name -> waived on the record (a16df4d6e).
- **spark-about-illustrations/B** wrote its ninth case as an e2e spec builders cannot run.

## What moved

- **Candidate protection:** every candidate-link mint asks the send gate first — including the AI
  voice-screen mint; a suppressed arrival parks on the human queue instead of a silent skip; a
  candidate can choose the letters' language on the stop page (never un-suppressing anyone); a closed
  case's invite is never re-sent as a dead link, and a homework arrival never reopens stopped intake.
- **Matching:** one education ladder (a named school with no stated degree is uncertain, not a KO); a
  filtered-out posting names the gate and its as-if score and stops rescanning (MATCH_VERSION v2: every
  seeker row re-matches once).
- **Interviews:** human scorecards keyed by interviewer and round, a save never erases another (cap 24,
  coded refusal at the cap), shown per interviewer on the drawer and compare grid; regenerating prep
  previews its changes (keep or replace) instead of overwriting; provider traits replace provider names
  in failover and routes; an operator-triggered readiness probe per voice provider (rate-limited,
  refused offline; whether an unused mint is metered is stated as unverifiable).
- **Eval harness:** the interview eval reads a generated brief snapshot instead of a hand-kept port —
  KP_SKIP_BASELINE tightened 5 -> 4; a stale eval record names the units that moved.
- **Recruiter UX:** History is server-filtered and keyset-paged, with a triage drawer that walks the
  undecided through the same acknowledgement gate; a dev-case detail reads its own case and shows
  closed intake as closed with stop/reopen.
- **Public surface:** one Spark motion preset (reduced-motion honoured) builds the about-art reveals; all
  nine spotlights walk in one dialog addressable as `/#spotlight-<key>`.

## Owner notes

- **Matching re-run:** MATCH_VERSION `jobseeker-match-v2` re-matches every stored seeker row once.
- **Readiness probe cost:** a probe mints one credential per paid provider; whether an unused mint is
  metered is not verifiable from the code — operator-triggered only.
- **Scorecard cap:** at 24 records per entry a new interviewer/round is refused (409) rather than
  evicting an old one.
- **Homework refusals are log-only** (pre-existing design, all six reasons): the candidate stays in the
  column with no flag saying why no assignment went out. A dedicated approval kind is the named fix —
  a candidate for a later card.
- **Test runner:** re-running a failed bracketed path (`[id]`) as a glob matches 0 tests and labels a
  genuine failure FLAKE (it still fails the build). Fix touches the flake-policy gate — yours.
- **Lock takeover:** a builder took over a 14-minute lock and deleted it under its holder; no loss
  (verified). The brief now forbids removing a lock you did not create.

## Not verified

No browser pass (History triage drawer, closed-intake detail, stop-page language picker, spotlight walk,
readiness strip, prep plan diff, per-interviewer scorecards); e2e owed: `e2e/landing.spec.ts` (spotlight
walk + reduced-motion about art). All in the loop's owed list.
