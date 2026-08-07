> **Archived 2026-07-30.** This was the original build spec for the HR
> automation tasks. The build shipped and then evolved past several details
> here: stage names moved from `AI-matched`/`Screening` to `Accepted`/`Screened`,
> the per-task API routes consolidated into `/api/automation/[task]`, and a
> Phase 3 (data-driven decision config + screen-wave bulk auto-reject) was
> added on top. Superseded by `docs/features/pipeline/README.md`, which
> describes the shipped behavior; kept here for the original design rationale
> (fairness-gate reasoning, task catalog, risk table).

# AUTOMATION_SPEC — Local-First HR Pipeline Automation

> **Engine constraint:** the ONLY runtime LLM is the **Claude Code CLI** via
> `pipeline/jobfit/claude_cli.py` (`ClaudeCliProvider`: `claude -p --output-format json`,
> subscription-billed, text-in/JSON-out). No Gemini, no hosted API at runtime. Every LLM task
> MUST ship with a **deterministic fallback** (cf. `match_reasoning.py::generate`/`deterministic_reasoning`)
> so the pipeline never blocks when the CLI is missing. Deployment is out of scope.

This spec turns the seven reviewed task designs + the adversarial review into one concrete build.
It reuses the existing seams: Python CLIs (stdin/file JSON → stdout JSON, errors as `{"error","status","code"}`
on stderr with an honest status — 404/400/500, see §3.2), `spawnPython` + workdir helpers in `app/_lib/python-runner.ts`, the `gemini_cache` table
for caching, and `pipeline_entries` / `pipeline_events` for state + audit.

---

## 1. Final Task Catalog

Seven tasks. **Mode** reflects the review's fairness gates. "auto" = system triggers the LLM call;
**no auto stage transition for early-career and no auto-reject ever happens without a human gate**.

| # | Task | Module fn | Mode | Trigger | LLM? | Stage effect |
|---|------|-----------|------|---------|------|--------------|
| 1 | **AI Screening Recommendation** | `screen_candidate()` | **auto** (call) / **gated** (execute) | Entry lands in `AI-matched` | yes + fallback | advance→Screening **only if** `recommendation=advance` AND `confidence>=80` AND **not early-career**; else `hold` (Decisions queue). Never auto-reject. |
| 2 | **Personalized Outreach Draft** | `draft_outreach()` | **on_demand** | Recruiter clicks "Draft message" (AI-matched/Screening/Interview) | yes + fallback | none (info event); blocked if `status='rejected'` |
| 3 | **Rejection Message Draft** | `draft_rejection()` | **on_demand** (human-initiated) | Recruiter clicks "Reject" | yes + fallback | none by itself — draft only; the **reject action** is the human's separate click |
| 4 | **Interview Prep Pack** | `interview_prep()` | **on_demand** | After recruiter approves Screening→Interview | yes + fallback | none (support artifact); stored on entry |
| 5 | **Interview Scorecard Synthesis** | `interview_scorecard()` | **on_demand** | Recruiter marks "Interview complete", pastes notes | yes + fallback | none — sets `approval_kind` for the human Interview→Offer gate |
| 6 | **Re-Match Alternatives** | `rematch_candidate()` | **auto-trigger / gated-exec** | On reject, or "Explore alternatives" button | deterministic `match()` + 1 LLM rationale | creates a **new** `AI-matched` entry for the best alternative job (recruiter must still approve it) |
| 7 | **Pipeline Automation Policy Pass** | `evaluate_entry()` | **auto** (batch) | "Run automation pass" button or nightly cron | **none — deterministic** | auto-advance **BAU only** (`score>=70` & `confidence_low>=65`); all early-career → `hold`; aging alerts log only |

**Human-in-the-loop boundaries (hard rules):**
- Early-career (`student`, `career_switcher`) is **never** silently advanced or rejected by automation. Tasks 1 & 7 force `hold`.
- Task 7 may **auto-reject only BAU** with `score < 40` (no entry-eligibility). Early-career low scores get a 30-day aging escalation, then a human decides.
- Rejection (Task 3) and the Offer decision (post Task 5) are always a human click.

---

## 2. Automation Rules

