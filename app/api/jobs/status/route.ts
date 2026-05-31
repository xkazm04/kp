import { NextResponse } from "next/server";
import { listDraftJobs, listJobStatuses } from "@/app/_lib/job-ingest";

export const runtime = "nodejs";

// Lifecycle status for authored JDs: a jobId → status map (for badges) plus the
// list of drafts awaiting publish. Seeded corpus jobs are absent = already live.
export async function GET() {
  return NextResponse.json({ statuses: listJobStatuses(), drafts: listDraftJobs() });
}
