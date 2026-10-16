import { NextResponse } from "next/server";
import { listDraftJobs } from "@/app/_lib/job-ingest";
import { withWorkspace } from "@/app/_lib/auth/workspace-context";


// The drafts awaiting publish, for the JD library's Drafts panel. Seeded corpus jobs
// carry no status and are absent = already live.
//
// This used to ship a second field, `statuses` — the whole workspace's jobId → status
// map, "for badges". Nothing read it: DraftsPanel (the ONLY caller, app/features/
// library/jobs/JobsDraftsPanel.tsx) takes `p.drafts` and drops the rest, and the badges
// it was meant to feed resolve their status from the job rows the catalog already
// carries. So every poll of this endpoint serialized every role's lifecycle state for
// no reader. Dropped rather than wired up: a payload nobody consumes is a contract
// nobody can change safely, and `listJobStatuses` is still there for a server-side
// caller that genuinely needs the map.
export const GET = withWorkspace(async (ws: string) => {
  return NextResponse.json({ drafts: listDraftJobs(ws) });
});
