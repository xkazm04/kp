// Candidate-facing timezone awareness for self-scheduling (idea-b51106df).
//
// Slots are absolute instants (ISO `slot_at`); use-slot-label.ts already renders
// them in the candidate's BROWSER-local zone (Intl with no `timeZone` uses the
// runtime zone) — but with NO zone indicator a remote candidate sees a shifted
// "16:00" with no way to know it isn't the recruiter's "16:00". These pure
// helpers surface the zone so the booking reads as "16:00 (GMT+2)" in the
// candidate's own time, and let the confirm capture the candidate's IANA zone so
// the recruiter side can show where the candidate actually is. Pure + injectable
// (locale + optional timeZone) so the label derivation is unit-testable, mirroring
// schedule-slots.ts / interview-reminder-policy.ts.

/** The current environment's IANA timezone (e.g. "Europe/Prague"), or "" when it
 *  can't be resolved. Client-only in practice (the candidate's browser), but safe
 *  to call anywhere. */
export function resolveTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

/** A stored IANA zone is only trustworthy if the runtime still recognizes it —
 *  guard before persisting/formatting so a spoofed or stale body value can't make
 *  Intl throw downstream. Returns the zone when valid, else "". */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) return false;
  try {
    // Intl throws RangeError on an unknown time zone.
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Short zone label for an instant, e.g. "GMT+2" / "EST" (ICU-dependent), in the
 *  given locale and optional explicit zone (defaults to the runtime zone). Pure —
 *  returns "" for an unparsable instant or an invalid zone so a caller never
 *  renders "Invalid Date" or throws. */
export function timeZoneShortLabel(
  iso: string | null | undefined,
  locale: string,
  timeZone?: string | null
): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const zone = timeZone && isValidTimeZone(timeZone) ? timeZone : undefined;
  try {
    const parts = new Intl.DateTimeFormat(locale, {
      timeZone: zone,
      timeZoneName: "short",
      hour: "2-digit",
    }).formatToParts(new Date(ms));
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}
