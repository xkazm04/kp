# Case-generation calibration framework (Part 1)

A repeatable harness that hardens the **case-generation** mechanism (the take-home
"case" the app designs from a job) by running it over **real, broad cross-industry
office job descriptions** and judging the output — instead of only the synthetic
scenarios `lifecycle_eval.py` has always used. It exists to attack the product's #1
known weakness: being **industry-locked to bank/Czech/tech**.

Part 2 (next session) reuses the frozen output of Part 1 to harden the
**evaluation** prompt; see "Handoff to Part 2" below.

## TL;DR

- Corpus: ~100 real office JDs pulled from the Hugging Face **datasets-server REST
  API** (no auth/key), classified into 13 broad office families, stratified for breadth.
- Engine: the real production chain `analyze → role → case` on the **Claude Code
  CLI** (subscription), routed per devcase use-case exactly like `devcase_cli`.
- Judge: an automated 1–5 + role-fit pass (cheap, self-grading) **plus** a
  higher-vantage **Claude Opus** judge applied out of band (the real bar) against
  `JUDGE_RUBRIC.md`.
- Result: the generator is strong on office roles (role-fidelity, domain vocab, and
  probe quality all high); the industry-lock surfaced in the **support cast**
  (validators, the analyze prompt, the rubric vocab, and the deterministic
  *fallback*), which this pass fixed.

## Status (2026-06-23) — COMPLETE

- Framework built + tested (685 Python tests green; 10 corpus tests).
- Generation prompts **hardened** (5 edits below), validated on a 12-case pilot, then
  confirmed on the full 100.
- **Full 100-case corpus generated, judged, gated, and FROZEN** (`case-design-v5`).
  Gate **PASS**: reliability 100/100, error-fallbacks 0, role-fit **0.99**, automated
  case-judge **4.06/5**, title uniqueness 1.0. The out-of-band Opus judge rated the
  pilot 12 **and** a spanning spot-check of the regenerated set all "good"
  (role-fidelity ~all, probe-quality ≈4.8/5) — the industry-lock does not surface as
  case-domain drift.
- One role-fit miss (`cal-026`) is a **fraudulent source JD** (a reshipping-mule scam
  the analyze step correctly flagged at 0.84 confidence); `design_case` safely degraded
  to the domain-neutral template instead of tailoring a scam task. Bad input, not a
  generator defect.
- The 100-run hit the subscription session limit once and was completed by **resuming**
  across windows (zero rework on the cases already done) — see "Running at scale".

Note: `design.py`'s case-design prompt has since moved past v5 (the Dev Case feature
doc, `docs/features/dev-case/README.md`, cites the current version) — this doc
records the Part 1 calibration run and its findings as evidence, not the live
prompt-version pointer.

## Components

| File | Role |
|------|------|
| `pipeline/jobfit/devcase/real_corpus.py` | Fetch + classify + stratify real JDs → `data/seed_calibration/jobs.json`; `scenarios_from_jobs()` adapter. |
| `pipeline/jobfit/devcase/calibrate.py` | Orchestrator: run the chain per-use-case, reuse the lifecycle validators/signals/judge, write per-case JSON + reports + acceptance gate. |
| `pipeline/jobfit/devcase/lifecycle_eval.py` | (reused) `_check_*` validators + no-LLM `signals()`. `_check_analysis` was de-industry-locked here. Each planted-flag signal now reports its **behaviour-matched control and the lift**: `gap_caught_on_mismatch` 1.0 with a 0.2 control is a real 0.8 lift, but `clarify_probe_on_ambiguous` 1.0 turned out to be lift **0.0** — the designer plants an `underspecified` probe on every need, ambiguous or not, so the raw rate could never fail. A rate without a control certifies nothing (the same lesson as the `submission_eval` fairness gate). |
| `pipeline/jobfit/devcase/lifecycle_audits.py` | (reused) automated `judge` + `quality_summary`; `role_fit_verdicts()` factored out to run on every row. |
| `pipeline/jobfit/tests/test_real_corpus.py` | Network-free tests for classify / office-filter / stratify / adapter. |
| `data/seed_calibration/` | Output: `jobs.json`, `cases/<id>.json`, `cases.json`, `judge_report.json`, `JUDGE_REPORT.md`, `_calibration_report.json`, `JUDGE_RUBRIC.md`, `FROZEN.json`. |

## How to run

