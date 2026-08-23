import type { RoleBrief } from "./rolespec";
// Explicit ".ts" like schemas.ts: this is a VALUE import (the schema is parsed
// at runtime), and node:test's type-stripping loader resolves specifiers
// literally — an extensionless one breaks `npm run test:unit`.
import { appMasterSpecSchema, type AppMasterSpec, type RepoDossier } from "./schemas.generated.ts";

// Pure projection of a RoleBrief onto the JD builder's inputs (promote step,
// docs/concepts/role-intake-dialog.md). No imports beyond the type so the
// contract is unit-testable without a DB (intake-brief.test.ts).

export function briefMustSkills(brief: RoleBrief): string[] {
  return (brief.requirements ?? []).filter((r) => r.kind === "must_have").map((r) => r.skill);
}

export function briefNiceSkills(brief: RoleBrief): string[] {
  return (brief.requirements ?? []).filter((r) => r.kind === "nice_to_have").map((r) => r.skill);
}

// The graded projection the devcase chain consumes (DevNeed.statedRequirements
// ↔ pipeline/jobfit/devcase/models.py::StatedRequirement): the requestor's own
// must/nice + hardness split with weights, minus the intake-only fields
// (rationale/provenance/confidence stay on the brief).
export type StatedRequirement = { skill: string; kind: string; hardness: string; weight: number };

export function briefStatedRequirements(brief: RoleBrief): StatedRequirement[] {
  return (brief.requirements ?? [])
    .filter((r) => r.skill)
    .map((r) => ({ skill: r.skill, kind: r.kind, hardness: r.hardness, weight: r.weight }));
}

// The composed need text the JD build (and its persisted build_input) receives:
// the brief's content, flattened in the order the design chain reads best —
// narrative, outcomes, graded requirements, then the situational facets. This
// is what makes a promoted intake a RICHER need than the old free-text
// textarea, while staying replayable through the existing pipeline.
export function needTextFromBrief(brief: RoleBrief): string {
  const lines: string[] = [];
  if (brief.summary) lines.push(brief.summary);
  for (const s of brief.successCriteria ?? []) lines.push(`Done in 90 days: ${s}`);
  for (const r of brief.responsibilities ?? []) lines.push(r);
  for (const skill of briefMustSkills(brief)) lines.push(`Must have: ${skill}`);
  for (const skill of briefNiceSkills(brief)) lines.push(`Nice to have: ${skill}`);
  for (const f of brief.facets ?? []) {
    if (f.value) lines.push(`${f.label || f.key || "Context"}: ${f.value}`);
  }
  return lines.join("\n").trim();
}

// A compact, interviewer-internal digest of the hiring intent for grounding
// downstream conversations (Phase 3 — brief-as-reference). Deliberately short:
// it rides inside an already-long agent brief. Returns null when the brief
// carries nothing worth grounding on.
//
// Reads BOTH homes via the evidence helpers below (same UAT L2-NEW-2 shape the
// promote gate had to learn): live sessions file their hard conditions and
// 90-day outcomes as FACET prose with `requirements[]` / `successCriteria[]`
// empty, so a digest reading only the graded arrays returned null for exactly
// the briefs richest in stated intent — the interviewer then ran with no role
// grounding at all and never probed the dealbreakers. Facet values are prose
// (capped at 600 chars by the sanitizer), so each line is trimmed before it
// rides inside the already-long agent brief.
const INTENT_ITEM_MAX = 200;

export function briefIntentSummary(brief: RoleBrief | null): string | null {
  if (!brief) return null;
  const musts = briefDealbreakerEvidence(brief).map((s) => s.trim().slice(0, INTENT_ITEM_MAX));
  const success = briefOutcomeEvidence(brief).map((s) => s.trim().slice(0, INTENT_ITEM_MAX));
  const urgency = (brief.facets ?? []).find((f) => f.key === "urgency")?.value;
  if (musts.length === 0 && success.length === 0) return null;
  const parts: string[] = [];
  if (success.length) parts.push(`success in the first 90 days means: ${success.slice(0, 3).join("; ")}`);
  if (musts.length) parts.push(`the stated dealbreakers are: ${musts.slice(0, 6).join(", ")}`);
  if (urgency) parts.push(`urgency: ${urgency.slice(0, 160)}`);
  return (
    "ROLE INTENT — internal context captured in the hiring-intake conversation with the requestor: " +
    parts.join("; ") +
    ". Weigh answers against this intent and probe the dealbreakers naturally; never read this note aloud."
  );
}

