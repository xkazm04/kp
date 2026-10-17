---
id: "0027"
title: Candidates are scored on proof of how they work with AI, through one channel-neutral evidence ladder, with a human at every gate
status: accepted
date: 2026-10-17
supersedes: []
superseded-by: null
tags: [scoring, devcase, matching, fairness, ai-era, human-in-the-loop]
sources:
  - pipeline/jobfit/devcase/evaluate.py
  - pipeline/jobfit/devcase/submission_eval.py
  - pipeline/jobfit/tests/test_devcase_verification_acts.py
  - pipeline/jobfit/tests/test_devcase_eval.py
---

**Status: accepted, partially implemented.** Only C1 below has landed; the rest is the
approved build order, not the state of the code.

## Context

AI-written CVs and AI-assisted work samples make two old signals unreliable: keyword
matching (the keywords are now cheap to produce) and the finished artifact (the assistant
may have produced it). The operator approved a scope on 2026-10-17 around this thesis
(the scope file is gitignored, so it is quoted here):

> grade the path, not the paper - give every candidate one channel-neutral,
> evidence-laddered read of how they work with AI (watched in the case, defended in a
> recorded debrief, quoted in the interview), and make the match score pay for proof
> instead of AI-written keywords, each step with a reasons block and a human at the gate.

The first fix showed the bias was real. Judgment credit depended on the channel a
candidate verified through: asking the assistant, writing a test, or flagging a defect in
the log. C1 (`24e67fd12`, test `bafe7b65b`) credits a verification act the same on every
channel, so two candidates who verify equally get equal judgment. Measured with
`submission_eval --count 48 --no-llm --path observed`, the judgment gap
`|ai - non_ai|` went **20.0 -> 0.0**, and the fairness gate became two-sided
(`ai_not_rewarded`).

## Decision

### 1. One channel-neutral, evidence-laddered read

Every candidate gets the same read of how they work with AI, built from three rungs of
evidence: **watched** in the case, **defended** in a recorded debrief, **quoted** in the
interview. A verification act earns the same credit whatever channel it came through.
The match score pays for proof, not for AI-written keywords. Each step carries a reasons
block and a human at the gate.

### 2. Build order (approved)

| Step | What | State |
| --- | --- | --- |
| C1 | channel-neutral verification credit | **landed** (`24e67fd12`, `bafe7b65b`) |
| C2 | witnessed timeline, zero-penalty | planned |
| C3 | decision log aims the debrief | planned |
| C4 | recorded debrief findings release holds | planned |
| C5 | keyless twin-cast match harness | planned |
| C6 | proof-paying match weights as a logged preview | planned |
| S1 | a "Working with AI tools" BARS axis | planned |
| S2 | a supplied AI-draft critique stimulus | planned |
| S3 | the evidence-ladder recruiter UI | planned |
| L1 | an offline-verifiable work-proof | planned |

### 3. Humans stay at every gate

A council of LLMs is **not** a product evaluator of candidates. The multi-model council
is a dev-time tool only. Every step above ends in a person's decision.

## Open watch item

Recorded verbatim: the gamer cohort rose 76.8 -> 82.0 while strong-weak discrimination
went 70.8 -> 76.0, to be checked in S2.

## Alternatives that lost

- **Scoring `DECISIONS.md` into judgment.** Breaks the ordinary-practice framing: writing
  decisions down is normal practice, not a thing to be graded.
- **Folding AI collaboration into the match total, and detecting tool nouns in CVs.** Tool
  nouns carry 0 weight; naming a tool is not evidence of using it well.
- **Forwarding CV probes into the frozen case.** Breaks identical materials: every
  candidate must meet the same case.
- **Fresh-challenge reuse.** Backlog; needs L1.
- **Independent human labels for matching.** An option inside C5, and costly.

## Consequences

- Credit for verification is a property of the act, not the channel; the two-sided
  fairness gate (`ai_not_rewarded`) fails if AI use alone is rewarded.
- Later steps must keep the judgment gap at zero on the observed path and report the
  gamer-cohort figure above when S2 lands.
- This record is **accepted** for the decision and **partial** for the build; update the
  table as each step ships.
- Reopen if: the gamer cohort keeps rising faster than strong-weak discrimination at S2.
