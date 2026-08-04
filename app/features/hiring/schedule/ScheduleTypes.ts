export type SchedEntry = {
  id: string;
  candidateId: string | null;
  candidateLabel: string;
  archetype: string | null;
  // P2-3 — drives the appended industry rubric axes in the human scorecard.
  roleFamily: string | null;
  jobId: string | null;
  jobTitle: string | null;
  stage: string;
  matchScore: number | null;
  status: string;
  approvalKind: string | null;
  approvalDetail: string | null;
};

// The grid's day columns are now CONCRETE dates (scheduleGridWeeks) and its hour rows
// are DERIVED from the configured interview hours + the proposal window + any real
// booking's hour (interviewGridRows in schedule-slots) — never a hardcoded 08:00–17:00
// band, which silently dropped a booking at a KP_INTERVIEW_TIMES hour outside it.
// DEFAULT_SLOT stays as the weekday-relative seed for a legacy entry with no invite;
// ScheduleTab resolves it to a concrete upcoming date for the dated grid.
//
// NOT COPY, and deliberately English: this is a PARSING PIVOT. `weekdayToDateSlot`
// feeds it to gridSlotToIso, which reads the same fixed `Ddd HH:MM` grammar the
// legacy `approvalDetail` column stores — the same reason schedule-slots.ts and
// timezone.ts pin "en-US" (docs/architecture/localization.md). It never reaches a
// screen: the grid resolves it to a real date, and slotLabel formats THAT in the
// reader's locale. Localizing the token would break the parse it exists for.
export const DEFAULT_SLOT = "Tue 14:00";

export const ARCHETYPE = {
  bau: { label: "Experienced", bg: "bg-steel" },
  student: { label: "Student", bg: "bg-coral" },
  career_switcher: { label: "Switcher", bg: "bg-moss" },
} as const;
export const styleFor = (a: string | null) => ARCHETYPE[(a as keyof typeof ARCHETYPE) ?? "bau"] ?? ARCHETYPE.bau;
