// W0.6 — the constructive rejection: tell a rejected candidate WHY, from the record.
//
// Today's rejection is a respectful two-variant template (comms-dispatch.dispatchRejection).
// It never ghosts anyone, which already beats most of the market — but it says nothing, and
// a competitor sells "hyper-personalized rejection emails explaining the decision" as a
// candidate-NPS and employer-brand lever.
//
// THE RULE THIS MODULE ENFORCES: we say only what was actually RECORDED about this
// candidate, in the words the record already holds. Specifically NOT:
//
//   - a fresh LLM call. Rejections dispatch inside batch policy passes; a per-candidate
//     generation would be slow, costly, and — worse — would invent a rationale that was
//     never the reason. The reason has to be the one on file or it is theatre.
//   - anything derived from a protected attribute, or from free text that mentions one.
//     An adverse comm is the highest-stakes message the product sends; a leak here is a
//     discrimination claim, so the filter is deny-by-default on the whole line.
//   - a reason at all, when nothing was recorded. Silence beats a fabricated explanation,
//     and the caller falls back to the existing template.
//
// Pure + dependency-free so it is unit-testable and callable from a batch pass.

/** Max feedback bullets in a rejection. Three is enough to be useful and short enough to
 *  stay readable; more reads as a case being built against the person. */
export const MAX_FEEDBACK_LINES = 3;

const MAX_LINE_CHARS = 140;

// Deny-list for the protected-attribute filter. Matching is on the LINE, and a match
// drops the whole line rather than redacting a word — a partially-scrubbed sentence about
// someone's age is still a sentence about their age. Deliberately broad: a false positive
// costs one bullet, a false negative costs a lawsuit.
const PROTECTED_PATTERNS: readonly RegExp[] = [
  /\b(age|aged|years old|birth|birthday|born in \d{4})\b/i,
  /\b(male|female|man|woman|gender|pregnan\w*|maternity|paternity)\b/i,
  /\b(marital|married|single|divorc\w*|children|childcare|family status)\b/i,
  /\b(nationality|citizen\w*|visa|immigrat\w*|ethnic\w*|race|racial|origin)\b/i,
  /\b(religio\w*|church|muslim|jewish|christian|hindu|buddhis\w*)\b/i,
  /\b(disab\w*|handicap\w*|illness|medical|health condition|sick leave)\b/i,
  /\b(union|political|party membership|sexual orientation|gay|lesbian)\b/i,
  // Czech equivalents — the primary market, and the locale most adverse comms ship in.
  //
  // Written as STEM + OPEN SUFFIX under /u, deliberately NOT as `\b…\b`: JavaScript's
  // \b is ASCII-only, so a diacritic is not a word character. `\bpohlaví\b` therefore
  // never matched the word AT ALL — the closing \b sits between "í" and a space, two
  // non-word characters, so there is no boundary there — and `\bvěk\b` matched only the
  // bare nominative while "věku"/"věkové" sailed straight through. The other stems were
  // saved by their `\w*` tail; age and gender, the two plainest discrimination claims an
  // adverse comm can make, were the two that had none. The leading guard is a
  // Unicode-aware non-letter (or the start of the line) and the tail is left open, so
  // every Czech inflection of the stem is caught.
  /(?:^|[^\p{L}\p{N}_])(?:věk|pohlav|těhoten|mateřsk|rodinn|národnost|občanstv|nábožen|zdravotn|invalid)/iu,
];

export type FeedbackSource = "recorded_gaps" | "unmet_requirements" | "none";

export type RejectionFeedback = {
  /** Bullets to render, already filtered, trimmed and capped. Empty iff source is "none". */
  lines: string[];
  source: FeedbackSource;
  /** True when at least one candidate line was dropped by the protected-attribute filter.
   *  Surfaced so a recruiter can see the filter fired rather than wondering where a
   *  recorded gap went, and so the behaviour is observable in tests. */
  filtered: boolean;
};

export type RejectionFeedbackInput = {
  /** Recorded still-unmet checklist items for this entry (db: profile_gaps_json). */
  profileGaps?: readonly { check: string; label: string }[] | null;
  /** Job requirements the match run recorded as unmet. */
  unmetRequirements?: readonly string[] | null;
};

const EMPTY: RejectionFeedback = { lines: [], source: "none", filtered: false };

function safeLines(raw: readonly string[]): { kept: string[]; filtered: boolean } {
  const kept: string[] = [];
  let filtered = false;
  for (const value of raw) {
    const line = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!line) continue;
    if (PROTECTED_PATTERNS.some((re) => re.test(line))) {
      filtered = true;
      continue;
    }
    kept.push(line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS - 1).trimEnd()}…` : line);
  }
  // De-dupe case-insensitively: the gap list and the unmet-requirement list overlap often,
  // and the same sentence twice reads as sloppy in the one message that must not.
  const seen = new Set<string>();
  return { kept: kept.filter((l) => !seen.has(l.toLowerCase()) && seen.add(l.toLowerCase())).slice(0, MAX_FEEDBACK_LINES), filtered };
}

/**
 * Build the feedback block, or nothing. Prefers recorded profile gaps (the checklist the
 * recruiter's own criteria produced) over unmet requirements (derived from the match run),
 * because the former is what a human actually asked for.
 */
export function buildRejectionFeedback(input: RejectionFeedbackInput): RejectionFeedback {
  const gapLabels = (input.profileGaps ?? []).map((g) => g?.label ?? "").filter(Boolean);
  if (gapLabels.length > 0) {
    const { kept, filtered } = safeLines(gapLabels);
    if (kept.length > 0) return { lines: kept, source: "recorded_gaps", filtered };
    // Everything was filtered: fall through rather than return a source with no lines.
    if (filtered) return { ...EMPTY, filtered: true };
  }
  const unmet = (input.unmetRequirements ?? []).filter(Boolean);
  if (unmet.length > 0) {
    const { kept, filtered } = safeLines(unmet);
    if (kept.length > 0) return { lines: kept, source: "unmet_requirements", filtered };
    if (filtered) return { ...EMPTY, filtered: true };
  }
  return EMPTY;
}

/**
 * Render the block into a rejection body. `intro` and `outro` come from the locale
 * catalog, so the sentence around the bullets is translated even though the bullets
 * themselves are recorded text in whatever language the criteria were written in.
 *
 * Returns "" for empty feedback, so the caller appends nothing and the existing template
 * ships unchanged.
 */
export function renderRejectionFeedback(feedback: RejectionFeedback, intro: string, outro: string): string {
  if (feedback.lines.length === 0) return "";
  return `\n\n${intro}\n${feedback.lines.map((l) => `• ${l}`).join("\n")}\n\n${outro}`;
}
