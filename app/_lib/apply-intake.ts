import type { JobRecord } from "./db";

// Pure, registry-free intake heuristics for the conversational apply flow. Kept
// in their own module (no `@/`-aliased imports) so the locale default and the
// bilingual years parser can be exercised directly by Node's built-in test
// runner — see apply-intake.test.ts. The candidate-facing script and the
// archetype self-declaration signal, which need the archetype registry, live in
// apply.ts and build on top of these.

/**
 * Default work languages assumed for a candidate when the job itself declares
 * none. This product was built Czech-market-first, so a bilingual Czech/English
 * profile is the safe default; whenever the job lists its own languages we use
 * those instead and never fall back here. Named (rather than inlined) so the
 * locale assumption is a stated default to revisit — not tribal knowledge — when
 * the product expands to other markets.
 */
export const DEFAULT_APPLY_LANGUAGES = ["Czech", "English"] as const;

/**
 * Pull a years-of-experience count out of the candidate's free-text experience
 * answer. This is a deliberately small bilingual heuristic, not an NLP parser;
 * the contract below is pinned by `apply-intake.test.ts` so it stays predictable
 * as the apply prompt copy evolves.
 *
 * CAPTURES — returns the first standalone 1–2 digit integer (0–99) that is
 * directly followed (whitespace and an optional `+` aside) by a recognized
 * "years" unit token:
 *   - Units, case-insensitive — English: `years`, `yrs`; Czech: `let`, `roky`,
 *     `rok`. The Czech tokens match as a prefix, so inflected forms such as
 *     `lety` / `letech` are also caught (e.g. "před 5 lety" → 5).
 *   - Examples: "3 years" → 3, "5+ yrs" → 5, "7 let praxe" → 7, "10 roky" → 10,
 *     "0 years" → 0, "5 to 8 years" → 8 (the integer adjacent to the unit).
 *
 * IGNORES — returns `undefined`:
 *   - Word-only quantities with no digit: "a couple of years", "several years".
 *   - Sub-year units: "6 months", "18 weeks" — only whole years are parsed.
 *   - Numbers of 3+ digits: "100 years" is out of the supported 0–99 range and
 *     is left uncaptured rather than silently matching a sub-string.
 *   - A bare number with no adjacent unit: "joined in 2019" → undefined.
 */
export function parseYearsExperience(experience: string): number | undefined {
  const match = /\b(\d{1,2})\s*\+?\s*(?:years|yrs|let|roky|rok)/i.exec(experience);
  return match ? Number(match[1]) : undefined;
}

/**
 * Normalize an applicant's display name into a stable comparison key:
 * trimmed, internal whitespace collapsed to single spaces, lowercased. So
 * "  Jane   DOE " and "jane doe" resolve to the same person. Returns "" for a
 * blank/whitespace-only name — the signal that we have nothing to dedup on.
 *
 * This is the identity the duplicate-application policy keys on. The
 * conversational apply flow captures no contact field (email/phone), so the
 * applicant's name (paired with the role) is the only stable signal available;
 * see {@link applyDedupeKey} and `findApplicationByApplicant` in db.ts.
 */
export function normalizeApplicantName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Build the stable per-applicant idempotency key the apply flow hands to
 * `createPipelineEntry` so repeat submissions from the same (person, role)
 * collapse onto one pipeline row instead of minting a fresh entry each time.
 *
 * Shape: `appl-<normalized-name-with-spaces-as-hyphens>` (e.g. "Jane Doe" →
 * `appl-jane-doe`). The hyphen/alphanumeric form survives createPipelineEntry's
 * slug strip so the derived entry id stays stable and human-legible. Returns ""
 * for a nameless applicant, which the caller treats as "don't dedup" (we can't
 * tell two anonymous applicants apart, so each gets its own entry).
 */
export function applyDedupeKey(name: string): string {
  const norm = normalizeApplicantName(name);
  return norm ? `appl-${norm.replace(/ /g, "-")}` : "";
}

/** The free-text answers captured by the conversational apply flow. */
export type ApplyAnswers = { name: string; experience: string; skills: string; archetype?: string };

/**
 * Assemble the registry-free part of a CandidateProfileV2 intake draft from the
 * captured answers: display name, role family, languages (job's own, else the
 * {@link DEFAULT_APPLY_LANGUAGES} fallback), skill evidence, and a parsed
 * {@link parseYearsExperience} count. A genuine "0 years" is preserved; an
 * unparseable experience simply omits `yearsExperience`.
 */
export function buildIntakeProfile(job: JobRecord, answers: ApplyAnswers): Record<string, unknown> {
  const skillList = answers.skills
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const yearsExperience = parseYearsExperience(answers.experience);

  const profile: Record<string, unknown> = {
    displayName: answers.name,
    roleFamily: job.roleFamily ?? "software_engineering",
    languages:
      job.languages && job.languages.length ? job.languages : [...DEFAULT_APPLY_LANGUAGES],
    evidence: [
      {
        kind: "project",
        title: "Recent experience (from application)",
        text: answers.experience || "—",
        skills: skillList,
      },
    ],
  };
  // Check against undefined (not truthiness) so a genuine "0 years" is kept.
  if (yearsExperience !== undefined) profile.yearsExperience = yearsExperience;
  return profile;
}
