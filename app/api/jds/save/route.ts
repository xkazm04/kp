import { NextRequest, NextResponse } from "next/server";
import { saveJd } from "@/app/_lib/db";
import { JD_BODY_MAX_LENGTH, JD_TITLE_MAX_LENGTH } from "@/app/_lib/jd-limits";
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
    const title = (body.title ?? "").trim();
    const markdown = body.body ?? "";
    if (!title || !markdown.trim()) {
      return NextResponse.json({ error: "A title and body are required." }, { status: 400 });
    }
    // Mirror the caps enforced on POST /api/jds so the builder's save path
    // (AI builder, template builder, simulation) can't bypass the write
    // boundary and store an unbounded title or body straight past the limit.
    if (title.length > JD_TITLE_MAX_LENGTH) {
      return NextResponse.json(
        { error: `Title must be ${JD_TITLE_MAX_LENGTH} characters or fewer.` },
        { status: 400 }
      );
    }
    if (markdown.length > JD_BODY_MAX_LENGTH) {
      return NextResponse.json(
        { error: `Body must be ${JD_BODY_MAX_LENGTH.toLocaleString("en-US")} characters or fewer.` },
        { status: 400 }
      );
    }

    const { slug } = saveJd({ title, body: markdown });
    const role = body.role ?? {};

    // Ingest the role into the corpus as a DRAFT structured Job (best-effort).
    let jobIngested = false;
    try {
      jobIngested = await ingestStructuredJob({ slug, title, markdown, role, salary: body.salary, company: body.company });
    } catch {
      /* job ingestion is best-effort — never block the JD save */
    }

    return NextResponse.json({ slug, jobId: `jd-${slug}`, status: "draft", jobIngested });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Save failed." }, { status: 500 });
  }
}