### 2.1 Task 1 — Screening (LLM-assisted, fairness-gated)

```
INPUT:  MatchCandidate, Job, MatchResult  (score_job output)
PRE-LLM FAIRNESS GATE (deterministic, runs BEFORE the prompt):
  if archetype in {student, career_switcher}
     and potential_score > 0.5
     and total_score < 55:
        force recommendation = "hold"   # prevents silent auto-reject of learnable gaps
ROUTING (after LLM/fallback returns recommendation+confidence):
  advance + confidence >= 80 + archetype == "bau"  -> actOnPipelineEntry(accept)  => Screening (kind=screening_advance)
  advance + (confidence < 80 OR early-career)       -> HOLD  (approval_kind=screening_review, Decisions queue)
  hold                                              -> HOLD  (approval_kind=screening_review)
  reject + archetype == "bau"                       -> Decisions queue (recruiter confirms reject; no auto-reject in Task 1)
  reject + early-career                             -> HOLD  (never reject here; surfaces red flags for human)
```
Output stored in `pipeline_entries.approval_detail` (full JSON) + `match_score`; emits `pipeline_events.kind = screening_advance | screening_hold`.

### 2.2 Task 7 — Policy Pass (pure deterministic, no LLM)

```
AI-matched -> Screening:
  BAU  score>=70 & confidence_low>=65        -> auto_advance (Screening)
  BAU  50<=score<70                          -> hold
  BAU  score<40                              -> auto_reject
  EARLY-CAREER any score                     -> hold        (always human gate)
Screening -> Interview:
  approval pending                           -> hold
  no approval pending & daysInStage>=2       -> auto_advance (Interview)   [config: SCREENING_AUTO_DAYS]
Interview -> Offer:
  ALL                                        -> hold        (always manual)
Aging nudge (any stage, independent of score):
  daysInStage>=21 -> log kind=stale_alert
  daysInStage>=30 -> log kind=aging_alert (escalate)
```
`daysInStage` = `now - stage_changed_at` (already populated by the seed/migration). Thresholds live in a
`POLICY` dict at the top of `automation.py` so they are tunable per market.

### 2.3 Task 6 — Re-Match (deterministic rank + 1 LLM rationale)

```
jobs_to_consider = listJobs(open)  minus current_job_id
survivors = [j for j in jobs if ko_filter(candidate, j).passed]      # reuse matching.ko_filter
ranked    = sorted(score_job(candidate, j) for j in survivors, by total desc)  # reuse matching.score_job
best      = ranked[0] if ranked and ranked[0].total > 55 else None   # >55 floor: avoid junk alternatives
rationale = match_reasoning.generate(candidate, best_job, best, provider)       # LLM + fallback
SAFEGUARD: max 2 alternatives per candidate (track rematch_count in pipeline_events history).
EARLY-CAREER: always attempt a rematch before a final archive.
```
Creates a fresh entry via `createPipelineEntry(stage='AI-matched', matchScore=best.total)`; logs `kind=rematched`,
`detail = {fromJob, toJob, scoreDelta}`.

### 2.4 "Run automation pass" semantics & idempotency
- A pass = fetch active entries → for each, `evaluate_entry()` (Task 7) → apply transition + log in one DB transaction.
- **Idempotent:** Task 7 is pure deterministic on the entry snapshot — re-running yields the same decision; re-emitting an identical `stale_alert`/`aging_alert` within the same UTC day is suppressed (check latest event of that kind for the entry).
- **Task 1 vs Task 7 ordering:** Task 7 must NOT override a Task 1 recommendation younger than 24h (check newest `screening_*` event timestamp). Task 7 only acts on aged/SLA-breached entries.
- **Caching:** every LLM task caches on `(prompt_version, candidate_signature|candidate_id, job_id[, notes_hash])` in `gemini_cache` (TTL 168h, like reasoning). Re-submitting a duplicate returns the cached artifact — no new `claude` call.

### 2.5 Recommendation / route verdict contract

The interview/screening **verdict** is a closed vocabulary, single-sourced per language and validated at every parse boundary so a misspelled or off-taxonomy value from the model can never slip silently to the UI.

