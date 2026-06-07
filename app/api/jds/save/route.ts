import { NextRequest, NextResponse } from "next/server";
import { loadJd, saveJd } from "@/app/_lib/db";
import { validateJdFields } from "@/app/_lib/jd-limits";
import { safeJsonError } from "@/app/_lib/api-response";
import { ingestStructuredJob } from "./ingest-job";

export const runtime = "nodejs";
export const maxDuration = 60;

// Save a generated JD to the library and ingest its role as a structured Job —
// as a DRAFT. It does NOT source candidates yet; "Source into Pipeline" (POST
// /api/jobs/[id]/publish) is what takes it live and sources it into the
// pipeline. See docs/JD_LIFECYCLE.md.
//
// The save-vs-ingest contract: saving the JD draft is authoritative (it succeeds
// or the whole request 4xx/5xx-es), but the structured-Job ingest below is
// best-effort. `jobIngested` reports whether that second step ran: when it is
// false the draft exists but the matchable `jd-<slug>` Job row does NOT, so
// "Source into Pipeline" would dead-end (POST /api/jobs/jd-<slug>/publish 404s).
// The builder reads this flag and offers a retry (re-POST with `slug`) rather
// than letting the user click into that dead end. See docs/JD_LIFECYCLE.md.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      title?: string;
      body?: string;
      role?: Record<string, unknown>;
      salary?: { suggestedMinimum?: number; suggestedMaximum?: number };
      company?: string;
      // Present on a RETRY of the best-effort ingest: the draft already exists,
      // so we re-ingest under this slug instead of forking a duplicate draft.
      slug?: string;
    };
    // Shared validator (also enforced on POST /api/jds and the client form) so the
    // builder's save path — AI builder, template builder, simulation — can't bypass
    // the write boundary and store an unbounded or empty title/body.
    const fields = validateJdFields(body.title, body.body);
    if (!fields.ok) {
      return NextResponse.json({ error: fields.error }, { status: 400 });
    }

    // First save creates the draft row; a retry re-uses the existing slug so the
    // best-effort ingest can be re-attempted without saving a duplicate JD. Reject
    // an unknown retry slug so a retry can't mint a `jd-<slug>` Job with no backing
    // draft.
    let slug: string;
    if (body.slug) {
      if (!loadJd(body.slug)) {
        return NextResponse.json({ error: "JD not found." }, { status: 404 });
      }
      slug = body.slug;
    } else {
      slug = saveJd({ title: fields.title, body: fields.body }).slug;
    }
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
    return safeJsonError(error, "api:jds/save", "JD_SAVE_FAILED");
  }
}
