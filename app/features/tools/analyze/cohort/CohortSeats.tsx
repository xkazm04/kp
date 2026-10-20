"use client";

// The cap drawn as seats: COHORT_CAP of them, each filled by its tone (who sits there on the
// tray; how far each member got during a run), the rest hollow. One accessible name for the
// whole strip — the caller states the count in words; the seats themselves are decoration.
import { COHORT_CAP } from "./cohortTypes";

export type SeatTone = "applicant" | "matched" | "added" | "queued" | "analyzing" | "reused" | "done" | "failed";

export function CohortSeats({ seats, label, cap = COHORT_CAP }: { seats: ReadonlyArray<{ key: string; tone: SeatTone }>; label: string; cap?: number }) {
  const empty = Math.max(0, cap - seats.length);
  return (
    <div className="cs-seats" role="img" aria-label={label}>
      {seats.map((s) => (
        <span key={s.key} className="cs-seat" data-tone={s.tone} aria-hidden />
      ))}
      {Array.from({ length: empty }, (_, i) => (
        <span key={`empty-${i}`} className="cs-seat" data-tone="empty" aria-hidden />
      ))}
    </div>
  );
}

/** One seat as a legend key, beside its word. */
export function SeatKey({ tone, children }: { tone: SeatTone; children: React.ReactNode }) {
  return (
    <span className="cs-key text-micro text-steel">
      <span className="cs-seat" data-tone={tone} aria-hidden />
      {children}
    </span>
  );
}
