import { NextRequest, NextResponse } from "next/server";
import { listPipeline } from "@/app/_lib/db";
import { createTemplate, listRuns, listTemplates, runForEntry, startRun } from "@/app/_lib/onboarding-store";
import { coerceTasks } from "@/app/_lib/onboarding";
import { safeJsonError } from "@/app/_lib/api-response";


// Onboarding hand-off (#6). GET returns the Hired candidates (the hand-off source)
// annotated with whether a run exists, plus all active runs and the templates.
export async function GET() {
  try {
    const runs = listRuns();
    const hired = listPipeline()
      .filter((e) => e.stage === "Hired")
      .map((e) => ({
        entryId: e.id,
        candidateLabel: e.candidateLabel,
        jobTitle: e.jobTitle,
        runId: runForEntry(e.id)?.id ?? null,
      }));
    return NextResponse.json({ hired, runs, templates: listTemplates() });
  } catch (error) {
    return safeJsonError(error, "api:onboarding", "ONBOARDING_FAILED");
  }
}

// POST starts a run for a Hired candidate, or creates a checklist template.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      entryId?: string;
      templateId?: string;
      name?: string;
      tasks?: unknown;
      questionnaire?: unknown;
    };

    if (body.action === "create_template") {
      if (typeof body.name !== "string" || !body.name.trim()) {
        return NextResponse.json({ error: "Template name is required." }, { status: 400 });
      }
      const tasks = coerceTasks(body.tasks);
      if (tasks.length === 0) {
        return NextResponse.json({ error: "A template needs at least one task." }, { status: 400 });
      }
      // Per-template questionnaire (P1-4) — coerced in the store; an absent field
      // list defaults there, an explicit (incl. empty) one is honoured.
      return NextResponse.json({ template: createTemplate(body.name, tasks, body.questionnaire) });
    }

    // Default action: start a run. Pull label/title from the Hired entry so the run
    // card is legible without re-deriving them client-side.
    if (typeof body.entryId !== "string" || !body.entryId) {
      return NextResponse.json({ error: "entryId is required." }, { status: 400 });
    }
    const entry = listPipeline().find((e) => e.id === body.entryId);
    if (!entry) return NextResponse.json({ error: "Candidate not found or not active." }, { status: 404 });
    if (entry.stage !== "Hired") {
      return NextResponse.json({ error: "Only Hired candidates can be onboarded." }, { status: 409 });
    }
    const run = startRun({
      entryId: entry.id,
      templateId: body.templateId ?? null,
      candidateLabel: entry.candidateLabel,
      jobTitle: entry.jobTitle,
    });
    return NextResponse.json({ run });
  } catch (error) {
    return safeJsonError(error, "api:onboarding", "ONBOARDING_FAILED");
  }
}
