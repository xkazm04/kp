import type { RoleBrief, RoleSpec } from "./rolespec";
import { languageIds, languageMentions } from "./jd-languages";

// Stated vs added: for every line of a built RoleSpec, did the AUTHOR state it
// (title, need text, brief) or did the build supply it? Pure, deterministic, no
// imports beyond types, so jd-build-run, the Ledger parser and the tests share it.
//
// THE RULE (version ROLE_TRACE_RULE)
//   1. Normalise both sides: NFD + strip combining marks (so "Řízení" == "rizeni"),
//      lowercase, split into tokens of letters/digits. A trailing run of `+` or `#`
//      stays on the token (c++, c# are not "c").
//   2. A SHORT line (≤ SHORT_MAX_TOKENS tokens) is 'brief' when its tokens appear as a
//      contiguous run in the author's input ("Czech" in "fluent Czech required").
//   3. A LONGER line is a sentence. Its CONTENT words are its tokens minus stop words
//      and minus tokens shorter than 3 chars (digits and c++/c#-style tokens are kept).
//      It is 'brief' when it has ≥ 2 content words and at least SENTENCE_OVERLAP of
//      them occur (exact token equality) in the author's input token set.
//   4. Anything else — including empty input, a line with no content words — is 'added'.
//   5. LANGUAGES (lang-v1) are matched by IDENTITY, not by tokens (jd-languages.ts): a model
//      language whose name is in the lexicon is stated when the author's input names the
//      same language in any form (češtiny = Čeština = Czech) in a clause with no negation
//      cue ("No English needed", "bez angličtiny", "angličtina není nutná" do not state
//      it). A language not in the lexicon falls back to rules 2-4. A brief that names
//      languages wins outright. Every model language removed is recorded as a dropped
//      language with its reason (unstated / negated / superseded by the brief).
//
// Conservative on purpose: a false 'added' costs the author a glance, a false 'brief'
// hides an invention. KNOWN MISSES (all resolve to 'added'): inflection of anything but a
// language name (Czech "vývojáři" vs "vývojář"), translation of a skill, a synonym or a
// paraphrase that keeps < 60% of the words, a language named only by a Czech adjective
// without "jazyk", and "not only English but also German" (the cue negates English).
// KNOWN OVER-TRUST (resolve to 'brief'): a sentence that reuses ≥ 60% of the author's
// words but flips their meaning ("no Kubernetes" vs "Kubernetes"), a short line that is a
// substring of an unrelated phrase of the input, and a language name used for something
// else: "experience with the Czech market" states Czech (pinned in the tests), as does a
// bare "česky".
export const ROLE_TRACE_RULE = "overlap-v1+lang-v1";
export const SHORT_MAX_TOKENS = 3;
export const SENTENCE_OVERLAP = 0.6;

export const ROLE_TRACE_SECTIONS = ["mustHaves", "niceToHaves", "responsibilities", "languages"] as const;
export type RoleTraceSection = (typeof ROLE_TRACE_SECTIONS)[number];
export type RoleLineOrigin = "brief" | "added";
export type RoleTraceLine = { section: RoleTraceSection; text: string; origin: RoleLineOrigin };

/** What the author typed, as the build received it. */
export type AuthorInput = { title?: string; needText?: string; brief?: RoleBrief | null };

const STOP_WORDS = new Set(
  [
    // en
    "the", "and", "for", "with", "that", "this", "from", "into", "are", "was", "will", "you", "your", "our", "their",
    "have", "has", "had", "can", "able", "must", "should", "all", "any", "such", "not", "but", "per", "via", "etc",
    "who", "what", "how", "when", "where", "within", "across", "using", "use", "work", "working",
    // cs
    "ale", "nebo", "pro", "pri", "pod", "nad", "jako", "jak", "kde", "kdy", "ktery", "ktera", "ktere", "jsou", "byt",
    "bude", "mit", "se", "si", "na", "ve", "ze", "do", "od", "po", "je", "to", "tak", "aby", "pokud",
  ].map((w) => w.normalize("NFD").replace(/[̀-ͯ]/g, ""))
);

