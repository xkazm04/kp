# Pipeline write doors — security scan, 2026-10-07

Scope: the write doors under `app/api/pipeline/` (`route.ts`, `[id]`, `batch`, `command`,
`command/reverse`, `events`, `outcomes`, `rejected`, `stage-impact`, `stage-migration`,
`stage-sla`). Base: main `73d802b9c`. Charter: `codebase-security-scan`. Delivers idea
`d6f86aa9`.

Severity is ranked for this prototype as it stands: no outside users yet, but every
deploy with `KP_OPERATOR_PASSWORD` unset is open (proxy.ts lets every caller in, and
`requireOperator()` lets every caller through). On an open deploy, a limiter is the
only bound on a door.

## Summary

| # | Finding | Where | Severity | State |
| --- | --- | --- | --- | --- |
| 1 | A Match verdict is sealed with a score and facts that the server never checks | `app/api/pipeline/route.ts:132-137`, sealed at `:204` | High | Reported. The sound fix needs paths outside this task |
| 2 | POST /api/pipeline had no limiter | `app/api/pipeline/route.ts:190` | Medium | **Fixed** `8f5603f4d` |
| 3 | A confirmed `reject below` / `advance top` on the command bar ran with no limiter (idea d6f86aa9) | `app/api/pipeline/command/route.ts:156` | Medium | **Fixed** `28aac8adb` |
| 4 | The per-card move/decide actions had no limiter. With the add door's reopen, a loop can email one candidate without bound | `app/api/pipeline/[id]/route.ts:219` | Medium | **Fixed** `e33923da7` |
| 5 | POST /api/pipeline asks no operator session and no `pipeline:write` seat | `app/api/pipeline/route.ts:84` | Medium (password set) / n/a (open) | Reported. The ratchet files that must change are outside this task's paths |
| 6 | Matrix and manual adds file a client-chosen `matchScore` that later drives `reject below` and `advance top` | `app/api/pipeline/route.ts:225`, read at `app/_lib/pipeline-command.ts:113` | Low | Reported (same root cause as 1) |

Doors with no finding:
- `batch`: operator, then seat, then `pipeline-batch` 20/min.
- `stage-migration`: operator, then seat, then limiter.
- `command/reverse`: operator and seat. It spends nothing and is bounded by `WAVE_REVERSAL_CAP`.
- `outcomes` POST: operator and seat. It writes one rating on a hired entry and spends nothing.
- `stage-sla` PATCH: operator and seat. It writes one team config value and spends nothing.
- `rejected`, `stage-impact`, `events/recent`: operator-gated reads.
- `events` GET: public by design, and it answers the anonymized projection only.

Every door that writes scopes its write to `currentWorkspace()`.

## 1. The sealed Match verdict is unverified (KNOWN 1, confirmed)

On a Match add, POST /api/pipeline checks three things:
- the facts' shape and closed vocabularies (`coerceMatchReasonFacts`, `app/_lib/match-verdict.ts:107`);
- that `matchFacts.matchScore` equals `body.matchScore` (`route.ts:134`);
- nothing else.

The facts are then sealed into the decision chain as a `match_verdict` record (ADR 0018) with `policyVersion: matchFacts.scorerVersion`. The comment at `route.ts:196-198` already says so: *"the record attests what they were shown, not what the server recomputed."* Anyone who can reach the door can therefore seal any score, tier, dimension or skill list under any scorer version. On an open deploy that is anyone at all. The filed `matchScore` then becomes the entry's stored score, and `reject below N%` / `advance top N` rank on that score (`app/_lib/pipeline-command.ts:113,123`). So a forged verdict also steers the bulk adverse actions.

**Why it is not fixed here.** No server-side source exists to check the score against:
- `POST /api/match` (`app/api/match/route.ts:96`) spawns `match_cli` and returns the result to the browser. It stores nothing.
- The recruiter's weight override (`sanitizeMatchWeights`, MAT1) changes the total. A baseline recompute in the add door would therefore refuse legitimate adds, unless the add also carried the weights. That changes the client (`app/features/insights/matrix/focus/useMatchResultsPipeline.ts`).
- A recompute in the add door would also spawn Python per add. The add door would then become a spend door.

**Fix shape (the narrowest sound one).**
1. `/api/match` persists each result it returns, keyed by `(workspace, candidate, job, scorerVersion, weightsHash)`, with a short TTL. It returns a `matchRunId` beside the results. This needs a new store under `app/_lib/db/` and a tenancy-manifest entry.
2. The Match add carries `matchRunId`.
3. POST /api/pipeline loads that stored result and refuses with a coded 409 when any of these differ from what the result says: `matchScore`, `fitTier`, `best`/`worst`, the skill lists, or `scorerVersion`. Only then does it seal.

This needs no new service and no key. It touches `app/_lib/db/`, `app/api/match/` and the Match client, none of which are in this task's paths.

## 2. POST /api/pipeline had no limiter (KNOWN 2, fixed)

The door writes an entry, can reopen a rejected one (the reconsider door), and seals a verdict on every call. It now spends `pipeline-add:<workspace>:<ip>` at 600/10min, after every cheap refusal and before the seal. The seal-first block and the re-add path are untouched.

