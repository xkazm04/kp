import { NextResponse } from "next/server";
import { insertAnalyzingJd, setJdAnalysisTask } from "@/app/_lib/db";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { startTask } from "@/app/_lib/tasks";
import { getTemplate } from "@/app/_lib/templates-store";
import { validateJdBuildInput } from "@/app/_lib/jd-limits";
import { safeJsonError } from "@/app/_lib/api-response";

// POST /api/jds/generate — start a BACKGROUNDED AI build. Unlike /api/jds/save
// (which persists a finished JD synchronously), this creates the JD row up front
// in an 'analyzing' state and hands the work to the detached jd_build task, so it
// shows in the Ledger immediately and completes even if the user navigates away.
// The handler (runJdBuild) owns writing the body/artifacts back onto the row.

// Which AI steps to run — the recruiter's pre-generation checklist. Independent
// toggles; ≥1 required. Mirrors JdBuildOptions in jd-build-run.ts.
function readOptions(raw: unknown): { description: boolean; marketResearch: boolean; caseDesign: boolean } {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    description: o.description === true,
    marketResearch: o.marketResearch === true,
    caseDesign: o.caseDesign === true,
  };
}

export async function POST(request: Request) {
  // A Generate spawns a 1–2 minute PAID AI build the moment it's accepted, so the
  // gate must run before any body read or DB write — a demo/non-operator session
  // the proxy waved through can't burn tokens here. Open mode (no
  // KP_OPERATOR_PASSWORD) is a no-op, so dev/sim are unaffected.
  const denied = await requireOperator();
  if (denied) return denied;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be a JSON object." }, { status: 400 });
  }
  const record = body as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title : "";
  const needText = typeof record.needText === "string" ? record.needText : "";
  const options = readOptions(record.options);

  if (!options.description && !options.marketResearch && !options.caseDesign) {
    return NextResponse.json({ error: "Select at least one thing to generate." }, { status: 400 });
  }
  // A role (for the description and/or the interview case) needs a real need —
  // enforce the same min-need contract the build handler does. Market research
  // alone only needs a title.
  const needRole = options.description || options.caseDesign;
  let cleanTitle = title.trim();
  if (needRole) {
    const valid = validateJdBuildInput(title, needText);
    if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: 400 });
    cleanTitle = valid.title;
  } else if (cleanTitle.length < 2) {
    return NextResponse.json({ error: "A role title is required." }, { status: 400 });
  }

  // Resolve the chosen company template server-side so the build renders through it
  // (an unknown/empty id ⇒ the AI-default format). Loaded here, not in the task, so
  // the handler stays storage-agnostic.
  const templateId = typeof record.templateId === "string" ? record.templateId : "";
  const templateBody = templateId ? getTemplate(templateId)?.body : undefined;

  // The recruiter's original intent, persisted on the JD row so Duplicate re-seeds
  // the PROMPT (not the rendered markdown) and Retry can replay even after the task
  // row is pruned. templateId (stable) is stored, not the resolved templateBody.
  const buildInput = {
    needText,
    company: typeof record.company === "string" ? record.company : undefined,
    seniority: typeof record.seniority === "string" ? record.seniority : undefined,
    roleFamily: typeof record.roleFamily === "string" ? record.roleFamily : undefined,
    repoUrl: typeof record.repoUrl === "string" ? record.repoUrl : undefined,
    lang: typeof record.lang === "string" ? record.lang : undefined,
    templateId,
    options,
  };

  try {
    // 1. Placeholder JD (appears in the Ledger as "Analyzing" right away).
    const { slug } = insertAnalyzingJd({ title: cleanTitle, options, buildInput }, await currentWorkspace());
    // 2. Detached build that fills it in (survives navigation). jdSlug makes the
    //    task's dedupe identity the JD itself, so each Generate is its own run.
    const task = startTask("jd_build", {
      title: cleanTitle,
      company: typeof record.company === "string" ? record.company : undefined,
      seniority: typeof record.seniority === "string" ? record.seniority : undefined,
      roleFamily: typeof record.roleFamily === "string" ? record.roleFamily : undefined,
      needText,
      repoUrl: typeof record.repoUrl === "string" ? record.repoUrl : undefined,
      lang: typeof record.lang === "string" ? record.lang : undefined,
      templateBody,
      jdSlug: slug,
      options,
    });
    // 3. Link the row to its task so the Ledger can show live progress / retry.
    setJdAnalysisTask(slug, task.id);
    return NextResponse.json({ slug, taskId: task.id });
  } catch (error) {
    return safeJsonError(error, "api:jds/generate", "JD_GENERATE_FAILED");
  }
}
