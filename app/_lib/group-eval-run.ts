import { getProfileRecord } from "./db";
import { runReasoning } from "./reasoning-run";
import { saveGroupEval } from "./group-eval";
import { isEarlyCareer } from "./archetypes";

// Cap on how many candidates one comparative evaluation covers. The strongest
// are selected by fit BEFORE the cap (see below), and the modal surfaces
// "top N of M" so a bounded comparison never reads as full coverage.
const GROUP_EVAL_CAP = 6;

// Decisions "group evaluation": a comparative read of every candidate competing
// for one role, replacing the old per-candidate "Why this candidate". For each
// candidate it pulls the gathered profile data + a best-effort AI fit reasoning
// (cached Gemini), then synthesizes a ranking, a top pick, differentiators and
// risks. LLM-enriched where available, deterministic otherwise — and persisted
// so the modal can re-open it without re-running.

export type GroupEvalCandidate = { entryId: string; candidateId: string | null; label: string; matchScore: number | null };
type Reasoning = { verdict?: string; strengths?: string[]; gaps?: string[] };
type PerCandidate = {
  label: string;
  score: number;
  seniority: string | null;
  archetype: string | null;
  topSkills: string[];
  verdict: string;
  strengths: string[];
  gaps: string[];
};

function topSkillsOf(payload: unknown): string[] {
  const claims = (payload as { skillClaims?: { skill?: string; level?: string }[] } | null)?.skillClaims ?? [];
  return claims
    .slice()
    .sort((a, b) => (a.level === "strong" ? -1 : 0) - (b.level === "strong" ? -1 : 0))
    .map((c) => c.skill)
    .filter((s): s is string => Boolean(s))
    .slice(0, 6);
}

export async function runGroupEval(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const roleKey = String(params.roleKey ?? "");
  const roleTitle = (params.roleTitle as string) ?? "the role";
  const jobId = params.jobId ? String(params.jobId) : null;
  const allCandidates = (params.candidates as GroupEvalCandidate[]) ?? [];
  const totalCandidates = allCandidates.length;
  // Sort by fit BEFORE applying the cap so the strongest candidates are always
  // the ones compared — never an arbitrary insertion-order subset. The recommended
  // lead/ranking is presented as authoritative, so dropping the best candidate by
  // list order would be a correctness + trust bug.
  const input = [...allCandidates]
    .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0))
    .slice(0, GROUP_EVAL_CAP);

  const sources: string[] = [];
  const candidates: PerCandidate[] = [];
  for (const c of input) {
    const rec = c.candidateId ? getProfileRecord(c.candidateId) : null;
    const payload = rec?.payload as { seniority?: string; archetype?: string } | null;
    let reasoning: Reasoning = {};
    if (jobId && c.candidateId) {
      try {
        const out = await runReasoning({ jobId, profileId: c.candidateId });
        reasoning = (out.reasoning as Reasoning) ?? {};
        sources.push(String(out.source ?? "deterministic"));
      } catch {
        sources.push("deterministic");
      }
    }
    candidates.push({
      label: c.label,
      score: c.matchScore ?? 0,
      seniority: payload?.seniority ?? null,
      archetype: payload?.archetype ?? null,
      topSkills: topSkillsOf(rec?.payload),
      verdict: reasoning.verdict ?? "",
      strengths: reasoning.strengths ?? [],
      gaps: reasoning.gaps ?? [],
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates[0] ?? null;

  // Differentiators: skills the top pick has that no one else in the group does.
  const othersSkills = new Set(candidates.slice(1).flatMap((c) => c.topSkills));
  const differentiators = top ? top.topSkills.filter((s) => !othersSkills.has(s)).slice(0, 5) : [];

  const risks: string[] = [];
  for (const c of candidates) {
    if (c.score > 0 && c.score < 55) risks.push(`${c.label}: lower fit (${c.score}) — confirm must-haves at interview.`);
    if (isEarlyCareer(c.archetype)) risks.push(`${c.label}: early-career — assess potential and trajectory, not only current skills.`);
    if (c.gaps.length) risks.push(`${c.label}: gaps in ${c.gaps.slice(0, 3).join(", ")}.`);
  }

  const uniqueSources = new Set(sources.filter(Boolean));
  const source = uniqueSources.size === 0 ? "deterministic" : uniqueSources.size === 1 && uniqueSources.has("llm") ? "llm" : uniqueSources.has("llm") ? "partial" : "deterministic";

  const payload: Record<string, unknown> = {
    roleTitle,
    jobId,
    source,
    candidateCount: candidates.length,
    // Coverage bookkeeping so the modal can show "top N of M" instead of letting a
    // capped comparison read as full coverage, and diff the pool for staleness.
    totalCandidates,
    cap: GROUP_EVAL_CAP,
    capped: totalCandidates > GROUP_EVAL_CAP,
    // Every candidate label considered at eval time (pre-cap) — the modal diffs
    // this against the role's current pending entries to warn about pool drift.
    evaluatedLabels: allCandidates.map((c) => c.label),
    topPick: top ? { label: top.label, score: top.score, why: top.verdict || `Highest fit (${top.score}) in this role.` } : null,
    recommendedOrder: candidates.map((c) => c.label),
    candidates,
    differentiators,
    risks,
    summary: top
      ? `${candidates.length} candidate(s) for ${roleTitle}. Recommended lead: ${top.label} (fit ${top.score}). ${
          differentiators.length ? `Unique strengths: ${differentiators.join(", ")}. ` : ""
        }${risks.length ? `${risks.length} watch-out(s) flagged below.` : "No blocking risks flagged."}`
      : `No candidates to evaluate for ${roleTitle}.`,
  };

  saveGroupEval(roleKey, roleTitle, payload);
  return payload;
}
