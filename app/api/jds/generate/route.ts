import { NextResponse } from "next/server";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { startJdBuild } from "@/app/_lib/jd-build-start";
import { getTemplate } from "@/app/_lib/templates-store";
import { validateJdBuildInput } from "@/app/_lib/jd-limits";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";

// THROTTLE: one accepted Generate buys a 1-2 minute PAID build (need analysis +
// role design + a grounded market-salary lookup, each a spawned child and, with a
// provider configured, a billed model call). The route is operator-gated, but open
// mode (no KP_OPERATOR_PASSWORD) makes that gate a documented no-op for the whole
// API, so the limiter is the real bound. 20/10min per IP: every Generate produces a
// JD the requestor then reads, so twenty in ten minutes is far above any honest pace
// while a scripted loop is pinned. METERING the build (a per-workspace paid quota) is
// a BILLING decision and deliberately not what this is.
const GENERATE_RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };

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

  // Resolve the chosen company template server-side so the build renders through it.
  // Loaded here, not in the task, so the handler stays storage-agnostic. Scope the
  // lookup to the caller's workspace (tenancy): getTemplate has a defaulted
  // workspaceId, so an unscoped call read the DEFAULT team's templates — silently
  // discarding a non-default team's private choice AND letting any team read a
  // default-team private template by id. A non-empty id that no longer resolves is
  // an explicit-choice-gone-missing, so 400 rather than silently using AI-default.
  const ws = await currentWorkspace();
  const templateId = typeof record.templateId === "string" ? record.templateId : "";
  let templateBody: string | undefined = undefined;
  if (templateId) {
    const template = getTemplate(templateId, ws);
    if (!template) return NextResponse.json({ error: "That template is no longer available." }, { status: 400 });
    templateBody = template.body;
  }

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

  // The budget is spent HERE: after every cheap refusal above (bad JSON, an empty
  // checklist, a too-thin need, a vanished template), so a request that was never
  // going to build costs nothing, and before the placeholder insert + the spawn.
  if (!rateLimit(`jd-generate:${clientIpFrom(request.headers)}`, GENERATE_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }

  try {
    // Placeholder row → detached build → row↔task link, through the one seam every
    // door shares (app/_lib/jd-build-start.ts), so the tenant stamp and the dedupe
    // identity cannot drift between the four callers that start a jd_build.
    const { slug, taskId } = startJdBuild({
      title: cleanTitle,
      options,
      buildInput,
      workspaceId: ws,
      params: {
        company: typeof record.company === "string" ? record.company : undefined,
        seniority: typeof record.seniority === "string" ? record.seniority : undefined,
        roleFamily: typeof record.roleFamily === "string" ? record.roleFamily : undefined,
        needText,
        repoUrl: typeof record.repoUrl === "string" ? record.repoUrl : undefined,
        lang: typeof record.lang === "string" ? record.lang : undefined,
        templateBody,
      },
    });
    return NextResponse.json({ slug, taskId });
  } catch (error) {
    return safeJsonError(error, "api:jds/generate", "JD_GENERATE_FAILED");
  }
}
