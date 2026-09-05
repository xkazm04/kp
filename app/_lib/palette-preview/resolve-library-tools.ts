// Palette preview resolvers — LIBRARY (Jobs, Job descriptions) and TOOLS
// (Archetypes, Analyze, Interview sim, Assignments). Cheap reads; the archetype
// registry is the one async read (a JSON file), so this module's dispatcher entry
// is async too.
import type { AttentionCounts } from "@/app/_lib/attention";
import { listArchetypes } from "@/app/_lib/archetype-registry";
import { listAnalyses } from "@/app/_lib/db/analyses";
import { countSubmissions, listDevCases, listPostings } from "@/app/_lib/db/devcase";
import { isInterviewSessionLive, listRecentInterviewSessions } from "@/app/_lib/db/interviews";
import { jdLibraryStats, jobStats } from "@/app/_lib/db/jobs";
import { countMatrixProfiles, listProfiles } from "@/app/_lib/db/profiles";
import { listTemplates } from "@/app/_lib/templates-store";
import type { PalettePreview } from "./types";

/** Top-N of a name → count map, descending, ties by name. */
function topOf(counts: Record<string, number>, n: number): { name: string; count: number }[] {
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, n);
}

export function resolveJobs(ws: string, attention: AttentionCounts): PalettePreview {
  const stats = jobStats(ws);
  return { view: "jobs", total: stats.total, draft: attention.jobs, entryEligible: stats.entryEligible, families: topOf(stats.byRoleFamily, 3) };
}

export function resolveLibrary(ws: string): PalettePreview {
  // Every figure here is a claim about the WHOLE library, so it comes from the
  // unbounded count, not from a page. This read used to fold `listJds(200, ws)` in
  // JS and report `jds.length` as `total`: a team with 240 saved JDs was shown
  // "200", and its analyzing/failed tallies stopped at whatever fell inside the
  // slice — a page's size presented as a library total, in the one surface whose
  // entire job is to preview how big things are.
  const { total, analyzing, failed, newest } = jdLibraryStats(ws);
  return { view: "library", total, analyzing, failed, templates: listTemplates(ws).templates.length, newest };
}

export async function resolveArchetypes(ws: string): Promise<PalettePreview> {
  let archetypes = 0;
  try {
    archetypes = (await listArchetypes()).length;
  } catch {
    archetypes = 0; // registry unreadable — the roster facts still stand
  }
  const counts: Record<string, number> = {};
  for (const p of listProfiles(500, ws)) if (p.archetype) counts[p.archetype] = (counts[p.archetype] ?? 0) + 1;
  return { view: "archetypes", archetypes, candidates: countMatrixProfiles(ws), top: topOf(counts, 3) };
}

export function resolveAnalyze(ws: string): PalettePreview {
  const rows = listAnalyses(200, ws);
  const scored = rows.filter((r) => typeof r.score === "number") as { score: number }[];
  const avgScore = scored.length ? Math.round(scored.reduce((a, r) => a + r.score, 0) / scored.length) : null;
  const first = rows[0]; // listAnalyses is newest-first
  return {
    view: "analyze",
    analyses: rows.length,
    avgScore,
    latest: first ? { label: first.candidate_label || first.slug, score: first.score, createdAt: first.created_at } : null,
  };
}

export function resolveInterview(ws: string): PalettePreview {
  const sessions = listRecentInterviewSessions(ws, 200);
  let completed = 0;
  let live = 0;
  for (const s of sessions) {
    if (s.status === "completed") completed += 1;
    if (isInterviewSessionLive({ status: s.status, createdAt: s.createdAt, updatedAt: s.startedAt ?? null })) live += 1;
  }
  const first = sessions[0];
  return {
    view: "interview",
    sessions: sessions.length,
    completed,
    live,
    latest: first ? { candidate: first.candidateLabel ?? "—", status: first.status, createdAt: first.createdAt } : null,
  };
}

export function resolveAssignments(ws: string): PalettePreview {
  return {
    view: "assignments",
    cases: listDevCases(200, ws).length,
    postings: listPostings(ws).length,
    submissions: countSubmissions(ws),
  };
}
