# Dev Extension — case-scenario hiring for the LLM era

> **Archived 2026-07-30.** This was the original multi-session planning doc (thesis,
> architecture, domain model, phased roadmap D0–D7). All phases described here have
> since shipped — need intake, reality reflection, role/case design, the Decisions
> gate, the Live Work Surface, the six LLM-era anti-delegation controls, submission
> evaluation, and the D4 distribution seam (local stub; 3rd-party channels still a
> known gap). Superseded by [`docs/features/dev-case/README.md`](../features/dev-case/README.md),
> which documents the shipped feature against the current code. Kept for the original
> impact analysis and domain-model rationale.

> Status: **planning + Phase D1 start**. A multi-session initiative. This doc is the
> durable spec (impact → design → phased roadmap). It rides the rails already built in
> v2 (background **tasks**, **pipeline/Decisions** human-gate, **automation** task family
> + deterministic fallbacks, the **eval** quality-gate, and the existing **GitHub analysis**).

## 1. Thesis — why a "Dev" track is different now

Writing code is commoditised: assume **100% of a candidate's code can be produced by an
LLM**. A classic take-home that grades "is the code correct" therefore measures the wrong
thing. The Dev extension grades the **durable, transferable** capabilities that
LLM-assisted engineering still demands, and that map to a *specific role*:

- **Problem framing & decomposition** — turning an ambiguous need into a plan.
- **Tooling fluency** — *how* they drive the model/agentic tools: iteration cadence,
  verification, when they override the model, the quality of their specs/prompts. **Observed,
  never asked.**
- **Judgment & verification** — do they catch the model's mistakes, test, validate, push back.
- **Architecture & systems reasoning** — structure, trade-offs, fit to the *existing* codebase.
- **Skill transfer** — does the demonstrated capability transfer to *this* role's stack and
  responsibilities (not a generic score).

Two evaluation surfaces:

1. **The case** — a designed assignment grounded in the customer's *real* codebase, with
   **covert tooling-probes**: ambiguity that rewards clarification; a subtly broken / legacy
   area that rewards reading-before-generating; a requirement where naive one-shot generation
   fails but good orchestration + verification succeeds. We never announce "we're testing your AI use."
