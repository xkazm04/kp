import path from "node:path";
import { writeFile } from "node:fs/promises";
import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, spawnPython } from "./python-runner";
import { buildLlmConfigEnv } from "./llm-config";
import { runDesignArtifacts, runNeedAnalysis, type DevNeed } from "./devcase-run";
import { validateJdBuildInput } from "./jd-limits";
import { marketSalaryLabel, normalizeMarketSalary, type MarketSalary } from "./salary-band";
import { type RepoSnapshot } from "./repo-snapshot";
import { parseRoleSpec, type RoleBrief, type RoleSpec } from "./rolespec";
import { briefMustSkills, briefStatedRequirements, needTextFromBrief } from "./intake-brief";
import { failJdAnalysis, finishJdAnalysis } from "./db/jobs";
import { ingestStructuredJob } from "@/app/api/jds/save/ingest-job";
import { renderTemplate, type TemplateTokens } from "@/app/features/shared/renderTemplate";
import { jdTemplateTokens } from "./jd-template-tokens";

// The AI job-description builder: a free-text need (+ optional GitHub repo for
// dev roles) → our devcase need→design machinery → a structured RoleSpec, then
// formatted as a publishable Markdown JD with a grounded market-salary band.

// The recruiter's pre-generation checklist — which AI steps to run. Every field
// is independent (≥1 must be true); see resolveBuildOptions for the defaults.
export type JdBuildOptions = {
  description: boolean; // compose + persist the JD markdown body (needs a role)
  marketResearch: boolean; // grounded market-salary band
  caseDesign: boolean; // the interview case/work-sample (also needs a role)
};

export type JdBuildInput = {
  title: string;
  company?: string;
  location?: string;
  seniority?: string;
  roleFamily?: string;
  needText: string;
  // Promoted role-intake (docs/concepts/role-intake-dialog.md): the structured
  // RoleBrief behind needText. When present, the DevNeed is filled from the
  // brief's graded fields (stack = must-have skills, responsibilities = 90-day
  // outcomes + responsibilities) instead of newline-splitting the need text —
  // closing the old asymmetry where this path and the Cases tab filled the
  // same type in incompatible ways.
  brief?: RoleBrief;
  repoUrl?: string;
  // JDL5 — the JD output language (en|cs). Threaded into the design chain
  // (--lang on design-artifacts) + the market-salary summary, and used to
  // localize composeMarkdown's headings. Defaults to "en".
  lang?: string;
  // Backgrounded flow: the placeholder JD row this build fills in. When present,
  // runJdBuild persists the result server-side (finish/fail) so the JD completes
  // even if the client navigated away; when absent it just returns the payload.
  jdSlug?: string;
  // Optional company template (markdown with {{placeholders}}) to render the role
  // through — the SAME renderTemplate the client preview used, now applied
  // server-side so the persisted body already carries the chosen format. Absent ⇒
  // the AI-default composeMarkdown layout.
  templateBody?: string;
  // The ticked checklist. Absent (a simulation deep-link / programmatic caller) ⇒
  // description + market research (today's effective output), so legacy callers are
  // unchanged but no longer pay for the discarded case call.
  options?: Partial<JdBuildOptions>;
};

// ONE source for the checklist's two default sets. They are different questions and
// both used to be written as literals in two files — the handler's here, the route's
// in app/api/jds/generate/route.ts — with nothing keeping them honest.
//
//  - JD_BUILD_DEFAULT_OPTIONS answers "a caller sent NO options at all" (a simulation
//    deep link, a programmatic caller): today's effective output, description + market
//    research, case off, so a legacy caller is unchanged but no longer pays for a
//    discarded case call.
//  - JD_BUILD_NO_OPTIONS is the starting point for reading a recruiter's EXPLICIT
//    checklist: an unticked box is off, and all-off is refused by the caller rather
//    than silently promoted to the defaults above.
export const JD_BUILD_DEFAULT_OPTIONS: JdBuildOptions = { description: true, marketResearch: true, caseDesign: false };
export const JD_BUILD_NO_OPTIONS: JdBuildOptions = { description: false, marketResearch: false, caseDesign: false };

/** Read a recruiter's ticked checklist off an untrusted request body. Only an explicit
 *  `true` ticks a box — the request states the whole checklist, so a missing field is
 *  an unticked box, NOT an invitation to spend on the defaults. */
export function readJdBuildOptions(raw: unknown): JdBuildOptions {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    description: o.description === true,
    marketResearch: o.marketResearch === true,
    caseDesign: o.caseDesign === true,
  };
}

/** Per-field resolution for the HANDLER: a caller with no options at all gets
 *  JD_BUILD_DEFAULT_OPTIONS, and a partial object still resolves every field. */
