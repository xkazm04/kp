// Auto-open logic for JobsTab.tsx — extracted verbatim (no behaviour change) so
// the tab file stays under the 200-line split threshold. Owns two independent
// auto-open sources for the posting modal: a just-ingested job (the latch,
// bounded to a single refresh) and a Pipeline deep link (?tab=jobs&job=<id>).
"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Job } from "./JobsTypes";
import { resolveIngestLatch, type IngestLatch } from "./jobsIngestLatch";

export function useJobsTabDeepLink(jobs: Job[] | null) {
  const [openJob, setOpenJob] = useState<Job | null>(null);

  // A just-ingested job to auto-open once the refreshed corpus contains it (mirrors
  // the ?job= deep-link below). bug-ui-scan-2026-07-09 (job-postings-lifecycle #5):
  // the latch now carries the jobs-array reference it was armed against so it is
  // bounded to a SINGLE refresh — on the refreshed list it either opens the match or
  // clears itself (a miss), instead of staying armed forever when the ingested draft
  // is hidden (e.g. by the "open only" filter) and later auto-opening out of nowhere.
  const [pendingOpen, setPendingOpen] = useState<IngestLatch | null>(null);
  {
    const resolved = resolveIngestLatch(jobs, pendingOpen);
    if (resolved.kind === "open") {
      setPendingOpen(null);
      setOpenJob(resolved.job);
    } else if (resolved.kind === "clear") {
      setPendingOpen(null);
    }
  }

  // Deep link from the Pipeline (?tab=jobs&job=<id>): auto-open that job's
  // posting. Applied during render (guarded render-phase adjustment) once the
  // corpus is loaded — once per param value, so a list refetch can no longer
  // re-open a modal the user already closed.
  const search = useSearchParams();
  const jobParam = search.get("job");
  const [appliedJobParam, setAppliedJobParam] = useState<string | null>(null);
  if (jobs && jobParam !== appliedJobParam) {
    setAppliedJobParam(jobParam);
    const match = jobParam ? jobs.find((j) => j.id === jobParam) : null;
    if (match) setOpenJob(match);
  }

  const armPendingOpen = (id: string) => setPendingOpen({ id, sawJobs: jobs });

  return { openJob, setOpenJob, armPendingOpen };
}
