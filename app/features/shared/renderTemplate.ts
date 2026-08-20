// Pure template rendering — used both server-side (store seed) and client-side
// (the composer's live preview). A template is markdown with {{placeholders}};
// list placeholders expand to bullet lists.

import type { JdTemplate } from "@/app/_lib/templates-store";

export type TemplateData = {
  title?: string;
  company?: string;
  seniority?: string;
  salary?: string;
  about?: string;
  responsibilities?: string[];
  mustHaves?: string[];
  niceToHaves?: string[];
};

export const TEMPLATE_PLACEHOLDERS = [
  "title",
  "company",
  "seniority",
  "salary",
  "about",
  "responsibilities",
  "mustHaves",
  "niceToHaves",
] as const;

// ── Output-language localization tokens (one-language-jd) ────────────────────
// composeMarkdown localizes its section headings for cs, but a template-rendered
// build used the template's OWN static headings — so a cs generate through the
// (English) seeded default produced Czech role content under English headings
// ("About us / The role / What we offer"). The fix: LANG-AWARE tokens resolved
// per OUTPUT language at render time (renderTemplate's 3rd arg). The SEEDED
// default (DEFAULT_TEMPLATE_BODY) uses them so it localizes end-to-end; a
// USER-authored template keeps its literal headings — the author's choice, never
// machine-translated — but MAY opt into these tokens. Two example-filler tokens
// (offer_note/apply_note) localize the seeded default's sample bullets too, so a
// cs build from the default is single-language throughout. These are NOT data
// placeholders (they take no value from `data`); they resolve from the TemplateTokens
// map the caller passes in.
export const TEMPLATE_LOCALIZED_TOKENS = [
  "heading_about",
  "heading_role",
  "heading_requirements",
  "heading_nice",
  "heading_offer",
  "heading_apply",
  "offer_note",
  "apply_note",
] as const;

export type LocalizedToken = (typeof TEMPLATE_LOCALIZED_TOKENS)[number];

/** The resolved text for every localization token, in the JD's OUTPUT language.
 *  Passed IN rather than looked up here (the pure-builder rule in
 *  docs/architecture/localization.md) — this module is imported by the template
 *  manager on the client, so it must not carry a catalog loader.
 *
 *  DOCUMENT-READER side: a JD is read by whoever the posting reaches, so its
 *  scaffolding follows the build's `lang`, never the recruiter's cookie.
 *  `jdTemplateTokens(lang)` in app/_lib/jd-template-tokens.ts is the loader.
 *
 *  F5 — this used to be a `Record<"en" | "cs", …>` table right here, so a de/fr
 *  build put localized role CONTENT under ENGLISH headings, which is the exact
 *  single-language defect the tokens were introduced to fix. The copy now lives in
 *  `library.templates.token.*` (all four locales). Two notes that moved with it:
 *  the role CONTENT (responsibilities/skills) is generated in the output language
 *  by the design chain, so only this structural scaffolding + the seeded sample
 *  filler is templated; and the filler is deliberately concrete and
 *  coded-language-free so a JD rendered from the default still LINTS CLEAN
 *  (jd-lint) — each language keeps a work-mode word ("hybrid" / "hybridní" /
 *  "hybrides Arbeiten" / "travail hybride") for the place signal jd-lint checks. */
export type TemplateTokens = Record<LocalizedToken, string>;

// Every token the renderer knows (data placeholders + localization tokens) — the
// single source both findUnknownPlaceholders and the supported-list message read,
// so the validator can never flag a token the renderer actually substitutes.
const ALL_KNOWN_TOKENS: readonly string[] = [...TEMPLATE_PLACEHOLDERS, ...TEMPLATE_LOCALIZED_TOKENS];

