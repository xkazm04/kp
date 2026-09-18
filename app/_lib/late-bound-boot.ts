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
  // The stage hook's AI-interview mint (stage-hooks.ts): the same door
  // POST /api/interview/create calls, unchanged.
  registerStageHookInvite(async (input) => {
    const { mintAndInviteVoiceScreen } = await import("./interview-invite");
    return mintAndInviteVoiceScreen(input);
  });
}
