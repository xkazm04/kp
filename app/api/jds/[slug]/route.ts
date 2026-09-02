import { NextResponse } from "next/server";
import { getJob, loadJd, setJdArchived, updateJd } from "@/app/_lib/db/jobs";
import { promotedBriefForJob } from "@/app/_lib/db/intakes";
import { ingestJobAd, insertJob } from "@/app/_lib/job-ingest";
import { jdJobId, validateJdFields } from "@/app/_lib/jd-limits";
import { groundedJdBand, withGroundedBand } from "@/app/_lib/salary-band";
import { safeJsonError } from "@/app/_lib/api-response";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";

// The best-effort re-ingest on a body edit is one LLM parse.
export const maxDuration = 60;

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  try {
    // Tenancy: serve the JD from the CALLER'S library. `/api/jds/*` is a gated
    // recruiter route (never public — the share link is the /jds/[slug] page, see
    // public-routes.ts), so the session workspace is the authority, and loadJd's
    // defaulted argument was wrong in both directions. It 404'd a non-default team's
    // OWN JD everywhere this endpoint feeds — the Ledger detail modal, Duplicate, the
    // Analyze saved-JD picker, the Dev tab's brief — because the row sat in their
    // workspace while the read looked in the default one; and it handed the DEFAULT
    // team's full body + build artifacts (a private, often unfinished draft) to any
    // other team's signed-in recruiter who knew the slug.
    const ws = await currentWorkspace();
    const row = loadJd(slug, ws);
    if (!row) {
      return NextResponse.json({ error: "JD not found." }, { status: 404 });
    }
    // The JD detail is public/shareable, but the stored build intent
    // (build_input_json — the recruiter's raw "describe the need" text) is
    // internal authoring material and must not ride the plain detail payload. It is
    // returned only when explicitly requested (?intent=1) — the recruiter Ledger's
    // Duplicate flow. Workspace ownership IS the scoped load above: a caller who
    // doesn't own the row never reaches this line.
    const { build_input_json, ...publicRow } = row;
    const params = new URL(request.url).searchParams;
    if (params.has("intent")) {
      return NextResponse.json({ ...publicRow, build_input_json });
    }
    // ?brief=1 — the promoted role-intake brief behind this JD (Dev tab's
    // structured-need read, UAT L1-EVA-3). Internal authoring material like
    // build_input_json, and read from the same workspace that owns the JD. Null
    // when no promoted intake backs the JD.
    if (params.has("brief")) {
      return NextResponse.json({ ...publicRow, intakeBrief: promotedBriefForJob(jdJobId(slug), ws) });
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
  // The JD detail PAGE (/jds/[slug]) is public/shareable, so edit + archive must be
  // recruiter-only at the handler — not just hidden in the UI. This API route is
  // not: `/api/jds/*` sits behind the session gate (public-routes.ts), and GET above
  // serves the caller's own library — an earlier revision of this comment called
  // that GET "public", which it never was.
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
    // ingestJobAd PARSES only — the persist is insertJob's job. Without the
    // write the re-parse was discarded and `jobResynced: true` was a claim the
    // server never made good on: the matchable job kept its pre-edit
    // requirements/education floor, so every subsequent match score (and the
    // winnability coach's "+N eligible") answered the OLD text.
    let jobResynced = false;
    const jobId = jdJobId(slug);
    if (getJob(jobId)) {
      try {
        const { job } = await ingestJobAd(fields.body, jobId);
        // The re-parse reads the pay figure out of the edited WORDING, and
        // insertJob's upsert writes salary_min/salary_max from whatever it got — so
        // this write used to replace the analysis-grounded band the first ingest
        // pinned with either the recruiter's hand-typed number (the exact override
        // the builder refuses to honor) or, when the edited text states no pay, the
        // taxonomy anchor `normalize_job` stamps as the "salary_band" phantom. The
        // doc's contract is that editing the salary line changes the published
        // wording, never the matchable band; carry the stored analysis band across
        // the re-sync the same way the first ingest set it. A JD with no analysis
        // (pasted, keyless 0–0 miss) has no grounded band, and the parse stands.
        // No content hash: the row already exists under this explicit id, so the
        // upsert path applies and the lifecycle status is preserved.
        insertJob(withGroundedBand({ ...job, id: jobId }, groundedJdBand(existing.analysis_json)), undefined, "draft", ws);
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
