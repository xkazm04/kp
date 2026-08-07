import { NextRequest, NextResponse } from "next/server";
import { listDevCases, saveDevCase } from "@/app/_lib/db/devcase";
import { enforceProbeGate } from "@/app/_lib/devcase-probe-audit";
import { recordAudit } from "@/app/_lib/dev-control";


// GET: approved case scenarios. POST: the human gate — approve a designed role+case.
export async function GET() {
  try {
    return NextResponse.json({ cases: listDevCases() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to list cases." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      need?: unknown;
      analysis?: unknown;
      role?: Record<string, unknown>;
      case?: Record<string, unknown>;
      overrideProbeAudit?: unknown;
    };
    if (!body.role || !body.case) {
      return NextResponse.json({ error: "role and case are required to approve." }, { status: 400 });
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
    const saved = saveDevCase({
      need: body.need ?? null,
      analysis: body.analysis ?? null,
      role: body.role,
      case: body.case,
    });
    // Audit the human approval exactly as the lifecycle route does (any probe-audit
    // override is recorded). Separation of duties (author != approver) is a larger
    // product change and is intentionally NOT enforced here — see the follow-up note.
    recordAudit({ lifecycleId: null, actor: "human", action: "approved", ref: saved.id, reason: gate.auditReason ?? undefined });
    return NextResponse.json({ ok: true, ...saved });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Approve failed." }, { status: 500 });
  }
}
