import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { getProfileRecord } from "./db/profiles";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";
import { candidateSignature, resolveCandidate, type CandidateInput } from "./match-candidate";

// Body fields both /api/match and the reasoning runner read to resolve their
// Python input: either a saved v2 profile (profileId) or an inline/analysis
// candidate (candidate/analysisSlug).
export type MatchInputBody = {
  analysisSlug?: string;
  candidate?: CandidateInput;
  profileId?: string;
};

// Either a resolution error (mapped by the caller to a 4xx) or the resolved
// Python input: the `--profile-json`/`--candidate-json` arg pair plus a stable
// cache-key part. keyPart is only consumed by the reasoning cache; /api/match
// ignores it.
export type MatchInput =
  | { error: string; status: number }
  | { inputArgs: string[]; keyPart: string };

// The resolved-but-not-yet-materialized input: the cache-key part (needs NO disk)
// plus everything materializeMatchInput needs to write the file on a cache MISS.
// Splitting resolve (DB-only) from materialize (disk) lets the reasoning path
// compute its cache key and short-circuit a HIT with ZERO file serialization.
export type ResolvedMatchInput =
  | { error: string; status: number }
  | { keyPart: string; flag: "--profile-json" | "--candidate-json"; fileName: string; payload: unknown };

/**
 * Resolve a profile or inline candidate from the request body WITHOUT touching
 * disk, returning the cache-key part plus the payload to serialize later. This is
 * the DB-only half of writeMatchInput, split out so the reasoning cache can be
 * consulted before any file (candidate/profile or corpus) is written — a pure
 * cache hit then pays no serialization tax.
 *
 * Single resolution path shared by /api/match and /api/match/reasoning so the
 * profile-vs-candidate handling (which record to load, which --json flag to pass,
 * how to key the cache) never diverges between the two routes.
 */
export function resolveMatchInput(
  body: MatchInputBody,
  // Tenancy: profile/analysis resolution is scoped to the caller's workspace so a
  // cross-workspace id is not-found rather than mixing tenants (matches /api/match's
  // workspace-scoped corpus). Defaults preserve behavior for single-workspace callers.
  workspaceId: string = DEFAULT_WORKSPACE_ID
): ResolvedMatchInput {
  if (body.profileId) {
    // v2 profile: hand the raw CandidateProfileV2 to Python, which transforms it
    // (skills+provenance, potential) into a MatchCandidate before matching.
    const record = getProfileRecord(body.profileId, workspaceId);
    if (!record) return { error: "Profile not found.", status: 404 };
    // Mix a content hash of the profile payload into the key so an in-place edit
    // (same profileId, changed skills/aspirations/etc.) invalidates its cached
    // reasoning instead of serving the pre-edit verdict.
    const contentHash = createHash("sha256").update(JSON.stringify(record.payload)).digest("hex");
    return { keyPart: `profile:${body.profileId}:${contentHash}`, flag: "--profile-json", fileName: "profile.json", payload: record.payload };
  }

  const resolved = resolveCandidate(body, workspaceId);
  if ("error" in resolved) return { error: resolved.error, status: resolved.status };
  return { keyPart: candidateSignature(resolved.candidate), flag: "--candidate-json", fileName: "candidate.json", payload: resolved.candidate };
}

/**
 * Serialize a resolved input into `workdir` and return the Python `--*-json` arg
 * pair. The MISS-path other half of resolveMatchInput — only reached when the
 * verdict isn't already cached.
 */
export async function materializeMatchInput(
  resolved: Extract<ResolvedMatchInput, { keyPart: string }>,
  workdir: string
): Promise<string[]> {
  const filePath = path.join(workdir, resolved.fileName);
  await writeFile(filePath, JSON.stringify(resolved.payload), "utf-8");
  return [resolved.flag, filePath];
}

/**
 * Resolve AND serialize in one call — the eager path /api/match takes (it always
 * spawns, so there's no cache to short-circuit). Kept as a thin wrapper over
 * resolve + materialize so both routes share the exact same resolution logic.
 */
export async function writeMatchInput(
  body: MatchInputBody,
  workdir: string,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): Promise<MatchInput> {
  const resolved = resolveMatchInput(body, workspaceId);
  if ("error" in resolved) return { error: resolved.error, status: resolved.status };
  const inputArgs = await materializeMatchInput(resolved, workdir);
  return { inputArgs, keyPart: resolved.keyPart };
}
