import { GIG_ARENA_LABEL } from "./specialist-defaults";
import {
  GIG_DISCLOSURE_ITEM,
  type GigArena,
  type GigEvidenceKind,
  type GigOutcomeVerdict,
  type GigQualification,
  type RecipeRef,
} from "./types";

// What an outcome teaches the recipes that shaped the specialist - DETERMINISTIC lesson
// bullets, one lesson per adopted recipe, queued in gig_lessons for the registry lander
// (the lander appends them to each recipe's LESSONS.md and stamps them landed through
// POST /api/gigs/lessons).
//
// PURE: rows in, bullets out. No db, no clock, no model - the same outcome always yields
// the same bullets, so a lesson is reproducible from the record it was derived from.
//
// GENERALIZABLE ONLY. A lesson leaves this repository for a shared registry, so a bullet
// may name an arena, a verdict, evidence KINDS and checklist KEYS (all closed
// vocabularies) and numbers about them - never an account, a client or program name, a
// credential, a URL or a path. The one free-text input, the client's feedback, is
// scrubbed by scrubGigFeedback before it may ride along (see the rules there).
//
// The bullets, stated once:
//   every recipe:
//     accepted     "accepted: <arena> work whose evidence included <kinds> and whose
//                   checklist had <n>/<m> items ticked"
//     rejected     "rejected: <arena> work whose evidence included <kinds> and whose
//                   checklist had <n>/<m> items ticked", plus "left unticked before
//                   sending: <keys>" when any item was
//     duplicate    "rejected as duplicate: check for prior reports before drafting"
//     no_response  "no response: <arena> work drew no verdict; agree a follow-up window
//                   with the venue before counting an attempt as sent"
//     + "feedback (scrubbed): <text>" when the scrubbed feedback still says something
//   per recipe, beside those:
//     paid-work-opportunity-qualification  the qualification score and its two facts
//     pre-send-deliverable-verification    evidence counted by kind with pass/fail
//     disclosed-proposal-writing           whether the disclosure item was ticked

/** The recipe slugs that receive a bullet of their own (recipes.ts GIG_SHARED_RECIPES). */
export const LESSON_RECIPE_QUALIFICATION = "paid-work-opportunity-qualification";
export const LESSON_RECIPE_VERIFICATION = "pre-send-deliverable-verification";
export const LESSON_RECIPE_DISCLOSURE = "disclosed-proposal-writing";

/** The longest scrubbed feedback a bullet carries. */
export const LESSON_FEEDBACK_MAX_CHARS = 280;

export type GigLessonEvidence = { kind: GigEvidenceKind; passed: boolean | null };

export type GigLessonInput = {
  arena: GigArena;
  verdict: GigOutcomeVerdict;
  /** The specialist's adopted recipes; one lesson per recipe. */
  recipes: readonly RecipeRef[];
  /** The sent attempt's deliverable evidence ([] = none recorded or no attempt known). */
  evidence: readonly GigLessonEvidence[];
  /** The arena's checklist keys and the review's ticks (null ticks = never reviewed). */
  checklist: { keys: readonly string[]; ticked: Readonly<Record<string, boolean>> | null };
  /** The client's, maintainer's or program's words, verbatim; scrubbed here. */
  feedbackText: string | null;
  /** Names that must never leave: the gig's org/client, the listing title. */
  scrubNames: readonly (string | null | undefined)[];
  qualification: GigQualification | null;
};

export type DerivedGigLesson = { recipe: RecipeRef; bullets: string[] };

// ---------------------------------------------------------------------------
// Feedback scrubbing
// ---------------------------------------------------------------------------

