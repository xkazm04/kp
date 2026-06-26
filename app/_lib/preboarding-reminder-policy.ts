// Pre-boarding reminder policy (candidate-onboarding-hand-off #3). On accept the
// candidate is emailed their /onboarding/{token} link once (dispatchOnboarding),
// but the window between accept and day-one is exactly when ghosting happens — and
// a questionnaire that's one-click-reachable, once, with no resend means most hires
// never complete it and the recruiter's hire record stays empty. This is the single
// nudge that fires if the pre-boarding intake is still unsubmitted after a delay.
//
// Pure + injectable (no DB / no clock), mirroring offer-policy.ts /
// interview-reminder-policy.ts, so the cadence is unit-testable and the heartbeat
// sweep (preboarding-reminders.ts) just consults it.

const DAY_MS = 86_400_000;

/** Days after the onboarding run starts (≈ the accept) before the single
 *  unsubmitted-intake nudge fires. Configurable for a deployment whose pre-boarding
 *  window differs, validated to a sane 1..30 days; defaults to 3 (long enough not to
 *  nag a candidate still reading the welcome, short enough to catch the drop-off). */
export function preboardingReminderDelayMs(): number {
  const raw = Number(process.env.KP_PREBOARDING_REMINDER_DAYS);
  const days = Number.isFinite(raw) && raw >= 1 && raw <= 30 ? Math.floor(raw) : 3;
  return days * DAY_MS;
}

export const PREBOARDING_REMINDER_DELAY_MS = preboardingReminderDelayMs();

/** The ISO cutoff: runs started at or before this are old enough to remind. The
 *  sweep uses it as the SQL bound so it never loads not-yet-due runs. */
export function preboardingReminderCutoffIso(nowMs: number, delayMs: number = PREBOARDING_REMINDER_DELAY_MS): string {
  return new Date(nowMs - delayMs).toISOString();
}

/** Whether a run is due its one pre-boarding nudge: the intake is still unsubmitted,
 *  no reminder was sent before, and the run has aged past the delay. A missing/invalid
 *  start never reminds (fail-closed — better a missed nudge than a spurious one on a
 *  candidate-facing channel). */
export function isPreboardingReminderDue(
  startedAtIso: string | null | undefined,
  opts: { intakeSubmitted: boolean; remindedAt?: string | null; nowMs?: number; delayMs?: number }
): boolean {
  if (opts.intakeSubmitted) return false;
  if (opts.remindedAt) return false;
  if (!startedAtIso) return false;
  const startedMs = Date.parse(startedAtIso);
  if (!Number.isFinite(startedMs)) return false;
  const nowMs = opts.nowMs ?? Date.now();
  const delayMs = opts.delayMs ?? PREBOARDING_REMINDER_DELAY_MS;
  return nowMs >= startedMs + delayMs;
}
