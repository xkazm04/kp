import path from "node:path";
import { writeFile } from "node:fs/promises";
import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, spawnPython } from "./python-runner";
import { runDesignArtifacts, runNeedAnalysis, type DevNeed } from "./devcase-run";
import { formatSalaryRange } from "./format";
import { validateJdBuildInput } from "./jd-limits";
import { normalizeMarketSalary, type MarketSalary } from "./salary-band";

// The AI job-description builder: a free-text need (+ optional GitHub repo for
// dev roles) → our devcase need→design machinery → a structured RoleSpec, then
// formatted as a publishable Markdown JD with a grounded market-salary band.

export type JdBuildInput = {
  title: string;
  company?: string;
  location?: string;
  seniority?: string;
  roleFamily?: string;
  needText: string;
  repoUrl?: string;
  // JDL5 — the JD output language (en|cs). Threaded into the design chain
  // (--lang on design-artifacts) + the market-salary summary, and used to
  // localize composeMarkdown's headings. Defaults to "en".
  lang?: string;
};

// JDL5 — the document's heading scaffolding, bilingual + self-contained (the
// same approach as jobMarkdown's table): the recruiter-authored role content is
// generated in `lang` by the design chain; only these headings are templated.
type JdMarkdownStrings = {
  level: (seniority: string) => string;
  salary: string;
  aboutRole: string;
  hiringLine: (title: string, company?: string) => string;
  responsibilities: string;
  whatBring: string;
  niceToHave: string;
  languages: string;
};
const JD_MARKDOWN_STRINGS: Record<"en" | "cs", JdMarkdownStrings> = {
  en: {
    level: (s) => `${s} level`,
    salary: "Salary:",
    aboutRole: "About the role",
    hiringLine: (title, company) => `We're hiring a ${title}${company ? ` at ${company}` : ""}.`,
    responsibilities: "Responsibilities",
    whatBring: "What you'll bring",
    niceToHave: "Nice to have",
    languages: "Languages",
  },
  cs: {
    level: (s) => `úroveň ${s}`,
    salary: "Mzda:",
    aboutRole: "O pozici",
    hiringLine: (title, company) => `Hledáme na pozici ${title}${company ? ` ve společnosti ${company}` : ""}.`,
    responsibilities: "Odpovědnosti",
    whatBring: "Co byste měli mít",
    niceToHave: "Výhodou",
    languages: "Jazyky",
  },
};

// The canonical band shape + its trust-boundary normalizer live in salary-band
// (a pure module shared with the client renderer and the ingest write path), so
// the producer here and the consumers can't drift. Re-exported for callers that
// import it from this module.
export type { MarketSalary };

export async function runMarketSalary(input: {
  title: string;
  seniority: string;
  roleFamily: string;
  company?: string;
  stack?: string[];
  lang?: string;
}, signal?: AbortSignal): Promise<{ result: MarketSalary; sources: string[]; source: string }> {
  const workdir = await createWorkdir();
  try {
    const p = path.join(workdir, "salary.json");
    await writeFile(p, JSON.stringify(input), "utf-8");
    // JDL5 — the market-salary summary lands in the JD body, so render it in the
    // JD language (the CLI already supports --lang; only the summary text localizes).
    const { result } = spawnPython(
      ["-m", "pipeline.jobfit.market_salary_cli", "--input-json", p, "--lang", input.lang || "en"],
      { signal }
    );
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) throw new Error(parseStderrError(stderr, exitCode).message);
    // The CLI payload is untrusted — parsePythonJson hands back whatever the
    // child printed, cast to a type the runtime never enforces. Normalize the
    // salary band HERE, at the trust boundary, so a partial/garbage band (or the
    // CLI's 0–0 taxonomy miss) becomes a render-safe `available: false` shape
    // instead of a `suggestedMaximum` that white-screens the result panel after a
    // 1–2 minute build, or a literal `undefined` baked into the saved JD body.
    const parsed = parsePythonJson<{ result?: unknown; sources?: unknown; source?: unknown }>(stdout, stderr);
    return {
      result: normalizeMarketSalary(parsed.result),
      sources: Array.isArray(parsed.sources) ? parsed.sources.filter((s): s is string => typeof s === "string") : [],
      source: typeof parsed.source === "string" ? parsed.source : "deterministic",
    };
  } finally {
    await cleanupWorkdir(workdir);
  }
}

// The structured role this builder produces and ingest-job.ts consumes — exported
// so the producer→consumer pair share ONE declaration (was hand-copied verbatim in
// both). NOTE: DevTypes.RoleSpec is a deliberately different shape; not unified here.
export type RoleSpec = {
  title?: string;
  seniority?: string;
  roleFamily?: string;
  mustHaves?: string[];
  niceToHaves?: string[];
  responsibilities?: string[];
  languages?: string[];
};

