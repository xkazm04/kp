// The two numbers the calendar integration had declared TWICE, now declared once.
//
// Both duplicates were the same value written in two files that never imported each
// other, which is the shape of a constant that drifts silently: free-busy.ts said an
// interview is 45 minutes and calendar-links.ts said the same thing under a different
// name, so a change to either half would have made kp block one length on the
// interviewer's calendar and offer another on the candidate's — the exact bug
// DEFAULT_DURATION_MIN was introduced to fix, one level up. Same for the 8-second bound:
// google-calendar.ts held the Calendar API calls to it while google-oauth.ts held the
// token calls to a separately-written copy, on a chain (`/schedule/<token>` → free/busy →
// refresh) whose bound is only as good as its weakest link.
//
// Deliberately dependency-free: `calendar-links.ts` is imported by CLIENT components, so
// anything this file pulls in would land in the browser bundle.

/** How long an interview is when nothing says otherwise. The one duration for the
 *  recruiter's calendar event, the candidate's .ics, the free/busy overlap window and the
 *  slot proposer — see calendar-links.ts's DEFAULT_DURATION_MIN and free-busy.ts. */
export const DEFAULT_INTERVIEW_MINUTES = 45;

/**
 * How long ANY single call to Google may take — Calendar API and OAuth alike.
 *
 * Load bearing on a PUBLIC path: a free/busy lookup refreshes the access token first, so
 * an unbounded token call is an unbounded `/schedule/<token>`. Node's fetch otherwise
 * falls back to undici's 300s header timeout, which is not a bound a candidate's booking
 * page can wear. "Degrade, never block" has to hold for the whole chain, not most of it.
 *
 * This is the per-ATTEMPT bound; a throttled call may spend it twice (edge-fetch.ts
 * retries once), plus the capped Retry-After wait between them.
 */
export const CALENDAR_TIMEOUT_MS = 8000;
