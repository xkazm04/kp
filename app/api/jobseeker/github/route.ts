import { NextResponse } from "next/server";
import { jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { currentSession, requireCapability } from "@/app/_lib/auth/current-user";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { currentUserId } from "@/app/_lib/auth/session";
import { deleteGithubState, getGithubState, setGithubState } from "@/app/_lib/db/jobseeker-ui-state";
import { getJobseekerProfile, touchJobseekerProfile } from "@/app/_lib/db/jobseeker-profiles";
import { parseGithubUsername } from "@/app/_lib/github-handle";
import { portfolioCandidates, readSeekerGithub } from "@/app/_lib/jobseeker/github";
import { GITHUB_PROJECTS_MAX, githubStateOf, type GithubState } from "@/app/_lib/jobseeker/githubEvidence";
import { runPythonCli } from "@/app/_lib/jobseeker/python-cli";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// /api/jobseeker/github - the seeker's OWN GitHub account as a second source of skill
// evidence and of CV Projects (app/_lib/jobseeker/github.ts reads, pipeline/jobfit/
// github_evidence_cli.py derives, githubEvidence.ts merges). Registry recruiting/public-
// work-evidence-bounding: a PERSON account only, owned non-fork repositories only, labels
// read and never code (the budget travels with the result), and an unavailable read is its
// own outcome - never "no evidence".
//
//   GET     { state, suggestion }  - what is stored, and the handle the CV itself names
//   POST    { handle }             - read (or re-read) the account: { state, outcome, retryAfterSec? }
//                                    outcome "ok" | "invalid_handle" | "not_found" | "not_a_person"
//                                    | "throttled" | "offline" | "unreachable" | "failed"
//   PUT     { confirmed?, use?, projects? } - the seeker's choices: this is me; use it for
//                                    matching; these repositories in my CV
//   DELETE  forget it
//
// Nothing reaches the matcher or the CV until the seeker CONFIRMED the account is theirs;
// a re-read of the same account keeps their choices, a different account starts over.

type Owner = { profileId: string; ws: string; cvText: string; claims: string[] };

async function owner(): Promise<Owner | NextResponse> {
  const [session, ws] = await Promise.all([currentSession(), currentWorkspace()]);
  const profile = getJobseekerProfile(currentUserId(session), ws);
  if (!profile) return jsonRefusal("JOBSEEKER_PROFILE_MISSING", 409);
  const claims = (profile.profile.skillClaims ?? []).map((c) => c.skill?.trim()).filter((s): s is string => !!s);
  return { profileId: profile.id, ws, cvText: profile.cvSourceText ?? "", claims };
}

/** The handle the CV's own header names (github.com/<user>), for a one-tap suggestion. */
function suggestionOf(cvText: string): string | null {
  const head = cvText.split(/\r?\n/).slice(0, 40).join("\n");
  const m = /github\.com\/([A-Za-z0-9-]{1,39})(?![A-Za-z0-9-])/i.exec(head);
  return m ? parseGithubUsername(m[1]!) : null;
}

function stored(o: Owner): GithubState | null {
  return githubStateOf(getGithubState(o.profileId, o.ws)?.value);
}

export async function GET(): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const o = await owner();
    if (o instanceof NextResponse) return o;
    return NextResponse.json({ state: stored(o), suggestion: suggestionOf(o.cvText) });
  } catch (error) {
    return safeJsonError(error, "api:jobseeker/github", "JOBSEEKER_STORE_FAILED");
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  // One read is 1 + up to 3 list pages + up to 12 /languages calls against GitHub's budget
  // (60 an hour without a token): 10 reads per 10 minutes per IP.
  if (!rateLimit(`jobseeker-github:${clientIpFrom(request.headers)}`, { limit: 10, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const body = (await request.json().catch(() => null)) as { handle?: unknown } | null;
    const handle = typeof body?.handle === "string" ? body.handle.trim().slice(0, 200) : "";
    if (!handle) return jsonRefusal("JOBSEEKER_REQUEST_INVALID", 400);
    const o = await owner();
    if (o instanceof NextResponse) return o;
    const before = stored(o);
    const read = await readSeekerGithub(handle);
    if (!read.ok) {
      return NextResponse.json({ state: before, outcome: read.state, ...(read.retryAfterSec ? { retryAfterSec: read.retryAfterSec } : {}) });
    }
    const snapshot = read.snapshot;
    const derived = await runPythonCli({
      module: "github_evidence_cli",
      files: { "input.json": { snapshot, claims: o.claims } },
      args: (f) => ["--input-json", f["input.json"]!],
      timeoutMs: 60_000,
    });
    // The same account re-read keeps the seeker's choices; another account starts over.
    const same = before !== null && before.login.toLowerCase() === snapshot.login.toLowerCase();
    const names = new Set(snapshot.repos.map((r) => r.name));
    const projects = same
      ? before.projects.filter((n) => names.has(n))
      : portfolioCandidates(snapshot, 4).map((r) => r.name);
    const next = githubStateOf({
      handle,
      login: snapshot.login,
      name: snapshot.name,
      htmlUrl: snapshot.htmlUrl,
      publicRepos: snapshot.publicRepos,
      readAt: snapshot.readAt,
      confirmed: same ? before.confirmed : false,
      use: same ? before.use : false,
      projects,
      repos: snapshot.repos,
      derived,
    });
    if (!next) return jsonRefusal("JOBSEEKER_REQUEST_INVALID", 422);
    setGithubState(o.profileId, next as unknown as Record<string, unknown>, o.ws);
    return NextResponse.json({ state: next, outcome: "ok" });
  } catch (error) {
    return safeJsonError(error, "api:jobseeker/github", "JOBSEEKER_STORE_FAILED");
  }
}

export async function PUT(request: Request): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  if (!rateLimit(`jobseeker-github-choice:${clientIpFrom(request.headers)}`, { limit: 60, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const body = (await request.json().catch(() => null)) as { confirmed?: unknown; use?: unknown; projects?: unknown } | null;
    if (!body || typeof body !== "object") return jsonRefusal("JOBSEEKER_REQUEST_INVALID", 400);
    const o = await owner();
    if (o instanceof NextResponse) return o;
    const current = stored(o);
    if (!current) return jsonRefusal("JOBSEEKER_REQUEST_INVALID", 409);
    const names = new Set(current.repos.map((r) => r.name));
    if (body.projects !== undefined && (!Array.isArray(body.projects) || body.projects.some((p) => typeof p !== "string" || !names.has(p)))) {
      return jsonRefusal("JOBSEEKER_REQUEST_INVALID", 400);
    }
    const confirmed = typeof body.confirmed === "boolean" ? body.confirmed : current.confirmed;
    const next: GithubState = {
      ...current,
      confirmed,
      // Not theirs = nothing of it is used, whatever was chosen before.
      use: confirmed && (typeof body.use === "boolean" ? body.use : current.use),
      projects: Array.isArray(body.projects) ? [...new Set(body.projects as string[])].slice(0, GITHUB_PROJECTS_MAX) : current.projects,
    };
    setGithubState(o.profileId, next as unknown as Record<string, unknown>, o.ws);
    return NextResponse.json({ state: next });
  } catch (error) {
    return safeJsonError(error, "api:jobseeker/github", "JOBSEEKER_STORE_FAILED");
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  if (!rateLimit(`jobseeker-github-choice:${clientIpFrom(request.headers)}`, { limit: 60, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const o = await owner();
    if (o instanceof NextResponse) return o;
    // Scores computed with the repositories must be re-run without them: with the row gone,
    // only the profile's own time can say the inputs moved.
    if (deleteGithubState(o.profileId, o.ws)) touchJobseekerProfile(o.profileId, o.ws);
    return NextResponse.json({ state: null });
  } catch (error) {
    return safeJsonError(error, "api:jobseeker/github", "JOBSEEKER_STORE_FAILED");
  }
}
