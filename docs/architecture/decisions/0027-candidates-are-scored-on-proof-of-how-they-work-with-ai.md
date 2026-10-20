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
  - pipeline/jobfit/devcase/ai_drafts.py
  - pipeline/jobfit/tests/test_devcase_ai_draft.py
  - pipeline/jobfit/tests/test_devcase_verification_acts.py
  - pipeline/jobfit/tests/test_devcase_eval.py
---

**Status: accepted, partially implemented.** C1 to C6 below have landed. On 2026-10-18 the
operator adopted the C6 weights as the default scorer (landed, see the dated decision
below), and C6b "close the leaks" has landed on top of it. S1 and S2 landed on 2026-10-18;
S3 and L1 are still the approved build order.

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
| C2 | witnessed timeline, zero-penalty | **landed** (`171348563`) |
| C3 | decision log aims the debrief | **landed** (`62bbd7ccb`, `fd513167a`) |
| C4 | recorded debrief findings release holds | **landed** (`e8c97df61`) |
| C5 | keyless twin-cast match harness (`pipeline/jobfit/eval/matching_era_eval.py`) | **landed** (`2fdc4fe5`) |
| C6 | proof-paying match weights as a logged preview | **landed as an opt-in preview** (`4145c47bb`, `ccc839eaa`, `5fd3430d0`, `d3f500f68`); **adopted as the default scorer** (`9ec98ac06`), see below |
| S1 | a "Working with AI tools" BARS axis | **landed** (`6fd0f72c8`, `74b0789ec`, `c38d34620`) |
| S2 | a supplied AI-draft critique stimulus | **landed** (`9ba252257`, `796519494`, `a1813287e`), see the watch item |
| S3 | the evidence-ladder recruiter UI | planned |
| L1 | an offline-verifiable work-proof | planned |

### 3. Humans stay at every gate

A council of LLMs is **not** a product evaluator of candidates. The multi-model council
is a dev-time tool only. Every step above ends in a person's decision.

## Decision 2026-10-18: proof weights become the default scorer

**Measured C6 result.** The opt-in preview (`PROOF_PREVIEW_WEIGHTS`) was run through the C5
harness against six targets: free-claim gain <= 2.0, best-job crossings 0 (restated below
as at most 2 of 66, each a 1-point step), proof premium
not lower, name deltas 0, 0 student/career_switcher tier losses, and a reasons line on
every changed score. Free-claim gain measured **+13.67** with **7 of 66** best-job
crossings, so the targets were **not met**.

**Decision.** The operator, as the named adopter, adopts `PROOF_PREVIEW_WEIGHTS` as kp's
default scorer anyway. The adoption delivery **landed** in `16c80ed98` (the red test pins) and `9ec98ac06` (the change). It owed:

- wiring into the product path;
- the proof runner in `pipeline/jobfit/eval/neutrality.py` `SCORERS`;
- `docs/features/matching/README.md`;
- a scorer-version stamp on stored scores;
- re-pinned C5 baselines and `test:eval:match`, with before/after recorded, and any
  candidate whose tier changes carries its reasons line.

Before -> after: free-claim gain +18.3801 -> +13.6659, best-job crossings 9/66 -> 7/66, proof
premium +24.703 -> +29.3913, name deltas 0 -> 0. Figures and method are in
`docs/features/matching/README.md`.

**Approved follow-up C6b, "close the leaks" (landed 2026-10-18).**
Discount `self_declared` claims on prerequisite and nice-to-have requirements; proof-gate
the BAU personal keyword overlap in `score_personal`; stop counting bare claims in
`transform.compute_potential` velocity. C6b uses the same harness and the same targets, the
frontier is reported honestly, a target is never loosened, and the `expectedFailure` tests
flip when met.

Landed one commit per leak, each test-first (`pipeline/jobfit/tests/test_matching_c6b_leaks.py`):
(a) `b6bd61a4e`, a new lever `self_declared_requirement` = 0.05 on prerequisites and
nice-to-haves; (b) `e715216eb`, a bare skill claim counts 0.05 of a keyword hit in
`score_personal` under the proof weights; (c) `abeff477e`, bare claims add at most one skill
(`BARE_CLAIM_VELOCITY_CAP` = 1) of learning velocity. The stamp is now
`proof-weights.2-lam0.8-sd0.05-sr0.05`, so C6 and C6b scores stay distinguishable in storage.

