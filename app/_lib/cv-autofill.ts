// CV-first autofill for conversational apply (idea-cddec0bf). When a candidate
// uploads a CV (text already extracted via /api/extract-text), pull the two
// reliably-recoverable identity fields — email and name — so the apply flow can
// pre-fill those steps as EDITABLE defaults the candidate confirms, instead of
// re-typing what their résumé already states. Deliberately conservative: a wrong
// guess is worse than none (the candidate would have to delete it), so each
// extractor returns undefined unless it's fairly confident. Pure + testable;
// richer field parsing (years, skills) stays server-side at submit (profile_cli).

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// FINDING #5 (bug-ui-scan-2026-07-09, github-evidence-cv-utilities): how many lines
// AFTER the guessed applicant name still count as their "contact block". The
// candidate's own address sits on their name line or just below it; a referee's or a
// former employer's address lives in a separate section outside this window.
const EMAIL_BLOCK_LINES = 3;

// Distinct, lowercased, length-valid email-shaped tokens in a chunk of text.
function distinctEmails(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(EMAIL_RE)].map((m) => m[0].toLowerCase()).filter((e) => e.length <= 254)
    ),
  ];
}

/** A best-effort applicant email from the CV, lowercased, or undefined.
 *
 *  FINDING #5: the old code returned the FIRST email-shaped token regardless of whose
 *  address it was, so a CV that lists a portfolio host, a former employer, or a
 *  "References: john@bigco.com" block ABOVE the candidate's own address prefilled
 *  someone else's email. "A wrong guess is worse than none," so we only return an
 *  address we can attribute to the candidate:
 *    - exactly one distinct address in the whole CV → unambiguous, return it;
 *    - several distinct addresses → return the single address that appears in the
 *      guessed name's contact block (their name line + the next few lines). If that
 *      block has no address, or more than one, prefill nothing and let the candidate
 *      type it — an ambiguous CV degrades to "candidate types it", never a confident
 *      wrong default. */
export function extractCvEmail(text: string): string | undefined {
  const distinct = distinctEmails(text);
  if (distinct.length === 0) return undefined;
  if (distinct.length === 1) return distinct[0]; // one address in the whole CV — unambiguous

  // Several distinct addresses: attribute one to the candidate only via their name's
  // contact block, so an address listed elsewhere on the page can't win by position.
  const name = guessCvName(text);
  if (!name) return undefined; // no anchor to attribute an address → candidate types it
  const lines = text.split(/\r?\n/);
  // Anchor on the line that IS the name, not merely one CONTAINING it. A cover
  // header repeats the applicant's name ABOVE the real contact block
  // ("Curriculum Vitae — Jane Applicant" / "Prepared for Jane Applicant by …"),
  // and an `includes` match parked the 3-line window on that header — handing back
  // the agency's or referee's address as the candidate's, the exact
  // mis-attribution FINDING #5 exists to prevent. guessCvName returns a TRIMMED
  // whole line, so trim-equality always locates the real name line.
  const nameLine = lines.findIndex((line) => line.trim() === name);
  if (nameLine < 0) return undefined;
  const block = lines.slice(nameLine, nameLine + EMAIL_BLOCK_LINES).join("\n");
  const inBlock = distinctEmails(block);
  return inBlock.length === 1 ? inBlock[0] : undefined;
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
