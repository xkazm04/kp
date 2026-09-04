// The load-bearing JD<->Job identity contract: a saved JD with slug `<slug>` maps
// to the matchable Job row id `jd-<slug>` (getJob, the /apply/<id> CTA, the
// analyses sidebar, the status lookup and the re-ingest path all line up on this).
// Single-sourced here so the prefix (or any future encoding) lives in one place
// instead of being hand-interpolated at every call site. Documented in
// docs/features/jobs/README.md.
export const jdJobId = (slug: string): string => `jd-${slug}`;

/** The inverse of `jdJobId`: the JD slug a job id encodes, or null when the job
 *  is not JD-backed (a seeded/ingested corpus job). Callers joining a pipeline
 *  entry to its analyses (the canonical match-score resolver, the lifecycle
 *  strip) must use this instead of hand-slicing the prefix. */
export const jdSlugOfJobId = (jobId: string | null | undefined): string | null =>
  jobId && jobId.startsWith("jd-") ? jobId.slice(3) : null;

// Length caps for saved JDs, enforced on both the client (JdBuilder's "Save as
// draft") and the server (POST /api/jds) so the form and the write trust boundary always
// agree. Bounding length at the write boundary stops unbounded storage growth
// and the downstream render/transfer cost of giant rows.
export const JD_TITLE_MAX_LENGTH = 200;
export const JD_BODY_MAX_LENGTH = 20000;

// The minimum-need contract for the AI JD builder. The builder fans a free-text
// need into a 1–2 minute AI need→design chain, so a title that is barely a word
// or a need that is barely a phrase burns that whole run on empty input. These
// were once undocumented client-only thresholds buried in JdBuilder
// (`title.trim().length > 1 && needText.trim().length > 10`), which a deep-link
// /simulation prefill (the jd* query params) or any programmatic startTask could
// bypass entirely. Naming them here lets the form gate AND the runJdBuild
// boundary enforce the same contract. Inclusive minimums: length must be >= the
// value (so >= 2 ⟺ the old `> 1`, and >= 11 ⟺ the old `> 10`).
export const JD_BUILD_TITLE_MIN_LENGTH = 2;
export const JD_BUILD_NEED_MIN_LENGTH = 11;

/** Why a JD's title/body was rejected. A CODE, not a sentence: the `error` string
 *  below is canonical English written for the server log and for API consumers,
 *  and the client resolves the code through the shared `errors` catalog in the
 *  reader's language (app/_lib/use-error-message.ts). Before this the builder's
 *  "Save as draft" banner printed this module's English verbatim into a cs/de/fr
 *  workspace. The catalog messages mirror JD_TITLE_MAX_LENGTH / JD_BODY_MAX_LENGTH
 *  as literals — change a cap here and the four `errors.JD_*` strings change with it. */
export type JdFieldsErrorCode = "JD_FIELDS_REQUIRED" | "JD_TITLE_TOO_LONG" | "JD_BODY_TOO_LONG";

export type JdFieldsResult =
  | { ok: true; title: string; body: string }
  | { ok: false; error: string; code: JdFieldsErrorCode };

/** Required-and-length validation for a JD's title/body — the single source for
 *  both the bounds AND the exact error wording. Called by the write boundary
 *  (POST /api/jds, POST /api/jds/save) and the client form (JdBuilder's "Save as
 *  draft") so the three can't drift on caps, messages, or trimming. Returns the trimmed/normalized
 *  fields on success, or one user-facing error message. Accepts `unknown` so a raw
 *  request field can be passed without re-implementing the string type guard. */
export function validateJdFields(title: unknown, body: unknown): JdFieldsResult {
  const t = typeof title === "string" ? title.trim() : "";
  const b = typeof body === "string" ? body.trim() : "";
  if (!t || !b) return { ok: false, error: "Title and body are both required.", code: "JD_FIELDS_REQUIRED" };
  if (t.length > JD_TITLE_MAX_LENGTH) {
    return { ok: false, error: `Title must be ${JD_TITLE_MAX_LENGTH} characters or fewer.`, code: "JD_TITLE_TOO_LONG" };
  }
  if (b.length > JD_BODY_MAX_LENGTH) {
    return { ok: false, error: `Body must be ${JD_BODY_MAX_LENGTH.toLocaleString("en-US")} characters or fewer.`, code: "JD_BODY_TOO_LONG" };
  }
  return { ok: true, title: t, body: b };
}

export type JdBuildInputResult =
  | { ok: true; title: string; needText: string }
  | { ok: false; error: string };

/** Minimum-need validation for the AI JD builder — the single source for both
 *  the thresholds (JD_BUILD_*_MIN_LENGTH) AND the exact error wording, shared by
 *  the client gate (JdBuilder.canGenerate) and the server boundary (runJdBuild)
 *  so a non-form entry path can't feed a near-empty need into the AI chain.
 *  Returns the trimmed title/needText on success, or one user-facing error.
 *  Accepts `unknown` so raw task params can be validated without re-implementing
 *  the string type guard. */
export function validateJdBuildInput(title: unknown, needText: unknown): JdBuildInputResult {
  const t = typeof title === "string" ? title.trim() : "";
  const n = typeof needText === "string" ? needText.trim() : "";
  if (t.length < JD_BUILD_TITLE_MIN_LENGTH) {
    return { ok: false, error: `Role title must be at least ${JD_BUILD_TITLE_MIN_LENGTH} characters.` };
  }
  if (n.length < JD_BUILD_NEED_MIN_LENGTH) {
    return { ok: false, error: `Describe the need in at least ${JD_BUILD_NEED_MIN_LENGTH} characters so the AI has something to design from.` };
  }
  return { ok: true, title: t, needText: n };
}
