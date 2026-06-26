// GDPR data-processing consent — the pure, dependency-free core (so the colocated
// node --test loads it without dragging in better-sqlite3). The DB lifecycle that
// uses these lives in db/pipeline.ts (recordEntryConsent / anonymizeEntry /
// anonymizeExpiredConsents); the borrowed pattern (anonymize-on-expiry but RETAIN
// the non-identifying scoring artifacts for re-engagement) is documented in
// docs/GDPR_AND_HIRING_EXTENSIONS.md. See the DPO note there before enabling in prod.

/** Default retention window for a recruitment consent: 12 months from grant
 *  (Recruitis/Sloneek both default to ~1 year). This is a GLOBAL default, blind to
 *  jurisdiction and source — the lawful retention period varies by country and by how
 *  the candidate was acquired, so a deployment SHOULD set it for its legal basis via
 *  KP_CONSENT_TTL_DAYS (whole days, 1..3650). The per-call `ttlDays` arg overrides it
 *  for a future per-jurisdiction/per-source policy. See docs/GDPR_AND_HIRING_EXTENSIONS.md. */
function defaultConsentTtlDays(): number {
  const raw = Number(process.env.KP_CONSENT_TTL_DAYS);
  return Number.isFinite(raw) && raw >= 1 && raw <= 3650 ? Math.floor(raw) : 365;
}
export const CONSENT_TTL_DAYS = defaultConsentTtlDays();

/** A consent is "expiring" within this many days of its expiry — the window the
 *  pre-expiry reminder + the drawer's amber chip use. */
export const CONSENT_EXPIRING_DAYS = 30;

const DAY_MS = 86_400_000;

export type ConsentStatus = "none" | "active" | "expiring" | "expired" | "anonymized";

export type ConsentSnapshot = {
  givenAt: string | null;
  expiresAt: string | null;
  anonymizedAt: string | null;
};

/** ISO expiry for a consent granted at `givenAtMs`, `ttlDays` later. */
export function consentExpiresAt(givenAtMs: number, ttlDays: number = CONSENT_TTL_DAYS): string {
  return new Date(givenAtMs + ttlDays * DAY_MS).toISOString();
}

/** Lifecycle state of an entry's consent, for the sweep + the drawer chip.
 *  anonymized wins over everything (it's terminal); then we read the expiry. */
export function consentStatus(snap: ConsentSnapshot, nowMs: number): ConsentStatus {
  if (snap.anonymizedAt) return "anonymized";
  if (!snap.givenAt) return "none";
  if (!snap.expiresAt) return "active"; // granted but open-ended (legacy / no expiry)
  const exp = Date.parse(snap.expiresAt);
  if (!Number.isFinite(exp)) return "active";
  if (exp <= nowMs) return "expired";
  if (exp <= nowMs + CONSENT_EXPIRING_DAYS * DAY_MS) return "expiring";
  return "active";
}

/** Why a candidate may NOT receive unsolicited OUTREACH — the suppression gate the
 *  outreach/rediscovery path must consult before sending (CAN-SPAM/GDPR). Rediscovery
 *  re-contacts previously-rejected people, so an ANONYMIZED candidate (PII scrubbed,
 *  terminal) or one whose processing consent has EXPIRED must be suppressed. `none`
 *  (recruiter-sourced, never applied), `active`, and `expiring` (still valid) are
 *  contactable. Returns the reason, or null when the candidate may be contacted. */
export function outreachSuppressionReason(
  snap: ConsentSnapshot,
  nowMs: number = Date.now(),
): "anonymized" | "consent_expired" | null {
  const status = consentStatus(snap, nowMs);
  if (status === "anonymized") return "anonymized";
  if (status === "expired") return "consent_expired";
  return null;
}

// Header tokens that are CV-section words, not names — so a CV whose first line
// is "Curriculum Vitae" never masks to "Curriculum V." (mirrors cv-autofill's
// stoplist discipline). Kept tiny and lowercase.
const NAME_STOPWORDS = new Set([
  "curriculum",
  "vitae",
  "resume",
  "résumé",
  "cv",
  "candidate",
  "applicant",
  "profile",
  "anonymous",
  "kandidat",
  "kandidát",
  "uchazeč",
  "uchazec",
]);

