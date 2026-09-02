// THE ACTION CATALOG — one array, three derivations.
//
// Candi is an ACTOR on rails that already exist (docs/features/companion/README.md,
// WP3). She never invents an operation: every action below dispatches machinery the
// operator already has a button for, and every one of them lands as a PROPOSAL the
// operator resolves. Nothing here sends, publishes, or decides on its own.
//
// SINGLE SOURCE (registry doctrine `action-catalog-single-source`). Three things
// have to agree about what an action is called and what it takes:
//
//   1. the PROMPT that teaches the model to emit `kp:action` (companion_cli.py),
//   2. the VALIDATOR that decides whether an emitted block is real
//      (companion_blocks.py, and `coerceActionParams` below),
//   3. the EXECUTOR that runs an accepted proposal (the resolve route).
//
// All three DERIVE from `COMPANION_ACTIONS`. The Python half never hardcodes the
// list: `companionActionWire()` serializes the catalog into `turn.json`, so the
// prompt addendum and the fence validator are both built from what was shipped
// across the boundary that turn. `companion-actions.test.ts` pins the derivation.
//
// The anti-pattern this exists to avoid is the repo's own cockpit post-mortem: a
// prompt listing one set of verbs, a parser accepting a second, and a dispatcher
// implementing a third, each edited separately until the model reliably proposed
// things nothing could run.
//
// WHY THE HEAVY IMPORTS ARE DYNAMIC. `execute` reaches into the task runner, the
// pipeline store and the JD store — the whole domain graph. This module is also
// imported by `companion-run.ts`, which the hot message route pulls in, and
// `next dev` compiles a route's entire module graph with no tree-shaking (the
// same cost note attention.ts carries). So the static graph here is EMPTY and
// every dependency is reached with `await import()` inside the function that
// needs it — the lazy-import precedent comms-dispatch.ts already sets for
// `next/headers`. The catalog stays one array; only the cost is deferred.

// The stored payload's SHAPE lives in companion-proposal-view.ts — the dock has
// to read it and must not import this module to do so (every `execute` below
// reaches better-sqlite3, and a lazy `import()` is still a bundled chunk). Nothing
// there names an action; it is the serialization contract, re-exported here so a
// spec author never has to know about the split.
import {
  coerceProposalPayload,
  MAX_ACTION_PARAM_CHARS,
  type CompanionActionOutcome,
  type CompanionActionParams,
  type CompanionActionSummary,
  type CompanionProposalPayload,
} from "./companion-proposal-view";

export { coerceProposalPayload, MAX_ACTION_PARAM_CHARS };
export type {
  CompanionActionOutcome,
  CompanionActionParams,
  CompanionActionSummary,
  CompanionProposalPayload,
};

/** One declared parameter. `doc` is shipped to the model verbatim, so it is
 *  written as an instruction ("the candidate's name exactly as it appears in the
 *  grounding") rather than as a type. */
export type CompanionActionParam = {
  name: string;
  required: boolean;
  doc: string;
};

export type CompanionActionContext = {
  workspaceId: string;
  /** The conversation that produced the proposal. Doubles as the LLM request id
   *  for anything the execution spends, so companion-caused spend stays
   *  attributable to the conversation that caused it. */
  threadId: string;
  /** The operator's UI locale, for the machinery that generates localized text. */
  locale: string;
};

export type CompanionActionSpec = {
  id: string;
  /** One line, shipped to the model. What accepting this actually does. */
  doc: string;
  params: readonly CompanionActionParam[];
  /** The proposal's own description, resolved at render time. Pure. */
  summary: (params: CompanionActionParams) => CompanionActionSummary;
  /** The ONE DOOR. Runs at execution time, after the operator accepted — it
   *  re-validates everything that can change between proposal and accept (does
   *  the candidate still exist, is it still in this tenant, is it still
   *  unambiguous) and then dispatches. A refusal is a normal return, not a
   *  throw: the operator gets an honest outcome chip either way. */
  execute: (params: CompanionActionParams, ctx: CompanionActionContext) => Promise<CompanionActionOutcome>;
};

/** At most two proposals per reply. A dock column that is mostly buttons has
 *  stopped being a conversation. Mirrors MAX_BLOCKS on the block half, and
 *  MAX_ACTIONS in companion_blocks.py. */
export const MAX_ACTIONS_PER_REPLY = 2;

/** Refused, honestly. Every refusal path returns one of these rather than
 *  throwing, so a stale proposal reads as "this no longer applies" instead of a
 *  500 the operator has to interpret. */
function refused(key: string, values?: Record<string, string | number>): CompanionActionOutcome {
  return { key, values };
}

