import { NextRequest } from "next/server";
import { mintAndDispatch } from "@/app/api/agents/dispatch/mint";
import { boundedBudget } from "@/app/api/agents/dispatch/spec-bounds";
import type { DispatchSpec } from "../agent-hire/bridge-client";
import { ACTIVE_AGENT_STATUSES, getHiredAgent } from "../db/agents";
import { createGigSpecialist, listGigSpecialists } from "../db/gigs-specialists";
import { publicBaseUrl } from "../public-base-url";
import { ROLE_FAMILY_SLUGS } from "../role-families";
import { GIG_DISCLOSURE_SENTENCE } from "./contract";
import { GIG_TYPE_LABEL, gigTypeOf, type GigKnowledgeRef, type GigType } from "./gig-type";
import { resolveGigTypeKnowledge } from "./gig-type-knowledge";
import type { ensurePersonasWorkspace, PersonasPlaceFailureReason } from "./personas-places";
import { GIG_PERSONA_MAX_BUDGET_USD, GIG_PERSONA_MODEL } from "./plan-seats";
import { ensureGigArenaWorkspace } from "./project";
import { resolveGigRecipes, type ResolvedGigRecipes } from "./recipes";
import { GIG_REQUIREMENTS_VERSION, composeGigRequirements, gatherGigResearch, type GigAgentRequirements } from "./requirements";
import {
  GIG_ARENA_CONNECTORS,
  GIG_ARENA_LABEL,
  GIG_DEFAULT_BUDGET_USD,
  GIG_DEFAULT_FAMILY,
  cleanNiche,
  gigSpecialistName,
} from "./specialist-defaults";
import type { Gig, GigArena, GigSpecialist, GigSpecialistSpec } from "./types";

// Gig specialists: compose the spec (arena + niche + adopted recipes), derive the
// REQUIREMENTS it is hired from (requirements.ts), project both onto the flat DispatchSpec
// the Personas hire takes, and HIRE it through the one existing hire tail
// (`mintAndDispatch`, app/api/agents/dispatch/mint.ts) - reused, never copied, so a gig
// specialist is minted, dispatched, rate-limited and failure-reported exactly like every
// other hire.
//
// NO SYSTEM PROMPT. kp used to write the persona's system prompt here; since 2026-09-25 it
// sends `spec.requirements` (kp.agent-requirements.v1) and no `systemPromptDraft`, and
// Personas designs the agent from the requirements (the operator's decision, quoted in
// requirements.ts). The rules the prompt carried now travel in two places that do not
// depend on any prompt: the requirements' `constraints`, and
// DELIVERABLE-CONTRACT.md in every gig folder (contract.ts, workdir.ts).
//
// THE jobId QUESTION. `mintAndDispatch` takes a `jobId`, and App-master hires already
// pass "" (they own an application, not a job posting). A gig specialist passes "" too,
// and that is safe on every read the hire path makes:
//   - the dispatch idempotency read `getActiveHiredAgentForJob` guards `job_id != ''`,
//     so an empty id never matches (nor dedupes against) any other hire;
//   - the App-master idempotency read keys on `intake_id`, which a gig hire leaves NULL;
//   - "is this an App-master hire" is `appMaster` present, which a gig hire never sets;
//   - `placeAgentOnBoard` returns early on an empty jobId, so no pipeline card is filed.
// A pseudo id (`gig-specialist:<id>`) was considered and REJECTED: `placeAgentOnBoard`
// would then file an Offer-stage card for a "job" that does not exist, the pseudo id
// would ride `kp.jobId` to Personas as if it named a posting, and the roster's job link
// would point nowhere. The gig hire is told apart by its jobTitle prefix
// (GIG_SPECIALIST_JOB_TITLE_PREFIX) and, authoritatively, by the gig_specialists row
// that names its hired_agents id.
//
// UNTRUSTED TEXT: the requirements are built from recipes (registry or seed), the arena
// checklist, the operator's niche label, and the research aggregate of OTHER gigs' briefs
// (requirements.ts scans each research string for agent-addressed text and drops it). A
// gig's own listing text never enters them - it arrives per attempt as `bodyUntrusted`
// inside the assignment (dispatch.ts), and the folder's rules say to treat it as data.