/** Mask a candidate label to "First L." for anonymization — keeps a human-
 *  readable, non-identifying handle on the row (Recruitis reduces to e.g.
 *  "Monika M.") so the retained recruitment record is still legible. Degrades
 *  safely: a single token keeps its first 1–2 letters + ".", an empty/stopword
 *  label becomes the neutral "Candidate". Never throws. */
export function maskCandidateName(label: string | null | undefined): string {
  const cleaned = (label ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "Candidate";
  const tokens = cleaned.split(" ").filter((t) => t.length > 0 && !NAME_STOPWORDS.has(t.toLowerCase()));
  if (tokens.length === 0) return "Candidate";
  const first = tokens[0];
  if (tokens.length === 1) {
    // One token: keep an abbreviated, non-full handle (first two letters max).
    return capitalize(first.slice(0, 2)) + ".";
  }
  const last = tokens[tokens.length - 1];
  const initial = [...last][0] ?? ""; // codepoint-safe first char (diacritics)
  return `${capitalize(first)} ${initial.toUpperCase()}.`;
}

function capitalize(s: string): string {
  if (!s) return s;
  const chars = [...s];
  return (chars[0]?.toUpperCase() ?? "") + chars.slice(1).join("");
}

// Payload keys that carry directly-identifying PII in a profile / analysis blob
// (CandidateProfileV2 + analysisResult.candidate). Lowercased; matched exactly so
// a non-PII field like "username" is left alone but "name"/"email" are scrubbed.
// `rawText` is the whole uploaded CV text — the single largest PII surface.
const PII_KEYS = new Set([
  "name",
  "fullname",
  "rawtext",
  "email",
  "phone",
  "contact",
  "address",
  "links",
  "linkedin",
  "github",
  "githubhandle",
  "dateofbirth",
  "birthyear",
  "photo",
  "avatar",
]);

// Free-text evidence arrays quote the CV verbatim, so they can leak the name even
// after the structured fields are blanked — emptied wholesale on anonymization.
const PII_ARRAY_KEYS = new Set(["evidence"]);

// CONTAINERS whose ENTIRE subtree is verbatim free-text quoted from the CV (not a
// retained recruitment signal), so erasure must deep-redact every string/array under
// them, not just a single named array. `evidenceTrace` ({experience,skills,seniority,
// education,salary}: string[] of CV quotes) was walked straight through before — its
// quotes survived Art. 17 erasure and were re-exported by the provenance dossier.
const PII_CONTAINER_KEYS = new Set(["evidencetrace"]);

/** Recursively blank every leaf under a free-text PII container: strings → "",
 *  arrays → [] (drop the verbatim quotes), objects recurse; non-identifying
 *  numbers/booleans/null are kept so the structure still parses. */
function deepRedact(value: unknown): unknown {
  if (typeof value === "string") return "";
  if (Array.isArray(value)) return [];
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = deepRedact(v);
    return out;
  }
  return value;
}

/** Deep-scrub directly-identifying PII out of a profile/analysis payload while
 *  KEEPING the non-identifying recruitment signal (skills, scores, seniority,
 *  roleFamily, salary band, traits) so talent-rediscovery can still rank the
 *  retained record. Schema-tolerant (walks the object generically rather than
 *  binding to a zod shape) and never mutates its input. Strings under a PII key
 *  become "", arrays under a PII-array key become []. */
export function scrubPiiFromPayload(payload: unknown): unknown {
  if (Array.isArray(payload)) return payload.map(scrubPiiFromPayload);
  if (payload && typeof payload === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      const k = key.toLowerCase();
      if (PII_CONTAINER_KEYS.has(k)) {
        out[key] = deepRedact(value);
      } else if (PII_ARRAY_KEYS.has(k)) {
        out[key] = [];
      } else if (PII_KEYS.has(k)) {
        out[key] = typeof value === "string" ? "" : null;
      } else {
        out[key] = scrubPiiFromPayload(value);
      }
    }
    return out;
  }
  return payload;
}
