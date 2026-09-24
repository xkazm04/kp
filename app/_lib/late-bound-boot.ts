// The ONE list of late-bound implementations, registered at boot.
//
// Two hub modules sit on nearly every route's import graph — tasks.ts (every route
// that starts or polls a task) and db/pipeline.ts (through its lazy stage-hooks edge)
// — and the perf budget counts every module they reach, dynamic imports included. A
// heavy implementation behind either of them is therefore held in a leaf registry
// (task-external-runners.ts, stage-hooks-invite.ts) and registered HERE, from
// instrumentation-node.ts, which no route imports. Each implementation is still loaded
// lazily, on its first use, so boot pays for nothing it does not run.
//
// Callers:
//   - instrumentation-node.ts, at server boot (idempotent: re-registering replaces);
//   - app/_lib/testing/unit-db.ts, so a unit-test process boots the same seams the
//     server does and a store test that moves an entry into an AI interview column, or
//     queues a task, exercises the real wiring rather than a test double.
//
// Adding a kind to tasks.ts that delegates to `externalRunner(kind)` means adding its
// registration here in the same change: late-bound-boot.test.ts parses tasks.ts and
// fails on a delegated kind this function does not register.
//
// The converse is NOT required, and `intake_round` below is the first case: a kind may be
// registered here and called straight from a route through the same leaf registry, with
// no spec in tasks.ts at all. That is the right shape when there is no durable task row
// to poll — no progress, no cancel, no result to fetch later — and it keeps the
// implementation off the hub's graph for the same reason the other three are here.

import { registerTaskRunner } from "./task-external-runners";
import { registerStageHookInvite } from "./stage-hooks-invite";

