import { NextRequest, NextResponse } from "next/server";
import { meterGate, recordMeterUsage } from "@/app/_lib/billing";
import { createLifecycle, listLifecycles } from "@/app/_lib/db";
import { startTask } from "@/app/_lib/tasks";
import { getServerLocale } from "@/i18n/server";
import { isLocale } from "@/i18n/locales";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";


// Direction A: start an automated lifecycle from a need, or list active ones.
// TENANT SCOPE (D5): both the list and the create carry the caller's workspace, so a
// team sees (and accretes into) its own lifecycles instead of the default tenant's.
export async function GET() {
  try {
    return NextResponse.json({ lifecycles: listLifecycles(50, await currentWorkspace()) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to list." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      need?: { title?: string } & Record<string, unknown>;
      auto?: boolean;
      lang?: string;
    };
    if (!body.need) return NextResponse.json({ error: "need is required." }, { status: 400 });
    // Billing hard gate + debit: one lifecycle = one dev-case design pipeline
    // (analyze → role → case). Debited at start; redesigns debit separately.
    const quota = meterGate("case_designs");
    if (quota) return NextResponse.json(quota, { status: 402 });
    recordMeterUsage("case_designs");
    // DEVP5 — the candidate-facing artifact language. Prefer an explicit body
    // choice (validated), else the recruiter's active locale; persisted on the
    // lifecycle and threaded to the dev-case CLIs by the orchestrator.
    const lang = isLocale(body.lang) ? body.lang : await getServerLocale();
    const lc = createLifecycle(body.need, body.auto !== false, lang, await currentWorkspace()); // default fully-auto
    const task = startTask("lifecycle", { lifecycleId: lc.id, title: lc.title });
    return NextResponse.json({ lifecycle: lc, task });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to start lifecycle." }, { status: 500 });
  }
}