/** The hired_agents job_title prefix that marks a gig specialist on the roster. */
export const GIG_SPECIALIST_JOB_TITLE_PREFIX = "Gig specialist";

export { GIG_REQUIREMENTS_VERSION };

export { GIG_ARENA_CONNECTORS, GIG_ARENA_LABEL, GIG_DEFAULT_BUDGET_USD, GIG_DEFAULT_FAMILY, cleanNiche, gigSpecialistName };

/** The disclosure sentence every deliverable must carry (contract.ts owns it; re-exported). */
export { GIG_DISCLOSURE_SENTENCE };

export type ComposeGigSpecialistInput = {
  arena: GigArena;
  niche: string;
  taxonomyFamily?: string | null;
  /** Operator override of the per-attempt ceiling; bounded, else the arena default. */
  budgetUsdPerAttempt?: number | null;
  /** Narrow the arena's tools for this niche (only a SUBSET of GIG_ARENA_CONNECTORS[arena];
   *  anything else is dropped, so an override can never add a tool). Personas holds a build
   *  whose test run never calls a declared tool, and a niche whose work never needs one (data,
   *  scripting) failed every hire on `research` - found in the 2026-09-26 training cycle. */
  connectors?: readonly string[] | null;
};

/** The arena's connectors, narrowed to `requested` when one is given (order of the arena list kept). */
export function narrowConnectors(arena: GigArena, requested?: readonly string[] | null): string[] {
  const allowed = GIG_ARENA_CONNECTORS[arena];
  if (!requested) return [...allowed];
  const want = new Set(requested.map((c) => c.trim()));
  return allowed.filter((c) => want.has(c));
}

/** The specialist's spec. Recipes are resolved here unless the caller already did
 *  (hireGigSpecialist resolves once and reuses the result for the requirements). */
export function composeGigSpecialistSpec(input: ComposeGigSpecialistInput, resolved?: ResolvedGigRecipes): GigSpecialistSpec {
  const recipes = resolved ?? resolveGigRecipes(input.arena);
  const family =
    typeof input.taxonomyFamily === "string" && (ROLE_FAMILY_SLUGS as readonly string[]).includes(input.taxonomyFamily)
      ? input.taxonomyFamily
      : GIG_DEFAULT_FAMILY[input.arena];
  const override = boundedBudget(input.budgetUsdPerAttempt);
  return {
    arena: input.arena,
    niche: cleanNiche(input.niche),
    taxonomyFamily: family,
    recipes: recipes.recipes.map((r) => ({ ...r.ref })),
    exemplars: [],
    connectors: narrowConnectors(input.arena, input.connectors),
    budgetUsdPerAttempt: override !== null && override > 0 ? override : GIG_DEFAULT_BUDGET_USD[input.arena],
    // The stored field keeps its name (persisted in every gig_specialists row); its value is
    // now the requirements version - prompt versions ended at `gig-specialist.v3`.
    promptVersion: GIG_REQUIREMENTS_VERSION,
  };
}

/** Project a specialist spec and its requirements onto the flat DispatchSpec the Personas
 *  hire takes: `requirements` rides as-is, and there is NO `systemPromptDraft` (absent,
 *  never "" - the bridge then omits the key from the wire). */
export function specialistDispatchSpec(spec: GigSpecialistSpec, requirements: GigAgentRequirements): DispatchSpec {
  const arenaCraft = requirements.craft[0];
  const mission = [arenaCraft?.need, arenaCraft?.coreAction].filter((s): s is string => !!s && !!s.trim()).join(" ");
  return {
    name: gigSpecialistName(spec),
    mission: mission || `Draft ${GIG_ARENA_LABEL[spec.arena].toLowerCase()} work for the operator to review and send.`,
    connectors: [...spec.connectors],
    maxBudgetUsd: boundedBudget(spec.budgetUsdPerAttempt),
    // kp measures a specialist on accepted outcomes itself (gigs/kpi.ts); none are
    // declared to Personas, whose success-metric shape is the App-master objective.
    successMetrics: [],
    requirements,
  };
}

/** Where a new hire was filed in Personas: its arena's workspace, or nowhere (with why). A
 *  reused specialist reports null/null - it was filed when it was hired. */