// The seeded "Company standard" template. Headings + sample filler are LANG-AWARE
// tokens (TEMPLATE_LOCALIZED_TOKENS) resolved per output language at render, so a
// cs build reads single-language instead of Czech content under English headings.
// The filler (offer_note/apply_note in the token catalog) must LINT CLEAN — a JD
// rendered from this is surfaced through JdLintPanel (Ledger read-view + editor),
// and the old "Competitive pay…" line was exactly the boilerplate jd-lint flags.
export const DEFAULT_TEMPLATE_BODY = `# {{title}}
**{{company}}** · {{seniority}} · {{salary}}

## {{heading_about}}
{{about}}

## {{heading_role}}
{{responsibilities}}

## {{heading_requirements}}
{{mustHaves}}

## {{heading_nice}}
{{niceToHaves}}

## {{heading_offer}}
- {{offer_note}}

## {{heading_apply}}
- {{apply_note}}`;

// The middot separator used by the default template's `**company** · seniority ·
// salary` header line. Kept as a named constant so the collapse contract below
// and the unit tests (render-template.test.ts) reference one source of truth.
export const TEMPLATE_SEPARATOR = " · ";

// Private-use sentinel (U+E000) that marks where a placeholder rendered to an
// empty string. It never appears in real markdown, and we strip any pre-existing
// copy from the body so template authors can't spoof it. See the collapse contract.
const EMPTY_MARK = "\uE000";

// The one definition of "what a placeholder token looks like". Both the renderer
// (which substitutes these) and the linter below (which validates them against
// TEMPLATE_PLACEHOLDERS) read from this single regex, so they can never disagree
// on what counts as a token. Global flag: `.replace` resets lastIndex each call
// and `.matchAll` operates on a clone, so sharing one object is safe here.
const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g;

