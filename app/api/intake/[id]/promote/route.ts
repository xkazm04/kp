import { NextResponse } from "next/server";
import { getIntake, markIntakePromoted } from "@/app/_lib/db/intakes";
import { insertAnalyzingJd, setJdAnalysisTask } from "@/app/_lib/db/jobs";
import { briefReadyToPromote, needTextFromBrief } from "@/app/_lib/intake-brief";
import { jdJobId } from "@/app/_lib/jd-limits";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { startTask } from "@/app/_lib/tasks";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";
import { safeJsonError } from "@/app/_lib/api-response";

// POST /api/intake/[id]/promote — turn a captured RoleBrief into a JD + a
// matchable Job through the EXISTING backgrounded build (the same
// insertAnalyzingJd → jd_build task → ingest path as /api/jds/generate), with
// the brief threading the DevNeed's structured fields. The intake row is
// stamped with the produced jd_slug/job_id so the job can be walked back to
// the conversation that defined it.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await params;
    const ws = await currentWorkspace();
    const intake = getIntake(id, ws);
    if (!intake) return NextResponse.json({ error: "Intake not found." }, { status: 404 });
    if (intake.status === "promoted") {
      return NextResponse.json({ error: "This intake was already promoted.", jdSlug: intake.jdSlug }, { status: 409 });
    }
    if (!briefReadyToPromote(intake.brief)) {
      return NextResponse.json(
        { error: "The brief needs at least a role title plus one dealbreaker or 90-day outcome before it can become a JD." },
        { status: 400 }
      );
    }
    // THROTTLE: promotion is the most expensive single operation this feature
    // has — it starts a full backgrounded jd_build (description + market
    // research + optionally a designed work-sample case), all paid. The route
    // is operator-gated, but in open mode (no KP_OPERATOR_PASSWORD) that gate
    // is a no-op for the whole API, and nothing else in the chain is limited:
    // POST /api/intake → PATCH /brief (a client-supplied brief passes the
    // ready-to-promote gate) → POST /promote loops unbounded paid builds.
    // 20/10min per IP is far above any human pace (each promote produces a JD
    // the requestor then reads). Sits AFTER the 404/409/400 refusals so a
    // rejected promote never consumes budget, and BEFORE the insert + build.
    // Belongs in app/api/rate-limit-contract.test.ts beside the other intake
    // throttles (expensive marker: `insertAnalyzingJd(`) so the budget and the
    // ordering stay contract-locked.
    if (!rateLimit(`intake-promote:${clientIpFrom(request.headers)}`, { limit: 20, windowMs: 10 * 60_000 })) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      company?: unknown;
      caseDesign?: unknown;
      marketResearch?: unknown;
    };
    const brief = intake.brief;
    const title = (brief.title ?? "").trim();
    const needText = needTextFromBrief(brief);
    const lang = intake.lang === "cs" ? "cs" : "en";
    const options = {
      description: true,
      // Opt-out (UAT L1-HRBP-6): the market layer is Czech-single-market, so a
      // non-Czech role must be able to promote WITHOUT auto-attaching a
      // wrong-market comp band. Default stays on.
      marketResearch: body.marketResearch !== false,
      caseDesign: body.caseDesign === true,
    };

    // Same three-step contract as /api/jds/generate: placeholder row in the
    // Ledger, detached build (survives navigation), row↔task link for progress.
    const buildInput = { needText, seniority: brief.seniority, roleFamily: brief.roleFamily, lang, options };
    const { slug } = insertAnalyzingJd({ title, options, buildInput }, ws);
    const task = startTask("jd_build", {
      title,
      company: typeof body.company === "string" ? body.company : undefined,
      seniority: brief.seniority,
      roleFamily: brief.roleFamily,
      needText,
      brief,
      lang,
      jdSlug: slug,
      options,
      // Same tenant as the placeholder JD row inserted just above.
    }, ws);
    setJdAnalysisTask(slug, task.id);
    // jdJobId(slug) is the DETERMINISTIC id the best-effort ingest will use;
    // stamped now so the back-link exists even while the build is running.
    markIntakePromoted(id, { jdSlug: slug, jobId: jdJobId(slug) }, ws);
    return NextResponse.json({ slug, jobId: jdJobId(slug), taskId: task.id });
  } catch (error) {
    return safeJsonError(error, "api:intake/promote", "INTAKE_PROMOTE_FAILED");
  }
}
