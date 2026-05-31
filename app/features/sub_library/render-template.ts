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
  // Substitute {{key}}; collapse the " · " separators if seniority/salary are empty.
  return body
    .replace(/\{\{(\w+)\}\}/g, (_, key) => map[key] ?? `{{${key}}}`)
    .replace(/ · (?= ·|\n|$)/g, "")
    .replace(/ · $/gm, "");
}
