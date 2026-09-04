import { NextRequest, NextResponse } from "next/server";
import { listDevCases, saveDevCase } from "@/app/_lib/db/devcase";
import { enforceProbeGate } from "@/app/_lib/devcase-probe-audit";
import { recordAudit } from "@/app/_lib/dev-control";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";


// The manual approve writes a dev_cases row and an immutable audit row per call, and
// it carried no throttle at all - a scripted loop could fill the library (and the
// studio's Cases table) unbounded. It spawns nothing, so the budget is generous:
// 60/10min per IP is far above a reviewer signing off designs by hand.
const APPROVE_RATE_LIMIT = { limit: 60, windowMs: 10 * 60_000 };

// GET: approved case scenarios. POST: the human gate — approve a designed role+case.
export async function GET() {
  // AUTHORITY (/perfect wave 31). This door hands back FULL approved-case records -
  // role, case, need and analysis JSON - and asked nothing at all about the caller.
  // Reading the library is a `read` act, so identity presence is the whole gate here;
  // the POST below asks the seat question.
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    // Scoped: an unscoped list showed the DEFAULT team's approved cases — full
    // role/case/need JSON — in every other team's Cases table, beside their own
    // postings. The sibling routes (/postings, /lifecycle, /comms) already scope.
    return NextResponse.json({ cases: listDevCases(undefined, await currentWorkspace()) });
  } catch (error) {
    // better-sqlite3's SQLITE_* detail and the absolute db path rode this message to
    // the studio verbatim; they stay in the server log and the reader gets the code.
    return safeJsonError(error, "api:devcase", "DEVCASE_CASE_LIST_FAILED");
  }
}

export async function POST(request: NextRequest) {
  // AUTHORITY (/perfect wave 31). This is the MANUAL half of the Art. 22 human gate -
  // the sibling of POST /api/devcase/lifecycle/[id]/approve, writing to the same
  // dev_cases table and the same audit trail - and it carried no gate whatsoever: not
  // the capability, not even identity presence. A viewer seat could approve a case
  // into the library, then source a pipeline off it. Same two gates as the lifecycle
  // sibling, in the same order: identity presence first (a no-op in open mode), then
  // the seat question. Approving a case is a recruiter operation, so `pipeline:write`.
  const denied = await requireOperator();
  if (denied) return denied;
  const forbidden = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (forbidden) return forbidden;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      need?: unknown;
      analysis?: unknown;
      role?: Record<string, unknown>;
      case?: Record<string, unknown>;
      overrideProbeAudit?: unknown;
    };
    if (!body.role || !body.case) {
      // Coded, not English prose: the approve banner (useDevTabActions.runAction)
      // resolves errors.<CODE> in the reader's language.
      return jsonRefusal("DEVCASE_CASE_FIELDS_REQUIRED", 400);
    }
    // Quality GATE (bug-ui-scan-2026-07-09): the manual approve path is a parallel write
    // to the same dev_cases table as the lifecycle approve route, so it MUST enforce the
    // SAME probe-strength doctrine via the SAME shared guard — a case whose probes can't
    // tell a strong submission from a naive one is blocked unless a human explicitly
    // overrides. Previously this path had NO gate and NO audit row, trivially sidestepping
    // the hardening added to the lifecycle route.
    const probes = (body.case as { coverProbes?: unknown[] }).coverProbes ?? [];
    const gate = enforceProbeGate(probes as Parameters<typeof enforceProbeGate>[0], body.overrideProbeAudit === true);
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error, code: gate.code, verdict: gate.verdict }, { status: gate.status });
    }
    // After every cheap refusal (missing fields, the probe-strength gate) so a request
    // that was never going to write costs no budget, and before the two writes it guards.
    if (!rateLimit(`devcase-approve:${clientIpFrom(request.headers)}`, APPROVE_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    const saved = saveDevCase(
      {
        need: body.need ?? null,
        analysis: body.analysis ?? null,
        role: body.role,
        case: body.case,
      },
      await currentWorkspace()
    );
    // Audit the human approval exactly as the lifecycle route does (any probe-audit
    // override is recorded). Separation of duties (author != approver) is a larger
    // product change and is intentionally NOT enforced here — see the follow-up note.
    recordAudit({ lifecycleId: null, actor: "human", action: "approved", ref: saved.id, reason: gate.auditReason ?? undefined });
    return NextResponse.json({ ok: true, ...saved });
  } catch (error) {
    // saveDevCase is a store transaction: the thrown message carries SQLITE_* codes and
    // the db path. Same code as the lifecycle sibling - it is the same human decision.
    return safeJsonError(error, "api:devcase/approve", "DEVCASE_APPROVE_FAILED");
  }
}