export type GigHirePlacement = {
  placement: { workspaceId: string } | null;
  /** Why the hire went out WITHOUT a placement (e.g. `personas_route_missing` on an older
   *  Personas). Never blocks the hire. */
  placementSkipped: PersonasPlaceFailureReason | null;
};

/** The handle a gig specialist's hire carries to Personas as `kp.jobId`: a specialist has
 *  no job posting, and Personas refuses an empty jobId outside the intake shape. Stable per
 *  arena + niche, ASCII, bounded to Personas' 128-character field. */
export function gigSpecialistLinkJobId(spec: Pick<GigSpecialistSpec, "arena" | "niche">): string {
  const niche = cleanNiche(spec.niche).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "general";
  return `gig-specialist:${spec.arena}:${niche}`.slice(0, 128);
}

export type HireGigSpecialistResult =
  | ({ ok: true; specialist: GigSpecialist; hiredAgentId: string; requestId: string | null; reused: boolean } & GigHirePlacement)
  | { ok: false; status: number; code: string; error: string; hiredAgentId: string | null };

/** The request mintAndDispatch reads for its per-IP limiter and kp's public base URL,
 *  when the caller has none (a script, the desk's server action). Its origin is the
 *  deployment's configured public origin, never a made-up host. */
function syntheticRequest(): NextRequest {
  return new NextRequest(`${publicBaseUrl()}/api/gigs/specialists`, { method: "POST" });
}

/** Hire a specialist: resolve recipes, compose the spec and its requirements, mint +
 *  dispatch through the shared hire tail, then record the gig_specialists row. A live
 *  specialist already hired for the same arena + niche is REUSED (a double-click must not hire twice). A failed
 *  dispatch records no specialist - the hired_agents row it minted is `failed` and says
 *  why, exactly as for every other hire. */
export async function hireGigSpecialist(
  workspaceId: string,
  input: ComposeGigSpecialistInput,
  req?: NextRequest,
  deps: { ensureWorkspace?: typeof ensurePersonasWorkspace } = {}
): Promise<HireGigSpecialistResult> {
  const niche = cleanNiche(input.niche);
  // A gig persona (gig_id set) serves its one gig and is never reused as a niche specialist.
  const existing = listGigSpecialists(workspaceId).find(
    (s) => s.gigId === null && s.spec.arena === input.arena && cleanNiche(s.spec.niche).toLowerCase() === niche.toLowerCase()
  );
  if (existing) {
    const agent = getHiredAgent(existing.hiredAgentId, workspaceId);
    if (agent && ACTIVE_AGENT_STATUSES.includes(agent.status)) {
      return {
        ok: true,
        specialist: existing,
        hiredAgentId: agent.id,
        requestId: agent.requestId,
        reused: true,
        placement: null,
        placementSkipped: null,
      };
    }
  }

  const resolved = resolveGigRecipes(input.arena);
  const spec = composeGigSpecialistSpec({ ...input, niche }, resolved);
  // The requirements: the recipes' craft and lessons, plus what this workspace's research of
  // the arena's listings found (keyless, deterministic; a store read, so outside any tx).
  const requirements = composeGigRequirements(spec, resolved, gatherGigResearch(workspaceId, spec.arena, spec.niche));
  const dispatchSpec = specialistDispatchSpec(spec, requirements);
  // File the hire into its arena's Personas workspace (project.ts). Any failure - an older
  // Personas without the route above all - hires WITHOUT a placement and says so: the
  // workspace is housekeeping, the hire is the point.
  const arenaWs = await ensureGigArenaWorkspace(spec.arena, deps.ensureWorkspace);
  const placement = arenaWs.ok ? { workspaceId: arenaWs.id } : null;
  const res = await mintAndDispatch(req ?? syntheticRequest(), workspaceId, {
    jobId: "",
    linkJobId: gigSpecialistLinkJobId(spec),
    jobTitle: `${GIG_SPECIALIST_JOB_TITLE_PREFIX} - ${dispatchSpec.name}`,
    intakeId: null,
    spec: dispatchSpec,
    fit: { kind: "kp.gig-specialist.v1", arena: spec.arena, niche: spec.niche, recipes: spec.recipes },
    metrics: [],
    budgetUsd: dispatchSpec.maxBudgetUsd,
    ...(placement ? { passthrough: { placement } } : {}),
  });
  const body = (await res.json().catch(() => null)) as {
    hiredAgentId?: unknown;
    requestId?: unknown;
    code?: unknown;
    error?: unknown;
  } | null;
  const hiredAgentId = typeof body?.hiredAgentId === "string" ? body.hiredAgentId : null;
  if (res.status !== 200 || !hiredAgentId) {
    return {
      ok: false,
      status: res.status === 200 ? 502 : res.status,
      code: typeof body?.code === "string" ? body.code : "AGENT_DISPATCH_BRIDGE_FAILED",
      error: typeof body?.error === "string" ? body.error : "The specialist hire was not dispatched.",
      hiredAgentId,
    };
  }
  const specialist = createGigSpecialist(workspaceId, {
    hiredAgentId,
    name: dispatchSpec.name,
    spec,
    registry: resolved.registry,
  });
  return {
    ok: true,
    specialist,
    hiredAgentId,
    requestId: typeof body?.requestId === "string" ? body.requestId : null,
    reused: false,
    placement,
    placementSkipped: arenaWs.ok ? null : arenaWs.reason,
  };
}

