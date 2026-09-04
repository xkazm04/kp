// The reviewer's deepest evidence, shaped once.
//
// `GET /api/devcase/session/[id]` (workspace-authed) has returned the candidate's chat
// transcript and their submitted tree since the Live Work Surface shipped, and until now
// nothing called it: the feature doc listed "no reviewer surface renders the transcript
// or the file tree" as gap #1 while the route sat there, pinned by three tests. This
// module is the pure half of the reader — everything the panel needs to decide what to
// draw, with no React and no fetch, so it can be tested by node:test (this repo has no
// component-test harness; devcase-judge-independence.ts is the same shape).
//
// Two judgements live here rather than in the JSX:
//
//   1. EMPTY IS NOT ERROR, and the two empties differ. A session with no transcript and
//      no files is a candidate who opened the link and did nothing — worth saying plainly.
//      A session with files but no chat is ordinary (the chat is optional), so the panel
//      must not render an "empty" state over a real tree.
//   2. SIZE IS THE ONLY FILE METRIC we can state honestly. The route returns the file
//      CONTENTS, and a reviewer scanning for "did they actually write anything" reads
//      length before they read code. Bytes are measured here, not taken from
//      String.length, which counts UTF-16 code units and under-states every accented
//      character the four locales guarantee.

/** One transcript turn as the route serializes it (`getDevSessionChat`). */
export type EvidenceTurn = { seq: number; channel: string; role: "user" | "model"; text: string; createdAt: string };

/** The route's GET payload, as far as this reader cares. Deliberately loose at the
 *  seam: the panel hands over `await res.json()`, so every field is `unknown` until
 *  proven otherwise. */
export type SessionEvidencePayload = {
  session?: { id?: unknown; status?: unknown; candidateRef?: unknown; createdAt?: unknown; submittedAt?: unknown } | null;
  transcript?: unknown;
  files?: unknown;
} | null;

export type SessionEvidenceFileView = { path: string; bytes: number };

export type SessionEvidenceModel = {
  status: string | null;
  submittedAt: string | null;
  turns: EvidenceTurn[];
  files: SessionEvidenceFileView[];
  totalBytes: number;
  /** True only when there is NOTHING to show — no turn and no file. A tree with no
   *  chat is not empty; the chat is optional and always has been. */
  isEmpty: boolean;
};

const BYTES = new TextEncoder();

function toTurn(raw: unknown): EvidenceTurn | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.text !== "string") return null;
  return {
    seq: Number.isFinite(Number(r.seq)) ? Number(r.seq) : 0,
    channel: typeof r.channel === "string" ? r.channel : "default",
    // The store writes only "user"/"model"; anything else is a corrupt row and reads
    // as the candidate's own words rather than being dropped, so evidence is never
    // silently withheld from the reviewer.
    role: r.role === "model" ? "model" : "user",
    text: r.text,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
  };
}

function toFile(raw: unknown): SessionEvidenceFileView | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.path !== "string" || !r.path) return null;
  const contents = typeof r.contents === "string" ? r.contents : "";
  return { path: r.path, bytes: BYTES.encode(contents).length };
}

/** Shape one GET payload into what the panel renders. Total, never throwing: a
 *  malformed row is dropped, a malformed payload becomes an honest empty. */
export function sessionEvidenceModel(payload: SessionEvidencePayload): SessionEvidenceModel {
  const turns = (Array.isArray(payload?.transcript) ? payload.transcript : [])
    .map(toTurn)
    .filter((t): t is EvidenceTurn => t !== null)
    .sort((a, b) => a.seq - b.seq);
  const files = (Array.isArray(payload?.files) ? payload.files : [])
    .map(toFile)
    .filter((f): f is SessionEvidenceFileView => f !== null)
    .sort((a, b) => a.path.localeCompare(b.path));
  const s = payload?.session ?? null;
  return {
    status: typeof s?.status === "string" ? s.status : null,
    submittedAt: typeof s?.submittedAt === "string" ? s.submittedAt : null,
    turns,
    files,
    totalBytes: files.reduce((n, f) => n + f.bytes, 0),
    isEmpty: turns.length === 0 && files.length === 0,
  };
}

/** The work-session id a submission's `repoRef` carries, or null for a repo
 *  submission. `session:<id>` is the SAME encoding devcase-run.ts branches on
 *  (app/_lib/devcase-run.ts) — read in one place so the two cannot drift. */
export function sessionIdFromRepoRef(repoRef: string | null | undefined): string | null {
  if (typeof repoRef !== "string") return null;
  const id = repoRef.startsWith("session:") ? repoRef.slice("session:".length).trim() : "";
  return id || null;
}
