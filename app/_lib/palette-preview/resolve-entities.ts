// Palette preview resolvers — ENTITY hits (a candidate profile, a pipeline entry,
// a role, a saved JD, a CV analysis). One indexed read each plus the one cheap
// aggregate that answers "how is it going" (placements / pipeline stats). The
// analysis view replicates /api/analyses/[slug]'s PII rule: a candidate whose
// consent has lapsed or who was anonymized is shown masked, never by name.
import { countAnalysesByJd, loadAnalysis } from "@/app/_lib/db/analyses";
import { getJob, jobVisibleToWorkspace, loadJd } from "@/app/_lib/db/jobs";
import { candidateLabelWithholdsPii, getPipelineEntry, listJobPipelineStats, listPipeline } from "@/app/_lib/db/pipeline";
import { getProfileRecord } from "@/app/_lib/db/profiles";
import { maskCandidateName } from "@/app/_lib/consent";
import { getPipelineAxis } from "@/app/_lib/pipeline-axis-server";
import { withCanonicalScoresCached } from "@/app/_lib/pipeline-score-cache";
import { listScheduleInvitesForEntry } from "@/app/_lib/schedule-store";
import type { EntityKind, PalettePreview } from "./types";

const MISSING: PalettePreview = { view: "missing" };

/** Stage id → the workspace's column label (retired stages still resolve). */
function stageLabeller(ws: string): (id: string) => string {
  const axis = getPipelineAxis(ws);
  const map = new Map([...axis.stages, ...axis.retired].map((s) => [s.id, s.label]));
  return (id) => map.get(id) ?? id;
}

export function resolveEntity(kind: EntityKind, id: string, ws: string): PalettePreview {
  switch (kind) {
    case "profile":
      return resolveProfile(id, ws);
    case "entry":
      return resolveEntry(id, ws);
    case "job":
      return resolveJob(id, ws);
    case "jd":
      return resolveJd(id, ws);
    case "analysis":
      return resolveAnalysis(id, ws);
  }
}

function resolveProfile(id: string, ws: string): PalettePreview {
  const rec = getProfileRecord(id, ws);
  if (!rec) return MISSING;
  const label = stageLabeller(ws);
  const placements = listPipeline(ws)
    .filter((e) => e.candidateId === id)
    .slice(0, 3)
    .map((e) => ({ jobTitle: e.jobTitle ?? "—", stage: label(e.stage) }));
  return {
    view: "profile",
    label: rec.row.label,
    archetype: rec.row.archetype,
    roleFamily: rec.row.role_family,
    completeness: rec.row.completeness,
    createdAt: rec.row.created_at,
    placements,
  };
}

function resolveEntry(id: string, ws: string): PalettePreview {
  const entry = getPipelineEntry(id, ws);
  if (!entry) return MISSING;
  // Same canonical score the board renders (precedence + provenance), so the
  // preview never disagrees with the row the recruiter is about to open.
  const [scored] = withCanonicalScoresCached([entry], ws);
  const invites = listScheduleInvitesForEntry(id, ws);
  const open = invites.find((i) => i.status === "confirmed") ?? invites.find((i) => i.status === "pending") ?? null;
  return {
    view: "entry",
    candidate: entry.candidateLabel,
    jobTitle: entry.jobTitle,
    stage: stageLabeller(ws)(entry.stage),
    matchScore: scored?.canonicalScore ?? entry.matchScore ?? null,
    stageChangedAt: entry.stageChangedAt ?? null,
    source: entry.sourceChannel ?? null,
    approvalKind: entry.approvalKind ?? null,
    nextInvite: open ? { status: open.status, slot: open.slot } : null,
  };
}

function resolveJob(id: string, ws: string): PalettePreview {
  if (!jobVisibleToWorkspace(id, ws)) return MISSING;
  const job = getJob(id);
  if (!job) return MISSING;
  const stats = listJobPipelineStats(ws)[id] ?? { total: 0, reachedInterview: 0, hired: 0 };
  return {
    view: "job",
    title: job.title,
    company: job.company ?? null,
    location: job.location ?? null,
    seniority: job.seniority ?? null,
    status: job.status ?? null,
    ...stats,
  };
}

function resolveJd(slug: string, ws: string): PalettePreview {
  const jd = loadJd(slug, ws);
  if (!jd) return MISSING;
  return {
    view: "jd",
    title: jd.title,
    createdAt: jd.created_at,
    analysisStatus: jd.analysis_status ?? null,
    analyses: countAnalysesByJd(ws)[slug] ?? 0,
    words: jd.body ? jd.body.trim().split(/\s+/).length : 0,
  };
}

function resolveAnalysis(slug: string, ws: string): PalettePreview {
  const rec = loadAnalysis(slug, ws);
  if (!rec) return MISSING;
  const raw = rec.row.candidate_label;
  const label = raw && candidateLabelWithholdsPii(raw, ws) ? maskCandidateName(raw) : raw || slug;
  return {
    view: "analysis",
    label,
    score: rec.row.score,
    roleFamily: rec.row.role_family,
    seniority: rec.row.seniority,
    disposition: rec.row.disposition ?? null,
    createdAt: rec.row.created_at,
    jdSlug: rec.row.jd_slug,
  };
}
