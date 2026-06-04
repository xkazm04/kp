import { Briefcase, GraduationCap, Repeat, type LucideIcon } from "lucide-react";

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
  // Set when the application couldn't be normalized into a matchable profile and
  // is a label-only stub needing manual capture; reason holds the failure detail.
  intakeDegraded?: boolean;
  intakeDegradedReason?: string | null;
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

// Consolidated 5-stage board model (mirrors db.ts PIPELINE_STAGES). "Accepted"
// = CV received (inbound application OR proactively sourced), waiting to be
// screened; "Screened" = run through the first wave of evaluation (matching +
// AI screening). Must match db.ts; legacy stages are remapped on boot.
export const STAGES = ["Accepted", "Screened", "Interview", "Offer", "Hired"];

// One-line, new-user-friendly explanation of what each board stage represents,
// surfaced as the column-header tooltip so the funnel is self-explaining.
export const STAGE_HELP: Record<string, string> = {
  Accepted: "CV received — an inbound application or a proactively-sourced candidate, waiting to be screened.",
  Screened: "Run through the first wave of evaluation — matched and AI-screened; strong matches advance, the rest wait on a human decision.",
  Interview: "Interviewing — slot scheduling, AI voice screen, and scorecard.",
  Offer: "An offer is being drafted, reviewed, or sent.",
  Hired: "Offer accepted — candidate hired and onboarding.",
};

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

// ONE catalog of archetype presentation — label, fill (bg), focus ring, and glyph.
// Every archetype-styled surface (candidate row, drawer, legend, analytics) reads
// from this single source so a label/color/icon tweak lands in exactly one place
// instead of drifting across the copies that used to live in PipelineShared
// (ARCHETYPE_ICON) and CandidateDrawerTypes (ARCHETYPE). The glyph lets a surface
// read without relying on hue alone (mirrors Badge's icon-plus-label doctrine).
export type ArchetypeStyle = { label: string; bg: string; ring: string; icon: LucideIcon };

export const ARCHETYPE_STYLE: Record<string, ArchetypeStyle> = {
  bau: { label: "Experienced", bg: "bg-steel", ring: "ring-steel", icon: Briefcase },
  student: { label: "Student", bg: "bg-coral", ring: "ring-coral", icon: GraduationCap },
  career_switcher: { label: "Switcher", bg: "bg-moss", ring: "ring-moss", icon: Repeat },
};
export const styleFor = (a: string | null): ArchetypeStyle => ARCHETYPE_STYLE[a ?? "bau"] ?? ARCHETYPE_STYLE.bau;
