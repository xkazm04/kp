// Length caps for saved JDs, enforced on both the client (LibraryJdForm) and
// the server (POST /api/jds) so the form and the write trust boundary always
// agree. Bounding length at the write boundary stops unbounded storage growth
// and the downstream render/transfer cost of giant rows.
export const JD_TITLE_MAX_LENGTH = 200;
export const JD_BODY_MAX_LENGTH = 20000;

export type JdFieldsResult =
  | { ok: true; title: string; body: string }
  | { ok: false; error: string };

/** Required-and-length validation for a JD's title/body — the single source for
 *  both the bounds AND the exact error wording. Called by the write boundary
 *  (POST /api/jds, POST /api/jds/save) and the client form (LibraryJdForm) so the
 *  three can't drift on caps, messages, or trimming. Returns the trimmed/normalized
 *  fields on success, or one user-facing error message. Accepts `unknown` so a raw
 *  request field can be passed without re-implementing the string type guard. */
export function validateJdFields(title: unknown, body: unknown): JdFieldsResult {
  const t = typeof title === "string" ? title.trim() : "";
  const b = typeof body === "string" ? body.trim() : "";
  if (!t || !b) return { ok: false, error: "Title and body are both required." };
  if (t.length > JD_TITLE_MAX_LENGTH) {
    return { ok: false, error: `Title must be ${JD_TITLE_MAX_LENGTH} characters or fewer.` };
  }
  if (b.length > JD_BODY_MAX_LENGTH) {
    return { ok: false, error: `Body must be ${JD_BODY_MAX_LENGTH.toLocaleString("en-US")} characters or fewer.` };
  }
  return { ok: true, title: t, body: b };
}
