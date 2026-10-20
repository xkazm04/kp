# /scan-sweep `--challenge` — kp, challenge-r04 (2026-09-23)

Method: full (strategy challenge, skill 3.5.1, cohort 8 hosts + 3 riders = 11 contexts, waves of 6).
Scouted during challenge-r03's builds; built after r03 closed. Deck approval: in advance for the loop.
Models: scouts, builders, coordinator = claude-opus-5-5; critic = claude-fable-5-1.

## Scores

| | |
| --- | --- |
| idea_score (critic, 16 cards) | ambition 4.00 / grounding 4.44 / falsifiability 4.25; 0 premise-false, 0 void, 6 revise |
| execution_score | **13 / 16 flawless** (8 / 16 strict — five cards wrote declared no-regression guards) |
| landed / partial / demoted / reverted | 16 / 0 / 0 / 0, plus 1 follow-up builder (landed) |
| acceptance cases | 238 written, 219 red before, 238 green after |
| integration failures / coordinator fixes | 5 / 4 (three of them combined-growth perf settles) |
| lines changed | 14,161 (builders' count) |
| tokens | scouts 1.71M, critic 0.27M, builders 3.77M |
| builds wall clock | ~117 min for three waves of 6 / 6 / 5 |

Not flawless: github-repo-intelligence/A (its transport rode onto the workspace page graph — the
coordinator moved `parseRepoRef` to an import-free leaf, 448816081), decisions-review-ui/B (the undo
window covers rejects only; accepts still commit on click, because their handoffs live outside the card's
write set — a sound scoping, logged as a follow-up), profile-editor/B (edited a keyless e2e spec it
could not run — owed at loop end).

## What moved

- **Fairness.** A throttled / unreadable GitHub repo no longer costs a dev-case candidate 40 authenticity
  points; the skill ledger replaces the accusatory "Unverified claims" lists (and a follow-up removed the
  last two surfaces that still painted absence of public evidence as a failure).
- **Security / integrity.** One session issuer for all five sign-in doors (a disabled user can no longer
  renew through switch-workspace); webhook idempotency claims are durable and store only sha256 of the
  key (a post-restart replay can no longer re-decline a lead and re-email a rejection); tenant tables key
  uniqueness by team, with an executed rollback drill.
- **Recruiter UX.** 8-second undo on a one-click reject (keepalive commit on page exit); a failed single
  decision finally says so; the Analytics tab scopes to one role and names every figure it withholds;
  the profile editor's crash backup restores three-way and never silently overwrites a colleague's save;
  a lapsing session warns and re-signs in over the page.
- **Demo + evals.** Every scripted demo click proves its effect (two had silently broken since
  2026-09-16/17) and a reloaded walk resumes; the keyless evals certify a recorded measurement, and the
  shared fallback runner states a coded reason on every degradation.
- **Budget.** test:perf is fully green from 3993c0adc on (llm-config and job-ingest, red since before the
  challenge runs, were settled with their why).

## Side fixes found by run 5's scouts during this run (outside the cards)

- 9e834cf04 — SECURITY: POST /api/tasks accepted kind "analyze" with client paths: arbitrary file read and
  a recursive delete of any writable directory. Refused at the door, confined in runAnalyze, and
  cleanupWorkdir now deletes only jobfit workdirs.
- e00c802fc — the keyless devcase fallback graded unassessed probes as failures (judgment halved).

## Not verified

No browser pass (session-lapse dialog, undo strip, SLA/readiness/ledger surfaces, sim resume); no
`npm run build`; keyless e2e subset owed (profile-builder, token-doors-axe). `python-runner-concurrency`
remains a pre-existing Windows timing flake.
