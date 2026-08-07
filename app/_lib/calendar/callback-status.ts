// connect-the-integrations — the CANONICAL vocabulary of Google-Calendar OAuth
// callback outcomes.
//
// The callback route can only end a browser round trip by redirecting back into the
// workspace with `?calendar=<code>`; that code is the only thing the operator ever sees.
// It used to be nine bare string literals inside the route, which is exactly the shape
// that ships a UI catalog covering four of them and renders the other five as a blank
// screen (the 4-key/13-kind regression this repo has already paid for once).
//
// So the list lives here, the route's `back()` is typed against it — a new outcome is a
// COMPILE error until it is added — and integrationsCatalog.test.ts asserts every code in
// this array has a message in all four locales. Order is presentational only.

export const CALENDAR_CALLBACK_STATUSES = [
  /** Full grant stored. */
  "connected",
  /** Stored, but the user unticked a scope on Google's consent screen. */
  "connected_partial",
  /** The user pressed Cancel. Not an error. */
  "cancelled",
  /** Google returned an `error` other than access_denied. */
  "google_error",
  /** State cookie missing/forged/expired — the callback was refused. */
  "state_mismatch",
  /** Google redirected back without an authorization code. */
  "no_code",
  /** GOOGLE_OAUTH_CLIENT_ID/SECRET disappeared between start and callback. */
  "not_configured",
  /** Google withheld a refresh token, so the grant was deliberately NOT stored. */
  "no_refresh_token",
  /** The code→token exchange threw. */
  "exchange_failed",
] as const;

export type CalendarCallbackStatus = (typeof CALENDAR_CALLBACK_STATUSES)[number];

export function isCalendarCallbackStatus(value: string | null | undefined): value is CalendarCallbackStatus {
  return typeof value === "string" && (CALENDAR_CALLBACK_STATUSES as readonly string[]).includes(value);
}

/** How loudly to render an outcome. `warn` is its own tone on purpose: a partial grant is
 *  a working connection with a hole in it, and painting it green would hide the hole while
 *  painting it red would tell the operator to redo a connect that actually succeeded. */
export type CalendarCallbackTone = "ok" | "warn" | "error";

const TONES: Record<CalendarCallbackStatus, CalendarCallbackTone> = {
  connected: "ok",
  connected_partial: "warn",
  // Cancelling is a choice, not a fault — say what happened without an alarm color.
  cancelled: "warn",
  google_error: "error",
  state_mismatch: "error",
  no_code: "error",
  not_configured: "error",
  no_refresh_token: "error",
  exchange_failed: "error",
};

export function calendarCallbackTone(status: CalendarCallbackStatus): CalendarCallbackTone {
  return TONES[status];
}

/** The i18n key suffix for a Google Calendar scope URL — the last dotted segment of the
 *  last path segment ("…/auth/calendar.freebusy" → "freebusy"). Catalog keys cannot carry
 *  the raw URL (next-intl/flatten treat dots as nesting), and the slug is stable because
 *  it is derived, never hand-listed. */
export function calendarScopeSlug(scope: string): string {
  const last = scope.split("/").pop() ?? scope;
  return last.split(".").pop() ?? last;
}
