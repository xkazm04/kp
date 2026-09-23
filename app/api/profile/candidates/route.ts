import { NextResponse } from "next/server";
import { safeJsonError } from "@/app/_lib/api-response";
import { listAnalysisRecords } from "@/app/_lib/db/analyses";
import { cachedProfileRecords } from "@/app/_lib/db/profiles";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { collapsePopulation, type PopulationAnalysis, type PopulationProfile } from "@/app/_lib/candidate-population";
import type { ProfilePayload } from "@/app/features/shared/profileTypes";


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
export async function GET() {
  try {
    const ws = await currentWorkspace();

    const analyses: PopulationAnalysis[] = listAnalysisRecords(200, ws).map(({ row, payload }) => {
      const v2 = (payload as { v2Profile?: { archetype?: string } } | null)?.v2Profile;
      return {
        slug: row.slug,
        name: row.candidate_label,
        role: row.role_family,
        seniority: row.seniority,
        score: row.score,
        // Honest fail-closed sentinel (NOT "bau"): collapsing an unrouted candidate
        // to "bau" mislabels a fairness-protected class. The matrix renders "unknown"
        // as the "Unrouted" column via archetypeDisplayKey.
        archetype: v2?.archetype ?? "unknown",
        cvHash: row.cv_hash ?? null,
        createdAt: row.created_at,
      };
    });

    const profiles: PopulationProfile[] = cachedProfileRecords(ws).map(({ row, payload, sourceCvHash }) => {
      const p = (payload as ProfilePayload | null) ?? {};
      return {
        id: row.id,
        name: row.label,
        role: row.role_family ?? p.roleFamily ?? null,
        seniority: p.seniority ?? null,
        archetype: row.archetype ?? "unknown",
        sourceCvHash,
        createdAt: row.created_at,
      };
    });

    return NextResponse.json({ candidates: collapsePopulation(profiles, analyses) });
  } catch (error) {
    // Two store reads; better-sqlite3's thrown text carries the absolute db path.
    return safeJsonError(error, "api:profile:candidates", "PROFILE_CANDIDATES_FAILED");
  }
}
