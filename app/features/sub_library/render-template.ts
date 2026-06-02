// Pure template rendering — used both server-side (store seed) and client-side
// (the composer's live preview). A template is markdown with {{placeholders}};
// list placeholders expand to bullet lists.

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
- Competitive pay, hybrid working, meaningful ownership, and room to grow.

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
    about: data.about?.trim() || `${data.company?.trim() || "We"} build technology trusted by millions — join a team that ships and owns what it builds.`,
    responsibilities: bullets(data.responsibilities),
    mustHaves: bullets(data.mustHaves),
    niceToHaves: bullets(data.niceToHaves),
  };

  // Substitute placeholders, marking empty values with the sentinel so the
  // collapse step can find the separators that became orphaned by them.
  const substituted = body
    .replaceAll(EMPTY_MARK, "")
    .replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      if (!(key in map)) return `{{${key}}}`;
      return map[key] === "" ? EMPTY_MARK : map[key];
    });

  // Collapse a separator adjacent to an empty marker (either side), then drop
  // any lone markers that had no separator beside them.
  return substituted
    .replaceAll(`${TEMPLATE_SEPARATOR}${EMPTY_MARK}`, "")
    .replaceAll(`${EMPTY_MARK}${TEMPLATE_SEPARATOR}`, "")
    .replaceAll(EMPTY_MARK, "");
}
