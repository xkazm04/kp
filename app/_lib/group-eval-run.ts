import { getProfileRecord } from "./db";
import { runReasoning } from "./reasoning-run";
import { saveGroupEval } from "./group-eval";

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

const EARLY = new Set(["student", "career_switcher"]);

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
  const input = ((params.candidates as GroupEvalCandidate[]) ?? []).slice(0, 6);

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
    if (c.archetype && EARLY.has(c.archetype)) risks.push(`${c.label}: early-career — assess potential and trajectory, not only current skills.`);
    if (c.gaps.length) risks.push(`${c.label}: gaps in ${c.gaps.slice(0, 3).join(", ")}.`);
  }

  const uniqueSources = new Set(sources.filter(Boolean));
  const source = uniqueSources.size === 0 ? "deterministic" : uniqueSources.size === 1 && uniqueSources.has("llm") ? "llm" : uniqueSources.has("llm") ? "partial" : "deterministic";

  const payload: Record<string, unknown> = {
    roleTitle,
    jobId,
    source,
    candidateCount: candidates.length,
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
