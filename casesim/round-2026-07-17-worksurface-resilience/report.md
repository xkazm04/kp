# case-sim round 1 — Live Work Surface resilience (2026-07-17)

First run of the candidate-simulation harness (`/case-sim`). Four Sonnet-driven
candidate personas solved the same deliberately vague, repo-grounded case — "make
working in the Live Work Surface feel safe" — in isolated worktrees; the REAL
devcase pipeline evaluated their self-reported bundles (events, chat, files).

## Scores

Deterministic pass (after the two pipeline fixes below):

| persona | framing | tooling | judgment | arch | transfer | transferScore |
|---|---|---|---|---|---|---|
| verifier | 78 | 100 | 100 | 75 | 100 | **91** |
| prompt-crafter | 78 | 70 | 50 | 64 | 60 | **64** |
| minimal | 78 | 70 | 30 | 64 | 50 | **58** |
| delegator | 22 | 30 | 0 | 50 | 15 | **23** |

LLM-judged pass (production path; reflect/evaluate/transfer/followups = llm,
tooling = observed): verifier 63 ≥ prompt-crafter 62 > minimal 44 > delegator 21.

**Discrimination verdict: PASS.** Expected order holds on both paths; the
delegator is unambiguously last, and its tells fired exactly as designed —
`briefPasteRatio 0.976` (the pasted-brief prompt), a single bulk paste event,
judgment 0/near-0. The minted follow-up questions anchor precisely where a
delegator cannot answer live (how they decomposed the brief, why the second
prompt round happened, which loss mode they prioritized and why).

## Pipeline findings (the harness's real product)

1. **Judgment was 0 for EVERY live-session candidate** on the deterministic path:
   verification habits were derived only from commits, which watched sessions
   don't have by design. Fixed — `evaluate.deterministic` now derives observed
   verification from the watched signals (edited a test 0.5, decision log kept
   warm 0.3, asked the model to verify 0.2) exposed via `tooling.signals`.
2. **Read-before-write punished file CREATION**: the verifier scored rbw 0.125
   because its new files (tests, a new lib) counted as "edited without reading",
   inverting tooling below `minimal`. Fixed — `derive_signals` now scopes the
   ratio to files that existed in the seed (`seed_paths`, threaded from
   `--seed-json`), so creating new files is never a negative.

Both fixes are covered by the re-run above (verifier: tooling 65→100, judgment
0→100) and the full unit suites stay green.

## Harvest (2-in-1)

Winner: **verifier** (also the strongest artifact on review). Merged into main,
adapted onto the current component (its worktree predated this session's chat/
watermark/perturbation additions):

- `app/devcase/apply/[token]/liveWorkDraft.ts` + `liveWorkDraft.test.ts` —
  adopted verbatim: bounded, defensively-parsed localStorage draft (mirrors the
  server route's caps; 6 unit tests).
- `LiveWorkSurface.tsx` — restore-on-mount + persist-on-change + offline
  re-buffer persistence + stale-session (404/409) self-heal + submit-time draft
  cleanup + "work restored" banner; i18n key `devApply.workSurface.restored` in
  4 locales.
- Integration fix found during harvest: the watermark stamp now REPLACES a prior
  session's mark (a restored draft that self-heals onto a fresh session would
  otherwise read as circulated work).

Not merged: delegator's monolith rewrite (unreviewable diff over the old base),
prompt-crafter's parallel localStorage layer (same idea as the winner's, less
bounded), minimal's beforeunload guard (superseded by full draft persistence —
worth revisiting as a complement later).

## Next round ideas

- Materialize a real seed with canaries + freeze a baseline so `canaryOutcomes`
  and `baselineSimilarity` discriminate too (this round exercised neither).
- Add a "gamer" persona that knows the rubric and tries to fake the signals —
  the adversarial test of the hash chain / server-recorded event kinds.
- Wire the eval to assert the expected-order invariant mechanically (a
  `discrimination: PASS/FAIL` line in eval_round.py).
