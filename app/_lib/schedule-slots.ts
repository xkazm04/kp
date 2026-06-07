// Slot proposal + validation for candidate self-scheduling — pure (no DB), so
// the trust-boundary decision is unit-testable (mirrors finalize-status.ts /
// preflight.ts). Extracted from schedule-store.ts when confirm-side validation
// landed (idea-e05aedfb), so proposal and validation share ONE derivation and
// can never drift.
//
// THE INVARIANT (idea-e05aedfb): a candidate-submitted booking is only ever
// persisted as a slot the server itself would have offered. The POST handler
// used to trust body.slot (display label) and body.slotAt (ISO) verbatim —
// letting a token holder book an out-of-hours/weekend/past time, and inject
// arbitrary text as the label, which is stored and rendered into confirmation
// and reminder EMAILS and the recruiter activity feed. Validation here is
// STRUCTURAL (future, ≤ window, business day, one of the offered times, exact
// minute) rather than membership in the current proposeSlots() page — stable
// across the midnight rollover of the proposal window — and the label is
// re-derived server-side from the validated time, never taken from the client.

const TIMES = ["10:00", "14:00"] as const;
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** How far out slots are offered (proposeSlots scans day+1..21; +1 day of slack
 *  so a slot loaded just before midnight stays confirmable after it). */
const MAX_SLOT_AHEAD_MS = 22 * 86_400_000;

/** The one canonical human label for a slot — proposal and validation both
 *  mint it here, so the stored label is always server-authored. */
function slotLabel(slot: Date, time: string): string {
  return `${DOW[slot.getDay()]} ${slot.getDate()} ${MON[slot.getMonth()]} · ${time}`;
}

/** Propose the next few business-day interview slots, skipping ones already
 *  taken (by ISO `value`, the same identity bookedSlots() returns). `value` is
 *  the slot's ISO datetime (used for timed reminders + collision checks);
 *  `label` is the human-readable time shown to the candidate. */
export function proposeSlots(taken: string[] = [], count = 6): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const takenSet = new Set(taken);
  const base = new Date();
  for (let day = 1; day <= 21 && out.length < count; day += 1) {
    const dt = new Date(base);
    dt.setDate(base.getDate() + day);
    const dow = dt.getDay();
    if (dow === 0 || dow === 6) continue; // skip weekends
    for (const t of TIMES) {
      const [h, m] = t.split(":").map(Number);
      const slot = new Date(dt);
      slot.setHours(h, m, 0, 0);
      const value = slot.toISOString();
      if (takenSet.has(value)) continue;
      out.push({ value, label: slotLabel(slot, t) });
      if (out.length >= count) break;
    }
  }
  return out;
}

/** Validate a candidate-submitted slot time and mint its canonical label, or
 *  null when it isn't a slot the server would offer: unparsable, in the past,
 *  beyond the proposal window, on a weekend, or not exactly one of the offered
 *  times (server-local, to the minute). `nowMs` is injectable for tests. */
export function offeredSlotFor(slotAtIso: unknown, nowMs: number = Date.now()): { value: string; label: string } | null {
  if (typeof slotAtIso !== "string" || slotAtIso.length === 0 || slotAtIso.length > 40) return null;
  const ms = Date.parse(slotAtIso);
  if (Number.isNaN(ms)) return null;
  if (ms <= nowMs || ms > nowMs + MAX_SLOT_AHEAD_MS) return null;
  const slot = new Date(ms);
  const dow = slot.getDay();
  if (dow === 0 || dow === 6) return null;
  const time = TIMES.find((t) => {
    const [h, m] = t.split(":").map(Number);
    return slot.getHours() === h && slot.getMinutes() === m && slot.getSeconds() === 0 && slot.getMilliseconds() === 0;
  });
  if (!time) return null;
  return { value: slot.toISOString(), label: slotLabel(slot, time) };
}
