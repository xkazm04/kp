import { DEFAULT_WORKSPACE_ID, getProfileRecord, listAnalysisRecords, listProfileRecords, loadAnalysis } from "./db";
import { DEFAULT_ROLE_FAMILY } from "./role-families.ts";

// Shared candidate-pool builder (v2 profiles + saved CV analyses) — the input
// the recruiter_cli ranker scores against a job. Used by /rediscover,
// /api/jobs/[id]/candidates, and the Decisions group evaluation so every view
// ranks the same population the same way.
//
// Tenant scope: every read is workspace-scoped — callers thread their request's
// currentWorkspace() so a job in workspace A never ranks against workspace B's
// candidates. `workspaceId` defaults to the single workspace so a single-tenant
// deployment (and every non-request/background caller) stays behavior-identical.

export type CandidatePoolEntry =
  | { id: string; label: string; profile: unknown }
  | { id: string; label: string; candidate: Record<string, unknown> };

// The pool + an honest `truncated` flag: true when EITHER cap filled, i.e. the
// corpus exceeds PROFILE_POOL_CAP + ANALYSIS_POOL_CAP and the overflow is NOT in
// this pool (so it is never scored or rediscovered). A boolean — not an
// excludedCount — is the least invasive honest surface: the caps read at most
// `cap` rows, so the true excess is unknown without an extra COUNT per store, and
// "the pool is capped, some candidates are excluded" is the actionable signal.
// Consumers may display it (the candidates route echoes it as `poolTruncated`) or
// ignore it; the central console.warn below still logs the specifics either way.
export type CandidatePool = { entries: CandidatePoolEntry[]; truncated: boolean };

// Pool caps: v2 profiles and saved CV analyses are bounded so the recruiter_cli
// ranker (and rediscovery) stay fast on a large corpus. A population above
// PROFILE_POOL_CAP + ANALYSIS_POOL_CAP (~160) means the overflow is never scored
// or rediscovered — so when a cap is actually hit we log it rather than dropping
// people silently. Bump these (or page) if the real corpus routinely exceeds them.
export const PROFILE_POOL_CAP = 100;
export const ANALYSIS_POOL_CAP = 60;

// Derive a recruiter-pool entry from a saved CV analysis payload: prefer the v2
// profile when the analysis carries one, else fall back to the legacy flat
// candidate shape with safe defaults. Single-sourced here so the batch builder,
// the single-id resolver below, AND the group-eval's shared-resolution path
// (group-eval-run.ts, idea-c7c2d014) never diverge.
export function poolEntryFromAnalysis(id: string, label: string, payload: unknown): CandidatePoolEntry {
  const p = payload as { candidate?: Record<string, unknown>; v2Profile?: Record<string, unknown> } | null;
  if (p?.v2Profile && Object.keys(p.v2Profile).length > 0) {
    return { id, label, profile: p.v2Profile };
  }
  const c = p?.candidate ?? {};
  return {
    id,
    label,
    candidate: {
      skills: (c.skills as string[]) ?? [],
      // Fail-closed, don't assume: a legacy analysis with no captured
      // seniority/family passes the same honest sentinels the matcher's own
      // resolver uses (match-candidate.ts::resolveCandidate) — "unknown"
      // seniority and role-families.ts::DEFAULT_ROLE_FAMILY ("general_professional",
      // "Never assume software"), NOT a fabricated "medior"/"software_engineering"
      // that ranks a nurse or electrician as a mid-level SWE. Python's
      // _SENIORITY_RANK.get(..., 2) treats "unknown" as neutral for scoring and
      // ko_filter fails closed on the "unknown" archetype below, so neither
      // sentinel triggers a hard gate on a signal we never detected.
      seniority: (c.currentSeniority as string) ?? "unknown",
      roleFamily: (c.roleFamily as string) ?? DEFAULT_ROLE_FAMILY,
      educationLevel: (c.educationLevel as string) ?? "unknown",
      languages: (c.languages as string[]) ?? [],
      yearsExperience: (c.yearsExperience as number) ?? 0,
      // Honest fail-closed sentinel (NOT "bau"): a legacy analysis with no v2
      // profile was never routed to a real archetype. "bau" ("Experienced") both
      // mislabels the candidate and — being NOT fairness-protected — strips the
      // fail-closed shield downstream. "unknown" is the matcher's sentinel the
      // rest of the app already standardized on (round 4, af60167).
      archetype: "unknown",
    },
  };
}

export function buildCandidatePool(workspaceId: string = DEFAULT_WORKSPACE_ID): CandidatePool {
  const entries: CandidatePoolEntry[] = [];
  let truncated = false;

  const profiles = listProfileRecords(PROFILE_POOL_CAP, workspaceId);
  if (profiles.length >= PROFILE_POOL_CAP) {
    truncated = true;
    console.warn(`[candidate-pool] profile pool hit its ${PROFILE_POOL_CAP} cap — older profiles are excluded from ranking/rediscovery.`);
  }
  for (const { row, payload } of profiles) {
    entries.push({ id: row.id, label: row.label, profile: payload });
  }

  const analyses = listAnalysisRecords(ANALYSIS_POOL_CAP, workspaceId);
  if (analyses.length >= ANALYSIS_POOL_CAP) {
    truncated = true;
    console.warn(`[candidate-pool] analysis pool hit its ${ANALYSIS_POOL_CAP} cap — older CV analyses are excluded from ranking/rediscovery.`);
  }
  for (const { row, payload } of analyses) {
    entries.push(poolEntryFromAnalysis(row.slug, row.candidate_label, payload));
  }

  return { entries, truncated };
}

// Resolve ONE candidate id to a recruiter-pool entry (a v2 profile first, else a
// saved CV analysis by slug). Lets the Decisions group evaluation score just a
// role's pending candidates against the role's job, without rebuilding the whole
// corpus pool. Returns null when the id matches neither — e.g. an inline /
// transient candidate that was never persisted — so callers can skip it.
export function resolveCandidatePoolEntry(
  candidateId: string,
  label?: string,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): CandidatePoolEntry | null {
  // Agent-candidate bridge exclusion: a hired AI agent's pipeline row carries
  // candidateId "agent-<id>" and creates NO profile/analysis row, so it can never
  // resolve here today — but the prefix is reserved and guarded explicitly so no
  // future id collision or store change can rank an agent among human candidates
  // (buildCandidatePool is safe by construction: it reads only profile/analysis
  // stores, which agents never write).
  if (candidateId.startsWith("agent-")) return null;
  const profile = getProfileRecord(candidateId, workspaceId);
  if (profile) return { id: candidateId, label: label ?? profile.row.label, profile: profile.payload };
  const analysis = loadAnalysis(candidateId, workspaceId);
  if (analysis) return poolEntryFromAnalysis(candidateId, label ?? analysis.row.candidate_label, analysis.payload);
  return null;
}
