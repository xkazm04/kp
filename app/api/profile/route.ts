import { NextRequest, NextResponse } from "next/server";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { analysisLineageSource } from "@/app/_lib/db/analyses";
import { cachedProfileRecords, deleteProfile, getProfileRecord, profileDivergence, profileStaleness, saveProfile, setProfileLineage, updateProfile, type ProfileLineage, type SaveProfileInput } from "@/app/_lib/db/profiles";
import {
  cleanupWorkdir,
  createWorkdir,
  parsePythonJson,
  parseStderrError,
  spawnPython,
} from "@/app/_lib/python-runner";
import type { ProfileCliOutput } from "@/app/features/shared/profileTypes";
import { isSpawnTimeoutMessage } from "@/app/_lib/intake-run";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { BODY_TOO_LARGE, readJsonWithLimit } from "@/app/_lib/request-body";
import { PROFILE_BUILD_TIMEOUT_MS } from "@/app/_lib/applicant-profile";


type RouteOutcome =
  | { data: ProfileCliOutput }
  | { error: { message: string; status: number } }
  // The spawn overran PROFILE_ROUTE_TIMEOUT_MS: a DECISION (we stopped waiting), not a
  // store fault, so it is carried as its own outcome and answered by NAME rather than
  // collapsing into the catch-all 500 whose generic sentence offers no next step.
  | { timeout: true };

// spawnPython's default is a TEN-MINUTE hang backstop — the right bound for a repo scan
// and the wrong one for the editor's Save button. profile_cli is pure deterministic
// logic (archetype router + completeness, no model call) and answers in well under a
// second, so a wedged child previously held the recruiter's save open for nine minutes
// past the point the answer was useful, with their unsaved intake still in the form.
// The SAME constant applicant-profile.ts bounds the SAME CLI with — imported, not
// re-typed: the two used to be hand-copied 60_000s, so tuning one silently left the
// other on the old budget.
const PROFILE_ROUTE_TIMEOUT_MS = PROFILE_BUILD_TIMEOUT_MS;

// THROTTLE (rate-limit-contract.test.ts). Every accepted POST/PUT here SPAWNS A
// PYTHON CHILD (profile_cli) and writes a row — the one subprocess door in the app
// that carried no budget at all. The route is not operator-gated, and in open mode
// (KP_OPERATOR_PASSWORD unset) or through the anonymous session /api/demo mints,
// that made profile saving an unbounded process-spawn endpoint. 60/10min per IP:
// the editor saves on a click and the "save → fill a completeness gap → save"
// loop is a handful of writes, so a recruiter never meets it while a script does
// at once.
const PROFILE_RATE_LIMIT = { limit: 60, windowMs: 10 * 60_000 };

// A profile payload is text: display name, aspirations, skill claims and evidence
// blurbs. 128 KB is far above the largest real intake and still bounds the bytes
// this route buffers before it JSON.stringifies them into a child's input file.
// `content-length` is advisory, so the cap is measured on the bytes actually read.
const MAX_PROFILE_BODY_BYTES = 128_000;

// The request body is a TS cast, not validated. Reject a non-object profile/signals at this
// trust boundary BEFORE it is JSON.stringified into the Python intake — a string/array/number
// would serialize into junk the CLI must defend against, and the AI-draft / direct-API paths
// bypass the form's client-side guards. Field-level normalization (archetype, completeness,
// numeric coercion) stays delegated to profile_cli; this only enforces the top-level shape.
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateProfileBody(body: { profile?: unknown; signals?: unknown }): string | null {
  if (body.profile !== undefined && !isPlainObject(body.profile)) return "profile must be an object.";
  if (body.signals !== undefined && !isPlainObject(body.signals)) return "signals must be an object.";
  return null;
}

// Run the pure-logic profile_cli (archetype router + completeness) over an intake
// draft. Shared by POST (create) and PUT (edit) so both re-route and re-score the
// same way — an edit must never persist a stale archetype/completeness.
async function routeAndScore(
  profile: Record<string, unknown>,
  signals: Record<string, unknown>,
  abortSignal?: AbortSignal
): Promise<RouteOutcome> {
  let workdir: string | null = null;
  try {
    workdir = await createWorkdir();
    const inputPath = path.join(workdir, "intake.json");
    await writeFile(inputPath, JSON.stringify({ profile, signals }), "utf-8");

    // Forward the caller's abort signal so an abandoned request SIGKILLs the child +
    // reaches finally→cleanupWorkdir instead of orphaning it + leaking the temp dir.
    const { result } = spawnPython(["-m", "pipeline.jobfit.profile_cli", "--input-json", inputPath], {
      signal: abortSignal,
      timeoutMs: PROFILE_ROUTE_TIMEOUT_MS,
    });
    let spawned;
    try {
      spawned = await result;
    } catch (err) {
      // python-runner delivers its deadline as a REJECTION carrying a message, not a
      // typed error; isSpawnTimeoutMessage (app/_lib/intake-run.ts) is the ONE place
      // that reading lives. Anything else — an ENOENT on PYTHON_CMD, a killed child —
      // is a real fault and still escapes to the caller's catch.
      if (err instanceof Error && isSpawnTimeoutMessage(err.message)) return { timeout: true };
      throw err;
    }
    const { stdout, stderr, exitCode } = spawned;
    if (exitCode !== 0) {
      const err = parseStderrError(stderr, exitCode);
      return { error: { message: err.message, status: err.status } };
    }
    // parsePythonJson, not raw JSON.parse: profile_cli can emit stray warnings
    // before the result and the interpreter prints shutdown noise after it
    // (atexit/ResourceWarning), and an exit-0-with-empty-stdout would make a raw
    // parse throw — each turning a successful build/edit into a 500 that
    // discards the recruiter's just-entered intake. Scan from the end for the
    // first JSON object, exactly like every other CLI seam.
    return { data: parsePythonJson<ProfileCliOutput>(stdout, stderr) };
  } finally {
    if (workdir) await cleanupWorkdir(workdir);
  }
}