/** Lowercased, diacritic-free tokens. `+`/`#` stick to the token they follow. */
export function roleTraceTokens(text: string): string[] {
  const flat = (text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return flat.match(/[a-z0-9]+(?:[+#]+)?/g) ?? [];
}

function contentWords(tokens: string[]): string[] {
  return tokens.filter((t) => !STOP_WORDS.has(t) && (t.length >= 3 || /[0-9+#]/.test(t)));
}

function containsRun(haystack: string[], needle: string[]): boolean {
  if (!needle.length || needle.length > haystack.length) return false;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    let j = 0;
    while (j < needle.length && haystack[i + j] === needle[j]) j++;
    if (j === needle.length) return true;
  }
  return false;
}

/** The author's own words, flattened. Brief fields the AUTHOR filled are included;
 *  the intake's model-written rationale / provenance are not. */
export function authorInputText(input: AuthorInput): string {
  const parts: string[] = [input.title ?? "", input.needText ?? ""];
  const b = input.brief;
  if (b) {
    parts.push(b.title ?? "", b.summary ?? "");
    parts.push(...(b.languages ?? []), ...(b.responsibilities ?? []), ...(b.successCriteria ?? []));
    for (const r of b.requirements ?? []) parts.push(r.skill ?? "");
    for (const f of b.facets ?? []) parts.push(f.label ?? "", f.value ?? "");
  }
  return parts.join("\n");
}

export function authorInputTokens(input: AuthorInput): string[] {
  return roleTraceTokens(authorInputText(input));
}

/** Origin of ONE line against already-tokenised author input. */
export function lineOrigin(line: string, inputTokens: string[]): RoleLineOrigin {
  const tokens = roleTraceTokens(line);
  if (!tokens.length || !inputTokens.length) return "added";
  if (tokens.length <= SHORT_MAX_TOKENS) return containsRun(inputTokens, tokens) ? "brief" : "added";
  const words = contentWords(tokens);
  if (words.length < 2) return "added";
  const have = new Set(inputTokens);
  const hit = words.filter((w) => have.has(w)).length;
  return hit / words.length >= SENTENCE_OVERLAP ? "brief" : "added";
}

/** Every non-blank line of the spec's four lists, tagged with where it came from. */
export function traceRoleLines(spec: RoleSpec | null | undefined, authorInput: AuthorInput): RoleTraceLine[] {
  if (!spec) return [];
  const inputTokens = authorInputTokens(authorInput);
  const mentions = languageMentions(authorInputText(authorInput));
  const out: RoleTraceLine[] = [];
  for (const section of ROLE_TRACE_SECTIONS) {
    for (const raw of spec[section] ?? []) {
      const text = typeof raw === "string" ? raw.trim() : "";
      if (!text) continue;
      const origin = section === "languages" ? languageOrigin(text, inputTokens, mentions) : lineOrigin(text, inputTokens);
      out.push({ section, text, origin });
    }
  }
  return out;
}

type Mentions = ReturnType<typeof languageMentions>;
export type DroppedLanguageReason = "unstated" | "negated" | "superseded";
export type DroppedLanguage = { text: string; reason: DroppedLanguageReason };
export const DROPPED_LANGUAGE_REASONS: readonly DroppedLanguageReason[] = ["unstated", "negated", "superseded"];

/** stated / negated / unstated for ONE model language against the author's input. */
function languageVerdict(lang: string, inputTokens: string[], mentions: Mentions): "stated" | "negated" | "unstated" {
  const ids = languageIds(lang);
  if (!ids.length) return lineOrigin(lang, inputTokens) === "brief" ? "stated" : "unstated";
  if (ids.some((id) => mentions.stated.has(id))) return "stated";
  return ids.some((id) => mentions.negated.has(id)) ? "negated" : "unstated";
}

function languageOrigin(lang: string, inputTokens: string[], mentions: Mentions): RoleLineOrigin {
  return languageVerdict(lang, inputTokens, mentions) === "stated" ? "brief" : "added";
}

const briefLanguages = (a: AuthorInput) => (a.brief?.languages ?? []).map((l) => l.trim()).filter(Boolean);

/** The role's languages: what the author stated, never what the build invented.
 *  A brief that names languages wins outright; otherwise only the model's languages
 *  that the author's own input states (by identity, not negated) survive. */
export function statedLanguages(modelLanguages: string[] | undefined, authorInput: AuthorInput): string[] {
  const fromBrief = briefLanguages(authorInput);
  if (fromBrief.length) return fromBrief;
  const inputTokens = authorInputTokens(authorInput);
  const mentions = languageMentions(authorInputText(authorInput));
  return (modelLanguages ?? []).map((l) => l.trim()).filter((l) => l && languageVerdict(l, inputTokens, mentions) === "stated");
}

/** Every model language statedLanguages removed, with why — so the Ledger can show a
 *  language the role does not ask. A model language the brief itself names is not dropped. */
export function droppedLanguages(modelLanguages: string[] | undefined, authorInput: AuthorInput): DroppedLanguage[] {
  const kept = statedLanguages(modelLanguages, authorInput);
  const keptKeys = new Set<string>(kept.flatMap((l) => [l.toLowerCase(), ...languageIds(l)]));
  const fromBrief = briefLanguages(authorInput).length > 0;
  const inputTokens = authorInputTokens(authorInput);
  const mentions = languageMentions(authorInputText(authorInput));
  const out: DroppedLanguage[] = [];
  const seen = new Set<string>();
  for (const raw of modelLanguages ?? []) {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    if (keptKeys.has(text.toLowerCase()) || languageIds(text).some((id) => keptKeys.has(id))) continue;
    const v = languageVerdict(text, inputTokens, mentions);
    out.push({ text, reason: fromBrief ? "superseded" : v === "negated" ? "negated" : "unstated" });
  }
  return out;
}

/** How the role was designed — read off the CLI's provenance envelope. */
export type RoleDesignedBy = "model" | "fallback";
export type RoleTrace = {
  rule: string;
  designedBy: RoleDesignedBy;
  lines: RoleTraceLine[];
  /** Model languages the build removed because the author did not state them. */
  droppedLanguages: DroppedLanguage[];
};

export function buildRoleTrace(
  spec: RoleSpec,
  authorInput: AuthorInput,
  provenance: { source?: string; perStepSources?: Record<string, string> },
  dropped: DroppedLanguage[] = []
): RoleTrace {
  const roleSource = provenance.perStepSources?.role ?? provenance.source ?? "deterministic";
  return {
    rule: ROLE_TRACE_RULE,
    designedBy: roleSource === "deterministic" ? "fallback" : "model",
    lines: traceRoleLines(spec, authorInput),
    droppedLanguages: dropped,
  };
}