// UAT L2-NEW-2 (escalated minor → major, recurrence 2): the dialog captures a
// dealbreaker or a 90-day outcome in EITHER of two homes — the graded
// `requirements[]` / `successCriteria[]` arrays, or a facet whose key names the
// same thing (`dealbreaker_context`, `success_90d`). Live, the model took the
// facet every time: all five recertify sessions stored their hard conditions as
// facet prose with `requirements: []`, so a gate reading only the arrays refused
// briefs holding nine stated facets and the recertifier had to PATCH the brief
// over the API to promote at all. The routing half is fixed in the extraction
// contract (pipeline/jobfit/intake.py, prompt v2); this is the deterministic
// half — read the substance wherever the dialog actually put it. Keys only:
// facet labels are free localized prose and would match by accident.
const DEALBREAKER_FACET_KEY = /(dealbreaker|must[_-]?have|hard[_-]?condition|non[_-]?negotiable|requirement)/i;
const OUTCOME_FACET_KEY = /(success[_-]?90|first[_-]?90|90[_-]?day|outcome)/i;

function facetsMatching(brief: RoleBrief, re: RegExp): string[] {
  return (brief.facets ?? [])
    .filter((f) => f.value?.trim() && re.test(f.key ?? ""))
    .map((f) => f.value);
}

// Every dealbreaker the session holds, from both homes (graded rows first).
export function briefDealbreakerEvidence(brief: RoleBrief | null): string[] {
  if (!brief) return [];
  return [...briefMustSkills(brief).filter(Boolean), ...facetsMatching(brief, DEALBREAKER_FACET_KEY)];
}

// Every 90-day outcome the session holds, from both homes.
export function briefOutcomeEvidence(brief: RoleBrief | null): string[] {
  if (!brief) return [];
  return [...(brief.successCriteria ?? []).filter(Boolean), ...facetsMatching(brief, OUTCOME_FACET_KEY)];
}

// What stands between this brief and a JD build. Empty = promotable. Ordered as
// the requestor should fix them; the UI names them on the disabled button
// (UAT L2-RC-1 — a gate that refuses without saying why).
export type BriefPromoteBlocker = "title" | "substance";

export function briefPromoteBlockers(brief: RoleBrief | null): BriefPromoteBlocker[] {
  if (!brief) return ["title", "substance"];
  const blockers: BriefPromoteBlocker[] = [];
  if (!brief.title?.trim()) blockers.push("title");
  if (briefDealbreakerEvidence(brief).length === 0 && briefOutcomeEvidence(brief).length === 0) {
    blockers.push("substance");
  }
  return blockers;
}

// Whether a brief carries enough to build a role from — mirrors the JD
// builder's min-need contract in spirit: a title plus at least one dealbreaker
// or a 90-day outcome, in whichever home the dialog recorded it.
export function briefReadyToPromote(brief: RoleBrief | null): brief is RoleBrief {
  return brief !== null && briefPromoteBlockers(brief).length === 0;
}

// --------------------------------------------------------------------------
// App master — RoleBrief (+ RepoDossier) → AppMasterSpec
// (docs/features/app-master/README.md §2.4, docs/concepts/app-master.md §3.5)
//
// Pure and total: the dialog writes a CLOSED set of facet keys
// (`objective:<kpiKey>`, `mandate.scopeRung`, `mandate.forbiddenClasses`,
// `budget.monthlyUsd`, `mandate.owner`, `tenure.probationDays`,
// `role.population` — pipeline/jobfit/intake.py::_AM_SLOT_FACET), and this
// reads them back into the spec. Two disciplines are load-bearing:
//
//   * **The defaults are the safe end, always.** A mandate rung that could not
//     be read is 2 (never 3 — that rung does not exist here), a forbidden-class
//     answer that could not be read keeps ALL SIX, and a population that could
//     not be read is `either` — the disclosed unknown, never a decision nobody
//     made.
//   * **Every fallback is written down.** Anything this function assumed lands
//     in `coercionNotes[]`, which travels with the spec exactly as
//     `coerce_app_master_spec`'s notes do — a spec composed from thin answers
//     must say so rather than look complete.
// --------------------------------------------------------------------------

