// CV-first autofill for conversational apply (idea-cddec0bf). When a candidate
// uploads a CV (text already extracted via /api/extract-text), pull the two
// reliably-recoverable identity fields — email and name — so the apply flow can
// pre-fill those steps as EDITABLE defaults the candidate confirms, instead of
// re-typing what their résumé already states. Deliberately conservative: a wrong
// guess is worse than none (the candidate would have to delete it), so each
// extractor returns undefined unless it's fairly confident. Pure + testable;
// richer field parsing (years, skills) stays server-side at submit (profile_cli).

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/** The first email-shaped token in the CV text, lowercased, or undefined. */
export function extractCvEmail(text: string): string | undefined {
  const m = EMAIL_RE.exec(text);
  if (!m) return undefined;
  const email = m[0].toLowerCase();
  return email.length <= 254 ? email : undefined;
}

// A header line we should NOT mistake for a name.
const NON_NAME_LINE = /\b(curriculum\s+vitae|c\.?v\.?|r[eé]sum[eé]|resume|profile|contact)\b/i;
// A "looks like a person's name" token: starts with an UPPERCASE letter (incl.
// diacritics) — real names are Title- or UPPER-cased, so this rejects body prose
// like "built systems" — followed by letters and an optional internal
// hyphen/apostrophe. No digits, no symbols.
const NAME_TOKEN = /^[\p{Lu}][\p{L}'-]*$/u;

// Common job-title / seniority words — a CV that leads with "Senior Engineer"
// must not have that mistaken for the applicant's name (a wrong prefill is worse
// than none). If any token of a candidate line is one of these, it isn't a name.
const TITLE_WORDS = new Set([
  "senior", "junior", "lead", "principal", "staff", "head", "chief",
  "engineer", "developer", "designer", "manager", "analyst", "consultant",
  "architect", "intern", "specialist", "director", "officer", "scientist",
  "programmer", "administrator", "coordinator", "software", "data", "frontend",
  "backend", "fullstack", "full-stack", "devops", "qa", "product", "project",
]);

/** A best-effort applicant name from the top of the CV: the first non-empty line
 *  that reads like a 2–4 word personal name (no digits, no email/url, not a
 *  "Curriculum Vitae"-style header). Undefined when nothing qualifies — the
 *  candidate just types it, as before. Scans only the first few lines so a name
 *  buried in body prose isn't picked up. */
export function guessCvName(text: string): string | undefined {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 8);
  for (const line of lines) {
    if (line.length > 40 || line.includes("@") || /\d/.test(line) || NON_NAME_LINE.test(line)) continue;
    const tokens = line.split(/\s+/);
    if (tokens.length < 2 || tokens.length > 4) continue;
    if (!tokens.every((tok) => NAME_TOKEN.test(tok))) continue;
    if (tokens.some((tok) => TITLE_WORDS.has(tok.toLowerCase()))) continue; // a title line, not a name
    return line;
  }
  return undefined;
}

/** Both autofill fields in one pass; omits keys that didn't parse. */
export function cvAutofill(text: string): { name?: string; email?: string } {
  const out: { name?: string; email?: string } = {};
  const name = guessCvName(text);
  if (name) out.name = name;
  const email = extractCvEmail(text);
  if (email) out.email = email;
  return out;
}