// ---------------------------------------------------------------------------
// Gig personas: ONE persona per gig, hired at pairing (pairing.ts) and retired when the gig
// ends (sync.ts). Same hire tail and the same requirements object as a niche specialist,
// plus what makes it the gig's own: the model it runs on (GIG_PERSONA_MODEL), the gig's
// registry knowledge by type (gig-type.ts), the operator-accepted plan (its steps lead the
// responsibilities), and a placement in the gig's own Personas project. The gig's listing
// text still never enters the requirements - only the plan (written by kp's plan seats from
// the research brief and accepted by the operator) and trusted parts do.
// ---------------------------------------------------------------------------

/** The hired_agents job_title prefix that marks a gig persona on the roster. */
export const GIG_PERSONA_JOB_TITLE_PREFIX = "Gig persona";

/** The `fit.kind` a gig persona's request carries (the Personas side routes on it). */
export const GIG_PERSONA_FIT_KIND = "kp.gig-persona.v1" as const;

const PERSONA_TITLE_MAX = 48;
const PERSONA_MISSION_MAX = 600;

/** `<short title> · <last 6 of the gig id>` - the brief's title (else the listing's), cut at
 *  a word to 48 characters. Pure. */
export function gigPersonaName(gig: Pick<Gig, "id" | "title" | "brief">): string {
  const full = (gig.brief?.title || gig.title).replace(/\s+/g, " ").trim();
  let short = full.slice(0, PERSONA_TITLE_MAX);
  if (full.length > PERSONA_TITLE_MAX) short = short.replace(/\s+\S*$/, "") || short;
  const id6 = gig.id.toLowerCase().replace(/[^a-z0-9]/g, "").slice(-6) || "000000";
  return `${short.trim() || "Gig"} · ${id6}`;
}

/** The handle a gig persona's hire carries to Personas as `kp.jobId` (there is no job
 *  posting): stable per gig, bounded to Personas' 128-character field. */
export function gigPersonaLinkJobId(gigId: string): string {
  return `gig-persona:${gigId}`.slice(0, 128);
}

/** The niche label a gig persona is filed under: the brief category's head, else its type. */
export function gigPersonaNiche(gig: Pick<Gig, "arena" | "brief">, type: GigType = gigTypeOf(gig)): string {
  const head = (gig.brief?.category ?? "").split("·")[0]?.replace(/\s+/g, " ").trim() ?? "";
  return cleanNiche(head || GIG_TYPE_LABEL[type]);
}

export type HireGigPersonaInput = {
  gig: Gig;
  /** The accepted plan (db/gigs-plans.ts getAcceptedGigPlan) and the operator's note. */
  plan: { summary: string; steps: readonly { title: string; doneWhen: string }[]; note: string | null };
  /** The gig's Personas workspace and project; null hires without a placement. */
  placement: { workspaceId: string; projectId: string } | null;
};

export type HireGigPersonaDeps = {
  resolveRecipes?: (arena: GigArena) => ResolvedGigRecipes;
  resolveKnowledge?: (type: GigType) => GigKnowledgeRef[];
  req?: NextRequest;
};

