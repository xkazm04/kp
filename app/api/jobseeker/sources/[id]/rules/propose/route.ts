import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { getJobseekerSource } from "@/app/_lib/db/jobseeker-sources";
import { listingPages } from "@/app/_lib/jobseeker/adapters/boardRules";
import { politeFetch } from "@/app/_lib/jobseeker/fetch/politeFetch";
import { isCollapsed, reduceHtmlForAuthoring } from "@/app/_lib/jobseeker/rules/collapse";
import { isRulesError, validateRules } from "@/app/_lib/jobseeker/rules/dsl";
import { dryRun } from "@/app/_lib/jobseeker/rules/engine";
import { buildLlmConfigEnv } from "@/app/_lib/llm-config";
import { isOffline } from "@/app/_lib/offline";
import { parsePythonJson, parseStderrError, spawnPython } from "@/app/_lib/python-runner";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// POST /api/jobseeker/sources/[id]/rules/propose — { url?, lang? } → fetch the listing
// page (politeFetch), reduce it to what a rule author needs, ask the extraction_rules
// use case for a rule set (pipeline.jobfit.extraction_rules_cli; keyless twin = a
// heuristic set marked source:"deterministic"), validate it, dry-run it against the
// SAME page, and hand all of that back. NOTHING is persisted — saving is PATCH's act.

type ProposeBody = { url?: unknown; lang?: unknown };
type CliOutput = { rules?: unknown; source?: unknown; fallbackReason?: unknown; promptVersion?: unknown; reasoning?: unknown };
const PROPOSE_TIMEOUT_MS = 120_000;
const PREVIEW_ITEMS = 5;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  // THROTTLE before the fetch AND the LLM spend. 10/10min per IP.
  if (!rateLimit(`jobseeker-rules-propose:${clientIpFrom(request.headers)}`, { limit: 10, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as ProposeBody;
    const ws = await currentWorkspace();
    const source = getJobseekerSource(id, ws);
    if (!source) return jsonRefusal("JOBSEEKER_SOURCE_NOT_FOUND", 404);
    if (source.tier === "C") return jsonRefusal("JOBSEEKER_SOURCE_REFUSED", 403);
    const url = typeof body.url === "string" && /^https?:\/\//.test(body.url) ? body.url : listingPages(source)[0];
    if (!url) return jsonRefusal("JOBSEEKER_RULES_INVALID", 400, { detail: "url: no listing page to author from" });
    const lang = typeof body.lang === "string" && /^(en|cs|de|fr)$/.test(body.lang) ? body.lang : "en";
    if (isOffline()) return jsonRefusal("JOBSEEKER_OFFLINE", 503);

    const fetched = await politeFetch(url, { sourceId: source.id, host: source.host, accept: "text/html, application/xhtml+xml;q=0.9" });
    if (fetched.kind === "offline") return jsonRefusal("JOBSEEKER_OFFLINE", 503);
    if (fetched.kind === "blocked") return jsonRefusal("JOBSEEKER_SOURCE_BLOCKED", 423, { detail: fetched.detail });
    if (fetched.kind !== "ok") return jsonRefusal("JOBSEEKER_PREVIEW_FAILED", 502, { detail: fetched.detail });
    const pageUrl = fetched.finalUrl || url;
    const reduced = reduceHtmlForAuthoring(fetched.body);

    const workdir = await mkdtemp(path.join(os.tmpdir(), "kp-rules-"));
    let out: CliOutput;
    try {
      const inputPath = path.join(workdir, "input.json");
      await writeFile(inputPath, JSON.stringify({ html: reduced, url: pageUrl, lang }), "utf-8");
      const { result } = spawnPython(["-m", "pipeline.jobfit.extraction_rules_cli", "--input-json", inputPath], {
        signal: request.signal,
        timeoutMs: PROPOSE_TIMEOUT_MS,
        env: buildLlmConfigEnv(),
      });
      const { stdout, stderr, exitCode } = await result;
      if (exitCode !== 0) {
        const err = parseStderrError(stderr, exitCode);
        console.error("[api:jobseeker/sources/[id]/rules/propose] extraction_rules_cli", err.code, err.message);
        return jsonRefusal("JOBSEEKER_PREVIEW_FAILED", err.status >= 500 ? 502 : err.status, { detail: err.code });
      }
      out = parsePythonJson<CliOutput>(stdout, stderr);
    } finally {
      await rm(workdir, { recursive: true, force: true }).catch(() => undefined);
    }

    const validated = validateRules(out.rules);
    if (isRulesError(validated)) {
      // The model (or the twin) produced nothing the engine can run: say so with the
      // reason, and hand back the reduced page so the owner can author by hand.
      return NextResponse.json({
        rules: [],
        source: out.source === "llm" ? "llm" : "deterministic",
        fallbackReason: typeof out.fallbackReason === "string" ? out.fallbackReason : null,
        invalid: validated.error,
        perRule: [],
        items: [],
        url: pageUrl,
        reducedHtml: reduced,
      });
    }
    const { items, perRule } = dryRun(validated, fetched.body, pageUrl);
    return NextResponse.json({
      rules: validated,
      source: out.source === "llm" ? "llm" : "deterministic",
      fallbackReason: typeof out.fallbackReason === "string" ? out.fallbackReason : null,
      promptVersion: typeof out.promptVersion === "string" ? out.promptVersion : null,
      reasoning: Array.isArray(out.reasoning) ? out.reasoning.filter((r): r is string => typeof r === "string") : [],
      outcome: isCollapsed(perRule, validated, null) ? "collapsed" : items.length > 0 ? "ok" : "empty",
      perRule,
      items: items.slice(0, PREVIEW_ITEMS),
      itemCount: items.length,
      baseline: Object.fromEntries(perRule.map((r) => [r.field, r.matched])),
      url: pageUrl,
    });
  } catch (error) {
    return safeJsonError(error, "api:jobseeker/sources/[id]/rules/propose", "JOBSEEKER_STORE_FAILED");
  }
}