function composeMarkdown(
  role: RoleSpec,
  opts: { company?: string; location?: string; salary: MarketSalary; lang?: string }
): string {
  const str = JD_MARKDOWN_STRINGS[opts.lang === "cs" ? "cs" : "en"];
  const lines: string[] = [];
  const title = role.title || "Untitled role";
  lines.push(`# ${title}`);
  const meta = [opts.company, opts.location, role.seniority ? str.level(role.seniority) : null].filter(Boolean);
  if (meta.length) lines.push(`**${meta.join(" · ")}**`);
  const s = opts.salary;
  // Only advertise a band when the normalizer confirmed a usable one. An
  // unavailable band omits the line entirely — a published JD shouldn't print
  // "Salary: 0 CZK" or "salary unavailable" to candidates; omission is the
  // graceful degradation here. (The builder card surfaces the unavailability to
  // the recruiter; see JdBuilderResult.)
  if (s.available) lines.push(`**${str.salary}** ${formatSalaryRange(s.suggestedMinimum, s.suggestedMaximum, { currency: s.currency, period: "month" })}`);

  lines.push("", `## ${str.aboutRole}`);
  // The summary is generated in `lang` by market_salary_cli; the hiring sentence
  // localizes here. Role content (responsibilities/skills) is generated in `lang`.
  lines.push(`${str.hiringLine(title, opts.company)} ${s.summary}`.trim());

  const section = (heading: string, items?: string[]) => {
    if (items && items.length) {
      lines.push("", `## ${heading}`);
      items.forEach((it) => lines.push(`- ${it}`));
    }
  };
  section(str.responsibilities, role.responsibilities);
  section(str.whatBring, role.mustHaves);
  section(str.niceToHave, role.niceToHaves);
  section(str.languages, role.languages);
  return lines.join("\n");
}

type Progress = (done: number, total: number, msg?: string) => void;

export async function runJdBuild(params: Record<string, unknown>, progress?: Progress, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const input = params as unknown as JdBuildInput;
  // Enforce the minimum-need contract HERE, not just in the form gate: a deep-link
  // /simulation prefill or a programmatic startTask reaches this handler directly,
  // and the need→design chain below is a 1–2 minute AI run we refuse to spend on a
  // barely-there title or an empty need. Throwing fails the task fast (before any
  // Python spawn) with the same user-facing message the form would have shown.
  const valid = validateJdBuildInput(input.title, input.needText);
  if (!valid.ok) throw new Error(valid.error);
  // JDL5 — the JD output language (validated to en|cs; anything else → en).
  const lang = input.lang === "cs" ? "cs" : "en";
  const need: DevNeed = {
    title: valid.title,
    stack: [],
    responsibilities: valid.needText.split("\n").map((l) => l.trim()).filter(Boolean),
    codebaseRefs: input.repoUrl?.trim() ? [{ kind: "github", ref: input.repoUrl.trim() }] : [],
    seniorityTarget: input.seniority || "medior",
    roleFamily: input.roleFamily || "software_engineering",
    notes: valid.needText,
  };

  // The design chain (analyze need → design role) and the grounded salary
  // lookup are independent, so run them concurrently to roughly halve the wait.
  progress?.(0, 2, "Analyzing the need and researching market salary…");
  const [design, salary] = await Promise.all([
    (async () => {
      const { analysis, snapshot } = await runNeedAnalysis(need, signal);
      progress?.(1, 2, "Designing the role from the need…");
      const { role } = await runDesignArtifacts(need, analysis, signal, undefined, lang);
      return { role: role as RoleSpec, snapshot };
    })(),
    runMarketSalary({
      title: valid.title,
      seniority: input.seniority || "medior",
      roleFamily: input.roleFamily || "software_engineering",
      company: input.company,
      stack: need.responsibilities ?? [],
      lang,
    }, signal),
  ]);
  const spec = design.role;
  const snapshot = design.snapshot;
  progress?.(2, 2, "Formatting the job description…");

  const markdown = composeMarkdown(spec, { company: input.company, location: input.location, salary: salary.result, lang });
  return {
    markdown,
    role: spec,
    salary: salary.result,
    salarySources: salary.sources,
    salarySource: salary.source,
    snapshot: snapshot ? { ref: snapshot.ref, languages: snapshot.languages, inferredStack: snapshot.inferredStack, loc: snapshot.loc } : null,
  };
}
