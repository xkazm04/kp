import { NextRequest, NextResponse } from "next/server";
import { loadJd, saveJd } from "@/app/_lib/db/jobs";
import { jdJobId, validateJdFields } from "@/app/_lib/jd-limits";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { ingestStructuredJob } from "./ingest-job";

export const maxDuration = 60;

// THROTTLE: the ingest half spawns a `jobs_cli normalize` child per accepted save
// (deterministic, but still a process), and the save half writes an unbounded-count
// row pair. 30/10min per IP — the loosest of the four JD budgets on purpose: a save
// is the CHEAPEST of them (no model call) and the builder legitimately re-POSTs to
// retry the best-effort ingest, so the budget must clear a retry burst. Operator-
// gated, and open mode makes that gate a no-op for the whole API.
const SAVE_RATE_LIMIT = { limit: 30, windowMs: 10 * 60_000 };

// Save a generated JD to the library and ingest its role as a structured Job —
// as a DRAFT. It does NOT source candidates yet; "Source into Pipeline" (POST
// /api/jobs/[id]/publish) is what takes it live and sources it into the
// pipeline. See docs/features/jobs/README.md.
//
// The save-vs-ingest contract: saving the JD draft is authoritative (it succeeds
// or the whole request 4xx/5xx-es), but the structured-Job ingest below is
// best-effort. `jobIngested` reports whether that second step ran: when it is
// false the draft exists but the matchable `jd-<slug>` Job row does NOT, so
// "Source into Pipeline" would dead-end (POST /api/jobs/jd-<slug>/publish 404s).
// The builder reads this flag and offers a retry (re-POST with `slug`) rather
// than letting the user click into that dead end. See docs/features/jobs/README.md.
export async function POST(request: NextRequest) {
  // Saving a generated JD as a draft (and ingesting its Job) is a recruiter write,
  // so it shares the same operator gate as POST /api/jds. The guided sim drives this
  // route under the operator's own session (or open mode), so it's unaffected.
  const denied = await requireOperator();
  if (denied) return denied;
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

    // The budget is spent HERE: after the field validation above, so a rejected
    // title/body costs nothing, and before the first DB write and the spawn.
    if (!rateLimit(`jds-save:${clientIpFrom(request.headers)}`, SAVE_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }

    // First save creates the draft row; a retry re-uses the existing slug so the
    // best-effort ingest can be re-attempted without saving a duplicate JD. Reject
    // an unknown retry slug so a retry can't mint a `jd-<slug>` Job with no backing
    // draft.
    const ws = await currentWorkspace();
    let slug: string;
    if (body.slug) {
      if (!loadJd(body.slug, ws)) {
        return NextResponse.json({ error: "JD not found." }, { status: 404 });
      }
      slug = body.slug;
    } else {
      slug = saveJd({ title: fields.title, body: fields.body }, ws).slug;
    }
    const role = body.role ?? {};

    // Ingest the role into the corpus as a DRAFT structured Job (best-effort).
    let jobIngested = false;
    try {
      jobIngested = await ingestStructuredJob({ slug, title: fields.title, markdown: fields.body, role, salary: body.salary, company: body.company }, ws);
    } catch (ingestError) {
      // Best-effort: a failed ingest never blocks the JD save. But it is not
      // silent — the operator sees `jobIngested: false` and a retry affordance,
      // and whoever runs the server needs the cause, exactly like the sibling
      // re-ingest catch in PATCH /api/jds/[slug].
      console.error(`[api:jds/save] JD ${slug} saved but job ingest failed`, ingestError);
    }

    return NextResponse.json({ slug, jobId: jdJobId(slug), status: "draft", jobIngested });
  } catch (error) {
    return safeJsonError(error, "api:jds/save", "JD_SAVE_FAILED");
  }
}
