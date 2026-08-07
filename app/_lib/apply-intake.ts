import type { JobRecord } from "./db/core";
import { parseGithubUsername } from "./github-handle.ts";

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
 * Anti-bot honeypot. `company_url` is a hidden form field a real applicant never sees
 * or fills; a bot that auto-fills every input trips it. Returns true when the field is
 * a non-empty string, so the caller can silently DROP the submission (file no lead,
 * send no email). The KO gate filters ineligible HUMANS, not bots; this complements —
 * does not replace — the rate limit. Pure + tested (apply-intake.test.ts).
 */
export function isHoneypotFilled(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const v = (body as Record<string, unknown>).company_url;
  return typeof v === "string" && v.trim() !== "";
}

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

/** The display label a contact-less / nameless lead files under. Single-sourced
 *  here so the prefill seeding below can recognize the sentinel and never greet
 *  a candidate as "Applicant" (see seedLeadPrefillAnswers / lead-intake.ts). */
export const ANONYMOUS_APPLICANT_LABEL = "Applicant";

/**
 * Shape-gate the public lead-enrichment capability token (`?lead=` on the apply
 * page, `lead` in the apply POST body) BEFORE any DB lookup: a single plain
 * string in the randomToken alphabet (prefix + base64url), length-bounded.
 * Returns null for anything else — the caller degrades silently to the normal
 * first-time flow, never an error page: the emailed link must never be WORSE
 * than no token. Field-by-field coercion at the trust boundary, never a cast.
 */
export function coerceLeadTokenParam(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  return /^[A-Za-z0-9_-]{8,80}$/.test(token) ? token : null;
}

/**
 * Shape-gate the optional GitHub handle captured by the conversational apply's
 * "GitHub profile" step BEFORE it is persisted on the pipeline entry: accepts
 * either a bare username (a leading `@` tolerated) or a github.com profile URL
 * (protocol and `www.` optional, trailing path/query ignored) and returns the
 * NORMALIZED bare username — the one canonical form the deep-dive route and the
 * drawer's profile link both consume. Mirrors the username rules
 * /api/github-analysis enforces (1–39 chars of [A-Za-z0-9-], no leading or
 * trailing hyphen), so a handle that passes here is one the deep-dive can run.
 * Returns null for anything else — the step is optional evidence, so junk
 * degrades to "no handle" rather than blocking the application. Field-by-field
 * coercion at the trust boundary, never a cast.
 */
export function coerceGithubHandle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return parseGithubUsername(value);
}

/**
 * Seed the enrichment chat's answers from a token-resolved lead entry — the
 * facts the lead already gave, and ONLY those:
 *   - name: the entry's label, unless it's the {@link ANONYMOUS_APPLICANT_LABEL}
 *     sentinel (a webhook lead that arrived nameless);
 *   - email: the entry's contact, re-checked against the same shape gate the
 *     POST enforces — a junk/non-email contact is never seeded, or the final
 *     submit would 400 on input the candidate didn't type;
 *   - KO gates: `true` for exactly the ids RECORDED as passed at intake that the
 *     job's CURRENT script still asks. A gate the job gained since (or one a
 *     third-party form never asked) stays in the chat — pass-state is read,
 *     never derived, never fabricated.
 * The seeded keys ride the final POST payload so the server's strict KO verdict
 * and identity merge see the same answers a full walk-through would produce.
 */
export function seedLeadPrefillAnswers(
  lead: { candidateLabel: string; contact: string | null; passedKoIds: readonly string[] },
  steps: readonly { id: string; type: string }[]
): Record<string, string | boolean> {
  const answers: Record<string, string | boolean> = {};
  const name = lead.candidateLabel.trim();
  if (name && name !== ANONYMOUS_APPLICANT_LABEL) answers.name = name;
  const email = (lead.contact ?? "").trim();
  if (email && APPLY_EMAIL_RE.test(email)) answers.email = email;
  for (const step of steps) {
    if (step.type === "ko" && lead.passedKoIds.includes(step.id)) answers[step.id] = true;
  }
  return answers;
}

/**
 * Drop the steps the prefill already answered, so the enrichment chat opens at
 * the first NEW question instead of re-asking name/email/passed gates. Trimming
 * the array (rather than leaning on `when` conditions) keeps the client's
 * step-machine indexes dense; {@link nextVisibleStepIndex} still handles the
 * archetype-lane skips among the steps that remain.
 */
export function trimSeededSteps<T extends { id: string }>(
  steps: readonly T[],
  answers: Record<string, unknown>
): T[] {
  return steps.filter((s) => !(s.id in answers));
}

/**
 * Identity of the SCRIPT a saved draft was recorded against (idea-939d96e9).
 *
 * A draft stores answers keyed by step id plus a positional `idx` into the step
 * array — both of which are meaningless against a DIFFERENT script. The script
 * is rebuilt per visit from the live job and the request locale, so between
 * abandoning and resuming it can legitimately change:
 *   - the job was edited (a `ko_mode`/`ko_lang` gate appears or disappears —
 *     they're conditional on workMode/languages), or its archetype options moved
 *     (the registry changed, or the count crossed MIN_ARCHETYPE_OPTIONS_TO_OFFER);
 *   - the candidate switched language, so every prompt — and therefore the whole
 *     transcript the draft replays — is in the wrong one.
 *
 * A desynced restore is not cosmetic: `idx` lands the candidate on a different
 * question than the one their transcript shows, and a KO gate that shifted
 * position can be skipped positionally — the strict server verdict then declines
 * a qualified applicant for a gate they were never asked. So the draft carries
 * this fingerprint and a mismatch discards it (starting fresh is the existing,
 * always-safe path — one restart beats a silent wrong decline).
 *
 * Deliberately the ids + locale and nothing else: prompt COPY changing (a
 * reworded question) must not throw away a candidate's work, but a step
 * appearing, disappearing, or moving must.
 */
export function applyDraftFingerprint(stepIds: readonly string[], locale: string): string {
  return `${locale}|${stepIds.join(",")}`;
}

/**
 * Reconcile a restored in-progress draft (idea-939d96e9, localStorage) with an
 * incoming lead-enrichment prefill (the ?lead= hand-off). The invariant this
 * pins: the prefill's SEEDED keys — name/email and, critically, the KO gates the
 * lead already passed — must ALWAYS win over the stored draft.
 *
 * Why it matters: on an enrichment visit `page.tsx` trims the passed-KO steps
 * out of the chat ({@link trimSeededSteps}), so those `ko_* = true` answers live
 * ONLY in the prefill — the shortened chat never re-asks them. A stale draft
 * saved under the same job (e.g. a first-time attempt the candidate abandoned
 * before the enrichment email) carries either a `ko_* = false` or, more often,
 * no KO key at all. Letting the draft's answers overwrite the prefill would wipe
 * the seeded KO=true, and the final POST's strict {@link failedKoStepIds} verdict
 * would then silently DECLINE a candidate who had already qualified.
 *
 * A prefill-less (normal first-time) restore returns the draft's answers
 * verbatim, preserving the resume-where-you-left-off UX. Pure + tested
 * (apply-intake.test.ts).
 */
export function mergeDraftAnswers(
  draftAnswers: Record<string, unknown>,
  prefillAnswers?: Record<string, string | boolean> | null
): Record<string, unknown> {
  // Spread the prefill LAST so its seeded keys (name/email + passed KO gates)
  // override any stale value the draft carries for the same key.
  return prefillAnswers ? { ...draftAnswers, ...prefillAnswers } : { ...draftAnswers };
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
