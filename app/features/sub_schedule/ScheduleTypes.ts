export type SchedEntry = {
  id: string;
  candidateId: string | null;
  candidateLabel: string;
  archetype: string | null;
  jobId: string | null;
  jobTitle: string | null;
  stage: string;
  matchScore: number | null;
  status: string;
  approvalKind: string | null;
  approvalDetail: string | null;
};

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
// Full working day, hourly (08:00–17:00). Covers the server-proposed slots
// (schedule-store proposes within this window) so a proposed chip always lands
// on a visible row.
export const TIMES = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00"];
export const DEFAULT_SLOT = "Tue 14:00";

export const ARCHETYPE = {
  bau: { label: "Experienced", bg: "bg-steel" },
  student: { label: "Student", bg: "bg-coral" },
  career_switcher: { label: "Switcher", bg: "bg-moss" },
} as const;
export const styleFor = (a: string | null) => ARCHETYPE[(a as keyof typeof ARCHETYPE) ?? "bau"] ?? ARCHETYPE.bau;
