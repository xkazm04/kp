// E3 (Erika gap) — pure extraction of a lead from an UNTRUSTED inbound webhook
// payload. Third-party lead forms (Meta Lead Ads via Zapier/Make, job-board
// integrations, plain HTML forms) all name their fields differently, so the
// receiver maps them through diacritic-folded key aliases instead of demanding
// one exact schema. Registry- and DB-free so the mapping rules are unit-tested
// in isolation (lead-payload.test.ts) — this IS the per-job field mapping the
// backlog promised, in its alias-driven default form.

export type ExtractedLead = {
  /** Display name as given ("" when none was found — the caller labels the entry). */
  name: string;
  /** First email-shaped address found ("" when none — the caller rejects: an
   *  unreachable lead defeats the channel's purpose). */
  email: string;
  /** Expected KO ids whose answer was an explicit NEGATIVE — these decline. */
  failedKoIds: string[];
  /** Expected KO ids the payload never answered — or answered uninterpretably.
   *  NOT a fail: a third-party form that didn't ask (or a mapping quirk) must
   *  not silently discard a real candidate. Recorded for recruiter visibility;
   *  the enrichment apply re-runs the full gate. */
  ungatedKoIds: string[];
  /** E5 — campaign attribution (utm_campaign-style; "" when none carried). */
  campaign: string;
  /** E5 — creative/variant attribution (utm_content / ad-id-style; "" when none). */
  variant: string;
};

// Key normalization: diacritic fold (jméno → jmeno), lowercase, every non-
// alphanumeric run → "_" ("E-mail address" → "e_mail_address" → alias hit).
function normalizeKey(key: string): string {
  return key
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const NAME_KEYS = ["name", "full_name", "fullname", "applicant_name", "candidate_name", "jmeno", "jmeno_a_prijmeni", "cele_jmeno"];
const FIRST_NAME_KEYS = ["first_name", "firstname", "krestni_jmeno"];
const LAST_NAME_KEYS = ["last_name", "lastname", "prijmeni"];
const EMAIL_KEYS = ["email", "e_mail", "mail", "email_address", "emailova_adresa", "e_mailova_adresa"];
// E5 — campaign/creative attribution, the UTM vocabulary plus the ad-platform
// field names integrations commonly forward.
const CAMPAIGN_KEYS = ["utm_campaign", "campaign", "campaign_name", "campaign_id"];
const VARIANT_KEYS = ["utm_content", "variant", "ad_id", "ad_name", "creative"];

// Same shape the apply surfaces validate against.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// KO answer vocabulary across the form ecosystems we ingest from (EN + CS).
const AFFIRMATIVE = new Set(["true", "yes", "y", "1", "on", "ano"]);
const NEGATIVE = new Set(["false", "no", "n", "0", "off", "ne"]);

function primitiveToString(value: unknown): string | null {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

/**
 * Flatten an arbitrary payload into one normalized-key → string map. Three
 * containers are read, later (more lead-specific) ones overriding earlier:
 *   1. top-level primitive fields (a plain JSON form POST),
 *   2. a `fields` object of primitives (common wrapper shape),
 *   3. a Meta-Lead-Ads-style `field_data` array of `{name, values: [...]}`.
 * Arrays contribute their first primitive. Anything else is ignored — this is
 * a trust boundary, not a parser.
 */
export function flattenLeadFields(payload: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return out;
  const obj = payload as Record<string, unknown>;

  const absorb = (key: string, raw: unknown) => {
    const value = Array.isArray(raw) ? primitiveToString(raw[0]) : primitiveToString(raw);
    const norm = normalizeKey(key);
    if (value !== null && norm) out[norm] = value;
  };

  for (const [key, raw] of Object.entries(obj)) absorb(key, raw);

  const fields = obj.fields;
  if (fields && typeof fields === "object" && !Array.isArray(fields)) {
    for (const [key, raw] of Object.entries(fields as Record<string, unknown>)) absorb(key, raw);
  }

  if (Array.isArray(obj.field_data)) {
    for (const item of obj.field_data) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const { name, values } = item as { name?: unknown; values?: unknown };
        if (typeof name === "string") absorb(name, Array.isArray(values) ? values : values ?? null);
      }
    }
  }
  return out;
}

function firstHit(fields: Record<string, string>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = (fields[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}

/** Map a raw webhook payload to a lead: name (aliases, else first+last
 *  composition), email (aliases, else a value scan for the first email-shaped
 *  string), and the provided-only KO verdict (explicit negative = fail;
 *  absent/uninterpretable = ungated — see ExtractedLead). */
export function extractLead(payload: unknown, expectedKoIds: readonly string[]): ExtractedLead {
  const fields = flattenLeadFields(payload);

  let name = firstHit(fields, NAME_KEYS);
  if (!name) {
    const first = firstHit(fields, FIRST_NAME_KEYS);
    const last = firstHit(fields, LAST_NAME_KEYS);
    name = [first, last].filter(Boolean).join(" ");
  }

  let email = firstHit(fields, EMAIL_KEYS);
  if (!EMAIL_RE.test(email)) email = "";
  if (!email) {
    // Last resort: any value that LOOKS like an address. Integrations love
    // creative field names; the address shape is the more stable signal.
    email = Object.values(fields).find((v) => EMAIL_RE.test(v)) ?? "";
  }

  const failedKoIds: string[] = [];
  const ungatedKoIds: string[] = [];
  for (const koId of expectedKoIds) {
    const raw = fields[normalizeKey(koId)];
    if (raw === undefined) {
      ungatedKoIds.push(koId);
      continue;
    }
    const answer = raw.trim().toLowerCase();
    if (NEGATIVE.has(answer)) failedKoIds.push(koId);
    else if (!AFFIRMATIVE.has(answer)) ungatedKoIds.push(koId);
  }

  return {
    name,
    email,
    failedKoIds,
    ungatedKoIds,
    campaign: firstHit(fields, CAMPAIGN_KEYS),
    variant: firstHit(fields, VARIANT_KEYS),
  };
}
