// The JD library's load state, as a closed vocabulary rather than an inference
// from an array's length.
//
// The hook used to hold only `JdSummary[]`, start it at `[]`, and `.catch(() => {})`
// a failed fetch. Three genuinely different situations therefore reached the
// picker as the same empty array — still loading, the workspace really has no
// saved JDs, and the library request failed — and the picker rendered the middle
// one for all three: "No JDs saved. Save one for reuse." A recruiter whose
// library was briefly unreachable was told, flatly, that their JDs did not exist.
//
// The literal-array + derived-union + runtime-guard shape the repo uses for its
// other closed vocabularies (tabs.ts, i18n/locales.ts).

export const JD_LIBRARY_STATES = ["loading", "ready", "failed"] as const;
export type JdLibraryState = (typeof JD_LIBRARY_STATES)[number];

export function isJdLibraryState(value: unknown): value is JdLibraryState {
  return typeof value === "string" && (JD_LIBRARY_STATES as readonly string[]).includes(value);
}

/**
 * How many saved JDs the picker will hold. The list route caps its own query at
 * 200 rows (`listJds(200, ws)`), and this is the client's matching, STATED bound:
 * the previous `fetch("/api/jds")` took whatever arrived and rendered all of it
 * into one `<select>`, so the surface's size was a server-side constant nothing
 * on this side named. Applied by `boundJdLibrary` below, so an over-long payload
 * (a route change, a stale cache, a self-hosted fork that raised the cap) cannot
 * silently turn the picker into a thousand-row dropdown.
 */
export const JD_LIBRARY_LIMIT = 200;

/** The shape the hook exposes: never an ambiguous bare array. */
export type JdLibraryResult<T> = { state: JdLibraryState; jds: T[] };

/** Clamp a library payload to the stated limit, dropping the tail. */
export function boundJdLibrary<T>(jds: readonly T[]): T[] {
  return jds.length > JD_LIBRARY_LIMIT ? jds.slice(0, JD_LIBRARY_LIMIT) : [...jds];
}

/**
 * Read a `/api/jds` payload into the picker's state. A payload that is not
 * `{ jds: [...] }` is a FAILURE, not an empty library: the route answers with
 * `{ error, code }` on a store fault, and reading that as "you have no JDs" is
 * the same lie the bare `.catch(() => {})` told. Only a genuine array — empty or
 * not — becomes "ready".
 */
export function readJdLibraryPayload<T>(payload: unknown): JdLibraryResult<T> {
  const jds = (payload as { jds?: unknown } | null | undefined)?.jds;
  if (!Array.isArray(jds)) return { state: "failed", jds: [] };
  return { state: "ready", jds: boundJdLibrary(jds as T[]) };
}
