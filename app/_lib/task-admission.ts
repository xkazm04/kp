// Every task kind declares its DOOR and its SEAT — the admission column of the
// task-kind vocabulary (app/_lib/task-kinds.ts), beside the budget class
// (task-budget.ts), the dedupe identity and the outcome decision.
//
//   door  "dock"   — the client may start it through POST /api/tasks with its own params.
//         "server" — only a server route enqueues it, AFTER building and validating the
//                    params itself (and asking the seat): analyze's params are the paths
//                    of a workdir /api/analyze made from the upload; lifecycle, jd_build,
//                    repo_scan, agent_fit, interview_kit, interview_letter, companion_digest
//                    and jobseeker_scan each have a dedicated door with its own gates. The
//                    generic dock door answers these 403 TASK_KIND_SERVER_ONLY.
//   capability — what starting (dock), retrying or cancelling a run of the kind asks of
//                the caller's seat. Retry and cancel ask it of the STORED row's kind.
//
// Keyed `Record<TaskKind, …>`, so a kind added to TASK_KINDS without a door decision is
// a compile error; task-admission.test.ts also reads the tree and fails when a kind a
// client starts is not a dock kind, or a kind only server modules enqueue is.
//
// Type-only imports: the route graph gains no module beyond this one.
import type { Capability } from "./auth/roles";
import { TASK_KINDS, isTaskKind, type TaskKind } from "./task-kinds";

export type TaskDoor = "dock" | "server";
export type TaskAdmission = { door: TaskDoor; capability: Capability };

const RECRUITER_DOCK: TaskAdmission = { door: "dock", capability: "pipeline:write" };
const RECRUITER_SERVER: TaskAdmission = { door: "server", capability: "pipeline:write" };

export const TASK_KIND_ADMISSION: Record<TaskKind, TaskAdmission> = {
  // ── dock: the client starts these (grep startTask("…") under app/features) ──
  automation: RECRUITER_DOCK,
  reasoning: RECRUITER_DOCK,
  batch_screen: RECRUITER_DOCK,
  batch_outreach: RECRUITER_DOCK,
  need_analysis: RECRUITER_DOCK,
  design_artifacts: RECRUITER_DOCK,
  evaluate_submission: RECRUITER_DOCK,
  group_eval: RECRUITER_DOCK,
  interview_prep: RECRUITER_DOCK,
  profile_draft: RECRUITER_DOCK,
  // No client literal names it today; kept a dock kind so nothing that builds the kind
  // dynamically is stranded by this table (its params are DB-keyed: a jobId).
  campaign: RECRUITER_DOCK,

  // ── server: a dedicated route builds the params, then enqueues ──
  analyze: RECRUITER_SERVER, // /api/analyze — params are paths into its own workdir
  lifecycle: RECRUITER_SERVER, // /api/devcase/lifecycle, control, [id]/approve
  jd_build: RECRUITER_SERVER, // jd-build-start.ts (/api/jds/generate, intake promote)
  agent_fit: RECRUITER_SERVER, // /api/jobs/[id]/agent-fit
  interview_kit: RECRUITER_SERVER, // /api/jobs/[id]/interview-kit
  interview_letter: RECRUITER_SERVER, // decisions redraft + the candidate's status-link door
  repo_scan: RECRUITER_SERVER, // repo-scan.ts
  companion_digest: RECRUITER_SERVER, // companion-actions.ts
  jobseeker_scan: RECRUITER_SERVER, // /api/jobseeker/scan, via SCAN_TASK_KIND
};

/** May the dock (POST /api/tasks) start this kind with client params? Unknown kinds,
 *  prototype keys included, are never dock kinds. */
export function dockMayStart(kind: string): boolean {
  return isTaskKind(kind) && TASK_KIND_ADMISSION[kind].door === "dock";
}

/** The kinds the dock refuses — for tests and docs. */
export function serverOnlyTaskKinds(): TaskKind[] {
  return TASK_KINDS.filter((k) => TASK_KIND_ADMISSION[k].door === "server");
}

/** The seat a start, retry or cancel of `kind` asks. A kind this build no longer knows
 *  (a row an older build wrote) fails closed to the recruiter seat — never to none. */
export function taskKindCapability(kind: string): Capability {
  return isTaskKind(kind) ? TASK_KIND_ADMISSION[kind].capability : "pipeline:write";
}