```bash
# 1. Build / refresh the real-JD corpus (one-time network pull, cached)
python -m pipeline.jobfit.devcase.real_corpus --count 100

# 2. Plumbing dry-run (no LLM — deterministic templates; exercises the whole pipeline)
python -m pipeline.jobfit.devcase.calibrate --count 8 --no-llm

# 3. Pilot with the automated judge + role-fit
python -m pipeline.jobfit.devcase.calibrate --count 12 --judge

# 4. Full gated, frozen run (the Part 2 fixture)
python -m pipeline.jobfit.devcase.calibrate --count 100 --judge --strict --freeze

# tests
python -m unittest pipeline.jobfit.tests.test_real_corpus
```

`--model sonnet` pins one CLI model for all steps (e.g. to match a deployment);
otherwise each step resolves its production provider. `--no-resume` re-fetches the
dataset **and** regenerates every case (default reuses the dataset cache and any
clean LLM case already on disk).

### Running at scale & the subscription session limit

The Claude CLI runs on the user's **subscription**, which has a rolling **session
usage limit**. A full `--count 100 --judge` run is ~500 CLI calls (100×3 generation
+ ~200 judge + 100 role-fit) — well beyond one session window — so a single sweep
will hit *"You've hit your session limit — resets HH:MM"* partway and the rest falls
back to deterministic. The harness is built for this:

