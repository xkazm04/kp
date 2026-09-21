/** Live-call clock: elapsed mm:ss, plus remaining vs booked duration when known.
 *
 *  Remaining is `durationMin * 60 - elapsed`, clamped at 0. Lab/sim omit
 *  `durationMin`, so the clock stays elapsed-only. */
export function formatMmSs(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  return `${Math.floor(clamped / 60)}:${String(clamped % 60).padStart(2, "0")}`;
}

export function remainingSeconds(elapsed: number, durationMin: number | undefined): number | null {
  if (durationMin == null || !Number.isFinite(durationMin) || durationMin <= 0) return null;
  const spent = Number.isFinite(elapsed) ? elapsed : 0;
  return Math.max(0, durationMin * 60 - spent);
}

export function formatLiveClock(
  elapsed: number,
  durationMin?: number,
): { elapsed: string; remaining: string | null } {
  const left = remainingSeconds(elapsed, durationMin);
  return {
    elapsed: formatMmSs(elapsed),
    remaining: left === null ? null : formatMmSs(left),
  };
}
