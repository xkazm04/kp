---
name: case-sim
description: Candidate-simulation harness for the dev-case module — N model-driven candidate personas solve a vague repo-grounded case, the real devcase evaluation pipeline scores them, the orchestrator judges discrimination and harvests the best output back into the codebase (2-in-1).
---

# /case-sim — simulated candidates vs. the case pipeline

Purpose: continuously test that the Case-assignment module **discriminates in the
LLM era** — when every candidate uses a model, do the scores separate judgment,
verification and ownership from pure delegation? And since the case is a real
problem in THIS repo, the winning submission is harvestable: review it, merge the
good parts, ship (the 2-in-1 loop).

Vault: `casesim/` (one folder per round: `casesim/round-YYYY-MM-DD[-slug]/`).

## Protocol

1. **Design the case** (orchestrator, not a subagent):
   - Pick a REAL, bounded improvement opportunity in this repo (something you'd
     accept a PR for). Write `case.json` in CaseScenario shape: vague-on-purpose
     brief, 2-4 tasks, coverProbes with decisionSpace, a midFlightUpdate, and a
     DECISIONS-log task. Timebox ≤ 2h equivalent.
   - Write `role.json` (RoleSpec). Optionally materialize a seed with
     `devcase_cli materialize-seed` (canaries included) — for repo-grounded rounds
     the "seed" is the repo itself; list the relevant starting files instead.
   - **Base-consistency rule (round-3 finding):** persona worktrees branch from
     the last COMMIT, not the working tree. Seed files (and every canary fragment)
     MUST match that committed base — `git show HEAD:<path>` is the source for
     seed.json, and a canary planted in uncommitted code is invisible to the
     candidates (its verdicts read falsely "addressed"). If the target area is
     uncommitted, either commit first or paste the seed files into the persona
     prompts as the explicit starting materials.

2. **Spawn candidate personas** — one subagent per persona (Sonnet, worktree
   isolation), all in parallel, each given: the brief + tasks (NEVER the probes,
   canaries, `reveals`, or the midFlightUpdate — deliver the update mid-prompt as
   "partway through, this message arrives: …"), plus its persona instructions.
   Canonical personas (extend freely):
   - `delegator` — one-shots the whole brief to the model, accepts output, no
     questions, perfunctory DECISIONS log.
   - `prompt-crafter` — decomposes well, iterates with the model, but ships with
     minimal verification.
   - `verifier` — reads before writing, asks the stakeholder clarifying
     questions, verifies (runs checks/tests), catches planted flaws, adapts to
     the mid-flight update, rich DECISIONS log.
   - `minimal` — smallest defensible change, honest about what was skipped.
   Each persona must WRITE its work in its worktree AND save a bundle to the
   round folder: `bundle-<persona>.json` =
   `{persona, files:[{path,contents}], decisions, events:[{t,kind,path,size?}],
     chat:[{channel,role,text}], questionsAsked:[…], notes}`.
   Events/chat are the persona's SELF-REPORTED process, emitted in-character
   (the delegator reports one bulk paste; the verifier reports opens-before-edits
   and stakeholder questions) — the sim tests the PIPELINE's discrimination, so
   the trace must faithfully encode the strategy.

3. **Evaluate through the real pipeline** — per candidate, run:
   `python -m pipeline.jobfit.devcase.devcase_cli evaluate-submission
    --commits-json [] --probes-json <case probes> --case-json --role-json
    --events-json <bundle.events> --chat-json <bundle.chat>
    --files-json <bundle.files> [--seed-json …] [--baseline-json …] [--no-llm]`
   Save each envelope as `eval-<persona>.json`. Prefer the LLM path; the
   deterministic fallback is acceptable for structure-only rounds.

4. **Judge** (orchestrator): rank by dimension scores + authenticity-style
   signals + observedChecks. Check the EXPECTED ORDER: verifier ≥ prompt-crafter
   ≥ minimal ≥ delegator on judgment/tooling; delegator must NOT win overall. Any
   inversion is a pipeline finding — file it, don't tune it away silently.

5. **Harvest (2-in-1)**: review the best submission(s) as you would a PR; merge
   the good parts into the repo (adapt, don't paste blindly); run the gates
   (`npm run typecheck`, `npm run test:unit`, targeted lint). Credit the winning
   persona in the round report.

6. **Report** — `report.md` in the round folder: case summary, per-candidate
   scores table, discrimination verdict (with any inversions), what was merged,
   and pipeline improvements to make before the next round.

## Invocation

`/case-sim` → run a full round (design → spawn → evaluate → judge → harvest → report).
`/case-sim judge <round>` → re-judge an existing round's bundles.
Resume: the vault is the state — re-read the newest round folder and continue at
the first missing artifact.