| Concept | Legal values | Emitted by | Read by |
|---------|--------------|-----------|---------|
| `recommendation` (verdict) | **`advance` \| `hold` \| `reject`** | Task 1 `screen_candidate`, Task 5 `interview_scorecard` | Decisions queue (`AiReviewCard`/`RecBadge`), interview transcript modal, recruiter compare grid, `screening_hold`/`interview_scorecard` audit events |
| `route` (screen gate) | **`advance` \| `hold`** (subset) | Task 1 `screen_candidate` only | `automation-run.ts` (auto-advance vs. queue for review) |

- **Canonical fallback = `hold`.** Any unknown / empty / malformed verdict coerces to `hold` — never `advance` (could silently auto-progress) and never `reject` (the fairness gate forbids a silent auto-reject). `hold` routes to the human Decisions gate, which is exactly where an unrecognised verdict belongs. The `route` fallback is likewise `hold` (queue for review). `reject` is a legal *verdict* but never a *route*.
- **Single source per side:**
  - Python — `RECOMMENDATIONS` / `RECOMMENDATION_FALLBACK` / `RECOMMENDATION_CHOICES` + `coerce_recommendation()` in `pipeline/jobfit/automation.py`. The prompts render the set via `RECOMMENDATION_CHOICES` (derived, never hand-typed), and both task coercers validate the model output through `coerce_recommendation()`.
  - TS — `INTERVIEW_RECOMMENDATIONS` / `INTERVIEW_RECOMMENDATION_FALLBACK` / `SCREEN_ROUTES` + `isInterviewRecommendation` / `coerceInterviewRecommendation` / `coerceScreenRoute` in `app/_lib/interview-recommendation.ts`. `automation-run.ts` validates `result.route`/`result.recommendation` here (logging a warning on off-taxonomy drift); `db.ts` coerces stored scorecards on read; the Badge surfaces an unrecognised raw value in a neutral badge (drift visibility) instead of masking it.
- **Drift guard:** the branching literals (`route === "advance"`, `== "reject"`) necessarily live in each language, but the legal set + fallback are pinned by tests on each side — `app/_lib/interview-recommendation.test.ts` (TS) and `RecommendationContractTest` in `pipeline/jobfit/tests/test_automation.py` (Python, incl. a byte-identical-prompt assertion).

---

## 3. Python Module Shape

### 3.1 `pipeline/jobfit/automation.py` (one function per task; provider-injected; always returns valid JSON)

```python
# Mirrors match_reasoning.generate(): try provider.complete_json(); on ANY exception
# fall back to a deterministic builder. provider=None => deterministic path.

SCREENING_PROMPT_VERSION   = "screening-v1"
OUTREACH_PROMPT_VERSION    = "outreach-v1"
REJECTION_PROMPT_VERSION   = "rejection-v1"
PREP_PROMPT_VERSION        = "interview-prep-v1"
SCORECARD_PROMPT_VERSION   = "scorecard-v1"

POLICY = {  # Task 7 thresholds — tunable per market/season
    "bau_advance_score": 70, "bau_advance_conf_low": 65,
    "bau_reject_score": 40, "screening_auto_days": 2,
    "stale_days": 21, "aging_days": 30,
    "rematch_floor": 55, "rematch_max": 2, "screen_advance_conf": 80,
}

def screen_candidate(candidate, job, m, *, provider=None) -> tuple[dict, str]: ...   # Task 1
def draft_outreach(candidate, job, strengths, *, provider=None) -> tuple[dict, str]: ...  # Task 2
def draft_rejection(candidate, job, m, stage, *, provider=None) -> tuple[dict, str]: ...  # Task 3
def interview_prep(candidate, job, m, reasoning, *, provider=None) -> tuple[dict, str]: ...  # Task 4
def interview_scorecard(candidate, job, notes, *, provider=None) -> tuple[dict, str]: ...  # Task 5
def rematch_candidate(candidate, current_job_id, jobs, *, provider=None) -> dict: ...  # Task 6 (reuses matching + match_reasoning)
def evaluate_entry(entry: dict, job: dict) -> dict: ...   # Task 7 — DETERMINISTIC, no provider

# Each LLM task: _build_<task>_prompt(context) + _deterministic_<task>(context) + _coerce_<task>(payload, context)
# Shared system preamble per task (cf. match_reasoning._SYSTEM). Pre-LLM fairness gate lives in screen_candidate().
```