/** Resolve a candidate NAME to exactly one active pipeline entry in this tenant.
 *
 *  The model only ever sees labels — `pipelineSummary` hands it
 *  `{label, matchScore, stage}` per role and no ids at all — so an action keyed
 *  by entry id would be an action the model cannot address. Resolving here is
 *  also what makes "the entry exists and is workspace-scoped" a real check
 *  rather than a claim: `listPipeline(workspaceId)` is the tenant's own board,
 *  so a label that resolves nowhere refuses, and a label matching two people (or
 *  one person on two roles) refuses as AMBIGUOUS rather than guessing which
 *  human the operator meant. */
async function resolveEntryByLabel(
  params: CompanionActionParams,
  workspaceId: string
): Promise<{ ok: true; id: string; label: string } | { ok: false; outcome: CompanionActionOutcome }> {
  const wanted = (params.candidate ?? "").trim().toLowerCase();
  if (!wanted) return { ok: false, outcome: refused("noSuchCandidate", { candidate: params.candidate ?? "" }) };
  const role = (params.role ?? "").trim().toLowerCase();
  const { listPipeline } = await import("./db/pipeline");
  const matches = listPipeline(workspaceId).filter(
    (entry) =>
      entry.status === "active" &&
      (entry.candidateLabel ?? "").trim().toLowerCase() === wanted &&
      (!role || (entry.jobTitle ?? "").trim().toLowerCase() === role)
  );
  if (matches.length === 0) return { ok: false, outcome: refused("noSuchCandidate", { candidate: params.candidate ?? "" }) };
  if (matches.length > 1) return { ok: false, outcome: refused("ambiguousCandidate", { candidate: params.candidate ?? "" }) };
  return { ok: true, id: matches[0].id, label: matches[0].candidateLabel };
}

/** ISO day, the digest's identity axis. One digest per tenant per day: a second
 *  accept the same day coalesces onto the run already in flight (task-dedupe). */
export function digestDayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export const COMPANION_ACTIONS: readonly CompanionActionSpec[] = [
  {
    id: "run_analysis",
    doc: "Re-run the AI screening of one candidate already on the board. It produces a screening verdict the operator reviews in Decisions; it does not hire, reject or write to the candidate.",
    params: [
      { name: "candidate", required: true, doc: "the candidate's name exactly as it appears in the grounding" },
      { name: "role", required: false, doc: "the role title, only when the same name sits on two roles" },
    ],
    summary: (p) => ({ key: "runAnalysis", values: { candidate: p.candidate ?? "" } }),
    execute: async (params, ctx) => {
      const found = await resolveEntryByLabel(params, ctx.workspaceId);
      if (!found.ok) return found.outcome;
      // The SAME per-entry screening the board's own "AI-screen" pass runs
      // (tasks.ts `automation`), dispatched one entry at a time and stamped with
      // this tenant — never a second screening path Candi owns privately.
      const { startTask } = await import("./tasks");
      const task = startTask(
        "automation",
        { entryId: found.id, task: "screen", notes: "", entryLabel: found.label },
        ctx.workspaceId
      );
      return { key: "analysisQueued", values: { candidate: found.label }, ref: task.id };
    },
  },
  {
    id: "generate_digest",
    doc: "Write today's studio digest: what needs the operator, what the board looks like, and which proposals are still open. Costs one model call and produces a message in this conversation.",
    params: [],
    summary: () => ({ key: "generateDigest" }),
    execute: async (_params, ctx) => {
      const { startTask } = await import("./tasks");
      const dayIso = digestDayIso();
      const task = startTask(
        "companion_digest",
        // workspaceId rides the PARAMS as well as the task row: buildDedupeKey
        // only ever sees params, so without it the day would be the whole
        // identity and two tenants would coalesce onto one digest.
        { workspaceId: ctx.workspaceId, dayIso, threadId: ctx.threadId, lang: ctx.locale },
        ctx.workspaceId
      );
      return { key: "digestQueued", ref: task.id };
    },
  },
  {
    id: "draft_jd",
    doc: "Draft a job description from a free-text need. It lands in the JD library as an unpublished draft the operator edits and publishes; nothing is posted anywhere.",
    params: [
      { name: "title", required: true, doc: "the role title" },
      { name: "need", required: true, doc: "what the team actually needs, in the operator's own words, at least a sentence" },
      { name: "seniority", required: false, doc: "junior | medior | senior, when the operator said one" },
    ],
    summary: (p) => ({ key: "draftJd", values: { title: p.title ?? "" } }),
    execute: async (params, ctx) => {
      const title = (params.title ?? "").trim();
      const needText = (params.need ?? "").trim();
      // The SAME contract POST /api/jds/generate enforces before it spends: a
      // build with too little need produces a JD nobody wants, and refusing here
      // is cheaper than refusing after the operator watched it run.
      const { validateJdBuildInput } = await import("./jd-limits");
      const valid = validateJdBuildInput(title, needText);
      if (!valid.ok) return refused("jdNeedsMore");
      const { startJdBuild } = await import("./jd-build-start");
      // Byte-identical to the Generate flow BECAUSE IT IS THE SAME CODE: the shared
      // seam inserts the placeholder JD row (it appears in the library immediately
      // in its `analyzing` state), starts the detached build that fills it in, and
      // links the two. `analysis_status` never reaches "published" on this path —
      // publishing is a separate act the operator takes in the library.
      const options = { description: true, marketResearch: true, caseDesign: false };
      const buildInput = { needText, seniority: params.seniority, lang: ctx.locale, options };
      const { slug } = startJdBuild({
        title: valid.title,
        options,
        buildInput,
        workspaceId: ctx.workspaceId,
        params: { needText, seniority: params.seniority, lang: ctx.locale },
      });
      return { key: "jdDrafting", values: { title: valid.title }, ref: slug };
    },
  },
  {
    id: "draft_outreach",
    doc: "Draft an outreach letter to one candidate already on the board. It lands in the Outbox for the operator to read and release; this action never relays it.",
    params: [
      { name: "candidate", required: true, doc: "the candidate's name exactly as it appears in the grounding" },
      { name: "role", required: false, doc: "the role title, only when the same name sits on two roles" },
    ],
    summary: (p) => ({ key: "draftOutreach", values: { candidate: p.candidate ?? "" } }),
    execute: async (params, ctx) => {
      const found = await resolveEntryByLabel(params, ctx.workspaceId);
      if (!found.ok) return found.outcome;
      // The board's own cohort drafter, with a cohort of one (tasks.ts
      // `batch_outreach` → runAutomationTask → dispatchOutreach). That door is
      // the Outbox: the draft is recorded `queued` and nothing dequeues it. It is
      // reused rather than reimplemented precisely so Candi adds NO send path of
      // her own — see the Outbox note in docs/features/companion/README.md.
      const { startTask } = await import("./tasks");
      const task = startTask("batch_outreach", { entryIds: [found.id] }, ctx.workspaceId);
      return { key: "outreachQueued", values: { candidate: found.label }, ref: task.id };
    },
  },
] as const;

