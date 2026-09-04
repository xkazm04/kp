import { NextResponse } from "next/server";
import { getIntake, markIntakePromoted } from "@/app/_lib/db/intakes";
import { startJdBuild } from "@/app/_lib/jd-build-start";
import { briefReadyToPromote, needTextFromBrief } from "@/app/_lib/intake-brief";
import { jdJobId } from "@/app/_lib/jd-limits";
import { intakeLang } from "@/app/_lib/intake-lang";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";

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
    // Codes (docs/architecture/api-contracts.md §1.1). The not-ready refusal is
    // the one that matters most here: it NAMES what the brief still needs, and
    // the panel used to replace it with "promote failed" — the reader lost the
    // only sentence that told them what to do next.
    if (!intake) return jsonRefusal("INTAKE_NOT_FOUND", 404);
    // The produced JD rides alongside as DATA, so the panel can link to it.
    if (intake.status === "promoted") return jsonRefusal("INTAKE_FROZEN", 409, { jdSlug: intake.jdSlug });
    if (!briefReadyToPromote(intake.brief)) return jsonRefusal("INTAKE_BRIEF_NOT_READY", 400);
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
    // Pinned in app/api/rate-limit-contract.test.ts beside the other intake
    // throttles, so the budget and the ordering stay contract-locked. That spec's
    // `expensive` marker is the INSERT CALL below including its opening brace, not
    // the bare function name - the name also appears in prose above the limiter.
    if (!rateLimit(`intake-promote:${clientIpFrom(request.headers)}`, { limit: 20, windowMs: 10 * 60_000 })) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }

    const body = (await request.json().catch(() => ({}))) as {
      company?: unknown;
      caseDesign?: unknown;
      marketResearch?: unknown;
    };
    const brief = intake.brief;
    const title = (brief.title ?? "").trim();
    const lang = intakeLang(intake.lang);
    // The composed need text carries the session's language, labels included - it
    // is persisted as this build's input and replayed on every task re-run.
    const needText = needTextFromBrief(brief, lang);
    const options = {
      description: true,
      // Opt-out (UAT L1-HRBP-6): the market layer is Czech-single-market, so a
      // non-Czech role must be able to promote WITHOUT auto-attaching a
      // wrong-market comp band. Default stays on.
      marketResearch: body.marketResearch !== false,
      caseDesign: body.caseDesign === true,
    };

    // THE ONE DOOR into a backgrounded build (`app/_lib/jd-build-start.ts`):
    // placeholder row in the Ledger, detached task stamped with the SAME tenant,
    // row↔task link. This route was the fourth hand-rolled copy of that sequence
    // and the seam's source guard allow-listed it; the allow-list entry goes with
    // this change rather than outliving it. `title`, `jdSlug` and `options` are
    // the seam's to set — a task pointed at a different row than the one just
    // created is the drift it exists to prevent.
    const buildInput = { needText, seniority: brief.seniority, roleFamily: brief.roleFamily, lang, options };
    const { slug, taskId } = startJdBuild({
      title,
      options,
      buildInput,
      workspaceId: ws,
      params: {
        company: typeof body.company === "string" ? body.company : undefined,
        seniority: brief.seniority,
        roleFamily: brief.roleFamily,
        needText,
        brief,
        lang,
      },
    });
    // jdJobId(slug) is the DETERMINISTIC id the best-effort ingest will use;
    // stamped now so the back-link exists even while the build is running.
    markIntakePromoted(id, { jdSlug: slug, jobId: jdJobId(slug) }, ws);
    return NextResponse.json({ slug, jobId: jdJobId(slug), taskId });
  } catch (error) {
    return safeJsonError(error, "api:intake/promote", "INTAKE_PROMOTE_FAILED");
  }
}