export const APP_MASTER_OBJECTIVE_PREFIX = "objective:";
const APP_MASTER_FORBIDDEN_CLASSES = [
  "test_deletion_or_skip",
  "suppression_directive",
  "gate_configuration",
  "dependency_bump_to_satisfy_check",
  "credentials_or_permissions",
  "delivery_configuration",
] as const;
type ForbiddenClass = (typeof APP_MASTER_FORBIDDEN_CLASSES)[number];

// Words that let a requestor RELAX a forbidden class. Only an explicit allow
// verb in front of a named class removes it — "we take test deletion very
// seriously" must never read as permission.
const ALLOW_MARKER = /\b(allow|allowed|allowing|ok to|fine to|may|povol\w*|smí\w*|lze)\b/i;
const CLASS_PATTERNS: Record<ForbiddenClass, RegExp> = {
  test_deletion_or_skip: /\b(test[_\s-]?(deletion|delete|skip|skipping)|delet\w+ (a )?test|skip\w* (a )?test|smaz\w+ test|přeskoč\w+ test)\b/i,
  suppression_directive: /\b(suppress\w*|eslint-disable|ts-expect-error|type:\s*ignore|noqa|potlač\w*)\b/i,
  gate_configuration: /\b(gate config\w*|ci config\w*|konfigurac\w+ bran)\b/i,
  dependency_bump_to_satisfy_check: /\b(dependency bump\w*|bump\w* (a )?dependenc\w+|závislost\w*)\b/i,
  credentials_or_permissions: /\b(credential\w*|secret\w*|permission\w*|iam|přihlašovac\w*|oprávnění)\b/i,
  delivery_configuration: /\b(delivery config\w*|deploy target\w*|release channel\w*|feature[_\s-]?flag\w*|nasazení)\b/i,
};

function facetValue(brief: RoleBrief, key: string): string {
  return (brief.facets ?? []).find((f) => f.key === key)?.value?.trim() ?? "";
}