export function resolveBuildOptions(raw: Partial<JdBuildOptions> | undefined): JdBuildOptions {
  return {
    description: raw?.description ?? JD_BUILD_DEFAULT_OPTIONS.description,
    marketResearch: raw?.marketResearch ?? JD_BUILD_DEFAULT_OPTIONS.marketResearch,
    caseDesign: raw?.caseDesign ?? JD_BUILD_DEFAULT_OPTIONS.caseDesign,
  };
}

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

/** The trust boundary itself, as a pure function so it can be driven with the
 *  garbage the CLI can actually print (a partial band, a 0-0 taxonomy miss, a
 *  `sources` that is a string, a missing `source`) without spawning anything.
 *  Everything here is defensive on purpose: an un-normalized band white-screens the
 *  result panel after a 1-2 minute build, or bakes a literal `undefined` into the
 *  saved JD body. */
export function normalizeMarketSalaryPayload(parsed: { result?: unknown; sources?: unknown; source?: unknown }): {
  result: MarketSalary;
  sources: string[];
  source: string;
} {
  return {
    result: normalizeMarketSalary(parsed.result),
    sources: Array.isArray(parsed.sources) ? parsed.sources.filter((s): s is string => typeof s === "string") : [],
    source: typeof parsed.source === "string" ? parsed.source : "deterministic",
  };
}

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
      { signal, env: buildLlmConfigEnv() }
    );
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) throw new Error(parseStderrError(stderr, exitCode).message);
    // The CLI payload is untrusted — parsePythonJson hands back whatever the
    // child printed, cast to a type the runtime never enforces. Normalize the
    // salary band HERE, at the trust boundary, so a partial/garbage band (or the
    // CLI's 0–0 taxonomy miss) becomes a render-safe `available: false` shape
    // instead of a `suggestedMaximum` that white-screens the result panel after a
    // 1–2 minute build, or a literal `undefined` baked into the saved JD body.
    return normalizeMarketSalaryPayload(
      parsePythonJson<{ result?: unknown; sources?: unknown; source?: unknown }>(stdout, stderr)
    );
  } finally {
    await cleanupWorkdir(workdir);
  }
}

// The structured role this builder produces and ingest-job.ts consumes — now
// single-sourced from the generated schema (app/_lib/rolespec.ts ← codegen ←
// pipeline/jobfit/devcase/models.py), so the Python producer and every TS
// consumer share one declaration (idea-dcf2460d). Re-exported for the existing
// importers that resolve it from this module.
export type { RoleSpec } from "./rolespec";

