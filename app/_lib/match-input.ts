import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { getProfileRecord } from "./db";
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

/**
 * Resolve a profile or inline candidate from the request body, write it into
 * `workdir`, and return the Python input args plus a cache-key part.
 *
 * Single resolution path shared by /api/match and /api/match/reasoning so the
 * profile-vs-candidate handling (which record to load, what file to write, which
 * --json flag to pass, how to key the cache) never diverges between the two routes.
 */
export async function writeMatchInput(body: MatchInputBody, workdir: string): Promise<MatchInput> {
  if (body.profileId) {
    // v2 profile: hand the raw CandidateProfileV2 to Python, which transforms it
    // (skills+provenance, potential) into a MatchCandidate before matching.
    const record = getProfileRecord(body.profileId);
    if (!record) return { error: "Profile not found.", status: 404 };
    // Mix a content hash of the profile payload into the key so an in-place edit
    // (same profileId, changed skills/aspirations/etc.) invalidates its cached
    // reasoning instead of serving the pre-edit verdict.
    const contentHash = createHash("sha256").update(JSON.stringify(record.payload)).digest("hex");
    const profilePath = path.join(workdir, "profile.json");
    await writeFile(profilePath, JSON.stringify(record.payload), "utf-8");
    return { inputArgs: ["--profile-json", profilePath], keyPart: `profile:${body.profileId}:${contentHash}` };
  }

  const resolved = resolveCandidate(body);
  if ("error" in resolved) return { error: resolved.error, status: resolved.status };
  const candidatePath = path.join(workdir, "candidate.json");
  await writeFile(candidatePath, JSON.stringify(resolved.candidate), "utf-8");
  return { inputArgs: ["--candidate-json", candidatePath], keyPart: candidateSignature(resolved.candidate) };
}
