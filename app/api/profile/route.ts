import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  analysisLineageSource,
  cachedProfileRecords,
  deleteProfile,
  getProfileRecord,
  profileDivergence,
  profileStaleness,
  saveProfile,
  setProfileLineage,
  updateProfile,
  type ProfileLineage,
  type SaveProfileInput,
} from "@/app/_lib/db";
import {
  cleanupWorkdir,
  createWorkdir,
  parsePythonJson,
  parseStderrError,
  spawnPython,
} from "@/app/_lib/python-runner";
import type { ProfileCliOutput } from "@/app/features/sub_profile/ProfileTypes";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";


type RouteOutcome = { data: ProfileCliOutput } | { error: { message: string; status: number } };

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
    const { result } = spawnPython(["-m", "pipeline.jobfit.profile_cli", "--input-json", inputPath], { signal: abortSignal });
    const { stdout, stderr, exitCode } = await result;
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
      return NextResponse.json({ profile: { ...rec.row, payload: rec.payload }, divergence: profileDivergence(id, ws) });
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
    const message = error instanceof Error ? error.message : "Failed to list profiles.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      profile?: Record<string, unknown>;
      signals?: Record<string, unknown>;
      persist?: boolean;
      // When the profile is being built FROM a saved CV analysis (the matrix
      // "build from analysis" entry, or a rebuild), the slug of that analysis. The
      // route resolves the authoritative cv_hash + analyzed-at from it and stamps
      // source lineage so staleness becomes detectable.
      sourceAnalysisSlug?: string;
    };

    const invalid = validateProfileBody(body);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

    const outcome = await routeAndScore(body.profile ?? {}, body.signals ?? {}, request.signal);
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
    const message = error instanceof Error ? error.message : "Profile build failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      id?: string;
      profile?: Record<string, unknown>;
      signals?: Record<string, unknown>;
      // Present on a "rebuild from latest": the newer analysis this profile is being
      // re-pointed at. Refreshes the profile's lineage (clearing its staleness); a
      // plain edit omits it and updateProfile leaves the existing lineage untouched.
      sourceAnalysisSlug?: string;
    };
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
    if ("error" in outcome) {
      return NextResponse.json({ error: outcome.error.message }, { status: outcome.error.status });
    }
    const { data } = outcome;

    const ok = updateProfile(body.id, persistFieldsFrom(data), ws);
    if (!ok) {
      return NextResponse.json({ error: "Profile not found." }, { status: 404 });
    }
    // A rebuild re-stamps lineage onto the SAME row (no duplicate profile), pointing
    // it at the newer analysis so its staleness clears. updateProfile deliberately
    // never touches lineage, so this explicit step is the only refresh path.
    const lineage = resolveLineage(body.sourceAnalysisSlug, ws);
    if (lineage) setProfileLineage(body.id, lineage, ws);
    return NextResponse.json({ ...data, saved: { id: body.id } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Profile update failed.";
    return NextResponse.json({ error: message }, { status: 500 });
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
    const message = error instanceof Error ? error.message : "Profile delete failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