export function composeMarkdown(
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
  // graceful degradation here. (The Ledger detail's read-only SalaryCard surfaces
  // the unavailability to the recruiter.)
  // Grouped in the POSTING's language (opts.lang), like every other scaffold
  // string here — an English JD must not carry Czech digit grouping.
  const salaryLabel = marketSalaryLabel(s, opts.lang === "cs" ? "cs" : "en");
  if (salaryLabel) lines.push(`**${str.salary}** ${salaryLabel}`);

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

/** The description branch, isolated: a chosen company template wins, otherwise the
 *  AI-default layout. Both paths are localized by `lang` — the template's structural
 *  scaffolding through `tokens` (the seeded default's heading/filler slots, resolved
 *  from the catalog by jdTemplateTokens), composeMarkdown's headings by its own
 *  table — so a localized build is never localized content under English headings.
 *  An empty/blank templateBody is NOT a template: it falls back rather than
 *  persisting an empty body after a 1-2 minute build. */
export function composeJdBody(
  spec: RoleSpec,
  opts: {
    templateBody?: string;
    title: string;
    company?: string;
    location?: string;
    seniority?: string;
    salary: MarketSalary;
    lang: "en" | "cs";
    /** REQUIRED, like renderTemplate's own `localized`: an omitted map would ship a
     *  raw `{{heading_about}}` onto a public posting. */
    tokens: TemplateTokens;
  }
): string {
  const templateBody = (opts.templateBody ?? "").trim();
  if (!templateBody) {
    return composeMarkdown(spec, { company: opts.company, location: opts.location, salary: opts.salary, lang: opts.lang });
  }
  // Same data the client preview fed renderTemplate: the salary slot gets the market
  // label, placeholders the role's fields; unfilled sections collapse per
  // renderTemplate's rules.
  return renderTemplate(
    templateBody,
    {
      title: opts.title,
      company: opts.company?.trim(),
      seniority: opts.seniority || spec.seniority || "medior",
      salary: marketSalaryLabel(opts.salary, opts.lang),
      responsibilities: spec.responsibilities ?? [],
      mustHaves: spec.mustHaves ?? [],
      niceToHaves: spec.niceToHaves ?? [],
    },
    opts.tokens
  );
}

type Progress = (done: number, total: number, msg?: string) => void;

/** `workspaceId` is the tenant this build runs for — the task's own workspace, which is
 *  the one the placeholder JD row was inserted for (/api/jds/generate, the intake
 *  promote route and the Ledger's retry all stamp the task with it). It exists for the
 *  ingest below: writing the matchable `jd-<slug>` opening unscoped filed a non-default
 *  team's freshly generated role into the DEFAULT team's corpus, so the team that ran
 *  the build watched their JD go "ready" and then never found its opening in Jobs (with
 *  no way to source it into their pipeline), while a team that wrote nothing collected
 *  the row. Omitted ⇒ ingestStructuredJob's own default, i.e. the single-tenant path. */
export async function runJdBuild(
  params: Record<string, unknown>,
  progress?: Progress,
  signal?: AbortSignal,
  workspaceId?: string
): Promise<Record<string, unknown>> {
  const input = params as unknown as JdBuildInput;
  // JDL5 — the JD output language (validated to en|cs; anything else → en).
  const lang = input.lang === "cs" ? "cs" : "en";
  const options = resolveBuildOptions(input.options);
  // Backgrounded flow: when a jdSlug is present we OWN persisting the outcome into
  // that placeholder JD row (finish on success / fail on error), so the JD lands
  // whether or not the client is still open. Absent ⇒ return-only (legacy callers).
  const jdSlug = typeof input.jdSlug === "string" && input.jdSlug.trim() ? input.jdSlug.trim() : null;

  try {
    if (!options.description && !options.marketResearch && !options.caseDesign) {
      throw new Error("Select at least one thing to generate.");
    }
    // A role (needed for the description AND/OR the interview case) requires a real
    // need; market research alone only needs the role facets. Enforce the min-need
    // contract HERE (not just the form gate) only when a role will actually be built
    // — a barely-there need would otherwise waste a 1–2 minute AI run.
    const needRole = options.description || options.caseDesign;
    let title = (input.title ?? "").trim();
    let needText = (input.needText ?? "").trim();
    if (needRole) {
      const valid = validateJdBuildInput(input.title, input.needText);
      if (!valid.ok) throw new Error(valid.error);
      title = valid.title;
      needText = valid.needText;
    } else if (title.length < 2) {
      throw new Error("A role title is required.");
    }

    // Promoted-intake path: the brief fills the DevNeed's structured fields
    // directly (and regenerates the composed need text so a task replay stays
    // faithful even if the caller sent a stale needText). Free-text path:
    // unchanged newline split.
    const brief: RoleBrief | undefined =
      input.brief && typeof input.brief === "object" ? (input.brief as RoleBrief) : undefined;
    // Same language the rest of the chain is generated in, so a regenerated need
    // text does not staple English headings onto a Czech brief.
    if (brief) needText = needTextFromBrief(brief, input.lang) || needText;
    const need: DevNeed = {
      title,
      stack: brief ? briefMustSkills(brief).slice(0, 10) : [],
      responsibilities: brief
        ? [...(brief.successCriteria ?? []), ...(brief.responsibilities ?? [])].filter(Boolean).slice(0, 12)
        : needText.split("\n").map((l) => l.trim()).filter(Boolean),
      codebaseRefs: input.repoUrl?.trim() ? [{ kind: "github", ref: input.repoUrl.trim() }] : [],
      seniorityTarget: input.seniority || brief?.seniority || "medior",
      roleFamily: input.roleFamily || brief?.roleFamily || "software_engineering",
      notes: needText,
      // The graded dealbreakers survive INTO role design (UAT L1-EVA-3) —
      // must/nice + hardness + weight, not just the flattened stack list.
      ...(brief ? { statedRequirements: briefStatedRequirements(brief) } : {}),
    };

    progress?.(0, 2, "Analyzing the need and researching market salary…");
    // The design chain (analyze → design role/case) and the grounded salary lookup
    // are independent, so run the SELECTED ones concurrently. An unticked step never
    // spawns — the case-design call in particular is skipped unless requested.
    const designP: Promise<{ role: RoleSpec | null; kase: Record<string, unknown> | null; snapshot: RepoSnapshot | null }> = needRole
      ? (async () => {
          const { analysis, snapshot } = await runNeedAnalysis(need, signal, lang);
          progress?.(1, 2, options.description ? "Designing the role from the need…" : "Designing the interview case…");
          const { role, case: kase } = await runDesignArtifacts(need, analysis, signal, undefined, lang, options.caseDesign);
          // Validated at the Python→TS trust boundary (was an unchecked cast).
          return { role: parseRoleSpec(role), kase: options.caseDesign ? kase : null, snapshot };
        })()
      : Promise.resolve({ role: null, kase: null, snapshot: null });
    const salaryP: Promise<{ result: MarketSalary; sources: string[]; source: string } | null> = options.marketResearch
      ? runMarketSalary({
          title,
          seniority: input.seniority || "medior",
          roleFamily: input.roleFamily || "software_engineering",
          company: input.company,
          stack: need.responsibilities ?? [],
          lang,
        }, signal)
      : Promise.resolve(null);

    const [design, salary] = await Promise.all([designP, salaryP]);
    const spec = design.role;
    const snapshot = design.snapshot;
    progress?.(2, 2, "Formatting the job description…");

    // Compose the markdown body only when a description was requested and a role was
    // produced. Market-research-only / case-only builds leave the body empty — the
    // JD detail view degrades gracefully (and no matchable job is ingested).
    const salaryBand = salary?.result ?? normalizeMarketSalary(undefined);
    const templateBody = typeof input.templateBody === "string" ? input.templateBody.trim() : "";
    let markdown = "";
    if (options.description && spec) {
      // The catalog read stays HERE (it is async, and the branch below must not be),
      // so the choice itself is a pure function the tests can drive both ways.
      markdown = composeJdBody(spec, {
        templateBody,
        title,
        company: input.company,
        location: input.location,
        seniority: input.seniority,
        salary: salaryBand,
        lang,
        tokens: await jdTemplateTokens(lang),
      });
    }

    // The structured artifacts stored beside the markdown body (analysis_json) and
    // returned to legacy in-memory consumers.
    const artifacts = {
      role: spec,
      salary: salary?.result ?? null,
      salarySources: salary?.sources ?? [],
      salarySource: salary?.source ?? null,
      snapshot: snapshot ? { ref: snapshot.ref, languages: snapshot.languages, inferredStack: snapshot.inferredStack, loc: snapshot.loc } : null,
      case: design.kase,
      options,
    };

    let bodyHeldAsRevision = false;
    if (jdSlug) {
      // Persist inside the detached handler → lands even if the client left. The
      // write is conditional: finishJdAnalysis takes the body ONLY if the row is
      // still the untouched placeholder this build was started for. An operator who
      // edited the row during the 1–2 minute build keeps their text, and this
      // build's markdown is filed as a revision they can read and revert to.
      const finished = finishJdAnalysis(jdSlug, { body: markdown, analysisJson: artifacts });
      bodyHeldAsRevision = finished.ok && !finished.bodyWritten && Boolean(markdown.trim());
      if (bodyHeldAsRevision) {
        // An operator would act on this: their JD did NOT get the generated body.
        console.warn(`[jd-build] ${jdSlug} moved during the build — result filed as a revision, live body kept`);
      }
      // Make it matchable exactly as "Save as draft" did — but only when there's a
      // real description with a role AND that description is what the JD actually
      // shows: ingesting a body the row does not carry would make the matchable
      // `jd-<slug>` opening answer text no reader can see. Best-effort (same contract
      // as /api/jds/save): a failed ingest leaves the JD saved but not matchable, and
      // the Ledger's "Ingest as job" retry can fix it up.
      if (options.description && spec && finished.ok && finished.bodyWritten) {
        try {
          // Same tenant the placeholder JD row lives in (see workspaceId above), so the
          // opening lands in the corpus of the team that generated it.
          await ingestStructuredJob(
            { slug: jdSlug, title, markdown, role: spec, salary: salary?.result, company: input.company },
            workspaceId
          );
        } catch (ingestError) {
          // Best-effort: a failed ingest never blocks the saved JD. But it is not
          // silent — the JD lands "ready" and not matchable, so "Source into
          // Pipeline" dead-ends until the Ledger's "Ingest as job" retry is used,
          // and whoever runs the server needs the cause. Same shape as the sibling
          // catches in POST /api/jds/save and PATCH /api/jds/[slug].
          console.error(`[jd-build] JD ${jdSlug} saved but job ingest failed`, ingestError);
        }
      }
    }

    // `bodyHeldAsRevision` rides the task result (TasksOutcome renders the result's
    // scalars), so the Tasks drawer says the build did not become the JD's body
    // rather than claiming a silent success.
    return { markdown, ...artifacts, ...(bodyHeldAsRevision ? { bodyHeldAsRevision: true } : {}) };
  } catch (err) {
    // Mark the placeholder JD failed so the Ledger shows a failed chip + retry
    // instead of a row stuck "Analyzing" forever. Then rethrow so the TASK also
    // records failed (its status is independent of the JD row).
    if (jdSlug) {
      try {
        failJdAnalysis(jdSlug, err instanceof Error ? err.message : String(err));
      } catch {
        /* don't mask the original error if the fail-write itself throws */
      }
    }
    throw err;
  }
}