// Project the routed profile into the columns the profiles table denormalizes
// (label/archetype/role_family/completeness) alongside the full payload.
function persistFieldsFrom(data: ProfileCliOutput): SaveProfileInput {
  const profile = data.profile;
  return {
    label: profile.displayName || "Candidate",
    archetype: data.archetype ?? null,
    roleFamily: profile.roleFamily ?? null,
    completeness: data.completeness ?? null,
    payload: profile,
  };
}

// Resolve the source lineage a create/rebuild wants to stamp. The client passes
// only the analysis SLUG it built from; the cv_hash + analyzed-at come from the DB
// (analysisLineageSource), so lineage can never be forged and is left NULL when the
// slug doesn't resolve or the analysis predates cv_hash — honest, never fabricated.
function resolveLineage(sourceAnalysisSlug: unknown, workspaceId: string): ProfileLineage | undefined {
  if (typeof sourceAnalysisSlug !== "string" || !sourceAnalysisSlug) return undefined;
  const src = analysisLineageSource(sourceAnalysisSlug, workspaceId);
  if (!src) return undefined;
  return { sourceAnalysisSlug: src.slug, sourceCvHash: src.cvHash, sourceAnalyzedAt: src.analyzedAt };
}

export async function GET(request: NextRequest) {
  try {
    // ?id=<candidateId> → a single profile (label/archetype/completeness + payload),
    // used by the Decisions analysis-summary modal and the Profile editor (edit /
    // duplicate hydration). No id → the full list.
    const ws = await currentWorkspace();
    const id = request.nextUrl.searchParams.get("id");
    if (id) {
      const rec = getProfileRecord(id, ws);
      if (!rec) return NextResponse.json({ error: "Profile not found." }, { status: 404 });
      // `divergence` lets the rebuild flow (ProfileTab) detect a profile hand-edited
      // AFTER it was built from its analysis and warn before re-hydrating from the
      // analysis dump — so the recruiter's edits are never silently clobbered.
      // `updatedAt` is the row's content-write stamp — the version token the editor
      // sends back as `expectedUpdatedAt` on its PUT so a save can be refused instead
      // of overwriting someone else's. It is the same column `divergence.editedAt`
      // reports, read once here rather than twice.
      const divergence = profileDivergence(id, ws);
      return NextResponse.json({
        profile: { ...rec.row, payload: rec.payload },
        divergence,
        updatedAt: divergence?.editedAt ?? null,
      });
    }
    // The list carries a `stale` map (profile id → newer analysis) alongside the
    // rows so the roster / Match candidate select can flag "a newer CV analysis
    // exists since this profile was built" without a per-row round-trip. Empty for
    // every hand-built profile (NULL lineage ⇒ never stale). The rows come off the
    // shared short-TTL memo (cachedProfileRecords) — projected to ProfileRow — so
    // the matrix's sibling /api/profile/candidates read on the same tab load is
    // free; the payload is byte-identical to the old listProfiles(200, ws).
    const profiles = cachedProfileRecords(ws).map((r) => r.row);
    return NextResponse.json({ profiles, stale: profileStaleness(ws) });
  } catch (error) {
    // better-sqlite3 throws with the absolute db path inside SQLITE_* text; it goes to
    // the server log and the caller gets the code (api-contracts.md §1.1).
    return safeJsonError(error, "api:profile:list", "PROFILE_LIST_FAILED");
  }
}

