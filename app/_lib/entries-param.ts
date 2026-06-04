// Shared guard for the comma-separated `entries=` batch param used by the
// interview status / prepared routes (idea-191ccc0c).
//
// Both /api/interview-prep?entries=… and /api/interview/by-entry?entries=… build
// an `IN (?,?,…)` with one bound variable per id. Past SQLite's
// SQLITE_MAX_VARIABLE_NUMBER (999 on older builds, 32766 on modern better-sqlite3)
// the prepared statement throws and the route 500s; a crafted request with tens
// of thousands of ids is also a cheap amplification/DoS vector. So we
//   (a) trim oversized input at the route boundary (parseEntriesParam), and
//   (b) chunk the IN query below the conservative limit (chunk + SQL_IN_CHUNK),
// which is defence-in-depth: even an internal caller that skips the route guard
// can never trip the variable limit. The Schedule board realistically holds
// dozens of pending entries, so the cap only bites adversarial/pathological input.

/** Hard cap on accepted entry ids per batch request (anti-amplification trim). */
export const MAX_ENTRIES_BATCH = 500;

/** Chunk size for `IN (…)` queries — kept well below the 999-variable floor of
 *  older SQLite builds so a batched read never trips SQLITE_MAX_VARIABLE_NUMBER. */
export const SQL_IN_CHUNK = 400;

/** Parse the `entries=a,b,c` param: split, trim, drop blanks, de-dupe, then cap to
 *  {@link MAX_ENTRIES_BATCH}. Over-cap input is trimmed (and logged) rather than
 *  rejected, so a legitimate-but-wide board still gets a partial answer for the
 *  first N entries instead of a hard 400/500. */
export function parseEntriesParam(raw: string | null | undefined): string[] {
  const ids = Array.from(
    new Set(
      (raw ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );
  if (ids.length > MAX_ENTRIES_BATCH) {
    console.warn(`[entries] trimming batch from ${ids.length} to ${MAX_ENTRIES_BATCH} ids`);
    return ids.slice(0, MAX_ENTRIES_BATCH);
  }
  return ids;
}

/** Split an array into chunks of at most `size` (used to bound `IN (…)` width). */
export function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return arr.length ? [arr] : [];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
