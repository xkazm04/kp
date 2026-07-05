import { NextResponse } from "next/server";
import { listDraftJobs, listJobStatuses } from "@/app/_lib/job-ingest";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";


// Lifecycle status for authored JDs: a jobId → status map (for badges) plus the
// list of drafts awaiting publish. Seeded corpus jobs are absent = already live.
export async function GET() {
  const ws = await currentWorkspace();
  return NextResponse.json({ statuses: listJobStatuses(ws), drafts: listDraftJobs(ws) });
}