export async function POST(request: NextRequest) {
  // Before the body read and before the spawn, so a throttled caller costs neither.
  if (!rateLimit(`profile-save:${clientIpFrom(request.headers)}`, PROFILE_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const body = await readJsonWithLimit<{
      profile?: Record<string, unknown>;
      signals?: Record<string, unknown>;
      persist?: boolean;
      // When the profile is being built FROM a saved CV analysis (the matrix
      // "build from analysis" entry, or a rebuild), the slug of that analysis. The
      // route resolves the authoritative cv_hash + analyzed-at from it and stamps
      // source lineage so staleness becomes detectable.
      sourceAnalysisSlug?: string;
    }>(request, MAX_PROFILE_BODY_BYTES, {});
    if (body === BODY_TOO_LARGE) return jsonRefusal("PAYLOAD_TOO_LARGE", 413, { maxBytes: MAX_PROFILE_BODY_BYTES });

    const invalid = validateProfileBody(body);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

    const outcome = await routeAndScore(body.profile ?? {}, body.signals ?? {}, request.signal);
    if ("timeout" in outcome) return jsonRefusal("PROFILE_BUILD_TIMEOUT", 504);
    if ("error" in outcome) {
      return NextResponse.json({ error: outcome.error.message }, { status: outcome.error.status });
    }
    const { data } = outcome;

    // Persist by default; the form can request a dry-run preview with persist:false.
    if (body.persist === false) {
      return NextResponse.json({ ...data, saved: null });
    }
    const ws = await currentWorkspace();
    const saved = saveProfile(persistFieldsFrom(data), ws, resolveLineage(body.sourceAnalysisSlug, ws));
    return NextResponse.json({ ...data, saved });
  } catch (error) {
    // A spawn/store fault carries the temp workdir path, PYTHON_CMD and SQLITE_* text.
    return safeJsonError(error, "api:profile:create", "PROFILE_BUILD_FAILED");
  }
}

export async function PUT(request: NextRequest) {
  if (!rateLimit(`profile-save:${clientIpFrom(request.headers)}`, PROFILE_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const body = await readJsonWithLimit<{
      id?: string;
      profile?: Record<string, unknown>;
      signals?: Record<string, unknown>;
      // Present on a "rebuild from latest": the newer analysis this profile is being
      // re-pointed at. Refreshes the profile's lineage (clearing its staleness); a
      // plain edit omits it and updateProfile leaves the existing lineage untouched.
      sourceAnalysisSlug?: string;
      // OPTIMISTIC CONCURRENCY: the `updated_at` the client read (GET carries it as
      // `updatedAt`). Re-asserted inside the UPDATE's WHERE, so a save computed
      // against a version that has since been replaced is REFUSED rather than
      // silently winning the race. Omitted by a legacy/scripted caller → the previous
      // unconditional overwrite, unchanged.
      expectedUpdatedAt?: string | null;
    }>(request, MAX_PROFILE_BODY_BYTES, {});
    if (body === BODY_TOO_LARGE) return jsonRefusal("PAYLOAD_TOO_LARGE", 413, { maxBytes: MAX_PROFILE_BODY_BYTES });
    if (!body.id) {
      return NextResponse.json({ error: "Profile id is required." }, { status: 400 });
    }
    const ws = await currentWorkspace();
    if (!getProfileRecord(body.id, ws)) {
      return NextResponse.json({ error: "Profile not found." }, { status: 404 });
    }

    const invalid = validateProfileBody(body);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

    const outcome = await routeAndScore(body.profile ?? {}, body.signals ?? {}, request.signal);
    if ("timeout" in outcome) return jsonRefusal("PROFILE_BUILD_TIMEOUT", 504);
    if ("error" in outcome) {
      return NextResponse.json({ error: outcome.error.message }, { status: outcome.error.status });
    }
    const { data } = outcome;

    const expected = typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : undefined;
    const ok = updateProfile(body.id, persistFieldsFrom(data), ws, expected);
    if (!ok) {
      // The row was proved to exist above, so with a precondition in play a zero-row
      // UPDATE means exactly one thing: someone saved this profile between that read
      // and this write. Answer the LOST UPDATE honestly (409 + a code the editor
      // resolves in the reader's language) instead of a 404 that says the profile is
      // gone, or a 200 that quietly discards the other writer's work.
      if (expected) return jsonRefusal("PROFILE_STALE", 409);
      return NextResponse.json({ error: "Profile not found." }, { status: 404 });
    }
    // A rebuild re-stamps lineage onto the SAME row (no duplicate profile), pointing
    // it at the newer analysis so its staleness clears. updateProfile deliberately
    // never touches lineage, so this explicit step is the only refresh path.
    const lineage = resolveLineage(body.sourceAnalysisSlug, ws);
    if (lineage) setProfileLineage(body.id, lineage, ws);
    // Hand back the row's NEW version stamp so the still-open editor can keep saving
    // ("save → click a completeness gap → fill it → save" is the designed loop) without
    // its own previous write looking like someone else's.
    return NextResponse.json({ ...data, saved: { id: body.id, updatedAt: profileDivergence(body.id, ws)?.editedAt ?? null } });
  } catch (error) {
    return safeJsonError(error, "api:profile:update", "PROFILE_UPDATE_FAILED");
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Profile id is required." }, { status: 400 });
    }
    const ok = deleteProfile(id, await currentWorkspace());
    if (!ok) {
      return NextResponse.json({ error: "Profile not found." }, { status: 404 });
    }
    return NextResponse.json({ deleted: id });
  } catch (error) {
    return safeJsonError(error, "api:profile:delete", "PROFILE_DELETE_FAILED");
  }
}
