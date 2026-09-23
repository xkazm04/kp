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
| challenge-2026-09-22 (r01) | 6 | 0 | done — 12/12 landed (apply-A completed 2026-09-23, f76c8462b) |
| challenge-r02 | 8 | 11 | done — 16/16 landed + 1 follow-up; flawless 12/16 (10 strict); 3 coordinator fixes |
| challenge-r03 | 8 | 5 | carded + critiqued (3.94/4.69/4.31, 5 revise) — builds after r02 closes |

Side fixes outside the card flow: a9bd69f62 companion recall scoped to workspace (r02 llm-api scout); 93f485438 interview-sim /s+/ word count (r03 scout).
Small follow-ups noted by scouts, not yet built: skill-profile public page limiter keyed per token (guessing gets fresh allowance); companion_cli fallbackReason raw provider text (llm-api/B may cover); /api/schedule ?limit >500 truncated:false; about riders: voice ticker double role=status, palette-preview raw stage labels.
The python-runner-concurrency failure is load-induced: passes 3/3 in isolation.
Registry: scan-sweep 3.5.1 (e1c0626b) — riders, --until-covered, --in-flight all committed with tests.
Known flake (not ours, owner's call): `app/_lib/python-runner-concurrency.test.ts` process-tree-kill case.
- OWED at loop end: run e2e/token-doors-axe.spec.ts against a KP_EMPTY=1 prod build (llm-api/A moved its offer case onto a (SIM) entry; builders could not run it).
- Reword app/features/shared/sharedGet.ts:5-12 comment (Schedule grid+panel double fetch no longer true after schedule/A).
- companion_cli exception path still sends raw provider text as fallbackReason; switching to a code needs app/_lib/companion-turn.ts companionFallbackClass + tests (llm-api/B follow-up).
- Dead catalog key pipeline.tab.previewApplyGlobal (pipeline/B); team-scoped pass filters the shared 2000-row list (documented gap).
