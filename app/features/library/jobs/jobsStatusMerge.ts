import type { Job } from "./JobsTypes.ts";

// A lifecycle transition a recruiter can trigger from the posting modal.
export type JobLifecycleStatus = "published" | "closed";

// Merge a lifecycle action's result into the corpus list so the affected row's
// status badge/chips reflect reality immediately — without waiting for a manual
// reload (job-postings-lifecycle finding #2: publish/close/reopen never refreshed
// the Jobs table, so a just-closed role kept reading live).
//
// Pure: returns a NEW array with ONLY the target row's `status` replaced; every
// sibling row is preserved by reference (so React re-renders just the row that
// changed). A miss (id not in the list) or a no-op (already that status) returns
// the SAME list reference, and a null list passes through — no needless re-render.
export function mergeJobStatus(
  jobs: Job[] | null,
  jobId: string,
  status: JobLifecycleStatus
): Job[] | null {
  if (!jobs) return jobs;
  let changed = false;
  const next = jobs.map((job) => {
    if (job.id !== jobId || job.status === status) return job;
    changed = true;
    return { ...job, status };
  });
  return changed ? next : jobs;
}