- **Generation is incremental + resumable.** Each case is written the moment it
  completes, and a re-run **skips any clean LLM case already on disk** (only
  `source == "llm"` + reliable rows are reused). So re-running `calibrate --count
  100` after the limit resets fills in only the degraded rows — no rework, no
  clobbering the good ones. The `--strict` gate refuses to certify a run that
  error-fell-back (so a session-limited sweep can't masquerade as a clean corpus).
- **Spread the cost.** To complete 100 on the subscription, resume across reset
  windows; generation-only (`--count 100` without `--judge`) is the cheaper ~300-call
  half — judge separately, or rely on the out-of-band Opus judge (which does NOT use
  the subscription).
- **Or skip the limit entirely.** Route the bulk run through the metered Anthropic
  API instead of the subscription via `KP_LLM_CONFIG`
  (`devcase_case_design`/`devcase_analyze` → `anthropic`, model `claude-sonnet-4-6`,
  with an API key) — no session limit; finishes in one pass (paid).

## Corpus source & breadth

Source: `jacob-hugging-face/job-descriptions` via
`https://datasets-server.huggingface.co/rows` (853 rows; fields `position_title`,
`company_name`, `job_description`). `real_corpus.classify_*` map titles to a **broad
office superset** of `scenarios.DOMAINS` — adding HR, legal, operations,
procurement, customer success, administration, consulting, project management and
product, the families the synthetic harness never tested. Non-office/manual/clinical
titles are dropped. Stratification is a deterministic round-robin across families, so
the corpus is reproducible and a pilot of N is a true prefix of a run of M>N. A live
100-job build spread evenly across **13 families** (design is thin in the source).

## The judge

Two layers, by design:
1. **Automated** (`calibrate.py --judge`): the existing `lifecycle_audits.judge`
   (1–5 per artifact) + `role_fit_verdicts` (binary "do the tasks match the role's
   function?"). Cheap and broad — a breadth signal, not the bar.
   It used to **self-grade**: the `devcase_judge` seat was routable but unpinned, so with
   no `KP_LLM_CONFIG` it fell back to the same engine and model that generated the case.
   That is fixed — the seat carries its own default and `judge_independence` reports the
   two seat identities on every run (`judgeIndependence` in `judge_report.json`; see
   [the dev-case doc](../features/dev-case/README.md#the-judge-is-independent-by-default)).
   It is still the *cheaper* tier, and it is still not the bar; a run whose judge does
   resolve to the generator is reported as such and refused by `--strict` in
   `lifecycle_eval` / `submission_eval`.
2. **Calibration judge (the bar)**: Claude **Opus** — a higher vantage than the
   sonnet-class generator — reads `cases/<id>.json` and scores `JUDGE_RUBRIC.md`'s 7
   dimensions, then synthesizes systematic failure modes that drive the prompt edits.

## Acceptance gate (`calibrate.py --strict`)

- structural reliability = 100% (`_check_*` clean)
- `error_fallbacks` = 0 (the LLM actually ran + returned parseable JSON)
- role-fit rate ≥ 0.95
- automated **case** judge mean ≥ 4.0 (the case is the target; the analyze step is
  inherently ungrounded for repo-less roles, so it is reported but **not** gated)
- case-title uniqueness ≥ 0.95
- with `--judge`, both judged dimensions must actually have been **measured**. A judged
  run whose judge returned nothing — `run_judge` silently drops every call that errors or
  returns unparseable JSON, so exhausting the Claude session limit mid-run empties both —
  now FAILS instead of skipping them. It used to pass: with the cases served from the
  `--resume` cache, reliability stayed 1.0 and `error_fallbacks` 0, so `--strict --freeze`
  exited 0 and stamped `FROZEN.json` `passed: true` on a corpus whose quality and role-fit
  were never measured at all.

## Calibration findings & fixes (Part 1)

The generated **cases** were strong out of the gate (12/12 "good" in the Opus pilot;
role-fidelity 12/12; probe-quality ≈4.8/5). The industry-lock did **not** show up as
case-domain drift — it hid in the support cast:

1. **Validator industry-lock** — `_check_analysis` required a non-empty `realStack`,
   failing every non-software office role (admin, customer support…) whose analysis
   was otherwise excellent. → Relaxed to accept `realStack` **or**
   `coreResponsibilities` as grounding (`lifecycle_eval.py`). Synthetic scenarios
   always carry a stack, so it only relaxes, never regresses.
2. **Analyze prompt industry-lock** — system was "senior *engineering* hiring
   analyst" reflecting against "the REAL codebase", producing low-value
   "doesn't-apply" prose for office roles. → Generalized to any function; `realStack`
   now means the role's real tools/materials (`analyze.py`, `need-analysis-v2 → v3`).
   Automated analysis score rose 3.4 → 4.0.
3. **Rubric vocab leak** — `RUBRIC_DIMENSIONS` descriptions said "fit the real
   **codebase**" / "THIS role's **stack**". → Domain-neutral wording (`models.py`);
   names/labels/weights unchanged (stable contract; also benefits Part 2's evaluator).
4. **Senior over-scoping** — a few senior/lead cases packed many deliverables into
   the ≤2h cap. → `case-design-v4 → v5`: the timebox is a HARD cap; seniority raises
   depth/ambiguity, not the number of deliverables (`design.py`).
5. **Industry-locked fallback** — when a case-design call *timed out*, the
   deterministic template produced a **software** case ("assess and improve the
   codebase", a "legacy file", a "test suite") even for a project-management role,
   drifting role-fit and tanking quality. → Made the deterministic template
   domain-neutral (`design.py`), and raised the harness case timeout (`calibrate.py`,
   200 → 360s) so complex cases stay on the LLM path.

## Known follow-ups (out of Part 1 scope)

- **Production timeout + fallback.** `devcase_cli` resolves providers at 120s; a
  complex real case can exceed that and fall back. The fallback is now domain-neutral
  (fix #5), but production should consider a longer case-design budget and/or a retry
  before falling back. (Robustness, not prompt quality.)
- **`architecture` dimension name** is still software-flavored for, e.g., an HR case.
  The *description* is now neutral; renaming the dimension cascades through
  `DimensionScore`, `evaluate`, and the UI, so it was left for a dedicated change.
  (Tracked in `docs/features/dev-case/README.md`'s Known gaps.)
- **Dataset breadth.** `design` is thin (≈3/100) in the source dataset; blend a
  second auth-less HF dataset if a heavier design/UX presence is wanted.
- **Fraudulent / non-genuine JDs.** Public datasets contain scam postings (e.g.
  `cal-026`, a reshipping-mule "admin" role). `analyze_need` already flags these (low
  confidence + a "not a genuine need" reflection), but `design_case` then silently
  emits the generic template. A small enhancement: when analyze marks a JD non-genuine,
  have the case explicitly say so (or skip it) rather than degrade quietly.

## Handoff to Part 2 (evaluation-prompt hardening)

`--freeze` writes `FROZEN.json` (timestamp, count, case prompt versions, gate
result) and the `cases/<id>.json` corpus is the fixture Part 2 reads. Plan:

1. For each frozen case, synthesize N candidate "submissions" of varied quality
   (strong / median / naive — including AI-over-reliant ones that miss the probes).
2. Run the evaluation chain `reflect → tooling → evaluate → transfer` over them.
3. Judge the **evaluator**: does it discriminate (rank strong > naive) and stay fair
   (AI use is not penalized)? Harden the evaluation prompt the same way.

`submission_eval.py` is the existing evaluation-half harness this extends; the
no-LLM signals + `--strict` gating mirror this Part 1 harness. (Part 2 has since run —
see `pipeline/jobfit/devcase/submission_eval.py`, `submission_scenarios.py`, and the
submission-evaluation findings folded into
`docs/_archive/dev-d3-hardening-findings.md`.)