// Separator-collapse contract
// ----------------------------
// `renderTemplate` substitutes every `{{key}}` with its value from `data`
// (trimmed, with the fallbacks in `map`); an unknown `{{key}}` is left verbatim.
// Some placeholders can render empty (today only `{{seniority}}` and
// `{{salary}}`), which on the default header line
//     **{{company}}** · {{seniority}} · {{salary}}
// would otherwise leave dangling `TEMPLATE_SEPARATOR`s. The contract:
//
//   • A separator immediately adjacent to a placeholder that rendered empty is
//     removed together with that empty value — on EITHER side, in ANY ordering:
//         seniority empty → **Acme** · 120k
//         salary empty    → **Acme** · Senior
//         both empty      → **Acme**
//   • A literal `TEMPLATE_SEPARATOR` typed into static template text is NEVER
//     removed, regardless of layout — only separators touching an empty
//     placeholder collapse. (The previous implementation regex-scanned the
//     finished markdown and could silently mangle a real middot in custom
//     templates; this version only collapses separator↔empty-marker pairs.)
//
// These cases are pinned by render-template.test.ts.
//
// `localized` (one-language-jd) carries the resolution for TEMPLATE_LOCALIZED_TOKENS
// (heading_*/offer_note/apply_note) so the SEEDED default's structural scaffolding
// renders in the JD's output language. It does not touch data placeholders or a
// user template's literal headings. Required, not optional: an omitted map would
// ship raw `{{heading_about}}` onto a public posting, so the type system asks the
// caller which language the document is in.
export function renderTemplate(body: string, data: TemplateData, localized: TemplateTokens): string {
  const bullets = (arr?: string[]) => (arr && arr.length ? arr.map((s) => `- ${s}`).join("\n") : "- —");
  const map: Record<string, string> = {
    title: data.title?.trim() || "Role title",
    company: data.company?.trim() || "Company",
    seniority: data.seniority?.trim() || "",
    salary: data.salary?.trim() || "",
    // No canned company blurb: the build supplies no real `about`, and emitting the
    // same "trusted by millions…" sentence into EVERY JD was identical filler the lint
    // itself flags as vague. Empty here renders nothing — and the section-collapse below
    // drops the now-empty "## About us" header so it isn't an awkward empty section.
    about: data.about?.trim() || "",
    responsibilities: bullets(data.responsibilities),
    mustHaves: bullets(data.mustHaves),
    niceToHaves: bullets(data.niceToHaves),
  };

  // Substitute placeholders, marking empty values with the sentinel so the
  // collapse step can find the separators that became orphaned by them.
  const substituted = body
    .replaceAll(EMPTY_MARK, "")
    .replace(PLACEHOLDER_RE, (_, key: string) => {
      // Localization tokens resolve per output language (never empty), so after this
      // pass the intermediate string is identical to a literal-heading template — the
      // separator/section-collapse below then behaves exactly as before.
      //
      // OWN properties only. `key in obj` walks the PROTOTYPE chain, so a token
      // naming an Object.prototype member ({{constructor}}, {{toString}},
      // {{__proto__}} — all `\w+`, all matched by PLACEHOLDER_RE) resolved to a
      // built-in and rendered `function Object() { [native code] }` onto the JD
      // instead of staying verbatim. That broke the module's stated invariant —
      // "what findUnknownPlaceholders flags is exactly what renderTemplate leaves
      // raw" — which is the whole basis of the BLOCKED unknown-token policy: the
      // linter reported {{constructor}} as unknown while the renderer silently
      // substituted it. Object.hasOwn restores the invariant for every token.
      if (Object.hasOwn(localized, key)) return localized[key as LocalizedToken];
      if (!Object.hasOwn(map, key)) return `{{${key}}}`;
      return map[key] === "" ? EMPTY_MARK : map[key];
    });

  // Section collapse: a markdown header whose entire body was an empty placeholder
  // (e.g. an unfilled `{{about}}` alone under "## About us") is dropped header-and-all,
  // so the section vanishes cleanly rather than leaving a dangling empty heading. Only
  // a header immediately followed by a lone marker line matches — inline empties on the
  // `**company** · seniority · salary` line aren't ATX headers, so they're untouched
  // and still handled by the separator collapse below.
  // Then collapse a separator adjacent to an empty marker (either side), and finally
  // drop any lone markers that had no separator beside them.
  return substituted
    .replace(/(^|\n)#{1,6} [^\n]*\n(?=\n|$)/g, "$1")
    .replaceAll(`${TEMPLATE_SEPARATOR}${EMPTY_MARK}`, "")
    .replaceAll(`${EMPTY_MARK}${TEMPLATE_SEPARATOR}`, "")
    .replaceAll(EMPTY_MARK, "");
}

// ---- Placeholder validation -----------------------------------------------
//
// Unknown-token policy: BLOCKED
// -----------------------------
// renderTemplate leaves any {{token}} not in TEMPLATE_PLACEHOLDERS verbatim in
// its output, so a typo ({{tilte}}) or an out-of-set token ({{location}},
// {{roleFamily}}) would render raw onto a public, shareable JD page. We make
// that impossible at save time by BLOCKING — not stripping or keeping — bodies
// that reference unknown tokens:
//   • blocked  ← chosen. JdTemplateManager warns live and disables Save, and
//                POST/PUT /api/templates return 400, so the author fixes the
//                token before it can ship. The error is precise and reversible.
//   • stripped ← rejected. Silently deleting an author's text hides the mistake
//                and would quietly mangle any intentional "{{…}}" content.
//   • kept     ← rejected. This is the original defect: the raw token ships.
// The renderer is intentionally left as-is (still emits unknown tokens verbatim)
// so it stays a pure, total function; this guard is the gate that stops such a
// body from ever being stored.

/** The unique unknown {{token}} names in a template body, in first-seen order.
 *  An empty array means every placeholder is one of TEMPLATE_PLACEHOLDERS. This
 *  is the single source of truth behind the manager's live warning and the
 *  templates API's 400 guard, so client and server can never disagree on which
 *  tokens are valid. Matches exactly the tokens renderTemplate would substitute
 *  (same PLACEHOLDER_RE), so it flags precisely what would otherwise ship raw. */
export function findUnknownPlaceholders(body: string): string[] {
  const known = new Set<string>(ALL_KNOWN_TOKENS);
  const seen = new Set<string>();
  const unknown: string[] = [];
  for (const [, key] of body.matchAll(PLACEHOLDER_RE)) {
    if (!known.has(key) && !seen.has(key)) {
      seen.add(key);
      unknown.push(key);
    }
  }
  return unknown;
}

/** `{{a}}, {{b}}` for a token-name list — shared by the English message below and
 *  the manager's localized one so both render tokens identically. */
export function formatTokens(tokens: string[]): string {
  return tokens.map((k) => `{{${k}}}`).join(", ");
}

/** The full supported-token list as `{{title}}, {{company}}, …` (data placeholders
 *  + localization tokens), for both the English message and the localized one. */
export const SUPPORTED_PLACEHOLDER_LIST = formatTokens([...ALL_KNOWN_TOKENS]);

/** Human-readable (English) message for a non-empty list of unknown tokens — the
 *  API-400 / consumer fallback. The manager localizes via `localizeTemplateError`
 *  ({ code: "unknownTokens" }); both read the same formatTokens/SUPPORTED list so
 *  they can't drift on which tokens are named. */
export function unknownPlaceholderMessage(unknown: string[]): string {
  return `Unknown placeholder${unknown.length === 1 ? "" : "s"}: ${formatTokens(unknown)}. Use only the supported placeholders: ${SUPPORTED_PLACEHOLDER_LIST}.`;
}

// ---- Stable validation-error codes (one-language-jd) -----------------------
//
// The validators return raw English in `error` — fine for API consumers (the
// route forwards it) but wrong for the manager, which renders in the recruiter's
// locale. So every failure now ALSO carries a stable `reason` CODE (+ any
// interpolation values); the manager maps the code → a localized string (4
// locales) while the server keeps the English `error` untouched. One switch
// (templateErrorMessage) is the English source; the manager mirrors it with t().
export type TemplateFieldError =
  | { code: "bothRequired" }
  | { code: "nameEmpty" }
  | { code: "bodyEmpty" }
  | { code: "tooLong"; field: "name" | "body"; max: number }
  | { code: "unknownTokens"; tokens: string[] };

/** The English rendering of a validation-error code — the API/consumer fallback,
 *  kept wording-identical to the pre-codes messages so existing consumers + tests
 *  are unchanged. The manager localizes the SAME codes via next-intl. */
export function templateErrorMessage(reason: TemplateFieldError): string {
  switch (reason.code) {
    case "bothRequired":
      return "Template name and body are both required.";
    case "nameEmpty":
      return "Template name can't be empty.";
    case "bodyEmpty":
      return "Template body can't be empty.";
    case "tooLong":
      return `Template ${reason.field} must be ${reason.max.toLocaleString("en-US")} characters or fewer.`;
    case "unknownTokens":
      return unknownPlaceholderMessage(reason.tokens);
  }
}

// ---- Template field length caps & validation ------------------------------
//
// A template is a fan-out point: it is re-fetched on every builder/manager open
// and rendered into every JD generated from it. Saved JDs are already length-
// capped at their write boundary (JD_TITLE_MAX_LENGTH / JD_BODY_MAX_LENGTH in
// jd-limits.ts); templates were not — POST/PUT /api/templates accepted an
// arbitrary-length name/body behind only a truthiness check, so a multi-megabyte
// body could be stored, re-fetched, and re-rendered indefinitely (unbounded
// storage growth + slow renders). These caps mirror the JD caps the team already
// trusts and are enforced by the validators below at the write boundary AND by
// the manager's inputs (maxLength + counter), so the two can't drift on bounds.
export const TEMPLATE_NAME_MAX_LENGTH = 200;
export const TEMPLATE_BODY_MAX_LENGTH = 20000;

// Single source for the over-cap check, shared by both validators below so the
// create and edit paths can't drift. Returns the tooLong CODE, or null in bounds.
function templateTooLong(field: "name" | "body", value: string, max: number): TemplateFieldError | null {
  return value.length > max ? { code: "tooLong", field, max } : null;
}

// A failure result carrying BOTH the English `error` (API/consumer + route) and
// the stable `reason` code (manager localizes it). One helper so the two never drift.
function fail(reason: TemplateFieldError): { ok: false; error: string; reason: TemplateFieldError } {
  return { ok: false, error: templateErrorMessage(reason), reason };
}

export type TemplateFieldsResult =
  | { ok: true; name: string; body: string }
  | { ok: false; error: string; reason: TemplateFieldError };

/** Required-and-length validation for a NEW template's name/body (POST
 *  /api/templates) — the single source for both the caps AND the exact error
 *  wording, shared by the write boundary and the manager form so they can't
 *  drift. Trims both fields and rejects a whitespace-only name (which the store
 *  would otherwise silently coerce to "Untitled template") or body. Returns the
 *  trimmed fields on success, or one user-facing error. Accepts `unknown` so a
 *  raw request field can be passed without re-implementing the string guard. */
export function validateTemplateFields(name: unknown, body: unknown): TemplateFieldsResult {
  const n = typeof name === "string" ? name.trim() : "";
  const b = typeof body === "string" ? body.trim() : "";
  if (!n || !b) return fail({ code: "bothRequired" });
  const lenError = templateTooLong("name", n, TEMPLATE_NAME_MAX_LENGTH) ?? templateTooLong("body", b, TEMPLATE_BODY_MAX_LENGTH);
  if (lenError) return fail(lenError);
  return { ok: true, name: n, body: b };
}

export type TemplateUpdateResult =
  | { ok: true; name?: string; body?: string }
  | { ok: false; error: string; reason: TemplateFieldError };

/** Partial validation for an in-place template edit (PUT /api/templates/[id]),
 *  where name and body are each optional (a rename-only or body-only edit; a
 *  promote-to-default carries neither). Only the fields actually present are
 *  trimmed, capped, and returned — and a present field may not be whitespace-only
 *  — so a partial edit can neither store an empty name/body nor exceed the caps.
 *  Same caps and wording as validateTemplateFields, via templateTooLong. */
export function validateTemplateUpdate(input: { name?: unknown; body?: unknown }): TemplateUpdateResult {
  const out: { name?: string; body?: string } = {};
  if (input.name !== undefined) {
    const n = typeof input.name === "string" ? input.name.trim() : "";
    if (!n) return fail({ code: "nameEmpty" });
    const e = templateTooLong("name", n, TEMPLATE_NAME_MAX_LENGTH);
    if (e) return fail(e);
    out.name = n;
  }
  if (input.body !== undefined) {
    const b = typeof input.body === "string" ? input.body.trim() : "";
    if (!b) return fail({ code: "bodyEmpty" });
    const e = templateTooLong("body", b, TEMPLATE_BODY_MAX_LENGTH);
    if (e) return fail(e);
    out.body = b;
  }
  return { ok: true, ...out };
}

// ---- Client-facing template list ------------------------------------------

/** The client-facing subset of a stored JD template — exactly what the JD builder
 *  and the template manager render. Derived from the store's JdTemplate (Pick) so
 *  the UI shape can't silently drift from the DB row it represents. */
export type Template = Pick<JdTemplate, "id" | "name" | "body" | "isDefault" | "scope">;

/** Load the company JD templates from the API. One shared fetch contract — the
 *  endpoint shape AND the swallow-to-empty error behavior — for every caller, so a
 *  change to either lives in one place. JdBuilder layers its default-selection
 *  reconciliation on top of the returned list. */
export async function fetchTemplates(): Promise<Template[]> {
  try {
    const payload = await fetch("/api/templates").then((r) => r.json());
    return (payload.templates as Template[]) ?? [];
  } catch {
    return [];
  }
}
