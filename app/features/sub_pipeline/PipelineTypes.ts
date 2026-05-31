export type Entry = {
  id: string;
  candidateId: string | null;
  candidateLabel: string;
  archetype: string | null;
  roleFamily: string | null;
  jobId: string | null;
  jobTitle: string | null;
  stage: string;
  matchScore: number | null;
  status: string;
  approvalKind: string | null;
  approvalDetail: string | null;
  createdAt: string | null;
  stageChangedAt: string | null;
};

export type PipelineEvent = {
  id: number;
  candidateLabel: string | null;
  jobTitle: string | null;
  archetype: string | null;
  kind: string;
  toStage: string | null;
  detail: string | null;
  createdAt: string;
};

// "Accepted" = an inbound application received via a channel; "Sourced" = a
// proactively-sourced candidate. Both feed AI-matched. (Accepted isn't in
// db.ts's PIPELINE_STAGES, so actOnPipelineEntry advances it to Sourced via the
// linear indexOf fallback — intentional, and avoids editing the fork-active db.)
export const STAGES = ["Accepted", "Sourced", "AI-matched", "Screening", "Interview", "Offer", "Hired"];
export const STALE_DAYS = 10;

export function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

export function relativeTime(iso: string): string {
  const d = daysSince(iso);
  if (d == null) return "";
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

export const ARCHETYPE_STYLE: Record<string, { ring: string; bg: string; label: string }> = {
  bau: { ring: "ring-steel", bg: "bg-steel", label: "Experienced" },
  student: { ring: "ring-coral", bg: "bg-coral", label: "Student" },
  career_switcher: { ring: "ring-moss", bg: "bg-moss", label: "Switcher" },
};
export const styleFor = (a: string | null) => ARCHETYPE_STYLE[a ?? "bau"] ?? ARCHETYPE_STYLE.bau;
