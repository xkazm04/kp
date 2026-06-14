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
/** Normalize a captured contact (email) into a stable comparison key: trimmed +
 *  lowercased. Email is the stronger identity than a display name (two real people
 *  can share a name; an address is theirs), so when present it drives dedup. "" for
 *  a blank/whitespace contact — the signal that we have no address to key on. */
export function normalizeContact(contact: string | null | undefined): string {
  return (contact ?? "").trim().toLowerCase();
}

/**
 * The single email-shape check shared by every apply intake surface — both client
 * forms (conversational + quick) and both server routes. The client checks exist
 * specifically to MIRROR the server's, so a divergence is a real correctness bug
 * (the client accepts what the server rejects → a 400 that wipes the conversation).
 * Hoisted here, in the registry-free module both client bundles already import, so
 * the four copies can't drift. (lead-payload.ts keeps its own EMAIL_RE — different
 * module/contract.)
 */
export const APPLY_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function applyDedupeKey(name: string, email?: string | null): string {
  // Prefer the email (idea: dedup-by-email) — two same-named applicants with
  // different addresses are different people and must get DISTINCT keys, which a
  // name-only key collapsed onto one entry. Non-alphanumerics → hyphens so the key
  // survives createPipelineEntry's slug strip distinctly (a.b@x vs ab@x don't
  // collide once `@`/`.` become separators). Falls back to the name when no email
  // was captured, preserving the legacy behavior for those applicants.
  const e = normalizeContact(email);
  if (e) return `appl-${e.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
  const norm = normalizeApplicantName(name);
  return norm ? `appl-${norm.replace(/ /g, "-")}` : "";
}

/**
 * The conversational-apply submit-failure recovery contract: given the HTTP
 * status of a failed FINAL submit, is re-POSTing the *same* answers worth
 * offering? This is what selects "Try again" vs. "Start over" in the inline
 * recovery UI (see app/apply/[id]/ConversationalApply.tsx).
 *
 *   - RETRYABLE (true) — 5xx (the server errored on its side), plus 408 Request
 *     Timeout and 429 Too Many Requests (transient back-pressure). The same
 *     payload can succeed on a later attempt, so the candidate is offered an
 *     in-place "Try again" that re-POSTs the already-collected answers — no
 *     re-walking the chat. A network error with NO HTTP response at all (offline)
 *     is also retryable; the caller defaults to true in that case.
 *
 *   - NOT RETRYABLE (false) — every other 4xx (400 answer-too-long, 413
 *     payload-too-large, 404 role-gone, …). Here the server rejected THIS input,
 *     so re-POSTing the identical payload fails identically — an infinite "Try
 *     again" dead-end. The candidate is instead offered a deliberate restart to
 *     re-answer with valid input.
 *
 * Centralized here (registry-free, so the candidate-facing apply bundle can import
 * it without pulling in the archetype registry) and pinned by apply-intake.test.ts,
 * so the retry-vs-restart boundary is an explicit contract rather than an inline
 * magic-number check that can quietly drift.
 */
export function isRetryableApplyStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

/**
 * Knockout gate verdict shared by BOTH public intake surfaces (the conversational
 * apply and the quick-apply lead form): given the KO step ids the job's own
 * script expects, return the ids whose answer is missing OR not exactly `true`.
 * The POST body is a public, untrusted trust boundary — an ABSENT key is a fail,
 * not a pass, so a scripted POST can't skip work-authorization / mode / language
 * eligibility by simply omitting the keys. An empty return means the gate passed.
 */
export function failedKoStepIds(
  expectedKoIds: readonly string[],
  answers: Record<string, unknown>
): string[] {
  return expectedKoIds.filter((koId) => answers[koId] !== true);
}

/**
 * Declarative visibility condition for an apply step: the step is shown only
 * when a previously-captured answer matches. `oneOf` shows the step iff the
 * referenced answer IS one of the values; `notOneOf` shows it iff the answer is
 * absent OR not in the list — so a flow whose branching question was never
 * offered (e.g. the registry exposes one archetype) degrades to the default
 * lane instead of asking nothing. Registry-free and pinned by tests, because
 * this is what decides which intake questions a student vs an experienced
 * applicant actually sees.
 */
export type StepCondition = { stepId: string; oneOf?: string[]; notOneOf?: string[] };

export function stepConditionMet(when: StepCondition | undefined, answers: Record<string, unknown>): boolean {
  if (!when) return true;
  const raw = answers[when.stepId];
  const answer = typeof raw === "string" ? raw : undefined;
  if (when.oneOf) return answer !== undefined && when.oneOf.includes(answer);
  if (when.notOneOf) return answer === undefined || !when.notOneOf.includes(answer);
  return true;
}

/**
 * The index of the next step visible under the captured answers, or -1 when the
 * conversation is complete. The conversational client calls this instead of
 * `idx + 1`, which is what lets one server-built script carry per-archetype
 * lanes (student / switcher / experienced) without becoming dynamic.
 */
export function nextVisibleStepIndex(
  steps: readonly { when?: StepCondition }[],
  fromIdx: number,
  answers: Record<string, unknown>
): number {
  for (let i = fromIdx + 1; i < steps.length; i += 1) {
    if (stepConditionMet(steps[i].when, answers)) return i;
  }
  return -1;
}

/** The free-text answers captured by the conversational apply flow. The
 *  early-career lanes capture their own fields (project/thesis, education,
 *  aspirations for a student; prior field + direction for a switcher) instead of
 *  the BAU "most relevant recent experience" question — exactly one lane's
 *  fields are present per application. */
export type ApplyAnswers = {
  name: string;
  experience?: string;
  skills: string;
  archetype?: string;
  studentProject?: string;
  studentEducation?: string;
  studentAspirations?: string;
  switchPrior?: string;
  switchAspirations?: string;
  // Text extracted from an uploaded CV (via /api/extract-text), folded in as
  // high-weight `kind: "cv"` evidence. Optional — the flow never requires a file.
  cvText?: string;
};

/**
 * Assemble the registry-free part of a CandidateProfileV2 intake draft from the
 * captured answers: display name, role family, languages (job's own, else the
 * {@link DEFAULT_APPLY_LANGUAGES} fallback), evidence, and a parsed
 * {@link parseYearsExperience} count. A genuine "0 years" is preserved; an
 * unparseable experience simply omits `yearsExperience`.
 *
 * Lane mapping — the early-career answers become TYPED evidence so the Python
 * normalizer prices them honestly instead of as generic experience:
 *  - student: the project/thesis answer is `kind: "project"` evidence carrying
 *    the claimed skills; education detail and aspirations land as profile fields
 *    (the completeness checklist's highest-weight items for this archetype).
 *  - switcher: the prior field is `kind: "job"` evidence WITHOUT the claimed
 *    skills (it feeds transferable-meta-skill extraction; attaching target-domain
 *    skill claims to it would inflate them to professional provenance), and the
 *    claimed skills ride a `kind: "other"` item instead.
 *  - experienced/default: unchanged — one project-kind item with the skills.
 */
export function buildIntakeProfile(job: JobRecord, answers: ApplyAnswers): Record<string, unknown> {
  const skillList = answers.skills
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const evidence: Record<string, unknown>[] = [];
  // An uploaded CV is the richest signal an applicant can give — surface it first
  // as `kind: "cv"` so the Python normalizer prices it as a full résumé (the same
  // evidence kind the recruiter Profile path produces), carrying the typed skills
  // alongside the extracted text.
  const cvText = (answers.cvText ?? "").trim();
  if (cvText) {
    evidence.push({
      kind: "cv",
      title: "CV (uploaded at application)",
      text: cvText,
      skills: skillList,
    });
  }
  if (answers.studentProject) {
    evidence.push({
      kind: "project",
      title: "Project or thesis (from application)",
      text: answers.studentProject,
      skills: skillList,
    });
  }
  if (answers.switchPrior) {
    evidence.push({
      kind: "job",
      title: "Previous field (from application)",
      text: answers.switchPrior,
      skills: [],
    });
    evidence.push({
      kind: "other",
      title: "Skills brought to this role (from application)",
      text: answers.switchAspirations || answers.switchPrior,
      skills: skillList,
    });
  }
  // The default lane — also the fallback when no lane captured anything, so an
  // application never produces a profile with zero evidence.
  if (answers.experience || evidence.length === 0) {
    evidence.push({
      kind: "project",
      title: "Recent experience (from application)",
      text: answers.experience || "—",
      skills: skillList,
    });
  }

  const profile: Record<string, unknown> = {
    displayName: answers.name,
    roleFamily: job.roleFamily ?? "software_engineering",
    languages:
      job.languages && job.languages.length ? job.languages : [...DEFAULT_APPLY_LANGUAGES],
    evidence,
  };

  const aspirations = (answers.studentAspirations || answers.switchAspirations || "").trim();
  if (aspirations) profile.aspirations = [aspirations];
  const education = (answers.studentEducation || "").trim();
  if (education) profile.educationDetail = education;

  // Years parse only from answers that describe WORK history (the BAU experience
  // answer, or a switcher's prior field) — a "2 years" inside a thesis description
  // is project age, not professional tenure.
  const yearsExperience = parseYearsExperience(answers.experience ?? answers.switchPrior ?? "");
  // Check against undefined (not truthiness) so a genuine "0 years" is kept.
  if (yearsExperience !== undefined) profile.yearsExperience = yearsExperience;
  return profile;
}
