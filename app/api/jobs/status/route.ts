import { NextResponse } from "next/server";
import { listDraftJobs } from "@/app/_lib/job-ingest";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";


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
export async function GET() {
  const ws = await currentWorkspace();
  return NextResponse.json({ drafts: listDraftJobs(ws) });
}
