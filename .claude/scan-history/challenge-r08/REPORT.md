# /scan-sweep `--challenge` — kp, challenge-r08 (2026-09-23)

Method: full (strategy challenge, skill 3.5.1, cohort 8 hosts, no riders left in these groups; waves of
6/6/3/1 + 3 follow-ups). Scouted during r07's builds; built after r07 closed. First run under the builder
brief's "close the loop your rule opens" rule (added after r07).
Models: scouts, builders, coordinator = claude-opus-5-5; critic = claude-fable-5-1.

## Scores

| | |
| --- | --- |
| idea_score (critic, 16 cards) | ambition 4.13 / grounding 3.88 / falsifiability 4.19; 0 premise-false, 0 void, 13 revise |
| execution_score | **13 / 16 flawless** (9 / 16 strict) |
| landed / partial / demoted / reverted | 16 / 0 / 0 / 0 |
| acceptance cases | 160 written, 155 red before, 160 green after |
| integration failures / coordinator fixes | 5 / 5 (three perf settles, one contradictory-guard reconciliation, one lens waiver) |
| follow-up builders | 3 (r07: 4) |
| lines changed | 10,374 (builders' count) |
| tokens | scouts 1.65M, critic 0.25M, builders 3.83M (incl. 0.42M follow-ups) |
| builds wall clock | ~110 min |

Delta vs r07: flawless 12 -> 13, strict 7 -> 9, follow-ups 4 -> 3. Grounding dipped (4.56 -> 3.88: line
cites 100-200 lines off in one card, past EOF in another); the r09 scout brief now demands verified cites
and r09 grounding recovered to 4.75.

The loop-closing rule worked where builders used it: archetypes/A and llm-runtime/B each recorded their
open end under `loop_open` with the exact file, and both ends were closed (6b9191034; llm-runtime/A
closed tasks.ts). Not flawless:
- **candidate-rediscovery/A** named `POST /api/pipeline` as ungated in prose, not as `loop_open` ->
  126f10fdd refuses a rediscovery/sourcing re-surface of an opted-out / consent-lapsed person.
- **pipeline-candidate-drawer/B** left refused-channel rows counted as "needs you" in two lists and raised
  the task-hub module ceiling for a re-export a local copy avoids -> c37558e67 + cbc5c0c1f; its own guard
  then contradicted the follow-up and the coordinator reconciled it (8c9d8bf34).
- **workspace-shell-core/B** added `/api/me/capability-holders` gated by `requireCapability("read")`,
  which the constitution lens does not recognise -> waived by name in the close commit.

## What moved

- **Engine:** Python spawn failures are typed (`SpawnFailure`); six regex readers converted; ENGINE_BUSY
  answers 503 on four more routes; admission lanes put a waiting person ahead of background work; task
  rows store a failure code, translated on five surfaces.
- **Fairness / matching:** one live archetype-registry reader drives the screening wave, the fairness
  re-check, the matrix cache and (follow-up) the analysis cache; Czech feminine agent nouns earn the same
  transferable skills as masculine ones, inflections included; a floor move previews who it pulls into
  auto-reject reach before Apply, writing nothing.
- **Candidate protection:** one eligibility gate at rediscovery rank, write, read and send; the
  silver-medalist feed is person-first with per-role outcomes; a re-surface add of a withheld person is
  refused.
- **Comms truth:** a bounced or failed letter is flagged on opening the candidate and re-sent from there;
  the three surfaces share one recovery-door rule; refused-channel rows no longer ask for action.
- **Voice:** one call-transport contract (one permitted provider-keyed line); a dropped call saves its
  record first, then offers a cancellable redial; the orb animates on ElevenLabs calls.
- **Shell:** the root page seeds the principal (three `/api/workspaces` GETs -> 0, no lock flash); tabs
  render through an exhaustive `Record<WorkspaceTabId, …>` registry (idea-47b71431); a seat arriving at a
  tab it cannot open lands on a locked panel naming the permission and who holds it.
- **Test harnesses:** one Python CLI harness reading the wire through the bridge's own reader (a shared
  case table runs against the TS and Python readers); devcase fakes answer in text and a one-key trailing
  object can no longer replace a genuine answer (it silently did on two multi-key steps).

## Owner notes

- **Task lanes:** every task kind now waits in the background lane (up to 10 min) instead of being refused
  at 20 s — including an analysis a recruiter is watching.
- **Analysis cache:** the key now carries the live archetype-registry digest — every cached analysis
  misses once on deploy and once after each registry edit.
- **Custom archetypes:** one registered as unprotected can now be auto-rejected (as it already could in
  Python); an unreadable registry keeps them protected.
- **Non-challenge session in the checkout:** its journey-cohort commit 1e52a019f added 7 page modules
  with no ceiling raise (settled by name, c7690bd4a) and a route the constitution lens BLOCKS
  (`app/api/journeys/cohort/route.ts`: currentWorkspace() behind the proxy, no requireOperator, the same
  posture as its sibling). Deliberately not waived here — that session's call.
- **Lens gap, second occurrence:** route-auth-posture does not recognise `requireCapability` /
  `requireOrgCapability`; two waivers now (billing alerts, capability holders). Teaching the lens those
  guards is a gate edit (ADR 0007) — yours to approve.
- `python-runner-concurrency` fails alone on this box; a standalone repro could not even spawn
  `node -e` (EPERM) — environment, not code; quarantine or investigate on a clean machine.

## Not verified

No browser pass (reconnect notice, person-first feed, locked-tab panel as a viewer on `?tab=billing` in
both themes, floor preview, drawer SWR and letters-needing-you, orb on ElevenLabs); no `npm run build`;
no live dropped call. All in the loop's owed list.