export function registerLateBoundImplementations(): void {
  // The seeker's manual scan: the whole acquisition graph (adapters, rules engine,
  // reconciliation).
  registerTaskRunner("jobseeker_scan", async (ctx) => {
    const { runJobseekerScan } = await import("./jobseeker/scan");
    return runJobseekerScan(ctx.workspaceId, { trigger: "manual", signal: ctx.signal, onProgress: ctx.progress });
  });
  // The job's interview kit draft (tasks.ts `interview_kit`). The job id is
  // client-supplied through POST /api/tasks; the runner re-checks ownership itself.
  registerTaskRunner("interview_kit", async (ctx) => {
    const { runInterviewKit } = await import("./interview-kit-run");
    return runInterviewKit(String(ctx.params.jobId), ctx.signal, ctx.workspaceId);
  });
  // The candidate's feedback-letter draft (tasks.ts `interview_letter`). Same rule: the
  // letter id resolves inside the enqueuing team or not at all (interview-letter-run.ts).
  registerTaskRunner("interview_letter", async (ctx) => {
    const { runInterviewLetter } = await import("./interview-letter-run");
    return runInterviewLetter(String(ctx.params.letterId), ctx.signal, ctx.workspaceId);
  });
  // The role-intake round's HISTORY row (Journey Analytics, db/intake-events.ts).
  //
  // NOT a tasks.ts kind, and deliberately so. The other three entries here back a spec in
  // that hub; this one is called straight from POST /api/intake/[id]/message through the
  // same leaf registry. A tasks.ts kind would put the classifier and the store on the hub
  // ~60 routes import — which is the exact cost this seam exists to avoid — and would buy
  // nothing: there is no durable task row to poll, no progress to report and no cancel to
  // honour. A round either gets its row or it does not.
  //
  // CLASSIFY, THEN WRITE — in that order, because `intake_events` is append-only and has
  // no UPDATE path to add a topic afterwards. The classifier is deterministic and keyless
  // (app/_lib/journey/intake-topics.ts): it reaches no model, no network and no
  // subprocess, and it REFUSES rather than guesses, leaving `topic_code` NULL for a round
  // it cannot place. Both imports are lazy, so nothing here is paid for until a round is
  // actually recorded.
  registerTaskRunner("intake_round", async (ctx) => {
    const { classifyIntakeRound } = await import("./journey/intake-topics");
    const { INTAKE_ROUND_FACT_CHARS, recordIntakeEvent } = await import("./db/intake-events");
    const question = typeof ctx.params.question === "string" ? ctx.params.question : "";
    const answer = typeof ctx.params.answer === "string" ? ctx.params.answer : "";
    const topicCode = classifyIntakeRound({ question, answer });
    recordIntakeEvent({
      intakeId: String(ctx.params.intakeId),
      // The enqueuing tenant, exactly as the three runners above take it — never the
      // deployment default, and never re-derived from the params the caller supplied.
      workspaceId: ctx.workspaceId,
      kind: "intake_round",
      occurredAt: String(ctx.params.occurredAt),
      topicCode,
      // Bounded here as well as at the route: the runner is the chokepoint's caller and
      // must not depend on one caller having trimmed its input.
      facts: { question: question.slice(0, INTAKE_ROUND_FACT_CHARS), answer: answer.slice(0, INTAKE_ROUND_FACT_CHARS) },
      actor: typeof ctx.params.actor === "string" ? ctx.params.actor : null,
    });
    return { topicCode };
  });
  // The analyze task's GitHub deep-dive stage (analyze-run.ts `ANALYZE_GITHUB_RUNNER`).
  // analyze-run is on tasks.ts's graph and reaches the stage by name, so the harvest stays
  // off the ~60 routes that import that hub. Registered here, not by /api/analyze, so a
  // task replayed after a restart finds it before any route has loaded.
  registerTaskRunner("analyze_github", async (ctx) => {
    const { runGithubStageTask } = await import("./analyze-github-stage");
    return runGithubStageTask(ctx);
  });
  // Gigs (app/_lib/gigs). Like `intake_round`, NO spec in tasks.ts: the Gig desk's
  // "scan now" / "sync now" doors and the clock (instrumentation-node.ts) reach them
  // through this leaf registry, which keeps the adapter graph (the scan) and the
  // Personas bridge + deliverable parser (the sync) off every importer's path until
  // one actually runs. Both scope every read and write to `ctx.workspaceId`.
  //
  // `gig_scan` runs `runGigScan(workspaceId, deps, signal)` (gigs/scan.ts) with its
  // default deps PLUS the qualifier (gigs/qualify.ts), which the scan's defaults leave
  // unplugged: every listing still `new` is scored and matched to a specialist as it
  // lands. The manual run is what verifies the clock job (requiresVerifiedRun).
  registerTaskRunner("gig_scan", async (ctx) => {
    const { runGigScan, defaultGigScanDeps } = await import("./gigs/scan");
    const { qualifyGigHook } = await import("./gigs/qualify");
    return runGigScan(ctx.workspaceId, { ...defaultGigScanDeps(), qualify: qualifyGigHook }, ctx.signal);
  });
  // `gig_sync` pulls the workspace's in-flight attempts from Personas (gigs/sync.ts),
  // then asks the outcome pollers (gigs/pollers.ts, WP4) about the workspace's SENT work:
  // a merged pull request or a scored Kaggle entry resolves without the operator typing
  // it in. The pollers run after the sync and their summary rides beside its counts.
  registerTaskRunner("gig_sync", async (ctx) => {
    const { syncGigAttempts } = await import("./gigs/sync");
    const { pollGigOutcomes } = await import("./gigs/pollers");
    const sync = await syncGigAttempts(ctx.workspaceId);
    const outcomes = await pollGigOutcomes(ctx.workspaceId);
    return { ...sync, outcomes };
  });
  // The stage hook's AI-interview mint (stage-hooks.ts): the same door
  // POST /api/interview/create calls, unchanged.
  registerStageHookInvite(async (input) => {
    const { mintAndInviteVoiceScreen } = await import("./interview-invite");
    return mintAndInviteVoiceScreen(input);
  });
}
