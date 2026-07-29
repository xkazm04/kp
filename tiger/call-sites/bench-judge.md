---
id: bench-judge
type: tiger/call-site
modality: text
file: pipeline/jobfit/llm/bench/judge.py:97
wrapper: MonitoredClaudeCli (use_case="bench_judge") → ClaudeCliProvider
provider: claude_cli  model: CLI default (overridable)
schema: yes — 1–10 dims (relevance/correctness/adherence + overall), JSON
grounding: n/a (internal quality harness, not a product surface)
quality_score: "—"  code_score: 4
recommended_model: "—"
status: discovered
last_scanned: 2026-07-15
characters: []
---
## What it does
The LLM-as-judge behind the in-repo **model-quality matrix / BYOM scorecard**
(commit 20b03ba, shipped ~2026-07-07). `bench/runner.py` runs a matrix of ~15
production ops × ~7 OpenRouter model targets capturing contract-validity, source
(llm vs deterministic fallback), latency, tokens, cost; `judge.py:97` then scores
each model's output 1–10 on relevance/correctness/adherence via a **separate**
Claude-CLI engine (never a family grading itself). `bake_quality.py` aggregates a
judged run and generates `app/_lib/llm-quality-scores.ts` (baked, do-not-edit),
consumed by `app/_lib/llm-quality.ts` → the Models tab (`QualityOverview.tsx`) as a
per-model ranking + per-use-case ★ recommendation for BYOM operators.

## Relationship to Tiger Lens 3 (IMPORTANT — prior art to reconcile, not duplicate)
This is a home-grown implementation of exactly what Tiger Lens 3 does: recommend
the optimal model per call site with quality/cost/latency/reliability evidence.
Tiger should **reconcile against it**, not re-run it. Its op catalog is a *subset*
of the 20+ routing use cases — it omits `cv_analysis`/`profile_extract` (multimodal,
not benchable on the text OpenRouter matrix), `github_analysis`, `grounded_salary`
(Gemini-grounding-only), and voice `interview_realtime`. **Those gaps are where
Tiger Lens 3 adds coverage the built-in scorecard can't.**

## Code quality
Goes through `MonitoredClaudeCli` so it IS metered (LightTrack + ledger) and tagged
`bench_judge`. Independent judge engine = no self-grading (good). One weakness:
the judge itself is an **unranked call site** — a Claude-CLI dependency with no
quality baseline of its own, so the whole matrix inherits an unmeasured judge.

## Findings
- [model] The built-in matrix is the Lens-3 seed; Tiger's job is the **coverage gap**
  (multimodal + grounded + voice sites) + validating the judge. Raised [[2026-07-15-scan]].