| target | legacy | C6 (adopted) | C6b | met |
|---|---|---|---|---|
| free-claim gain <= 2.0 | +18.3801 | +13.6659 | **+1.2283** | yes |
| best-job crossings at most 2 of 66, each a 1-point step (restated 2026-10-18; was 0) | 9/66 | 7/66 | **2/66** | **yes** |
| proof premium not lower than C6 | +24.703 | +29.3913 | +41.8304 | yes |
| name deltas 0 | 0 | 0 | 0 | yes |
| 0 student/career_switcher best-job tier losses | – | 0 | 0 | yes |
| every changed score carries a reasons line | – | 0 unexplained | 0 unexplained | yes |

**Crossings frontier.** The velocity lever (c) trades the last crossings one-for-one against the
protected-cohort target. Dropping bare claims from velocity outright reaches 0/66, but two
students who hold one bare claim beside real evidence lose their strong tier at their best job
(cand-009 73 -> 69, cand-045 71 -> 69). The cap of 1 is the setting that keeps every met target
met. The two crossings left are +1-point steps over a tier line (cand-031 @ job-018 69 -> 70,
cand-061 @ job-114 54 -> 55).

**Operator decision 2026-10-18: keep the cap.** The cap-vs-drop sweep from `abeff477e`: drop =
0/66 crossings but 2 protected losses; cap 1 = 2/66, 0 losses. The operator accepts the 2 of 66
one-point crossings rather than drop bare claims from velocity, because that would cost two real
students (cand-009, cand-045) their strong tier, and protecting a real student who lists one bare
skill beside real evidence outranks the last two crossings. The target is restated as **at most
2 of 66, each a 1-point step**, and is met at 2/66. It is pinned by a passing ratchet,
`test_target_free_claim_crossings_at_best_job_at_most_2_of_66`, which goes red if the count
rises or a crossing steps by more than 1 point. No other target was loosened.

**Alternative that lost:** keep proof weights as an opt-in preview until every target is
met.

**Constraint that decided it:** the operator chose to move the product onto the proof path
now and close the gap in C6b.

## Open watch item

Recorded verbatim: the gamer cohort rose 76.8 -> 82.0 while strong-weak discrimination
went 70.8 -> 76.0, to be checked in S2.

**Checked at S2 (2026-10-18).** Both figures are margins over the strong cohort on the
rubric-weighted case score: "gamer" is strong minus the AI-no-verify cohort, "discrimination"
is strong minus weak. Measured with `submission_eval --count 48 --no-llm --path observed`,
before S2 (`8dbe8ddfe`) and after it (`a1813287e`, the observed cast carrying the draft):

| figure | before S2 | after S2 |
|---|---|---|
| strong / weak / gamer mean | 92.0 / 16.0 / 10.0 | 92.0 / 16.0 / 10.0 |
| gamer margin (strong - AI-no-verify) | 82.0 | 82.0 |
| strong-weak discrimination | 76.0 | 76.0 |
| judgment gap `\|ai - non_ai\|` | 0.0 | 0.0 |
| draft caught rate: careful_verifier / ai_then_verify / ai_no_verify | - | 100% / 100% / 0% |

The gamer margin did not rise faster than discrimination: neither moved, so the reopen
trigger below is not met. Read that honestly: on this synthetic cast the verification term
is already at its ceiling (verifiers 100, non-verifiers 0 judgment), and a caught planted
defect counts as one verification act however many are caught, so the draft adds no score.
What S2 changes is that keyless cases now grade real canaries at all, and that the gamer's
propagated draft flaws are named in its concerns. Keep watching on the next step that moves
the observed score.

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
  table as each step ships. C1 to C6, the default-scorer adoption, C6b, S1 and S2 have shipped; the
  C6b best-job crossings target (at most 2 of 66, each a 1-point step) is met at 2/66.
- Reopen if: the gamer cohort keeps rising faster than strong-weak discrimination at S2.