const URL_RE = /\b(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>"')\]]+/gi;
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const HANDLE_RE = /(^|[^\w@])@[A-Za-z0-9_][\w.-]*/g;
const LONG_NUMBER_RE = /\d{7,}/g;
/** An absolute path (unix or drive letter) or a relative one with two or more separators. */
const PATH_RE = /(?:[A-Za-z]:[\\/]|~[\\/]|(?<![\w.])[\\/])[\w.-]+(?:[\\/][\w.-]+)*|\b[\w.-]+(?:[\\/][\w.-]+){2,}/g;
/** A credential-looking run: 24+ chars of token alphabet carrying both a letter and a digit. */
const SECRET_RE = /\b(?=[A-Za-z0-9_\-+/=]*\d)(?=[A-Za-z0-9_\-+/=]*[A-Za-z])[A-Za-z0-9_\-+/=]{24,}/g;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The forms of a name that are removed: the whole name, and each of its words of four
 *  or more letters ("Acme Robotics" also drops a bare "Acme"). */
function nameForms(names: readonly (string | null | undefined)[]): string[] {
  const forms = new Set<string>();
  for (const raw of names) {
    const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
    if (name.length < 2) continue;
    forms.add(name);
    for (const word of name.split(/[^\p{L}\p{N}]+/u)) if (word.length >= 4) forms.add(word);
  }
  // Longest first, so the whole name goes before its words.
  return [...forms].sort((a, b) => b.length - a.length);
}

/** Client feedback made fit for a shared registry, or null when nothing generalizable is
 *  left. Drops URLs, e-mail addresses, @handles, numbers longer than six digits, paths,
 *  credential-looking runs and every form of the given names (case-insensitive); then
 *  collapses whitespace and clips to LESSON_FEEDBACK_MAX_CHARS. */
export function scrubGigFeedback(text: string | null | undefined, names: readonly (string | null | undefined)[]): string | null {
  if (typeof text !== "string" || !text.trim()) return null;
  let out = text.normalize("NFKC");
  out = out.replace(URL_RE, " ");
  out = out.replace(EMAIL_RE, " ");
  out = out.replace(HANDLE_RE, "$1 ");
  out = out.replace(PATH_RE, " ");
  out = out.replace(SECRET_RE, " ");
  out = out.replace(LONG_NUMBER_RE, " ");
  for (const form of nameForms(names)) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(form)}(?![\\p{L}\\p{N}])`, "giu"), " ");
  }
  out = out
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,.;:!?-]+|[\s,;:-]+$/g, "")
    .trim();
  if ((out.match(/\p{L}/gu) ?? []).length < 3) return null;
  if (out.length > LESSON_FEEDBACK_MAX_CHARS) out = `${out.slice(0, LESSON_FEEDBACK_MAX_CHARS - 1).trimEnd()}…`;
  return out;
}

// ---------------------------------------------------------------------------
// Bullets
// ---------------------------------------------------------------------------

function arenaWords(arena: GigArena): string {
  return (GIG_ARENA_LABEL[arena] ?? arena).toLowerCase();
}

function evidenceKindsPhrase(evidence: readonly GigLessonEvidence[]): string {
  const kinds = [...new Set(evidence.map((e) => e.kind))];
  return kinds.length > 0 ? kinds.join(", ") : "no recorded evidence";
}

function checklistPhrase(c: GigLessonInput["checklist"]): string {
  if (!c.ticked) return "no review was recorded";
  const ticked = c.keys.filter((k) => c.ticked?.[k] === true).length;
  return `${ticked}/${c.keys.length} items ticked`;
}

function unticked(c: GigLessonInput["checklist"]): string[] {
  if (!c.ticked) return [];
  return c.keys.filter((k) => c.ticked?.[k] !== true);
}

/** The bullets every adopted recipe receives. */
export function commonLessonBullets(input: GigLessonInput): string[] {
  const arena = arenaWords(input.arena);
  const checklist = checklistPhrase(input.checklist);
  const evidence = evidenceKindsPhrase(input.evidence);
  const out: string[] = [];
  switch (input.verdict) {
    case "accepted":
      out.push(`accepted: ${arena} work whose evidence included ${evidence} and whose checklist had ${checklist}`);
      break;
    case "rejected": {
      out.push(`rejected: ${arena} work whose evidence included ${evidence} and whose checklist had ${checklist}`);
      const open = unticked(input.checklist);
      if (open.length > 0) out.push(`left unticked before sending: ${open.join(", ")}`);
      break;
    }
    case "duplicate":
      out.push("rejected as duplicate: check for prior reports before drafting");
      break;
    case "no_response":
      out.push(`no response: ${arena} work drew no verdict; agree a follow-up window with the venue before counting an attempt as sent`);
      break;
  }
  const feedback = scrubGigFeedback(input.feedbackText, input.scrubNames);
  if (feedback) out.push(`feedback (scrubbed): ${feedback}`);
  return out;
}

function qualificationBullet(input: GigLessonInput): string | null {
  const q = input.qualification;
  if (!q) return null;
  const headroom = q.factors.deadlineHeadroomDays;
  const deadline = headroom === null ? "not stated" : `${headroom} days`;
  return `${input.verdict} at qualification score ${q.score}/100 (reward stated: ${q.factors.rewardKnown ? "yes" : "no"}; deadline headroom: ${deadline})`;
}

function verificationBullet(input: GigLessonInput): string {
  if (input.evidence.length === 0) return `${input.verdict} with no evidence run before sending`;
  const byKind = new Map<string, { n: number; passed: number; failed: number }>();
  for (const e of input.evidence) {
    const acc = byKind.get(e.kind) ?? { n: 0, passed: 0, failed: 0 };
    acc.n += 1;
    if (e.passed === true) acc.passed += 1;
    else if (e.passed === false) acc.failed += 1;
    byKind.set(e.kind, acc);
  }
  const parts = [...byKind.entries()].map(([kind, a]) => `${kind} x${a.n} (${a.passed} passed, ${a.failed} failed)`);
  return `${input.verdict} with evidence at send time: ${parts.join("; ")}`;
}

function disclosureBullet(input: GigLessonInput): string {
  const ticks = input.checklist.ticked;
  const state = !ticks ? "not reviewed" : ticks[GIG_DISCLOSURE_ITEM] === true ? "ticked" : "not ticked";
  return `${input.verdict} with the AI-use disclosure ${state} before sending`;
}

/** One lesson per adopted recipe: the common bullets, plus the recipe's own bullet when
 *  it has one. A recipe listed twice yields one lesson. */
export function deriveGigLessons(input: GigLessonInput): DerivedGigLesson[] {
  const common = commonLessonBullets(input);
  const seen = new Set<string>();
  const out: DerivedGigLesson[] = [];
  for (const recipe of input.recipes) {
    if (!recipe || typeof recipe.slug !== "string" || !recipe.slug || seen.has(recipe.slug)) continue;
    seen.add(recipe.slug);
    const own: (string | null)[] = [];
    if (recipe.slug === LESSON_RECIPE_QUALIFICATION) own.push(qualificationBullet(input));
    if (recipe.slug === LESSON_RECIPE_VERIFICATION) own.push(verificationBullet(input));
    if (recipe.slug === LESSON_RECIPE_DISCLOSURE) own.push(disclosureBullet(input));
    const bullets = [...common, ...own.filter((b): b is string => typeof b === "string")];
    if (bullets.length > 0) out.push({ recipe: { slug: recipe.slug, version: recipe.version }, bullets });
  }
  return out;
}
