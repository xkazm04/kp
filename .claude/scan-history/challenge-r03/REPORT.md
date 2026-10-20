# /scan-sweep `--challenge` — kp, challenge-r03 (2026-09-23)

Method: full (strategy challenge, skill 3.5.1, cohort 8 hosts + 5 riders = 13 contexts, waves of 6).
Scouted in parallel with challenge-r02's builds (`--in-flight`), built after r02 closed.
Deck approval: in advance for the coverage loop. Excluded: none.
Models: scouts, builders, coordinator = claude-opus-5-5; critic = claude-fable-5-1.

## Scores

| | |
| --- | --- |
| idea_score (critic, 16 cards) | ambition 3.94 / grounding 4.69 / falsifiability 4.31; 0 premise-false, 0 void, 5 revise |
| execution_score | **13 / 16 flawless** (11 / 16 strict) |
| landed / partial / demoted / reverted | 16 / 0 / 0 / 0 |
| acceptance cases | 157 written, 146 red before, 157 green after |
| integration failures / coordinator fixes | 5 / 5 (2 of them combined-growth perf raises) |
| lines changed | 12,300 (builders' count) |
| tokens | scouts 1.88M, critic 0.28M, builders 3.31M |
| builds wall clock | ~80 min for three waves of 6 / 6 / 4 |

Not flawless: platform-auth-api/A (it recorded but did not close the palette's deployment-wide previews —
coordinator fix a3b01f494 gates them on the home org), pipeline-board-ui/A (left two comments claiming
per-browser SLAs — 2effa278c), devcase-workspace/A (its new ledger store was outside the doc map —
bb323ff1f).

## What moved

- **Budget given back.** glyph-system/A took ~274 KB of traced glyph paths off the workspace page's import
  graph and LOWERED `app/page.tsx`'s ceiling 8875 → 8645 KB; the rest of the run spent ~80 KB of it.
- **Security.** Deployment-wide reads (ops, health detail, LLM usage/activity, /diagrams, routing health,
  the palette previews) now require the home org, not any signed-in seat — a self-signup org could read
  this install's spend and queue before.
- **Fairness / data integrity.** One profile per CV (409 PROFILE_EXISTS, checked twice incl. inside the
  save transaction); rebuild-from-newer-CV is a field-level merge that keeps recruiter edits; blind
  analysis refuses a CV with no text layer; every refused dropped file names its reason.
- **One source for two copies.** Live voice interview route and simulator share one exchange kernel (parity
  test); readiness verdict computed once for /api/health and /api/ops; team stage SLAs feed the one aging
  clock (board, badge, automation pass).

## Not verified

No browser pass over the new surfaces (subway select/drag/menu, SLA editor, group-eval delta strip,
arriving empty state, readiness rows, analyze preflight and drop router, rebuild merge dialog). No
`npm run build`. `python-runner-concurrency.test.ts` is a genuine timing flake unrelated to this run.
