# Challenge coverage loop — kp (`/scan-sweep --challenge --until-covered`, skill 3.5.0)

Operator ask (2026-09-23): finish candidate-apply-api/A (remaining doors + adjust tests), then
continue challenge runs until every context is covered. Deck approval: given in advance for the
whole loop (irreversible / policy-loosen still never built).

## How a run goes (coordinator checklist)

1. `node ../ai-registry/skills/scan-sweep/scripts/coverage.mjs --challenge --cohort 8 --json > <RUN>/cohort.json`
2. One scout per host (brief `challenge-briefs/SCOUT.md`, prompt names <RUN>, host, riders).
3. Critic on model `fable` (brief `challenge-briefs/CRITIC.md`) -> `<RUN>/critic.json`.
4. `<RUN>/DECK.md`; waves of 4, the two slots of one host never in one wave, signature changes first.
5. Builders (brief `challenge-briefs/BUILDER.md`) -> `<RUN>/builds/*.json`.
6. After each wave, integration gate (kp overlay `## Challenge mode`), compared with the baseline:
   tsc errors outside `kpi-sim/` = 0; lint errors outside `kpi-sim/` = 0; ts-ratchet 0 blocking;
   i18n / design / api / docs = 0; test:unit fail 0; test:perf lines ONLY llm-config 322/320 and
   job-ingest 403/400 (pre-existing). Fix forward in `test(...)`/`fix(...)`/`chore(perf)` commits.
7. Close: scorecard row `challenge-runs.jsonl`, one `scan-sweep.jsonl` snapshot per host AND per rider
   (`note: "rider of <host>"`), `<RUN>/REPORT.md`, `usage.jsonl`; commit the run dir by pathspec.
8. Pipeline: the next run's scouts may start once this run's critic is done (read-only).

## Runs

| Run | Hosts | Riders | Status |
| --- | --- | --- | --- |
| challenge-2026-09-22 (r01) | 6 | 0 | done — 11 landed + 1 partial (apply-A, completion builder dispatched 2026-09-23) |
| challenge-r02 | 8 | 11 | scouting |