Reuse, do not duplicate:
- `matching.ko_filter`, `matching.score_job`, `matching.match`, `matching.load_corpus`
- `match_reasoning.reasoning_context`, `match_reasoning.generate` (for Task 6 rationale & Task 4 seed)
- `transform.build_match_candidate` (profile → MatchCandidate)
- `claude_cli.ClaudeCliProvider` (with `.available()` guard before constructing the provider)

### 3.2 `pipeline/jobfit/automation_cli.py` (single entry point, sub-command per task)

Mirrors `reasoning_cli.py` exactly: `reconfigure` stdout/stderr to UTF-8, read input from `--input-json`/stdin,
emit one JSON object to stdout. On failure it emits an `{"error": str, "status": int, "code": str}` envelope to
stderr with an **honest** status (mapped from the failure type, not a blanket 500) so the TS seam and its callers
can distinguish a bad request from a real outage:

| Failure | status | code | exit |
|---------|--------|------|------|
| Missing job / entry (`NotFoundError`) | 404 | `not_found` | 1 |
| Bad argument / malformed JSON / pydantic validation (`ValueError` & subclasses) | 400 | `invalid_input` | 2 |
| Unexpected fault (any other exception) | 500 | `engine_error` | 1 |

`parseStderrError` reads the explicit `status`/`code`; the exit code only matters as its fallback (2 → 400).

```
python -m pipeline.jobfit.automation_cli screen     --candidate-json P --job-id J [--no-llm]
python -m pipeline.jobfit.automation_cli outreach    --candidate-json P --job-id J --strengths-json S
python -m pipeline.jobfit.automation_cli rejection   --candidate-json P --job-id J --stage Screening
python -m pipeline.jobfit.automation_cli prep        --candidate-json P --job-id J
python -m pipeline.jobfit.automation_cli scorecard   --candidate-json P --job-id J --notes-file N
python -m pipeline.jobfit.automation_cli rematch     --candidate-json P --current-job-id J
python -m pipeline.jobfit.automation_cli policy-pass --entries-json E      # Task 7 batch; --no-llm implied
```
- Accept `--profile-json` too (transform via `build_match_candidate`), like `reasoning_cli`.
- Provider: `None if --no-llm else ClaudeCliProvider(timeout=120)`, downgraded to `None` if `not provider.available()`.
- `policy-pass` takes the full active-entry list and returns `{"decisions": [...]}` — the TS layer applies transitions.

---

## 4. API Routes (Next.js, `runtime = "nodejs"`)

All spawn Python through `spawnPython` + `createWorkdir`/`cleanupWorkdir` + `parseStderrError`, mirroring
`app/api/match/reasoning/route.ts`. LLM responses cached via `lookupPromptCache`/`storePromptCache` (only
authoritative `source: "llm"` payloads are cached; deterministic fallbacks are recomputed each request).

| Route | Method | Purpose | CLI sub-command | Cache key |
|-------|--------|---------|-----------------|-----------|
| `/api/automation/run` | POST | Task 7 policy pass over active entries (button + cron) | `policy-pass` | none (deterministic) |
| `/api/automation/screen` | POST `{entryId}` | Task 1 — generate + route | `screen` | `screening-v1\|cand\|job` |
| `/api/automation/outreach` | POST `{entryId}` | Task 2 draft | `outreach` | `outreach-v1\|cand\|job` |
| `/api/automation/rejection` | POST `{entryId}` | Task 3 draft (does **not** reject) | `rejection` | `rejection-v1\|cand\|job\|stage` |
| `/api/automation/prep` | POST `{entryId}` | Task 4 pack | `prep` | `interview-prep-v1\|cand\|job` |
| `/api/automation/scorecard` | POST `{entryId, notes}` | Task 5 synthesis | `scorecard` | `scorecard-v1\|cand\|job\|notesHash` |
| `/api/automation/rematch` | POST `{entryId}` | Task 6 alternatives | `rematch` | `rematch-v1\|cand\|job` (TTL 168h) |

