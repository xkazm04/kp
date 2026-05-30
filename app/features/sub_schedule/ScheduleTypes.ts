export type SchedEntry = {
  id: string;
  candidateId: string | null;
  candidateLabel: string;
  archetype: string | null;
  jobTitle: string | null;
  stage: string;
  matchScore: number | null;
  status: string;
  approvalKind: string | null;
  approvalDetail: string | null;
};

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
export const TIMES = ["09:00", "10:30", "11:00", "14:00", "15:30"];
export const DEFAULT_SLOT = "Tue 14:00";

export const ARCHETYPE = {
  bau: { label: "Experienced", bg: "bg-steel" },
  student: { label: "Student", bg: "bg-coral" },
  career_switcher: { label: "Switcher", bg: "bg-moss" },
} as const;
export const styleFor = (a: string | null) => ARCHETYPE[(a as keyof typeof ARCHETYPE) ?? "bau"] ?? ARCHETYPE.bau;

export const initialsOf = (label: string) =>
  label.split(" ").map((p) => p[0]).filter(Boolean).join("").slice(0, 2).toUpperCase();