const BY_ID = new Map(COMPANION_ACTIONS.map((spec) => [spec.id, spec]));

export function companionAction(id: string): CompanionActionSpec | null {
  return BY_ID.get(id) ?? null;
}

export function companionActionIds(): string[] {
  return COMPANION_ACTIONS.map((spec) => spec.id);
}

// ---- the wire catalog (what crosses into Python) ---------------------------

export type CompanionActionWire = {
  id: string;
  description: string;
  params: { name: string; required: boolean; doc: string }[];
};

/** The catalog as `turn.json` carries it. companion_cli.py builds its prompt
 *  addendum from THIS and companion_blocks.py validates fences against THIS —
 *  which is why neither file contains an action name. A route that ships no
 *  catalog teaches nothing, so the model never proposes: the safe default. */
export function companionActionWire(): CompanionActionWire[] {
  return COMPANION_ACTIONS.map((spec) => ({
    id: spec.id,
    description: spec.doc,
    params: spec.params.map((param) => ({ name: param.name, required: param.required, doc: param.doc })),
  }));
}

// ---- the shape validator ---------------------------------------------------

export type CoercedAction =
  | { ok: true; id: string; params: CompanionActionParams; summary: CompanionActionSummary }
  | { ok: false; reason: string };

/** Untrusted `{id, params}` in, a proposal-ready action out.
 *
 *  DERIVED, not written per action: presence and shape come from the declared
 *  `params` array, so adding a parameter to a spec extends the validator, the
 *  prompt and the executor in one edit. Undeclared keys are DROPPED rather than
 *  carried — a param nothing reads is a param that cannot be validated.
 *
 *  This runs at the process boundary (a spawned CLI's stdout). The executor
 *  runs its own checks again at accept time, because everything interesting
 *  about a proposal — does that candidate still exist, is that role still open —
 *  can change between the reply and the click. */
export function coerceCompanionAction(raw: unknown): CoercedAction {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "not an object" };
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const spec = BY_ID.get(id);
  if (!spec) return { ok: false, reason: `unknown action id ${JSON.stringify(id)}` };
  const rawParams =
    record.params && typeof record.params === "object" && !Array.isArray(record.params)
      ? (record.params as Record<string, unknown>)
      : {};
  const params: CompanionActionParams = {};
  for (const param of spec.params) {
    const value = rawParams[param.name];
    const text = typeof value === "string" ? value.trim().slice(0, MAX_ACTION_PARAM_CHARS) : "";
    if (!text) {
      if (param.required) return { ok: false, reason: `${id} is missing ${param.name}` };
      continue;
    }
    params[param.name] = text;
  }
  return { ok: true, id, params, summary: spec.summary(params) };
}

