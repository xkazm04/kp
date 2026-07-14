import { NextResponse } from "next/server";
import { getJob, loadJd, setJdArchived, updateJd } from "@/app/_lib/db";
import { ingestJobAd } from "@/app/_lib/job-ingest";
import { jdJobId, validateJdFields } from "@/app/_lib/jd-limits";
import { safeJsonError } from "@/app/_lib/api-response";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";

// The best-effort re-ingest on a body edit is one LLM parse.
export const maxDuration = 60;

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  try {
    const row = loadJd(slug);
    if (!row) {
      return NextResponse.json({ error: "JD not found." }, { status: 404 });
    }
    // The JD detail is public/shareable, but the stored build intent
    // (build_input_json — the recruiter's raw "describe the need" text) is
    // internal authoring material and must not ride the public payload. It is
    // returned only when explicitly requested (?intent=1) by a caller whose
    // workspace owns the row — the recruiter Ledger's Duplicate flow — so a
    // cross-tenant or share-link fetch never sees it.
    const { build_input_json, ...publicRow } = row;
    const wantsIntent = new URL(request.url).searchParams.has("intent");
    if (wantsIntent && loadJd(slug, await currentWorkspace())) {
      return NextResponse.json({ ...publicRow, build_input_json });
    }
    return NextResponse.json(publicRow);
  } catch (error) {
    return safeJsonError(error, "api:jds/[slug]", "JD_LOAD_FAILED");
  }
}

// W8-4 (JDL1) — the library was fully append-only: no update, delete or
// archive path existed anywhere (the only DELETE FROM jds is the simulation
// cleaner). A typo'd JD was permanent; the only "fix" was a duplicate under a
// new slug, forking the analysis history keyed on jd_slug.
// PATCH supports two independent writes:
//   { title, body }      — edit in place (same validateJdFields as save);
//   { archived: bool }   — archive/unarchive (archived JDs leave listJds and
//                          the pickers; the public page renders with a banner).
export async function PATCH(request: Request, context: { params: Promise<{ slug: string }> }) {
  // The JD detail page is public/shareable, so edit + archive must be recruiter-only
  // at the handler — not just hidden in the UI. GET above stays public.
  const denied = await requireOperator();
  if (denied) return denied;
  const { slug } = await context.params;
  const ws = await currentWorkspace();
  try {
    const existing = loadJd(slug, ws);
    if (!existing) return NextResponse.json({ error: "JD not found." }, { status: 404 });

    const body = (await request.json().catch(() => ({}))) as {
      title?: unknown;
      body?: unknown;
      archived?: unknown;
      baseBody?: unknown;
    };

    if (typeof body.archived === "boolean") {
      setJdArchived(slug, body.archived, ws);
      return NextResponse.json({ ok: true, archived: body.archived });
    }

    const fields = validateJdFields(body.title, body.body);
    if (!fields.ok) {
      return NextResponse.json({ error: fields.error }, { status: 400 });
    }
    // Content-CAS: the editor sends the body it loaded; a stale base means another
    // writer changed the JD in the gap, so we 409 instead of clobbering their edit.
    const baseBody = typeof body.baseBody === "string" ? body.baseBody : undefined;
    const result = updateJd(slug, { title: fields.title, body: fields.body }, baseBody, ws);
    if (!result.ok) {
      if (result.reason === "conflict") {
        return NextResponse.json(
          { error: "This JD changed since you opened it — reload to see the latest, then re-apply your edit.", code: "conflict" },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: "JD not found." }, { status: 404 });
    }

    // Keep the linked jd-<slug> job in step with the edited wording —
    // best-effort: insertJob's explicit-jobId upsert updates fields while
    // deliberately preserving lifecycle status, so an edit can't demote a
    // live role; a re-ingest failure leaves the JD edit committed.
    let jobResynced = false;
    const jobId = jdJobId(slug);
    if (getJob(jobId)) {
      try {
        await ingestJobAd(fields.body, jobId);
        jobResynced = true;
      } catch (ingestError) {
        console.error(`[api:jds] JD ${slug} edited but job re-ingest failed`, ingestError);
      }
    }
    return NextResponse.json({ ok: true, jobResynced });
  } catch (error) {
    return safeJsonError(error, "api:jds/[slug]", "JD_SAVE_FAILED");
  }
}
