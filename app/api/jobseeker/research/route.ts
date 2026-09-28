import { NextResponse } from "next/server";
import { jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { currentSession, requireCapability } from "@/app/_lib/auth/current-user";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { currentUserId } from "@/app/_lib/auth/session";
import { getJobseekerProfile } from "@/app/_lib/db/jobseeker-profiles";
import { getRoleResearch, setRoleResearch } from "@/app/_lib/db/jobseeker-ui-state";
import { runPythonCli } from "@/app/_lib/jobseeker/python-cli";
import {
  isFreshResearch,
  researchMarkets,
  researchTitles,
  roleResearchKey,
  roleResearchOf,
  roleResearchRecordOf,
  type RoleResearchRecord,
} from "@/app/_lib/jobseeker/roleResearch";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { isLocale } from "@/i18n/locales";

// /api/jobseeker/research - what the seeker's target titles ask for NOW, researched on the
// web (app/_lib/jobseeker/roleResearch.ts; the engine is pipeline/jobfit/role_research_cli.py,
// pinned to Claude Sonnet 5.5 with WebSearch + WebFetch - llm-config.ts PINNED_USE_CASES).
//
//   GET   the research for the seeker's CURRENT titles and markets, as stored, or null:
//         { record, titles, markets, fresh }
//   POST  { force?: boolean } - research now, unless a fresh one exists and force is not
//         set: { record, titles, markets, fresh, cached, attempt: { source, fallbackReason } }
//
// Only the TITLES and the MARKETS leave the box - never the CV, never the name. A keyless
// install (no Claude CLI, KP_OFFLINE, production without the engine) answers 200 with
// `attempt.source: "deterministic"` and the reason; a miss never overwrites a real answer,
// and the reader then shows the seeker's own postings instead, saying so.
//
// One research is one web session of up to 16 turns on the pinned model (~30-120 s, a few
// dimes): 6 per hour per IP, and the client disables the button while one runs. The spawn
// is NOT tied to the request's signal - a seeker who navigates away still gets the answer
// stored for their return. maxDuration is the serverless ceiling only (self-hosted
// `next start` is bounded by the spawn timeout below).

export const maxDuration = 300;

const RESEARCH_TIMEOUT_MS = 290_000;

type Scope = { profileId: string; ws: string; titles: string[]; markets: string[]; seniority: string | null; key: string };

async function scope(): Promise<Scope | NextResponse> {
  const [session, ws] = await Promise.all([currentSession(), currentWorkspace()]);
  const profile = getJobseekerProfile(currentUserId(session), ws);
  if (!profile) return jsonRefusal("JOBSEEKER_PROFILE_MISSING", 409);
  const titles = researchTitles(profile.preferences.targetTitles ?? []);
  const markets = researchMarkets(profile.preferences.countries ?? []);
  return { profileId: profile.id, ws, titles, markets, seniority: profile.preferences.seniority ?? null, key: roleResearchKey(titles, markets) };
}

export async function GET(): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const s = await scope();
    if (s instanceof NextResponse) return s;
    if (s.titles.length === 0) return NextResponse.json({ record: null, titles: [], markets: s.markets, fresh: false });
    const record = roleResearchRecordOf(getRoleResearch(s.profileId, s.key, s.ws)?.value);
    return NextResponse.json({ record, titles: s.titles, markets: s.markets, fresh: isFreshResearch(record) });
  } catch (error) {
    return safeJsonError(error, "api:jobseeker/research", "JOBSEEKER_STORE_FAILED");
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  // A model spend behind a seat, like every other jobseeker write (route-capability-coverage).
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  if (!rateLimit(`jobseeker-research:${clientIpFrom(request.headers)}`, { limit: 6, windowMs: 60 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const body = (await request.json().catch(() => ({}))) as { force?: unknown } | null;
    const force = body?.force === true;
    const s = await scope();
    if (s instanceof NextResponse) return s;
    if (s.titles.length === 0) return jsonRefusal("JOBSEEKER_REQUEST_INVALID", 409);
    const existing = roleResearchRecordOf(getRoleResearch(s.profileId, s.key, s.ws)?.value);
    if (!force && isFreshResearch(existing)) {
      return NextResponse.json({ record: existing, titles: s.titles, markets: s.markets, fresh: true, cached: true, attempt: null });
    }
    const langParam = new URL(request.url).searchParams.get("lang");
    const out = await runPythonCli({
      module: "role_research_cli",
      files: { "input.json": { titles: s.titles, countries: s.markets, seniority: s.seniority, lang: isLocale(langParam) ? langParam : "en" } },
      args: (f) => ["--input-json", f["input.json"]!],
      llm: true,
      timeoutMs: RESEARCH_TIMEOUT_MS,
    });
    const research = roleResearchOf(out.result);
    const record: RoleResearchRecord = {
      key: s.key,
      titles: s.titles,
      markets: s.markets,
      research,
      source: out.source === "llm" && research ? "llm" : "deterministic",
      fallbackReason: research ? null : typeof out.fallbackReason === "string" ? out.fallbackReason : "llm_unusable",
      model: typeof out.model === "string" ? out.model : null,
      promptVersion: typeof out.promptVersion === "string" ? out.promptVersion : null,
      at: new Date().toISOString(),
    };
    // A miss is the install's state, not the market's word: it never replaces an answer.
    if (research) setRoleResearch(s.profileId, s.key, record, s.ws);
    const shown = research ? record : existing;
    return NextResponse.json({
      record: shown,
      titles: s.titles,
      markets: s.markets,
      fresh: isFreshResearch(shown),
      cached: false,
      attempt: { source: record.source, fallbackReason: record.fallbackReason },
    });
  } catch (error) {
    return safeJsonError(error, "api:jobseeker/research", "JOBSEEKER_STORE_FAILED");
  }
}
