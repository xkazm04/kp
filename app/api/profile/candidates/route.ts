import { NextResponse } from "next/server";
import { safeJsonError } from "@/app/_lib/api-response";
import { listAnalysisRecords } from "@/app/_lib/db/analyses";
import { cachedProfileRecords, profileStaleness } from "@/app/_lib/db/profiles";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { analysisFromRecord, collapsePopulation, profileFromRecord } from "@/app/_lib/candidate-population";


// Candidate overview for the Profile tab matrix — BOTH candidate stores, folded into
// ONE row per candidate IDENTITY (the CV content hash) by collapsePopulation
// (app/_lib/candidate-population.ts). Before, this was a raw union: one row per store
// row, so a CV analysed against four JDs and promoted to a profile was five chips.
//
//   - source "profile": a saved profile exists for the person. Its reviewed archetype
//     wins; every analysis of the same CV (analyses.cv_hash = profiles.source_cv_hash)
//     is folded in, and the newest supplies the score. A hand-built profile, or one
//     whose CV has no analysis in view, has no MATCH score — an honest null (never
//     fabricated), rendered as a neutral em-dash badge.
//   - source "analysis": only analyses exist — every analysis of one CV is one row,
//     scored and opened by the newest. A legacy analysis with no cv_hash is its own row
//     (a label is never an identity key).
//
// This is the Profile tab's ONE population read (useCandidatePopulation): the roster,
// the matrix and the archetype retire dialog all derive from these rows, so a profile
// row also carries its completeness and its staleness (profileStaleness) — what the
// roster used to read from GET /api/profile on its own. GET /api/profile keeps its
// shape for its other readers.
export async function GET() {
  try {
    const ws = await currentWorkspace();

    // Every store read takes the caller's workspace — pinned by
    // app/features/tools/profile/candidateMatrixContracts.test.ts.
    const analyses = listAnalysisRecords(200, ws).map(analysisFromRecord);
    const profiles = cachedProfileRecords(ws).map(profileFromRecord);
    // Staleness rides on the profile rows, so the matrix knows what the roster knows
    // (a profile with a newer CV no longer reads "current" on one projection only).
    const stale = profileStaleness(ws);

    return NextResponse.json({ candidates: collapsePopulation(profiles, analyses, stale) });
  } catch (error) {
    // Three store reads; better-sqlite3's thrown text carries the absolute db path.
    return safeJsonError(error, "api:profile:candidates", "PROFILE_CANDIDATES_FAILED");
  }
}
