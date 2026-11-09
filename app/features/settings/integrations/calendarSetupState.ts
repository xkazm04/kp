// The guided Google Calendar setup's load state, as a pure rule. The setup needs the
// status read to show the exact redirect address the owner must register at Google
// (step 4) and the two scopes (step 3); without it those steps render empty and the
// form still looks usable, so a failed read must be said out loud, not swallowed.

export type CalendarSetupLoad = "loading" | "ready" | "failed";

export function calendarSetupLoad(data: unknown, error: string | null): CalendarSetupLoad {
  if (error) return "failed";
  return data ? "ready" : "loading";
}
