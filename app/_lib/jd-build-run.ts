import path from "node:path";
import { writeFile } from "node:fs/promises";
import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, spawnPython } from "./python-runner";
import { runDesignArtifacts, runNeedAnalysis, type DevNeed } from "./devcase-run";

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
};

export type MarketSalary = { suggestedMinimum: number; suggestedMaximum: number; currency: string; confidence: string; summary: string };

export async function runMarketSalary(input: {
  title: string;
  seniority: string;
  roleFamily: string;
  company?: string;
  stack?: string[];
}): Promise<{ result: MarketSalary; sources: string[]; source: string }> {
  const workdir = await createWorkdir();
  try {
    const p = path.join(workdir, "salary.json");
    await writeFile(p, JSON.stringify(input), "utf-8");
    const { result } = spawnPython(["-m", "pipeline.jobfit.market_salary_cli", "--input-json", p]);
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) throw new Error(parseStderrError(stderr, exitCode).message);
    return parsePythonJson<{ result: MarketSalary; sources: string[]; source: string }>(stdout, stderr);
  } finally {
    await cleanupWorkdir(workdir);
  }
}

type RoleSpec = {
  title?: string;
  seniority?: string;
  roleFamily?: string;
  mustHaves?: string[];
  niceToHaves?: string[];
  responsibilities?: string[];
  languages?: string[];
};

function composeMarkdown(role: RoleSpec, opts: { company?: string; location?: string; salary: MarketSalary }): string {
  const lines: string[] = [];
  const title = role.title || "Untitled role";
  lines.push(`# ${title}`);
  const meta = [opts.company, opts.location, role.seniority ? `${role.seniority} level` : null].filter(Boolean);
  if (meta.length) lines.push(`**${meta.join(" · ")}**`);
  const s = opts.salary;
  if (s?.suggestedMinimum > 0) lines.push(`**Salary:** ${s.suggestedMinimum.toLocaleString("cs-CZ")} – ${s.suggestedMaximum.toLocaleString("cs-CZ")} ${s.currency} / month`);

  lines.push("", "## About the role");
  lines.push(`We're hiring a ${title}${opts.company ? ` at ${opts.company}` : ""}. ${s?.summary ?? ""}`.trim());

  const section = (heading: string, items?: string[]) => {
    if (items && items.length) {
      lines.push("", `## ${heading}`);
      items.forEach((it) => lines.push(`- ${it}`));
    }
  };
  section("Responsibilities", role.responsibilities);
  section("What you'll bring", role.mustHaves);
  section("Nice to have", role.niceToHaves);
  section("Languages", role.languages);
  return lines.join("\n");
}

type Progress = (done: number, total: number, msg?: string) => void;

export async function runJdBuild(params: Record<string, unknown>, progress?: Progress): Promise<Record<string, unknown>> {
  const input = params as unknown as JdBuildInput;
  const need: DevNeed = {
    title: input.title,
    stack: [],
    responsibilities: (input.needText || "").split("\n").map((l) => l.trim()).filter(Boolean),
    codebaseRefs: input.repoUrl?.trim() ? [{ kind: "github", ref: input.repoUrl.trim() }] : [],
    seniorityTarget: input.seniority || "medior",
    roleFamily: input.roleFamily || "software_engineering",
    notes: input.needText,
  };

  // The design chain (analyze need → design role) and the grounded salary
  // lookup are independent, so run them concurrently to roughly halve the wait.
  progress?.(0, 2, "Analyzing the need and researching market salary…");
  const [design, salary] = await Promise.all([
    (async () => {
      const { analysis, snapshot } = await runNeedAnalysis(need);
      progress?.(1, 2, "Designing the role from the need…");
      const { role } = await runDesignArtifacts(need, analysis);
      return { role: role as RoleSpec, snapshot };
    })(),
    runMarketSalary({
      title: input.title,
      seniority: input.seniority || "medior",
      roleFamily: input.roleFamily || "software_engineering",
      company: input.company,
      stack: need.responsibilities ?? [],
    }),
  ]);
  const spec = design.role;
  const snapshot = design.snapshot;
  progress?.(2, 2, "Formatting the job description…");

  const markdown = composeMarkdown(spec, { company: input.company, location: input.location, salary: salary.result });
  return {
    markdown,
    role: spec,
    salary: salary.result,
    salarySources: salary.sources,
    salarySource: salary.source,
    snapshot: snapshot ? { ref: snapshot.ref, languages: snapshot.languages, inferredStack: snapshot.inferredStack, loc: snapshot.loc } : null,
  };
}
