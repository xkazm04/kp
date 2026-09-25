import { NextRequest } from "next/server";
import { mintAndDispatch } from "@/app/api/agents/dispatch/mint";
import { boundedBudget } from "@/app/api/agents/dispatch/spec-bounds";
import type { DispatchSpec } from "../agent-hire/bridge-client";
import { ACTIVE_AGENT_STATUSES, getHiredAgent } from "../db/agents";
import { createGigSpecialist, listGigSpecialists } from "../db/gigs-specialists";
import { publicBaseUrl } from "../public-base-url";
import { ROLE_FAMILY_SLUGS } from "../role-families";
import { GIG_DISCLOSURE_SENTENCE } from "./contract";
import type { ensurePersonasWorkspace, PersonasPlaceFailureReason } from "./personas-places";
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
import type { GigArena, GigSpecialist, GigSpecialistSpec } from "./types";

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
};

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
    connectors: [...GIG_ARENA_CONNECTORS[input.arena]],
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
  const existing = listGigSpecialists(workspaceId).find(
    (s) => s.spec.arena === input.arena && cleanNiche(s.spec.niche).toLowerCase() === niche.toLowerCase()
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
