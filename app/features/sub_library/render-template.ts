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

// The seeded "Company standard" template. Its filler must LINT CLEAN — a JD
// rendered from it is surfaced through JdLintPanel (the Ledger read-view + the
// editor), and the old "Competitive pay…" offer line was exactly the boilerplate
// jd-lint's VAGUE_PATTERNS flags, so the seeded standard contradicted its own
// linter. Keep the offer/apply filler concrete (no "competitive/attractive pay",
// no coded language) and keep a work-mode word ("hybrid") so the posting also
// carries a place-of-work signal.
export const DEFAULT_TEMPLATE_BODY = `# {{title}}
**{{company}}** · {{seniority}} · {{salary}}

## About us
{{about}}

## The role
{{responsibilities}}

## What we're looking for
{{mustHaves}}

## Nice to have
{{niceToHaves}}

## What we offer
- Hybrid working, meaningful ownership, and room to grow.

## How to apply
- Apply via the link — a short conversation, then a first-round interview.`;

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
export function renderTemplate(body: string, data: TemplateData): string {
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
      if (!(key in map)) return `{{${key}}}`;
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
  const known = new Set<string>(TEMPLATE_PLACEHOLDERS);
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

/** Human-readable message for a non-empty list of unknown tokens, shared by the
 *  manager warning and the API 400 so the wording lives in one place. */
export function unknownPlaceholderMessage(unknown: string[]): string {
  const tokens = unknown.map((k) => `{{${k}}}`).join(", ");
  return `Unknown placeholder${unknown.length === 1 ? "" : "s"}: ${tokens}. Use only the supported placeholders: ${TEMPLATE_PLACEHOLDERS.map((p) => `{{${p}}}`).join(", ")}.`;
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

// Single source for the over-cap wording, shared by both validators below so the
// create and edit paths can't drift on the message. Returns null when in bounds.
function templateTooLong(label: "name" | "body", value: string, max: number): string | null {
  return value.length > max ? `Template ${label} must be ${max.toLocaleString("en-US")} characters or fewer.` : null;
}

export type TemplateFieldsResult =
  | { ok: true; name: string; body: string }
  | { ok: false; error: string };

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
  if (!n || !b) return { ok: false, error: "Template name and body are both required." };
  const lenError = templateTooLong("name", n, TEMPLATE_NAME_MAX_LENGTH) ?? templateTooLong("body", b, TEMPLATE_BODY_MAX_LENGTH);
  if (lenError) return { ok: false, error: lenError };
  return { ok: true, name: n, body: b };
}

export type TemplateUpdateResult =
  | { ok: true; name?: string; body?: string }
  | { ok: false; error: string };

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
    if (!n) return { ok: false, error: "Template name can't be empty." };
    const e = templateTooLong("name", n, TEMPLATE_NAME_MAX_LENGTH);
    if (e) return { ok: false, error: e };
    out.name = n;
  }
  if (input.body !== undefined) {
    const b = typeof input.body === "string" ? input.body.trim() : "";
    if (!b) return { ok: false, error: "Template body can't be empty." };
    const e = templateTooLong("body", b, TEMPLATE_BODY_MAX_LENGTH);
    if (e) return { ok: false, error: e };
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
