import { SIM_TITLE_LIKE } from "@/app/features/shell/simulation/constants";
import { ensureDb } from "./core.ts";
import { DEFAULT_WORKSPACE_ID } from "./workspaces.ts";
import { getPipelineAxis } from "../pipeline-axis-server.ts";
import { threadAutonomy, type ThreadAutonomy, type ThreadEvent } from "../thread-autonomy.ts";

// The server half of the thread-autonomy read (thread-autonomy.ts holds the pure core and
// the rules). It groups the board's pipeline_events by the job their entry belongs to and
// scores each job's thread — one row per job, so the goal is read per ROLE, not as one
// workspace-wide blend that hides which role stalls.
//
// TENANCY: the event row AND the entry it hangs off must both be in `workspaceId`. The
// join alone would not do — an event's own workspace_id is what a reader of the log is
// scoped by — and checking both means a row that disagrees with its entry (a bad write,
// a migration gap) is dropped rather than leaked into the other team's number.
//
// ENTRY-LESS events (ko_declined) have no job to group by and are not read. Guided-demo
// residue is excluded on the same key every analytics read uses, so a simulation run can
// never move this number.
//
// BOUNDED: a window (default 30 days) and a hard cap on events read, so a long-lived board
// cannot turn this into an unbounded scan. `truncated` says the cap was hit — the figures
// then cover the OLDEST events of the window, and the caller must not present them as
// complete.

export const THREAD_AUTONOMY_DEFAULT_WINDOW_DAYS = 30;
export const THREAD_AUTONOMY_MAX_EVENTS = 20_000;
export const THREAD_AUTONOMY_MAX_JOBS = 500;

export type JobThreadAutonomy = ThreadAutonomy & {
  jobId: string;
  jobTitle: string | null;
  events: number;
};

export type ThreadAutonomyReport = {
  workspaceId: string;
  since: string;
  until: string;
  /** One row per job with at least one event in the window, busiest first. */
  jobs: JobThreadAutonomy[];
  /** The event cap was hit: the window holds more events than were read. */
  truncated: boolean;
};

type EventRow = {
  job_id: string;
  job_title: string | null;
  kind: string;
  to_stage: string | null;
  actor: string | null;
  created_at: string;
};

export function listThreadAutonomyByJob(
  opts: { workspaceId?: string; windowDays?: number; now?: Date; maxEvents?: number; maxJobs?: number } = {}
): ThreadAutonomyReport {
  const workspaceId = opts.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const windowDays = Math.min(Math.max(Math.floor(opts.windowDays ?? THREAD_AUTONOMY_DEFAULT_WINDOW_DAYS), 1), 365);
  const maxEvents = Math.min(Math.max(Math.floor(opts.maxEvents ?? THREAD_AUTONOMY_MAX_EVENTS), 1), THREAD_AUTONOMY_MAX_EVENTS);
  const maxJobs = Math.min(Math.max(Math.floor(opts.maxJobs ?? THREAD_AUTONOMY_MAX_JOBS), 1), THREAD_AUTONOMY_MAX_JOBS);
  const until = opts.now ?? new Date();
  const since = new Date(until.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const rows = ensureDb()
    .prepare(
      `SELECT p.job_id AS job_id, e.job_title AS job_title, e.kind AS kind, e.to_stage AS to_stage,
              e.actor AS actor, e.created_at AS created_at
         FROM pipeline_events e
         JOIN pipeline_entries p ON p.id = e.entry_id
        WHERE e.workspace_id = ? AND p.workspace_id = ?
          AND p.job_id IS NOT NULL
          AND e.created_at >= ? AND e.created_at < ?
          AND (e.job_title IS NULL OR e.job_title NOT LIKE ?)
        ORDER BY e.created_at ASC, e.id ASC
        LIMIT ?`
    )
    .all(workspaceId, workspaceId, since.toISOString(), until.toISOString(), SIM_TITLE_LIKE, maxEvents + 1) as EventRow[];

  const truncated = rows.length > maxEvents;
  if (truncated) rows.length = maxEvents;

  const byJob = new Map<string, { title: string | null; events: ThreadEvent[] }>();
  for (const r of rows) {
    const job = byJob.get(r.job_id) ?? { title: null, events: [] };
    job.title ??= r.job_title;
    job.events.push({ kind: r.kind, actor: r.actor, toStage: r.to_stage, createdAt: r.created_at });
    byJob.set(r.job_id, job);
  }

  const axis = getPipelineAxis(workspaceId).stages;
  const jobs = [...byJob.entries()]
    .map(([jobId, job]) => ({ jobId, jobTitle: job.title, events: job.events.length, ...threadAutonomy(job.events, axis) }))
    .sort((a, b) => b.events - a.events || a.jobId.localeCompare(b.jobId))
    .slice(0, maxJobs);

  return { workspaceId, since: since.toISOString(), until: until.toISOString(), jobs, truncated };
}
