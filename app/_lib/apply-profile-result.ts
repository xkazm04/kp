// Trust boundary between the TS apply route and the Python `profile_cli`. The
// route hands the CLI an intake draft and reads back a normalized profile from its
// stdout JSON. `parsePythonJson` only guarantees the last stdout line is *some*
// JSON object/array — NOT the shape `profile_cli` promises. So an exit-0 CLI that
// drifts to `{}`, `{ "profile": null }`, or a partial object would otherwise either:
//   • throw a cryptic `Cannot read properties of undefined (reading 'roleFamily')`,
//     which the route catches and shows recruiters as the degraded reason, or
//   • persist a junk, non-matchable profile (empty payload, empty/non-string
//     archetype that slips past the `?? FALLBACK` guard, NaN completeness).
// This narrow runtime check turns that drift into a clear, diagnosable degraded
// reason and refuses to save a malformed payload. Pure (no DB, no I/O) so the
// contract is unit-testable directly — see apply-profile-result.test.ts.

/** The fields `buildApplicantProfile` consumes from `profile_cli`'s stdout JSON.
 *  Mirrors what profile_cli emits (profile_cli.py): a normalized profile object,
 *  a routed archetype id, a numeric completeness score, and the machine-readable
 *  unmet-checklist list. */
export type ProfileCliResult = {
  profile: Record<string, unknown>;
  archetype: string;
  completeness: number;
  /** profile_cli's `missingGaps` — the archetype checklist's unmet items, biggest
   *  gap first, as {check, label}. Was parsed off the CLI and silently DISCARDED
   *  here, which left the gap-question engine (completeness-followup.ts) reachable
   *  only from the recruiter's banner — never from the candidate, the one person
   *  who can answer. SOFT: a missing/malformed list degrades to [] rather than
   *  failing the build (it is an enrichment nicety, never a reason to demote an
   *  applicant to a non-matchable stub). */
  missingGaps: CompletenessGap[];
};

import type { CompletenessGap } from "./completeness-followup.ts";

// Bounds on the gap list read back from the CLI. It rides a DB column and a
// candidate-facing payload, so cap both the list and each field at the trust
// boundary rather than trusting the subprocess's output length.
const MAX_GAPS = 12;
const MAX_CHECK_LEN = 64;
const MAX_LABEL_LEN = 160;

/** Narrow profile_cli's `missingGaps` to well-formed {check,label} pairs. Never
 *  throws and never fails the validation — an absent/garbled list simply means
 *  "no follow-up questions to offer". */
export function coerceCompletenessGaps(value: unknown): CompletenessGap[] {
  if (!Array.isArray(value)) return [];
  const out: CompletenessGap[] = [];
  for (const item of value) {
    if (out.length >= MAX_GAPS) break;
    if (!isPlainObject(item)) continue;
    const check = typeof item.check === "string" ? item.check.trim() : "";
    const label = typeof item.label === "string" ? item.label.trim() : "";
    if (!check || check.length > MAX_CHECK_LEN) continue;
    out.push({ check, label: label.slice(0, MAX_LABEL_LEN) });
  }
  return out;
}

export type ProfileCliValidation =
  | { ok: true; value: ProfileCliResult }
  | { ok: false; reason: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A short, safe description of an unexpected value, for the degraded reason. */
function describe(v: unknown): string {
  if (v === undefined) return "nothing (field absent)";
  if (v === null) return "null";
  if (Array.isArray(v)) return "an array";
  return `a ${typeof v}`;
}

/** Validate `profile_cli`'s parsed stdout against the shape the route trusts.
 *  Returns the typed result on success, or a short human reason naming the first
 *  violation — suitable verbatim as a recruiter-visible degraded reason. */
export function validateProfileCliResult(data: unknown): ProfileCliValidation {
  if (!isPlainObject(data)) {
    return { ok: false, reason: `profile normalizer returned ${describe(data)}, expected an object` };
  }
  if (!isPlainObject(data.profile)) {
    return { ok: false, reason: `profile normalizer returned no profile object (got ${describe(data.profile)})` };
  }
  if (typeof data.archetype !== "string") {
    return { ok: false, reason: `profile normalizer returned a non-string archetype (got ${describe(data.archetype)})` };
  }
  // Reject an empty/blank archetype too: it is not a routable id, and being a
  // non-nullish string it slips past the route's `?? FALLBACK_ARCHETYPE` guard,
  // leaking a blank archetype onto the pipeline entry.
  if (data.archetype.trim() === "") {
    return { ok: false, reason: "profile normalizer returned an empty archetype" };
  }
  if (typeof data.completeness !== "number" || !Number.isFinite(data.completeness)) {
    return { ok: false, reason: `profile normalizer returned a non-numeric completeness (got ${describe(data.completeness)})` };
  }
  return {
    ok: true,
    value: {
      profile: data.profile,
      archetype: data.archetype,
      completeness: data.completeness,
      missingGaps: coerceCompletenessGaps(data.missingGaps),
    },
  };
}
