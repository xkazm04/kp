// Fold a Live Work Surface session-mint attempt into a refusal the page can paint.
//
// HTTP refusals (404 this link is not taking work, 429 the day's sessions are
// spent, 403) already setRefusal from the body code. A thrown fetch (offline,
// DNS, CORS) used to `catch { return null }` with no refusal, so the candidate
// kept typing into a surface that recorded nothing — the same silent-mint
// defect the coded path was written to kill. Both paths now produce a refusal:
// coded when the server sent one, otherwise `{ code: null, error: null }` so
// useErrorMessage falls through to the existing workSurface.error string.

export type MintRefusal = { code: string | null; error: string | null };

export type MintFoldInput =
  | { ok: true }
  | { ok: false; payload: { code?: string | null; error?: string | null } | null }
  | { networkError: true };

export function foldMintRefusal(input: MintFoldInput): MintRefusal | null {
  if ("networkError" in input) return { code: null, error: null };
  if (input.ok) return null;
  const code = input.payload?.code ?? null;
  // Never copy payload.error: that English log string is what i18n:check bans
  // from UI-adjacent modules, and useErrorMessage ignores it anyway.
  return { code: code || null, error: null };
}
