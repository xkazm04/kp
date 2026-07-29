// A company JD format template (Phase 1, minimal). Applies a branded, structured
// format to a role so the published JD reads like a real posting. A fuller
// "manage templates" feature (CRUD of multiple company formats) is a follow-up.
export function applyCompanyTemplate(opts: {
  title: string;
  company: string;
  seniority?: string;
  about?: string;
  responsibilities: string[];
  mustHaves: string[];
  niceToHaves: string[];
  salaryBand?: [number, number];
  currency?: string;
}): string {
  const band = opts.salaryBand
    ? `${opts.salaryBand[0].toLocaleString("cs-CZ")}–${opts.salaryBand[1].toLocaleString("cs-CZ")} ${opts.currency ?? "CZK"}/mo`
    : null;
  return [
    `# ${opts.title}`,
    `**${opts.company}**${opts.seniority ? ` · ${opts.seniority}` : ""}${band ? ` · ${band}` : ""}`,
    "",
    "## About us",
    opts.about ?? `${opts.company} builds technology trusted by millions. Join a team that ships and owns what it builds.`,
    "",
    "## The role",
    ...opts.responsibilities.map((r) => `- ${r}`),
    "",
    "## What we're looking for",
    ...opts.mustHaves.map((s) => `- ${s}`),
    "",
    "## Nice to have",
    ...opts.niceToHaves.map((s) => `- ${s}`),
    "",
    "## What we offer",
    "- Competitive pay, hybrid working, meaningful ownership, and room to grow.",
    "",
    "## How to apply",
    "- Apply via the link — a short conversation, then a first-round interview.",
  ].join("\n");
}
