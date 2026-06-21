# Tri-Lens Fix Wave 4 — Pipeline State & Unwired Features (themes T5 + T6)

> 6 atomic fix commits, 6 criticals closed.
> Baseline preserved: tsc 0 → 0 · unit tests 951 → 953 (+2) · 0 regressions.
> Branch: `vibeman/triscan-fixes-2026-06-18`.

## Commits

| # | Commit | Finding | Severity | Files |
|---|---|---|---|---|
| 1 | `8710184` | interview-simulation #1 — attach mode mismatch | Critical | api/interview/simulate/attach/route.ts |
| 2 | `025a1e8` | group-eval-fairness #1 — KO-failed crowned lead | Critical | group-eval-run.ts |
| 3 | `2eafdf0` | offers-onboarding #1 — accept resurrects terminal entry | Critical | db/pipeline.ts, offer-finalize.ts |
| 4 | `f0ace13` | dev-lifecycle-cohort #1 — closed posting accepts | Critical | distribution.ts, devcase submit/inbound routes |
| 5 | `5de2e09` | dev-submissions-live #1 — authenticity discards live work | Critical | devcase-authenticity.ts (+test), devcase-run.ts |
| 6 | `f918094` | devcase-authoring #1 — late submission lost | Critical | devcase-orchestrator.ts |

## What was fixed

1. **"Attach practice run" un-broken.** The attach route required `session.mode === "test"`, but `/api/interview/simulate` mints sim sessions as mode `"candidate"` (so the voice providers get the scripted brief) — so attach 404'd on every sim token and the feature was silently dead. Qualify a practice run by the real discriminator: **no linked pipeline entry** (`entryId` null); accept those, reject entry-linked candidate sessions. Voice/consent behavior untouched.

2. **KO-failed candidate can't be the recommended lead.** Ranking was pure fit-score, so a candidate who failed the role's knockout must-haves could top the list and be **sealed into the tamper-evident decision record** as the lead. Made the sort ko-aware (failed sinks below passing/ungated; fit breaks ties), derived the lead as the best ko-passing candidate, and only compute differentiators / set topPick / seal when such a lead exists. An all-failed field yields no lead + a summary that says so.

3. **Offer-accept can't resurrect a terminal candidate.** `actOnPipelineEntry`'s accept path advanced a stage based only on the current stage, never the entry **status** — so a stale offer link accepted after the candidate was rejected/declined/rematched flipped them to Hired and fired onboarding while status stayed terminal. Added `if (action === "accept" && isTerminalEntryStatus(row.status)) return null;` inside the IMMEDIATE transaction (covers every accept caller); offer-finalize records `offer_accepted` only on a real transition (mirroring decline) and logs `offer_accept_blocked` otherwise.

4. **Closed posting refuses submissions everywhere.** The closed-status guard lived only in the public `inbound` route, so the internal `/api/devcase/submit` accepted submissions for a closed posting (re-ghosting candidates). Moved the guard into the shared `intakeSubmission` core (it already loads the posting) via a typed `PostingClosedError`; both routes map it to 410.

5. **Live-session work scored on what was watched, not absent git.** A Live Work Surface submission (`repoRef "session:<id>"`, no git) had `processTrace` built only from git → `commitCount 0` + `decisionsLogPresent` always false → docked to 60/"mixed". Derived `decisionsLogPresent` from the observed event stream (a `decision_log` event or DECISIONS file touch) and passed `observed: true` so `scoreAuthenticity` waives the no-commit penalty (watched work can't have commits). A genuinely missing DECISIONS log is still penalized. +2 tests.

6. **Mid-evaluation submission no longer dropped.** The collecting handler evaluated a one-shot snapshot then advanced to ranked; a candidate applying during the seconds-long evaluation had their resume **coalesced** into the running task (stable dedupe key) and was never seen — a silent ghost. Replaced the single pass with a **drain-with-recheck** inner loop: re-read after each batch and evaluate not-yet-attempted arrivals until none remain. `attempted` prevents a failing eval from pinning the lifecycle; `MAX_COLLECT_PASSES` bounds a flood within the single step (outer step budget untouched).

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| `node --test app/**/*.test.ts` | 951 | 953 (+2) |

## Patterns established (catalogue, continued)

11. **Discriminate on the real invariant, not a drifted proxy.** The attach guard keyed on `mode` (which drifted) instead of the actual property that defines a practice run (no linked entry). When two producers disagree on "what kind of thing is this", key the consumer on the structural invariant.
12. **A terminal-status guard belongs on every transition, not just the obvious one.** `approve_event` guarded terminal entries; `accept` didn't — same class, one gap, one resurrection bug. Audit sibling transitions for the same guard.
13. **Guards belong in the shared core, not one caller.** A status/closed/auth check duplicated in the "public" path but missing from the "internal" path is a bypass waiting to happen — push it down to the function both call.
14. **Coalescing dedup drops the resume signal.** A stable dedupe key that (correctly) prevents duplicate concurrent runs also swallows a re-trigger that lands mid-run. Either re-check inside the run (drain loop) or carry a durable dirty flag — never assume the snapshot you took at the top is still complete.

## What remains (per INDEX)

- **Same-context follow-ups (High/Med, not this wave):** sim scorecard payoff + student-mode surface (interview-sim #2/#5), `submitDevSession` finalize txn + live-session contact capture (dev-submissions #2/#3), per-token rate-limit on devcase intake / repo-snapshot fan-out (dev-submissions #5), duplicate-posting publish idempotency (devcase-authoring #2), authenticity-pill a11y (dev-submissions #4). The late-submission residual (durable `collecting_dirty` flag) noted in the commit.
- **Next themes:** T4 AI quality (4C), T7/T8/T10 durability/XSS/timezone (4C), T9 conversion (3C), T11 UI polish.