Flow per route: load entry (`getProfileRecord` / pipeline row) → write candidate/profile + job-id to workdir →
`spawnPython([...,"automation_cli", sub, ...])` → on exit 0 parse stdout, persist via the DB helpers in §5,
return JSON; on non-zero use `parseStderrError`. Reject/accept stage changes still go through existing
`actOnPipelineEntry` (do not write `pipeline_entries` directly from the route).

---

## 5. DB / `pipeline_events` Changes

**No schema migration required for the core flow** — `pipeline_entries.approval_kind` / `approval_detail` and the
free-form `pipeline_events.kind`/`detail` columns already carry everything. Two small additions to `app/_lib/db.ts`:

1. **Extend `PipelineAction`** and `actOnPipelineEntry` with new server-side helpers (keeps event logging in the DB layer):
   - `recordAutomationEvent(entryId, kind, detail)` — thin wrapper over the existing private `recordEvent`.
   - `setApproval(entryId, approvalKind, approvalDetailJSON)` — sets `approval_kind` + `approval_detail` without a stage change (Tasks 1 hold, 5 scorecard).
   - Optionally a `holdEntry` path so Task 1 `hold` and Task 7 `hold` are explicit (status stays `active`, `approval_kind=screening_review`).
2. **`listActiveEntriesForAutomation()`** — like `listPipeline()` but returns `daysInStage` (`now - stage_changed_at`) so Task 7 doesn't recompute in TS.

**New `pipeline_events.kind` values** (string column — additive, no migration):

| kind | emitted by | from→to |
|------|-----------|---------|
| `screening_advance` | Task 1 | AI-matched → Screening |
| `screening_hold` | Task 1 | AI-matched → AI-matched (queued for review) |
| `outreach_drafted` | Task 2 | stage → same stage |
| `rejection_drafted` | Task 3 | stage → same stage (the actual `rejected` event still comes from `actOnPipelineEntry('reject')`) |
| `interview_prep_generated` | Task 4 | Screening/Interview → same |
| `interview_scorecard` | Task 5 | Interview → Interview (sets approval gate) |
| `rematched` | Task 6 | (new entry) → AI-matched |
| `evaluated` / `advanced` / `stale_alert` / `aging_alert` | Task 7 | per decision (`advanced` already exists) |

Caching reuses the existing `gemini_cache` table (rename is cosmetic; functionally a generic prompt cache).

---

## 6. UI Surfaces

| Surface | Tasks shown | Behavior |
|---------|-------------|----------|
| **Decisions queue** (new/extended view over `approval_kind != NULL`) | 1 (hold/review), 5 (scorecard) | Recruiter sees `recommendation`, `confidence`, `rationale`, `strengths`, `redFlags`; approves (→`actOnPipelineEntry('accept')`) or rejects. **Confidence < 80 or early-career always lands here.** |
| **Pipeline board** (existing) | 7 | "Run automation pass" button → `/api/automation/run`; auto-advanced cards show a badge; `stale`/`aging` chips from alert events. |
| **Per-candidate detail / entry page** | 2, 3, 4, 6 | Action menu: "Draft outreach", "Reject…" (opens draft, recruiter edits, then confirms reject), "Generate interview prep", "Explore alternatives". Each renders the JSON artifact in an editable panel; **no auto-send anywhere**. |
| **Interview page** `/pipeline/[id]/interview` | 4, 5 | Prep pack (competencies, STAR scaffolds, sequence) above a notes textarea → "Synthesize scorecard" (Task 5) feeds the Interview→Offer gate. |
| **Activity feed** (existing `listPipelineEvents`) | all | New event kinds render with archetype tag for fairness audit. |

Guardrails: Outreach button hidden when `status='rejected'`; Reject draft requires the recruiter to confirm the
(editable) message before the `reject` action fires.

---

## 7. Execution Order (numbered build steps)

