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
| challenge-r03 | 8 | 5 | done — 16/16 landed; flawless 13/16 (11 strict); 5 coordinator fixes; page ceiling lowered 8875->8645 by glyph/A |
| challenge-r04 | 8 | 3 | done — 16/16 landed + 1 follow-up; flawless 13/16 (8 strict); test:perf fully green |
| challenge-r05 | 8 | 2 | done — 16/16 landed; flawless 14/16 (11 strict); coordinator error 232d7158e reverted in 42daecab4 |
| challenge-r06 | 8 | 3 | carded + critiqued (4.44/4.88/4.56 — best yet; 12 build / 4 revise; db-pipeline-store/A owns the re-add transition, apply-flow/A after it) |

Side fixes outside the card flow: a9bd69f62 companion recall scoped to workspace (r02 llm-api scout); 93f485438 interview-sim /s+/ word count (r03 scout); **9e834cf04 SECURITY: POST /api/tasks analyze with client paths could read any file and rm -rf any directory — refused + confined (r05 workspace-config-api scout)**; e00c802fc keyless devcase fallback graded unknown probes as failures (r05 devcase-core scout); **43f92ced0 SECURITY: hire-from-need let a human's body.workspace pick another team (r06 agents-api scout)**; 232d7158e Sentry hook params typed locally — WRONG DIAGNOSIS, reverted in 42daecab4: the lockfile pins nested @sentry/core 10.71 correctly; the errors came from a broken local install after the node_modules junction incident; **5075b3b08 devcase close sent a rejection to every PROMOTED submitter (r07 devcase-orchestration scout)**.
Small follow-ups noted by scouts, not yet built: skill-profile public page limiter keyed per token (guessing gets fresh allowance); companion_cli fallbackReason raw provider text (llm-api/B may cover); /api/schedule ?limit >500 truncated:false; about riders: voice ticker double role=status, palette-preview raw stage labels.
python-runner-concurrency is a genuine timing FLAKE (isolated: 3/3 pass once, 1/2 fail later); unchanged by this work — owner's quarantine call.
Registry: scan-sweep 3.5.1 (e1c0626b) — riders, --until-covered, --in-flight all committed with tests.
Lens gap for the owner: review:constitution's route-auth-posture recognises only requireOperator|isOperator|requireWorkspace, not requireOrgCapability/requireCapability — one waiver so far (billing/alerts/[id]).
Known flake (not ours, owner's call): `app/_lib/python-runner-concurrency.test.ts` process-tree-kill case.
- OWED at loop end: run e2e/token-doors-axe.spec.ts against a KP_EMPTY=1 prod build (llm-api/A moved its offer case onto a (SIM) entry; builders could not run it).
- Reword app/features/shared/sharedGet.ts:5-12 comment (Schedule grid+panel double fetch no longer true after schedule/A).
- companion_cli exception path still sends raw provider text as fallbackReason; switching to a code needs app/_lib/companion-turn.ts companionFallbackClass + tests (llm-api/B follow-up).
- Dead catalog key pipeline.tab.previewApplyGlobal (pipeline/B); team-scoped pass filters the shared 2000-row list (documented gap).
- OWED at loop end: browser pass (both themes) over the new UI surfaces the builders could not open — incl. Analyze drag-and-drop (r03 cv-analyze/A), About transport, schedule pending cards, routing chips, promote verdict, receiver editor, SLA editor, glyph empty states.
- Subway keyboard move: no screen-reader announcement and focus does not return to the moved bead (pipeline-board-ui/B gap); tablet cannot move a bead.
- OWED browser check: /?sim=auto live run — SimState.moves shows 'dom' for publish and send-offer (r04 shell-simulation/A).
- OWED at loop end: keyless e2e subset (profile-builder.spec was edited by r04 profile-editor/B; token-doors-axe by r02 llm-api/A) against a KP_EMPTY=1 prod build.
- decisions-review-ui/B deferred only REJECTS through the undo window; accepts still commit on click (their handoffs live in useDecisionsQueue.ts). Extending the window to accepts is a follow-up.
- OWED browser check: sim resume — reload mid-Offer shows 'Resume at Offer', rows kept; a second tab's Resume is refused (SIM_RUN_ACTIVE) while the first walks (r04 shell-simulation/B).
| challenge-r07 | 8 | 4 | carded (8/8), critic deferred until r06 builds start (fresher premises) — was scouting — NOTE scouted two runs ahead of builds (r05 building, r06 queued): expect more 'premise moved' revisions; do not scout r08 until r06 builds |