2. **The trace** — git history (the case repo and/or the candidate's GitHub): commit sequence,
   messages, diffs → infer **"where the candidate mentally went"** — approach, iteration pattern,
   dead-ends, refactors, verification habits, whether they read before writing.

## 2. The automated lifecycle (headline)

```
Customer need            LLM analysis + reality reflection      LLM artifact design        Human gate
(stack, responsibilities, ─▶ analyze the need AND reflect it ─▶ Assignment (case) +    ─▶ recruiter reviews/
 codebase URLs/paths)        against the REAL codebase            Role description          edits/approves
                             (true stack, real complexity,        (covert tooling-probes    (Decisions)
                              gaps, what it actually is)            baked in)                    │
                                                                                                 ▼
   Scoring / comparison  ◀── Incoming evaluation (LLM):     ◀── Distribution seam (3rd-party, pluggable)
   feeds pipeline +          case→code-structure analysis,       OUT: publish role / send case
   Decisions                 commit/trace reflection,            IN:  receive candidates + submissions
                             tooling-fluency, transfer score
```

Every LLM step runs as a **background task** (tracked, dedup'd, refresh-safe). Human gates are
**Decisions** approvals. Distribution is a **pluggable adapter** (local stub first).

## 3. Architecture (rides existing rails)

- **New Python package** `pipeline/jobfit/devcase/` mirroring `automation.py`: each LLM step is a
  function with an LLM path + a deterministic fallback, a prompt-version constant, and a CLI.
  - `analyze_need(need, repoSnapshot) -> NeedAnalysis` (reality reflection).
  - `design_case(needAnalysis, role) -> CaseScenario` (covert tooling-probes).
  - `design_role(needAnalysis) -> RoleSpec` (maps to the existing `Job`).
  - `reflect_commits(commits) -> CommitReflection` ("where they mentally went").
  - `assess_tooling(trace, caseProbes) -> ToolingSignal` (fluency inferred, not asked).
  - `evaluate_submission(submission, case, repoSnapshot) -> CaseEvaluation` (case→code structure).
  - `score_transfer(evaluation, role) -> TransferAssessment` (does it transfer to THIS role).
- **GitHub analysis extension** — the existing `/api/github-analysis` already fetches repos,
  languages, **commits**, contents, readme + runs an LLM code-review for fit. Extend it (and/or a
  new `devcase` analyzer) with the reflection / tooling / transfer dimensions; reuse its fetch layer.
- **Background tasks** — kinds: `need_analysis`, `design_case`, `design_role`, `evaluate_submission`.
- **Pipeline + Decisions** — the assignment/role approval is a Decisions gate; incoming candidates
  become pipeline entries; evaluations surface as review cards (like screening/scorecard/offer).
- **Distribution adapter** — `DistributionAdapter` interface: `publish(role, case)`, `pull()` →
  submissions. Local/no-op default; seams for email / ATS / job-board (3rd-party, out of scope to
  implement fully now).
- **Eval / quality-gate** — extend the `automation_eval` pattern with reliability + LLM-judge for the
  new tasks (esp. fairness: never penalise *using* tools; reward judgment/verification).

## 4. Domain model (Phase D1)

New Pydantic models (camelCase alias `_Base`, codegen → Zod), in `devcase/models.py`:

- **`DevNeed`** — customer intake: `stack[]`, `responsibilities[]`, `codebaseRefs[]` (repo URL / local
  path), `seniorityTarget`, `notes`, `id`.
- **`RepoSnapshot`** — grounded reality pulled from a codebase: `languages{}`, `topDirs[]`,
  `frameworks[]`, `recentCommitSummaries[]`, `loc`, `readmeExcerpt`, `inferredStack[]`.
- **`NeedAnalysis`** — `realStack[]`, `statedVsRealGaps[]`, `trueComplexity`, `coreResponsibilities[]`,
  `riskAreas[]`, `reflection` (prose), `confidence`.
- **`CaseScenario`** (the assignment) — `title`, `brief`, `repoSeed` (domain-neutral starting materials
  to hand over — code for software, but documents/designs/models/etc. otherwise; alias `startingMaterials`),
  `tasks[]`, `coverProbes[]` (hidden tooling-probes + what each reveals), `rubricDimensions[]`,
  `timeboxHours`, `promptVersion`.
- **`RoleSpec`** — bridges to `Job`: `title`, `seniority`, `roleFamily`, `mustHaves[]`, `niceToHaves[]`,
  `responsibilities[]`, `languages[]`.
- **`Submission`** — `candidateRef`, `repoRef` (URL), `notes`, receivedAt.
- **`CommitReflection`** — `narrative` ("where they mentally went"), `iterationPattern`,
  `deadEnds[]`, `readBeforeWrite` (bool/score), `verificationHabits[]`, `confidence`.
- **`ToolingSignal`** — `fluency` (0..1), `evidence[]`, `probeOutcomes[]` (per cover-probe:
  did they detect/handle it), `overReliance` flags, `confidence`. *Using tools is never penalised.*
- **`CaseEvaluation`** — `dimensionScores{}`, `dimensions[]` (ordered, weight-annotated mirror),
  `strengths[]`, `concerns[]`, `summary`, links a `CommitReflection` + `ToolingSignal`.
- **`TransferAssessment`** — `transferScore` (0..100), `transfers[]`, `gaps[]`, `roleFitRationale`,
  feeds the existing match/scoring + pipeline.

## 5. Evaluation philosophy (the rubric)

Scored on the five durable capabilities (§1), NOT on lines/correctness:
- **Reward**: reading before generating, clarifying ambiguity, catching/verifying model output,
  sound decomposition, architecture that fits the real codebase, honest dead-end recovery.
- **Probe covertly**: a legacy/broken area (read-first?), an under-specified requirement
  (clarify or assume?), a trap where one-shot generation passes tests but is wrong (verify?).
- **Transfer**: weight demonstrated capability by its relevance to the *role's* stack/responsibilities.
- **Fairness invariants** (eval-gated): using an LLM is never a negative; commit reflection must be
  hedged (no over-claiming intent); no protected-characteristic inference; deterministic fallback
  for every task so the pipeline never blocks.

## 6. Impact analysis

- **Additive & low-risk**: a new package + tables + a `Dev` tab; reuses tasks/pipeline/Decisions/eval.
  No breaking changes to existing matching/automation/analyze flows.
- **Engines**: Gemini (GitHub fetch+review, already wired) + Claude CLI (new task family). Both kept.
- **New surface area**: ~7 LLM tasks + a domain model + a lifecycle UI + a distribution seam.
- **Chief risks**: (a) covert probes must be *fair and meaningful*, not gimmicks; (b) commit
  reflection can over-claim → must hedge + be quality-gated; (c) scope creep on 3rd-party
  integrations → ship the adapter interface + a local stub only.
- **Why it matters**: it's the differentiated answer to "how do you hire devs when everyone has an
  LLM" — and it reuses the app's own analysis muscles (matching, reasoning, GitHub, scoring).

## 7. Phased roadmap (multi-session)

- **D0 — plan + diagrams** *(this session)*: this doc + `docs/diagrams/dev_*.puml`.
- **D1 — foundation** *(this session, start)*: `devcase/models.py` (the domain model) + codegen → Zod
  + unit tests + DB tables + a `Dev` workspace tab skeleton.
- **D2 — need intake & reality reflection**: intake UI → `RepoSnapshot` (reuse GitHub fetch) →
  `analyze_need` (LLM + fallback) + `need_analysis` task. "Customer need → LLM analysis."
- **D3 — artifact design + human gate**: `design_role` + `design_case` (covert probes) → Decisions
  approval. Role maps into the existing `Job`/pipeline.
- **D4 — distribution seam**: `DistributionAdapter` interface + local stub (publish + pull).
- **D5 — GitHub/commit reflection**: deepen commit analysis (`reflect_commits`) + `assess_tooling`
  (probe outcomes) extending the existing GitHub analyzer.
- **D6 — incoming evaluation & scoring**: `evaluate_submission` + `score_transfer`; candidates →
  pipeline + Decisions review cards; compare/rank (extends matching).
- **D7 — quality gate + end-to-end**: `devcase_eval` (reliability + LLM-judge, fairness invariants);
  wire the full lifecycle; `--no-llm` smoke.

## 8. Open questions for the customer (non-blocking; sensible defaults chosen)

- Distribution targets to prioritise (email / ATS / job board) — D4 ships the seam + local stub.
- Rubric weights per role family — defaults proposed in §5; tunable like the automation `POLICY`.
- Whether the case is completed in a provided repo (preferred — gives the trace) vs candidate's own GitHub.
