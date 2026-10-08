import type { RoleBrief, RoleSpec } from "./rolespec";

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
//
// Conservative on purpose: a false 'added' costs the author a glance, a false 'brief'
// hides an invention. KNOWN MISSES (all resolve to 'added'): inflection (Czech
// "vývojáři" vs "vývojář"), translation (an English need built into a Czech JD), a
// synonym or a paraphrase that keeps < 60% of the words. KNOWN OVER-TRUST (resolve to
// 'brief'): a sentence that reuses ≥ 60% of the author's words but flips their meaning
// ("no Kubernetes" vs "Kubernetes"), and a short line that is a substring of an
// unrelated phrase of the input.
export const ROLE_TRACE_RULE = "overlap-v1";
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
export function authorInputTokens(input: AuthorInput): string[] {
  const parts: string[] = [input.title ?? "", input.needText ?? ""];
  const b = input.brief;
  if (b) {
    parts.push(b.title ?? "", b.summary ?? "");
    parts.push(...(b.languages ?? []), ...(b.responsibilities ?? []), ...(b.successCriteria ?? []));
    for (const r of b.requirements ?? []) parts.push(r.skill ?? "");
    for (const f of b.facets ?? []) parts.push(f.label ?? "", f.value ?? "");
  }
  return roleTraceTokens(parts.join("\n"));
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
  const out: RoleTraceLine[] = [];
  for (const section of ROLE_TRACE_SECTIONS) {
    for (const raw of spec[section] ?? []) {
      const text = typeof raw === "string" ? raw.trim() : "";
      if (text) out.push({ section, text, origin: lineOrigin(text, inputTokens) });
    }
  }
  return out;
}

/** The role's languages: what the author stated, never what the build invented.
 *  A brief that names languages wins outright; otherwise only the model's languages
 *  that the author's own input mentions survive. */
export function statedLanguages(modelLanguages: string[] | undefined, authorInput: AuthorInput): string[] {
  const fromBrief = (authorInput.brief?.languages ?? []).map((l) => l.trim()).filter(Boolean);
  if (fromBrief.length) return fromBrief;
  const inputTokens = authorInputTokens(authorInput);
  return (modelLanguages ?? []).map((l) => l.trim()).filter((l) => l && lineOrigin(l, inputTokens) === "brief");
}

/** How the role was designed — read off the CLI's provenance envelope. */
export type RoleDesignedBy = "model" | "fallback";
export type RoleTrace = {
  rule: string;
  designedBy: RoleDesignedBy;
  lines: RoleTraceLine[];
};

export function buildRoleTrace(
  spec: RoleSpec,
  authorInput: AuthorInput,
  provenance: { source?: string; perStepSources?: Record<string, string> }
): RoleTrace {
  const roleSource = provenance.perStepSources?.role ?? provenance.source ?? "deterministic";
  return {
    rule: ROLE_TRACE_RULE,
    designedBy: roleSource === "deterministic" ? "fallback" : "model",
    lines: traceRoleLines(spec, authorInput),
  };
}