- **Sizing.** The heaviest honest caller is the Fit Matrix's sequential bulk add. The role demo and the automation pass create entries in-process and never reach this door over HTTP.
- **Key.** The workspace is in the key because with no trusted proxy every caller resolves to one shared IP bucket (`rate-limit.ts`, "THE TRAP"). The demo session can reach this door, so without the workspace a demo visitor could lock a real team out of adding.
- **Pinned by:** a `rate-limit-contract.test.ts` row, and `app/api/pipeline/add-rate-limit.test.ts`, which drives the real handler. A spent window answers 429 `TOO_MANY_REQUESTS` with no entry, no event and no sealed record.

## 3. Command-bar waves had no limiter (idea d6f86aa9, fixed)

**Reconcile.** On `73d802b9c`, `command/route.ts` throttled only `run_policy`. The contract file called the per-candidate commands *"deliberately NOT throttled — bounded by the previewed cohort"*. That bounds one wave, not how many waves a loop can run. Each target of a wave can queue candidate email: the rejection letter, or the AI-interview invite or work-sample assignment that an advance sets off. The batch door, which does the same one-action-many-candidates work, was already throttled.

**Fix.** A confirmed `reject_below` / `advance_top` now spends `pipeline-command-exec:<ip>` at 20/10min, in a separate bucket from `run_policy`. The preview writes nothing and stays free.

**Pinned by:** a contract row, and `command/execute-rate-limit.test.ts`, which drives the real handler.

## 4. The per-card door had no limiter (fixed)

`set_stage`, `accept`, `reject` and `approve_event` on POST /api/pipeline/[id] each run `runPipelineEntryAction`, and that core can queue candidate email. The door had no throttle. With finding 2's reopen, this loop could mail one candidate without bound:

1. reject (sends the rejection letter);
2. re-add (reopens the entry);
3. reject again.

**Fix.** These four actions now spend `pipeline-entry-move:<ip>` at 300/10min. The note, evidence, reinstate and intake branches send nothing and return before the limiter, so the drawer's notes autosave is never throttled.

**Pinned by:** a contract row, and `[id]/move-rate-limit.test.ts`, which drives the real handler.

## 5. POST /api/pipeline asks no seat (reported)

Every other pipeline write door runs `requireOperator()` and then `requireCapabilityCoded("pipeline:write")`. The add door runs neither. As a result:
- a **viewer** seat can add a candidate, reopen a rejected one through the reconsider door, and seal a Match verdict;
- with a password set, the anonymous **demo** session can write into the demo workspace.

The door is listed as debt in two ratchets:
- `app/api/route-capability-coverage.test.ts:173` ("slice 2 candidate");
- `app/api/pipeline/batch/authz-parity.test.ts:52`, which says the debt is "owned this wave by r06 db-pipeline-store/A (the re-add door)".

Closing it means:
1. adding the two gates at the top of POST;
2. deleting both allowlist rows (the capability ratchet fails on a gated door that is still listed);
3. adding a viewer-403 case to `app/api/write-capability-gate.test.ts`.

Steps 2 and 3 edit files outside this task's paths, and the owner has to decide whether the demo sandbox should keep its Match add.

## 6. Matrix and manual adds file a client-chosen score (reported)

`source: "matrix"` and plain board adds send `matchScore` with no facts, and the door stores it as sent. The value is not sealed, but it is what `reject below` / `advance top` rank on. The root cause is the same as finding 1, and so is the fix: a stored match or matrix result to check against.

## Outside the scope: open-mode write doors with no limiter

These are reported only, not fixed. "Open mode" means `requireOperator()` is a no-op.

| Route | What it writes or spends | Severity |
| --- | --- | --- |
| `app/api/devcase/lifecycle/[id]/redesign/route.ts:24` (call at `:53`) | One LLM design pass (~60s, `runDesignArtifacts`) per call, debited to the `case_designs` meter. No `requireOperator`, no capability (`route-capability-coverage.test.ts:112`), no limiter | Medium |
| `app/api/automation/run/route.ts:17` (call at `:63`) | The global Python policy pass, which dispatches candidate outreach. Single-flight only, so a sequential loop re-runs it without bound. `command` (`run policy`) and `automation/schedule` (`tick`) already throttle the same sweep | Medium |
| `app/api/agents/dispatch/route.ts:73` (calls at `:162`, `:227`) | Dispatches a Personas agent with a USD budget. It reuses an in-flight hire, but does not bound sequential dispatches | Medium |
| `app/api/sim/inbound/route.ts:27` (call at `:58`) | Creates a `(SIM)` pipeline entry per call. The demo session can reach it | Low |
| `app/api/devcase/feedback/route.ts:15` (call at `:55`) | Queues an outbox letter row (it is not sent until a recruiter sends it) | Low |
| `app/api/devcase/lifecycle/[id]/close/route.ts:19` (call at `:90`) | `sendComm` to each candidate of a lifecycle. The close claims the lifecycle once, so the send happens once per lifecycle | Low |
