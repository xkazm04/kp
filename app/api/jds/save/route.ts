import { NextRequest, NextResponse } from "next/server";
import { saveJd } from "@/app/_lib/db";
import { validateJdFields } from "@/app/_lib/jd-limits";
import { ingestStructuredJob } from "./ingest-job";

export const runtime = "nodejs";
export const maxDuration = 60;

// Save a generated JD to the library and ingest its role as a structured Job —
// as a DRAFT. It does NOT source candidates yet; "Source into Pipeline" (POST
// /api/jobs/[id]/publish) is what takes it live and sources it into the
// pipeline. See docs/JD_LIFECYCLE.md.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      title?: string;
      body?: string;
      role?: Record<string, unknown>;
      salary?: { suggestedMinimum?: number; suggestedMaximum?: number };
      company?: string;
    };
    // Shared validator (also enforced on POST /api/jds and the client form) so the
    // builder's save path — AI builder, template builder, simulation — can't bypass
    // the write boundary and store an unbounded or empty title/body.
    const fields = validateJdFields(body.title, body.body);
    if (!fields.ok) {
      return NextResponse.json({ error: fields.error }, { status: 400 });
    }

    const { slug } = saveJd({ title: fields.title, body: fields.body });
    const role = body.role ?? {};

    // Ingest the role into the corpus as a DRAFT structured Job (best-effort).
    let jobIngested = false;
    try {
      jobIngested = await ingestStructuredJob({ slug, title: fields.title, markdown: fields.body, role, salary: body.salary, company: body.company });
    } catch {
      /* job ingestion is best-effort — never block the JD save */
    }

    return NextResponse.json({ slug, jobId: `jd-${slug}`, status: "draft", jobIngested });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Save failed." }, { status: 500 });
  }
}
