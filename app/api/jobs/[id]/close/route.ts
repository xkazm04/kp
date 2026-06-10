import { NextResponse } from "next/server";
import { getJob } from "@/app/_lib/db";
import { getJobStatus, setJobStatus } from "@/app/_lib/job-ingest";

export const runtime = "nodejs";

// W8-1 (JOB1) — retire a role. The lifecycle was a one-way ratchet (NULL/draft
// → published, full stop): a filled role kept its apply link live, kept
// appearing open in the catalog, and kept being ranked against the pool.
// Idempotent mirror of /publish; the apply page + API gate on the status.
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const job = getJob(id);
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    const already = getJobStatus(id) === "closed";
    if (!already) setJobStatus(id, "closed");
    return NextResponse.json({ ok: true, status: "closed", alreadyClosed: already });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Close failed." }, { status: 500 });
  }
}