export type HireGigPersonaResult =
  | { ok: true; specialist: GigSpecialist; hiredAgentId: string; requestId: string | null; knowledge: GigKnowledgeRef[] }
  | { ok: false; status: number; code: string; error: string; hiredAgentId: string | null };

/** Hire the gig's own persona through the shared hire tail and record its gig_specialists
 *  row (gig_id set). The caller (pairing.ts) decides whether a hire is needed at all. */
export async function hireGigPersona(workspaceId: string, input: HireGigPersonaInput, deps: HireGigPersonaDeps = {}): Promise<HireGigPersonaResult> {
  const { gig, plan } = input;
  const type = gigTypeOf(gig);
  const resolved = (deps.resolveRecipes ?? ((a: GigArena) => resolveGigRecipes(a)))(gig.arena);
  const spec = composeGigSpecialistSpec({ arena: gig.arena, niche: gigPersonaNiche(gig, type) }, resolved);
  const knowledge = (deps.resolveKnowledge ?? ((t: GigType) => resolveGigTypeKnowledge(t)))(type);
  const name = gigPersonaName(gig);
  const composed = composeGigRequirements(spec, resolved, gatherGigResearch(workspaceId, spec.arena, spec.niche), {
    knowledge,
    plan: { summary: plan.summary, steps: plan.steps, note: plan.note },
  });
  const requirements: GigAgentRequirements = { ...composed, role: name, budgetUsdPerAttempt: GIG_PERSONA_MAX_BUDGET_USD };
  const base = specialistDispatchSpec(spec, requirements);
  const mission = plan.summary.replace(/\s+/g, " ").trim().slice(0, PERSONA_MISSION_MAX);
  const dispatchSpec: DispatchSpec = {
    ...base,
    name,
    mission: mission || base.mission,
    // The spend cap Personas stores on the persona: none today (GIG_PERSONA_MAX_BUDGET_USD).
    maxBudgetUsd: GIG_PERSONA_MAX_BUDGET_USD,
    modelProfile: { model: GIG_PERSONA_MODEL.model, effort: GIG_PERSONA_MODEL.effort },
  };
  const fit = {
    kind: GIG_PERSONA_FIT_KIND,
    gigId: gig.id,
    gigType: type,
    arena: gig.arena,
    recipes: spec.recipes,
    knowledge: knowledge.map((k) => ({ bundle: k.bundle, subject: k.subject })),
  };
  const res = await mintAndDispatch(deps.req ?? syntheticRequest(), workspaceId, {
    jobId: "",
    linkJobId: gigPersonaLinkJobId(gig.id),
    jobTitle: `${GIG_PERSONA_JOB_TITLE_PREFIX} - ${name}`,
    intakeId: null,
    spec: dispatchSpec,
    // Stored on kp's row AND sent top-level: Personas applies its gig-persona approval
    // policy to a request whose `fit.kind` is kp.gig-persona.v1.
    fit,
    metrics: [],
    budgetUsd: dispatchSpec.maxBudgetUsd,
    passthrough: {
      fit,
      ...(input.placement ? { placement: { workspaceId: input.placement.workspaceId, projectId: input.placement.projectId } } : {}),
    },
  });
  const body = (await res.json().catch(() => null)) as { hiredAgentId?: unknown; requestId?: unknown; code?: unknown; error?: unknown } | null;
  const hiredAgentId = typeof body?.hiredAgentId === "string" ? body.hiredAgentId : null;
  if (res.status !== 200 || !hiredAgentId) {
    return {
      ok: false,
      status: res.status === 200 ? 502 : res.status,
      code: typeof body?.code === "string" ? body.code : "AGENT_DISPATCH_BRIDGE_FAILED",
      error: typeof body?.error === "string" ? body.error : "The gig persona hire was not dispatched.",
      hiredAgentId,
    };
  }
  const specialist = createGigSpecialist(workspaceId, { hiredAgentId, name, spec, registry: resolved.registry, gigId: gig.id });
  return { ok: true, specialist, hiredAgentId, requestId: typeof body?.requestId === "string" ? body.requestId : null, knowledge };
}