1. **`automation.py` — Task 7 first** (`evaluate_entry` + `POLICY`): pure deterministic, no LLM, fully unit-testable. Establishes the rules contract.
2. **`automation.py` — Task 1** (`screen_candidate`): pre-LLM fairness gate + prompt + `_deterministic_screening` + `_coerce`. Reuse `reasoning_context`.
3. **`automation.py` — Tasks 2–5** (`draft_outreach`, `draft_rejection`, `interview_prep`, `interview_scorecard`): each prompt + deterministic builder + coerce.
4. **`automation.py` — Task 6** (`rematch_candidate`): wire `ko_filter`/`score_job`/`match` + `match_reasoning.generate` for the top-1 rationale; enforce `>55` floor + `max 2`.
5. **`automation_cli.py`**: sub-command dispatch mirroring `reasoning_cli.py` (UTF-8 reconfigure, stdin/file input, JSON-out, error-to-stderr).
6. **Python tests** (`tests/test_automation.py`): assert each task returns valid JSON with `provider=None`; assert fairness gates (early-career never reject in Task 1; Task 7 auto-reject BAU-only); assert Task 6 floor + cap.
7. **DB layer** (`app/_lib/db.ts`): add `listActiveEntriesForAutomation`, `setApproval`, `holdEntry`, `recordAutomationEvent`; extend `PipelineAction` if needed.
8. **API routes**: `/api/automation/run` (Task 7), then per-candidate routes (screen, outreach, rejection, prep, scorecard, rematch) — copy the `match/reasoning` route skeleton, add caching.
9. **UI**: Decisions queue (Tasks 1, 5) → Pipeline "Run pass" button + badges (Task 7) → per-candidate action menu + interview page (Tasks 2,3,4,5,6).
10. **Cron (optional, later)**: nightly `python -m pipeline.jobfit.automation_cli policy-pass` (or hit `/api/automation/run`) for aging nudges.
11. **End-to-end smoke**: CLI-down path (force `--no-llm`) must still produce every artifact and never block a stage.

---

## 8. Key Risks & Human-in-the-Loop Boundaries

| Risk | Mitigation |
|------|-----------|
| **Silent auto-reject of early-career** | Task 1 pre-LLM fairness gate forces `hold`; Task 7 auto-reject is **BAU-only**; early-career low scores get 30-day aging + human escalation. **Defense in depth:** the TS apply boundary (`automation-pass.ts`) re-asserts the invariant via `assertAutoRejectFair` (`automation-fairness.ts`) before applying any reject — a reject for a protected/unknown archetype, an unscored entry, or a score `>= bau_reject_score` is refused and downgraded to `hold` + a `fairness_gate_blocked_reject` alert, so a Python regression can't auto-reject unfairly. Audit `pipeline_events` for any `fairness_gate_blocked_reject` (a refused upstream bug) or early-career `hold→rejected` via automation (would be a bug). |
| **Confidence miscalibration** | Only `confidence>=80` + BAU bypasses the human gate. No ground truth yet → recommend logging post-interview outcomes to validate bands later. |
| **Outreach sent to a reject candidate** | Outreach disabled when `status='rejected'`; outreach and reject flows are physically separate UI actions. |
| **Rejection draft sent unreviewed** | Always human-initiated; recruiter edits the editable draft and confirms before the `reject` action; (optional) require an edit/confirm checkbox. |
| **Rematch floods the queue with junk** | Top-1 only, `score>55` floor, `max 2` per candidate; surfaces to the same human-gated AI-matched queue. |
| **Leading-question bias from prep pack** | Pack includes open `whatsGoodLooksLike` + `followUpIfAnswer`; deterministic fallback is neutral. |
| **CLI unavailable halts everything** | Mandatory deterministic fallback per task (`generate()` pattern); `policy-pass` is LLM-free; smoke test forces `--no-llm`. |
| **Task 7 overriding fresh Task 1 output** | Task 7 skips entries with a `screening_*` event < 24h old; acts only on aged/SLA-breached entries. |
| **Stale thresholds / over-rigid rules** | All thresholds in `POLICY` dict, tunable per market; quarterly review of auto-advance vs actual hire quality. |

**Cost/latency:** Tasks 6 (rank) & 7 (policy) are LLM-free (sub-second). LLM tasks are 1 `claude -p` call each
(2–8s, subscription-billed), all on-demand or background, all cached by `(prompt_version, candidate, job[, notes])`.
~$1/week per 100 candidates at subscription rates; UI shows a "generating…" spinner for the async ones.
