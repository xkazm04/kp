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
| challenge-r06 | 8 | 3 | done — 16/16 landed + 1 follow-up (21593fce5 de-flake); flawless 15/16 (11 strict); critic 4.44/4.88/4.56; 4 coordinator fixes (3 perf settles, 1 barrel import); owner notes in REPORT (ATS forgotten-link re-import, resend existence signal) |

Side fixes outside the card flow: a9bd69f62 companion recall scoped to workspace (r02 llm-api scout); 93f485438 interview-sim /s+/ word count (r03 scout); **9e834cf04 SECURITY: POST /api/tasks analyze with client paths could read any file and rm -rf any directory — refused + confined (r05 workspace-config-api scout)**; e00c802fc keyless devcase fallback graded unknown probes as failures (r05 devcase-core scout); **43f92ced0 SECURITY: hire-from-need let a human's body.workspace pick another team (r06 agents-api scout)**; 232d7158e Sentry hook params typed locally — WRONG DIAGNOSIS, reverted in 42daecab4: the lockfile pins nested @sentry/core 10.71 correctly; the errors came from a broken local install after the node_modules junction incident; **5075b3b08 devcase close sent a rejection to every PROMOTED submitter (r07 devcase-orchestration scout)**.
Small follow-ups noted by scouts, not yet built: skill-profile public page limiter keyed per token (guessing gets fresh allowance); companion_cli fallbackReason raw provider text (llm-api/B may cover); /api/schedule ?limit >500 truncated:false; about riders: voice ticker double role=status, palette-preview raw stage labels.
python-runner-concurrency is a genuine timing FLAKE (isolated: 3/3 pass once, 1/2 fail later); unchanged by this work — owner's quarantine call.
Registry: scan-sweep 3.5.1 (e1c0626b) — riders, --until-covered, --in-flight all committed with tests.
Lens gap for the owner (2 waivers now: billing/alerts, me/capability-holders): review:constitution's route-auth-posture recognises only requireOperator|isOperator|requireWorkspace, not requireOrgCapability/requireCapability — one waiver so far (billing/alerts/[id]).
Known flake (not ours, owner's call): `app/_lib/python-runner-concurrency.test.ts` process-tree-kill case. 2026-09-23 r08 W1: fails ALONE (sandbox on or off), kill code unchanged since 2e4883486 (944202890 only typed the rejection); a standalone repro could not even spawn node -e with windowsHide here (spawn EPERM) — points at this box's process environment, not the code. Still owner's call (quarantine or investigate on a clean machine).
- OWED at loop end: run e2e/token-doors-axe.spec.ts against a KP_EMPTY=1 prod build (llm-api/A moved its offer case onto a (SIM) entry; builders could not run it).
- Reword app/features/shared/sharedGet.ts:5-12 comment (Schedule grid+panel double fetch no longer true after schedule/A).
- profiles-lineage.test.ts "a profile built from an analysis becomes stale" still guards its asserts with `if (newer.createdAt > first.createdAt)` — silently skips on a same-ms save; pin the clock like 21593fce5 did for its sibling.
- DONE 7db88e568: listReconsiderQueue (app/_lib/db/pipeline.ts) still lists any rejected entry that EVER had auto_rejected; after pipeline-api/A (49194ff29) the door 409s PIPELINE_NOT_REINSTATABLE unless the NEWEST of auto_rejected/rejected/reinstated is auto_rejected — queue must use the same rule (UI offers an action the door refuses).
- DONE 36bb74cd3: after 9c226bc38 gated PUT /api/brand on org:manage, admins still SEE the branding editor (navCapabilities.ts header still says requireOperator) and get a 403 on save — gate the nav/editor on org:manage, fix the header, add a viewer/admin-403 row to write-capability-gate.test.ts.
- DONE 899eef6c3: results-core/B (b0a3b711c) disposition save route reads the analysis then writes without .immediate() or a WHERE re-assert — violates the read->compute->write rule; a concurrent save can skip one acknowledgement prompt. Make the ack check + write one IMMEDIATE tx (or CAS on the stored disposition/decision_basis).
- DONE 126f10fdd: POST /api/pipeline (the rediscovery feed's Add door) does not read withheldCandidateIds (rediscovery-eligibility.ts, r08 rediscovery/A 56ddf788e) — a direct call can still file an opted-out / consent-lapsed person (erased is already refused by createPipelineEntry). Loop-open per the builder brief; decide the rule for a HUMAN add (refuse vs warn) against docs/features/compliance.
- DONE c37558e67+cbc5c0c1f: refused-channel failed rows still count as needing the recruiter in channelsCommsHelpers.ts isActionable and outboxView.ts isDeadLetter (r08 drawer/B c56c2e73e made resendDoorOf the one rule; these two must read it). ALSO: drawer/B raised the route-group module ceiling 230->231 because comms-dispatch.ts re-exports SIM/REFUSED channel constants from comms-resend-outcome.ts — define them locally in comms-dispatch with an equality test (jobs-table-core precedent) and lower the ceiling back.
- DONE 6b9191034: analyze cache key (cache-key.ts / analyze-run.ts) omits the live archetype-registry digest that r08 archetypes/A (bd5137a9b) added to the matrix cache — a weight edit can serve a stale cached analysis. Low: server isEarlyCareer callers (comms-dispatch, group-eval-run, interview-*, /api/interview/compare) still read the bundled registry copy (wording/plans only, not auto-reject).
- OWNER (not challenge work): review:constitution BLOCKS on app/api/journeys/cohort/route.ts (route-auth-posture) — committed by a non-challenge session as 1e52a019f with currentWorkspace() behind the proxy gate and no requireOperator, the same posture as its sibling /api/journeys. review.yml stays red on any range containing 1e52a019f until that session adds requireOperator or records a Gate-exemption with its reason. Deliberately NOT waived by the challenge coordinator.
- companion_cli exception path still sends raw provider text as fallbackReason; switching to a code needs app/_lib/companion-turn.ts companionFallbackClass + tests (llm-api/B follow-up).
- Dead catalog key pipeline.tab.previewApplyGlobal (pipeline/B); team-scoped pass filters the shared 2000-row list (documented gap).
- OWED at loop end: browser pass (both themes) over the new UI surfaces the builders could not open — incl. r08 reconnect notice, person-first rediscovery feed, locked-tab panel (viewer on ?tab=billing), floor-move preview, drawer SWR + letters-needing-you, ElevenLabs orb; r07 decision ack editor, hire-rating queue, interview coverage cells, models routing pick board, setup finish receipt, dev-case outcome chips, Roles desk window; r06 offer-letter preview pane, metric-pack preview, agent roster next move, devcase in-flight close warning + intake-closed banner, bulk-move preview, status next-action card; Analyze drag-and-drop (r03 cv-analyze/A), About transport, schedule pending cards, routing chips, promote verdict, receiver editor, SLA editor, glyph empty states.
- Subway keyboard move: no screen-reader announcement and focus does not return to the moved bead (pipeline-board-ui/B gap); tablet cannot move a bead.
- OWED browser check: /?sim=auto live run — SimState.moves shows 'dom' for publish and send-offer (r04 shell-simulation/A).
- OWED at loop end: keyless e2e subset (shell.spec + public-pages.spec after r07 jd-public-detail/B hreflang change, and a manual look at /jds/<slug>?lang=cs with a stored translation; profile-builder.spec was edited by r04 profile-editor/B; token-doors-axe by r02 llm-api/A) against a KP_EMPTY=1 prod build.
- decisions-review-ui/B deferred only REJECTS through the undo window; accepts still commit on click (their handoffs live in useDecisionsQueue.ts). Extending the window to accepts is a follow-up.
- OWED browser check: sim resume — reload mid-Offer shows 'Resume at Offer', rows kept; a second tab's Resume is refused (SIM_RUN_ACTIVE) while the first walks (r04 shell-simulation/B).
| challenge-r07 | 8 | 4 | done — 16/16 landed + 4 follow-ups; flawless 12/16 (7 strict); critic 4.06/4.56/4.06; 4 coordinator fixes (3 perf settles, logger perf_counter 3d6e41446); owner notes in REPORT (PROMPT_VERSION v7, gemini-flash routing recommendation, CLI retries, billing journal rollback) |
| challenge-r08 | 8 | 0 | done — 16/16 landed + 3 follow-ups; flawless 13/16 (9 strict); critic 4.13/3.88/4.19; 5 coordinator fixes (3 perf settles, guard reconciliation 8c9d8bf34, capability-holders lens waiver); owner notes in REPORT (background task lane, analysis cache digest, journey-cohort lens block, lens gap x2) |
| challenge-r09 | 8 | 0 | W1 LANDED 6/6 (f43d8320c); W2 LANDED 6/6 + 3 follow-ups green (7769a80b1 coordinator fix: invite-suppression follow-up broke tsc in stage-hooks — narrowed; 4672eebb0 settle; voice/readiness lens waiver); lock takeover incident (schedule-prep/B took a 14-min lock and deleted it under voice-provider/B — no loss, verified); W3 building = cv-analyze/B, devcase-lifecycle/B, comms-optout/B, spark/B |
| challenge-r10 | 8 | 0 | scouting — analyze-workspace, pipeline-core, voice-tts-package, db-core-migrations, devcase-detail, e2e-suite, interview-execution-scoring, jobs-posting-campaign; 110 uncovered with r08+r09 in flight |