function firstNumber(text: string): number | null {
  const m = /-?\d[\d\s ]*(?:[.,]\d+)?/.exec(text);
  if (!m) return null;
  const n = Number(m[0].replace(/[\s ]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// "…within 60 days" / "do 60 dnů" / "this quarter" / "za měsíc". Returns null
// when the requestor gave no window — the caller then keeps the dossier's own
// window rather than inventing 30.
function parseWindowDays(text: string): number | null {
  const explicit = /(\d+)\s*(day|days|dn[íůy]|dnech)\b/i.exec(text);
  if (explicit) return Math.max(1, Math.min(3650, Number(explicit[1])));
  const weeks = /(\d+)\s*(week|weeks|týd\w*)\b/i.exec(text);
  if (weeks) return Math.max(1, Math.min(520, Number(weeks[1]) * 7));
  const months = /(\d+)\s*(month|months|měsíc\w*)\b/i.exec(text);
  if (months) return Math.max(1, Math.min(120, Number(months[1]) * 30));
  if (/\b(quarter|čtvrtlet\w*)\b/i.test(text)) return 90;
  if (/\b(month|měsíc\w*)\b/i.test(text)) return 30;
  return null;
}

function parseScopeRung(text: string): number | null {
  const digit = /(?:^|[^\d])([0-4])(?:[^\d]|$)/.exec(text);
  if (digit) return Number(digit[1]);
  if (/\b(open (a )?branch|propose|pull request|\bpr\b|větev|navrh\w*)\b/i.test(text)) return 2;
  if (/\b(re-?run|retry|znovu spust\w*|opakovat)\b/i.test(text)) return 1;
  if (/\b(read[- ]?only|just read|observe|jen (číst|čte)|pouze číst)\b/i.test(text)) return 0;
  return null;
}

function parsePopulation(text: string): "human" | "agent" | "either" | null {
  if (!text.trim()) return null;
  const either = /\b(either|both|obojí|oboje|kdokoliv|kdokoli)\b/i.test(text);
  const agent = /\b(agent|ai|autonomous|bot)\b/i.test(text);
  const human = /\b(human|person|people|člověk\w*|lidsk\w*|osoba)\b/i.test(text);
  if (either || (agent && human)) return "either";
  if (agent) return "agent";
  if (human) return "human";
  return null;
}

function repoName(repo: RepoDossier["repo"] | undefined): string {
  const raw = (repo?.url || repo?.rootPath || "").replace(/[/\\]+$/, "");
  if (!raw) return "";
  const tail = raw.split(/[/\\]/).pop() ?? "";
  return tail.replace(/\.git$/i, "").slice(0, 120);
}

/**
 * Compose the AppMasterSpec this session defines. Pure — no I/O, no clock, no
 * randomness — so the same brief + dossier always yields the same spec, and the
 * route can validate it with `appMasterSpecSchema` before persisting anything.
 *
 * `dossier` may be null (a scan that failed, or one that has not landed): the
 * spec is still composed from the requestor's answers, with the missing app
 * binding recorded as a coercion note rather than silently absent.
 */
export function briefToAppMasterSpec(brief: RoleBrief, dossier: RepoDossier | null): AppMasterSpec {
  const notes: string[] = [];
  const candidates = dossier?.candidateObjectives ?? [];

  // objectives — one per `objective:<kpiKey>` facet, in the order the requestor
  // gave them (rank IS the order they listed).
  const objectives: AppMasterSpec["objectives"] = [];
  for (const facet of brief.facets ?? []) {
    if (!facet.key?.startsWith(APP_MASTER_OBJECTIVE_PREFIX)) continue;
    const kpiKey = facet.key.slice(APP_MASTER_OBJECTIVE_PREFIX.length).trim();
    if (!kpiKey || objectives.some((o) => o.kpiKey === kpiKey)) continue;
    const proposed = candidates.find((c) => c.kpiKey === kpiKey);
    const statement = facet.value ?? "";
    // The requestor's own target wins over the scan's proposal; a line with no
    // readable number keeps the scan's target (or stays null — an objective
    // nobody has quantified is a real state, and 0 would invent one).
    const targetSpoken = firstNumber(statement.split(/[—:–-]/).slice(1).join(" ") || statement);
    const windowSpoken = parseWindowDays(statement);
    if (targetSpoken === null && proposed?.target == null) {
      notes.push(`objective '${kpiKey}' has no numeric target — it is recorded unquantified`);
    }
    objectives.push({
      kpiKey,
      label: facet.label || proposed?.label || kpiKey,
      baseline: proposed?.baseline ?? null,
      target: targetSpoken ?? proposed?.target ?? null,
      unit: proposed?.unit ?? (/%/.test(statement) ? "%" : ""),
      direction: proposed?.direction ?? "gte",
      windowDays: windowSpoken ?? proposed?.windowDays ?? 30,
    });
  }
  if (objectives.length === 0) notes.push("no objectives were chosen — the value ledger is empty");

  // mandate
  const rungAnswer = facetValue(brief, "mandate.scopeRung");
  const parsedRung = parseScopeRung(rungAnswer);
  let scopeRung = parsedRung ?? 2;
  if (parsedRung === null && rungAnswer) {
    notes.push(`could not read a scope rung from "${rungAnswer.slice(0, 80)}" — kept rung 2 (propose only)`);
  } else if (parsedRung !== null && parsedRung > 2) {
    notes.push(`scopeRung ${parsedRung} is not grantable in v1 (deploy/merge and gate changes never are) — clamped to 2`);
    scopeRung = 2;
  } else if (parsedRung !== null && parsedRung < 0) {
    scopeRung = 0;
  }

  const forbiddenAnswer = facetValue(brief, "mandate.forbiddenClasses");
  let forbiddenClasses: ForbiddenClass[] = [...APP_MASTER_FORBIDDEN_CLASSES];
  if (forbiddenAnswer && ALLOW_MARKER.test(forbiddenAnswer)) {
    const relaxed = APP_MASTER_FORBIDDEN_CLASSES.filter((c) => CLASS_PATTERNS[c].test(forbiddenAnswer));
    if (relaxed.length > 0 && relaxed.length < APP_MASTER_FORBIDDEN_CLASSES.length) {
      forbiddenClasses = APP_MASTER_FORBIDDEN_CLASSES.filter((c) => !relaxed.includes(c));
      notes.push(`the requestor relaxed: ${relaxed.join(", ")}`);
    } else if (relaxed.length >= APP_MASTER_FORBIDDEN_CLASSES.length) {
      // "allow everything" is not a grantable answer — all six stand and the
      // refusal is recorded rather than applied silently.
      notes.push("an answer relaxing every forbidden class was not applied — the full list stands");
    }
  }

  const owner = facetValue(brief, "mandate.owner").slice(0, 200);
  if (!owner) notes.push("no mandate owner was named — escalations have nowhere to go");

  // budget / tenure / population
  const budgetAnswer = facetValue(brief, "budget.monthlyUsd");
  const monthly = firstNumber(budgetAnswer);
  if (monthly === null && budgetAnswer) notes.push(`could not read a monthly budget from "${budgetAnswer.slice(0, 80)}"`);
  const probation = firstNumber(facetValue(brief, "tenure.probationDays"));
  const populationAnswer = facetValue(brief, "role.population");
  const population = parsePopulation(populationAnswer) ?? "either";
  if (population === "either" && parsePopulation(populationAnswer) === null) {
    notes.push("the population was not decided — recorded as 'either', the disclosed unknown");
  }

  // app binding
  const repo = dossier?.repo;
  if (!dossier) notes.push("no repo dossier was available — the app binding is incomplete");
  else if (!repo?.url && !repo?.rootPath) notes.push("the dossier carries no repo url or rootPath");

  const title = brief.title?.trim() || "App master";
  const spec = {
    schemaVersion: 1,
    role: {
      title: title.slice(0, 200),
      population,
      // "A step past senior" (§2.1) — only a seniority the requestor actually
      // stated overrides it; a schema default must not read as a decision.
      seniority: brief.spineProvenance?.seniority === "stated" && brief.seniority ? brief.seniority : "senior",
      rubricVersion: "app-master-rubric-v1",
    },
    app: {
      name: repoName(repo) || title.slice(0, 120),
      repo: {
        url: repo?.url ?? null,
        rootPath: repo?.rootPath ?? null,
        mainBranch: repo?.mainBranch || "main",
      },
      contextMapRef: null,
      dossierId: dossier?.dossierId || null,
    },
    objectives,
    mandate: {
      scopeRung,
      forbiddenClasses,
      // The repo's OWN declared gates are what a proposal must pass — the scan
      // read them, so they are inferred, not invented. Personas EXECUTES this
      // list on every proposal branch, so it is selected, not truncated.
      approvalGates: selectApprovalGates(dossier?.declaredGates ?? []),
      owner,
    },
    // Triggers are installed at dispatch (P4) — an empty cadence here is the
    // honest state, not a forgotten field.
    cadence: { triggers: [] },
    budget: {
      monthlyUsd: monthly !== null && monthly > 0 ? Math.round(monthly * 100) / 100 : 0,
      reservationPolicy: "estimate" as const,
      onCap: "drain" as const,
    },
    tenure: {
      probationDays: probation !== null && probation > 0 ? Math.round(probation) : 30,
      reviewCadenceDays: 30,
      retireCriteria: [],
    },
    agent:
      population === "agent"
        ? {
            name: `${title.slice(0, 100)} agent`,
            mission:
              brief.summary?.trim() ||
              (objectives.length
                ? `Move ${objectives.map((o) => o.label).slice(0, 3).join(", ")} for ${repoName(repo) || title}.`
                : `Own the continuing value of ${repoName(repo) || title}.`),
            systemPromptDraft: appMasterSystemPrompt(title, objectives, scopeRung, forbiddenClasses),
            // Intersected with the live catalog at dispatch (P4) — this pure
            // function has no catalog and must not guess one.
            connectors: [],
            maxTurns: null,
          }
        : null,
    human:
      population === "human"
        ? {
            jdSlug: "",
            // The open decision in docs/concepts/app-master.md §6, carried as
            // an explicit assumption rather than a silent band.
            compBandRef: "software_engineering senior +1 step (assumption)",
          }
        : null,
    coercionNotes: notes,
    promptVersion: "app-master-v1",
  };

  // Parse, not cast: the schema is the contract, and a spec that cannot satisfy
  // it must fail here rather than at the far end of a dispatch.
  return appMasterSpecSchema.parse(spec);
}

function appMasterSystemPrompt(
  title: string,
  objectives: AppMasterSpec["objectives"],
  scopeRung: number,
  forbidden: readonly string[]
): string {
  const ledger = objectives.length
    ? objectives.map((o) => `- ${o.label} (${o.kpiKey})${o.target != null ? `: target ${o.target}${o.unit}` : ""}, window ${o.windowDays}d`).join("\n")
    : "- (no objectives were chosen yet)";
  const rung =
    scopeRung === 0
      ? "read and report only — you make no writes at all"
      : scopeRung === 1
        ? "re-run existing work (a failed job, a flaky gate); you author no new change"
        : "open a branch and propose a change; a HUMAN merges it — never merge, deploy, or touch a gate";
  return [
    `You are the App master for "${title}": accountable for the continuing value of this one application.`,
    `Start every cycle from the value ledger, not from a task list:\n${ledger}`,
    `Your mandate is rung ${scopeRung}: ${rung}.`,
    `These change classes are forbidden — never make one, and never rewrite a blocked change into a shape that evades the check: ${forbidden.join(", ")}.`,
    "Run the repo's own declared gates before authoring and again before proposing. Never repair by deletion.",
    "Report truthfully: sent means sent, queued means queued, failed means failed. Unmeasured spend is not free spend.",
    "Stop at the mandate line and ask the named owner ONE specific question, carrying the options and your recommendation.",
  ].join("\n\n");
}

/**
 * Pick the gates a proposal must pass from the dossier's declared list.
 *
 * Personas runs every entry of `mandate.approvalGates` as a shell command in a
 * fresh worktree on each proposal (pre-authorship verification), so the list
 * has to be (a) runnable — a `ci: .github/workflows/ci.yml` pointer is a
 * finding, not a command — (b) the cheap, environment-free gates first, and
 * (c) bounded. A blind `slice(0, 10)` of an alphabetical list kept `build`,
 * `test:e2e` and three `test:eval*` runs and dropped `typecheck`, `test:unit`
 * and `test:python:gate` — the exact gates that decide a proposal.
 */
export const APPROVAL_GATE_PRIORITY: readonly string[] = [
  "typecheck",
  "lint",
  "test:unit",
  "test",
  "test:python:gate",
  "test:python",
  "design:check",
  "i18n:check",
  "schemas:check",
  "taxonomy:check",
  "check",
];
const APPROVAL_GATE_EXCLUDE = /(^|[\s:])(build|dev|start|deploy|release|publish|e2e|eval|bench|watch|storybook)([\s:]|$)/i;
export const MAX_APPROVAL_GATES = 8;

export function selectApprovalGates(declared: readonly unknown[]): string[] {
  const cmds = declared
    .map((g) => String(g ?? "").trim().slice(0, 200))
    // "ci: .github/workflows/ci.yml" is a pointer, not a command.
    .filter((g) => g.length > 0 && !/^[a-z_-]+:\s/i.test(g));
  const rank = (cmd: string): number => {
    const tail = cmd.replace(/^(npm|pnpm|yarn|bun)\s+(run\s+)?/i, "").split(/\s+/)[0] ?? cmd;
    const i = APPROVAL_GATE_PRIORITY.indexOf(tail);
    return i === -1 ? APPROVAL_GATE_PRIORITY.length : i;
  };
  const seen = new Set<string>();
  return cmds
    .filter((c) => !APPROVAL_GATE_EXCLUDE.test(c))
    .map((c, i) => ({ c, i, r: rank(c) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.c)
    .filter((c) => (seen.has(c) ? false : (seen.add(c), true)))
    .slice(0, MAX_APPROVAL_GATES);
}
