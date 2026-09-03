// The aging-SLA override's range, stated ONCE (/perfect 2026-09-03, pipeline-board-3).
//
// PipelineSlaEditor declared [1, 365] on its `<input type="number">` and then did
// not enforce it: `parseInt(ev.target.value, 10)` went straight to the store, which
// accepted any positive number. A native number input's min/max are advisory —
// they style the field, they do not stop a paste, an arrow-key overshoot or a
// programmatic set — so a typed 5000 persisted to localStorage and silenced that
// column's amber aging dot for fourteen years, with the field showing the honest
// 5000 and nothing saying it was out of range.
//
// Pure, so the node runner loads it directly (pipelineSla.test.ts).

/** The smallest cadence the board can express: it ages in whole days. */
export const SLA_MIN_DAYS = 1;
/** A year. Past this an "SLA" is not a cadence, it is the absence of one — and the
 *  honest way to say that is to clear the override, not to type a bigger number. */
export const SLA_MAX_DAYS = 365;

/**
 * Parse an SLA field's raw text into a storable override.
 *
 * Returns `null` for "clear this override, fall back to the stage ROLE's default"
 * — empty, blank, unparseable, zero or negative. Anything else is rounded to whole
 * days and clamped into [SLA_MIN_DAYS, SLA_MAX_DAYS], so the value that persists is
 * always one the aging chip will actually honor.
 */
export function clampSlaDays(raw: string): number | null {
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(SLA_MIN_DAYS, Math.min(SLA_MAX_DAYS, Math.round(n)));
}
