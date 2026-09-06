// The wire format for a reason a WRITER records and a READER renders in their own
// language. `reason:<code>` already existed — automation-run.ts writes it for the
// offer_auto_extended event and pipelineEventCatalog.ts resolves it through
// `pipeline.eventReasons`. This module is that format, lifted out and given the one
// thing it could not express: PARAMS.
//
// Why it needed them. The lead intake's two reader-facing strings were English
// sentences built by interpolation — "boards webhook lead — profile pending enrichment"
// and "repeat application via boards webhook" — so a Czech recruiter read English, and a
// codeless string cannot be re-rendered later either. A bare code cannot replace them,
// because the interesting half IS the interpolated part (which channel, what the repeat
// contributed). Hence `reason:<code>:<json>`.
//
// Format, deliberately narrow:
//
//   reason:leadPending                      — no params (the pre-existing shape)
//   reason:leadPending:{"channel":"boards"} — params as a flat JSON object of strings
//
// The code is `[A-Za-z]+` so it can never contain the separator, and the params are the
// whole remainder — so a value carrying `:` or `}` round-trips through JSON.parse without
// any escaping rules of our own.
//
// RECORD vs SCREEN. The stored token is the record; the catalog is the screen. Legacy
// rows (English prose, or a machine handle like a rematch counterpart id) do not match
// the prefix, parse to `null`, and fall through to whatever rendering they had — which is
// what makes adopting a code a non-migration.
//
// Pure and dependency-free ON PURPOSE: the writers open SQLite and the renderers are
// client components, so this is the only file both sides can share.

/** The prefix a coded detail starts with. */
export const CODED_REASON_PREFIX = "reason:";

export type CodedReason = { code: string; params: Record<string, string> };

/** Codes are letters only — no separator, no locale, no punctuation to escape. */
const CODE_RE = /^[A-Za-z]+$/;

/**
 * Encode one reason. Params are stringified as a flat object; a value that is not a
 * string is coerced, because this is a WIRE format and a reader can only interpolate
 * text. Passing no params (or an empty object) yields the bare `reason:<code>` shape, so
 * the existing writers' output is unchanged.
 */
export function codedReasonDetail(code: string, params?: Record<string, string | number>): string {
  if (!CODE_RE.test(code)) throw new Error(`coded-reason: "${code}" is not a valid reason code`);
  const entries = Object.entries(params ?? {});
  if (entries.length === 0) return `${CODED_REASON_PREFIX}${code}`;
  const flat: Record<string, string> = {};
  for (const [k, v] of entries) flat[k] = String(v);
  return `${CODED_REASON_PREFIX}${code}:${JSON.stringify(flat)}`;
}

/**
 * Decode a stored detail, or `null` when it is not one of ours — an English sentence, a
 * machine handle, an empty value, a code with characters codes cannot have, or params
 * that are not a flat JSON object. Every one of those falls back to legacy rendering
 * rather than throwing: a reader must never fail on a row a future build wrote.
 */
export function parseCodedReason(detail: string | null | undefined): CodedReason | null {
  if (!detail || !detail.startsWith(CODED_REASON_PREFIX)) return null;
  const rest = detail.slice(CODED_REASON_PREFIX.length);
  const split = rest.indexOf(":");
  const code = (split < 0 ? rest : rest.slice(0, split)).trim();
  if (!CODE_RE.test(code)) return null;
  if (split < 0) return { code, params: {} };

  let raw: unknown;
  try {
    raw = JSON.parse(rest.slice(split + 1));
  } catch {
    // A malformed params blob is not worth losing the whole row over, but it IS worth
    // knowing about — the code alone still renders, so the reader sees a real sentence.
    return { code, params: {} };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { code, params: {} };
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") params[k] = String(v);
  }
  return { code, params };
}
