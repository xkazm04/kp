import { getHiredAgent, type AgentStatus } from "../db/agents";
import { getGig, setGigRoute } from "../db/gigs";
import { getAcceptedGigPlan, setGigPlanProgress } from "../db/gigs-plans";
import { getGigSpecialistForGig } from "../db/gigs-specialists";
import { GIG_RUNNABLE_HIRE_STATUSES } from "./match";
import {
  PERSONAS_DESCRIPTION_MAX,
  PERSONAS_MILESTONE_GOALS_PER_CALL,
  PERSONAS_MILESTONE_GOAL_MAX,
  PERSONAS_NAME_MAX,
  addPersonasMilestoneGoals,
  createPersonasMilestone,
  getPersonasMilestone,
} from "./personas-places";
import { initialPlanProgress } from "./plan-status";
import { prepareGigProject, type PrepareGigProjectResult } from "./project";
import { hireGigPersona, type HireGigPersonaInput, type HireGigPersonaResult } from "./specialist";
import { gigTrackOf, type Gig, type GigPlanRow, type GigSpecialist, type GigStatus } from "./types";

// PAIRING (gig-mastery S2, docs/features/gigs/README.md "Pairing"): ONE Personas persona per
// gig, created when the gig is paired and retired when it ends (sync.ts). Knowledge persists
// in the registry (recipes + knowledge bundles), never in a long-lived persona.
//
//   pairGig(workspaceId, gigId):
//     1. the gig must have an operator-ACCEPTED plan (db/gigs-plans.ts) - else
//        GIG_PLAN_NOT_ACCEPTED; a suspect gig or one past the line is refused like dispatch;
//     2. the gig's folder is prepared as always, and its Personas project is filed in the gig
//        TYPE's workspace ("Gigs · Security"; project.ts placeBy "type" - an older project
//        stays in its arena's workspace). Pairing needs the project: without it (unpaired,
//        an older Personas) it refuses GIG_WORKSPACE_FAILED with the reason;
//     3. the accepted plan becomes the project's MILESTONE (name = the gig's title, goal = the
//        plan summary as a short title, description = the summary) with one GOAL per step
//        ("<n>. <title>", description = its done-when), and `{milestoneId, goals}` is recorded
//        on the accepted plan. Created ONCE (Personas does not dedupe milestones); a milestone
//        Personas would not create degrades - the goals are tracked locally as `step-<n>` and
//        the next pairing tries again - it never blocks the hire;
//     4. the gig persona: the gig's own gig_specialists row (gig_id set) is REUSED unless its
//        hire failed, was rejected or was retired; otherwise it is hired (specialist.ts
//        hireGigPersona: Opus 5.5 high, fit kp.gig-persona.v1, placement {workspaceId,
//        projectId}, requirements with the type's knowledge and the plan);
//     5. the gig's `specialist_id` points at its persona (a CAS on the status read).
//   It answers the current state: `ready` when the persona's hire is active (dispatch runs
//   it), `pending` while Personas has not approved it yet (sync.ts runs it once active).
//
// Idempotent: calling it again for a paired gig re-ensures the folder and project (both
// create-if-absent), skips the milestone and the hire, and returns the same state. No
// transaction spans any of it - every Personas call is network, and each DB write is one
// statement after the call it records.

/** The statuses a gig may be paired in: the ones a dispatch may start from. */
export const GIG_PAIRABLE_STATUSES: readonly GigStatus[] = ["qualified", "drafted", "in_review"];

/** Hire statuses after which a gig's persona is not reused (a new one is hired). */
export const GIG_PERSONA_DEAD_HIRE_STATUSES: readonly AgentStatus[] = ["failed", "rejected", "retired"];

export type PairGigDeps = {
  prepareProject: (workspaceId: string, gigId: string) => Promise<PrepareGigProjectResult>;
  createMilestone: typeof createPersonasMilestone;
  addMilestoneGoals: typeof addPersonasMilestoneGoals;
  getMilestone: typeof getPersonasMilestone;
  hirePersona: (workspaceId: string, input: HireGigPersonaInput) => Promise<HireGigPersonaResult>;
  now: () => Date;
};

export const defaultPairGigDeps: PairGigDeps = {
  prepareProject: (workspaceId, gigId) => prepareGigProject(workspaceId, gigId, {}, { placeBy: "type" }),
  createMilestone: (projectId, input, opts) => createPersonasMilestone(projectId, input, opts),
  addMilestoneGoals: (milestoneId, goals, opts) => addPersonasMilestoneGoals(milestoneId, goals, opts),
  getMilestone: (milestoneId, opts) => getPersonasMilestone(milestoneId, opts),
  hirePersona: (workspaceId, input) => hireGigPersona(workspaceId, input),
  now: () => new Date(),
};

export type GigMilestoneOutcome = { ok: true; milestoneId: string; created: boolean } | { ok: false; reason: string };

export type PairGigResult =
  | {
      ok: true;
      /** `ready`: the persona's hire is active and has a persona id - dispatch can run it. */
      state: "ready" | "pending";
      gig: Gig;
      plan: GigPlanRow;
      specialist: GigSpecialist;
      hireStatus: AgentStatus | null;
      personaId: string | null;
      /** True when this call hired the persona (false: an existing one was reused). */
      hired: boolean;
      workdir: string;
      projectId: string;
      /** The Personas workspace the project and the persona are filed in. */
      personasWorkspaceId: string;
      milestone: GigMilestoneOutcome;
    }
  /** `GIG_PROPOSAL_TRACK`: a freelance bid is never paired (kp writes a proposal, not the work). */
  | { ok: false; code: "GIG_NOT_FOUND" | "GIG_PLAN_NOT_ACCEPTED" | "GIG_PROPOSAL_TRACK" }
  | { ok: false; code: "GIG_SUSPECT" | "GIG_NOT_DISPATCHABLE"; detail?: string }
  | { ok: false; code: "GIG_WORKSPACE_FAILED"; detail: string }
  /** The persona hire did not go out: `hireCode` is the hire tail's code (e.g.
   *  AGENT_DISPATCH_BRIDGE_FAILED, AGENT_BRIDGE_KEY_INVALID, TOO_MANY_REQUESTS). */
  | { ok: false; code: "GIG_PAIRING_HIRE_FAILED"; status: number; hireCode: string; hiredAgentId: string | null };

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const atWord = cut.replace(/\s+\S*$/, "");
  return `${(atWord.length >= max / 2 ? atWord : cut).trimEnd()}…`;
}

/** One goal per step: "<n>. <title>" (unique within the gig's project, which is how Personas
 *  dedupes goals), described by its done-when. Pure. */
export function planMilestoneGoals(steps: readonly { title: string; doneWhen: string }[]): { title: string; description?: string }[] {
  return steps.map((st, i) => {
    const done = st.doneWhen.trim();
    return {
      title: clip(`${i + 1}. ${st.title}`, PERSONAS_NAME_MAX),
      ...(done ? { description: clip(`Done when: ${done}`, PERSONAS_DESCRIPTION_MAX) } : {}),
    };
  });
}

/** The milestone body for the accepted plan. Pure. */
export function planMilestoneInput(gig: Pick<Gig, "title" | "brief">, summary: string): { name: string; goal: string; description: string } {
  return {
    name: clip(gig.brief?.title || gig.title, PERSONAS_NAME_MAX) || "Gig",
    goal: clip(summary, PERSONAS_MILESTONE_GOAL_MAX),
    description: clip(summary, PERSONAS_DESCRIPTION_MAX),
  };
}

/** Create the accepted plan's milestone once and record its goal ids on the plan. */
async function ensureMilestone(workspaceId: string, gig: Gig, plan: GigPlanRow, projectId: string, d: PairGigDeps): Promise<GigMilestoneOutcome> {
  if (plan.progress?.milestoneId) return { ok: true, milestoneId: plan.progress.milestoneId, created: false };
  const steps = plan.plan?.steps ?? [];
  const goals = planMilestoneGoals(steps);
  const now = () => d.now().toISOString();
  const record = (milestoneId: string | null, ids: (string | null)[]) =>
    setGigPlanProgress(workspaceId, plan.id, initialPlanProgress(steps.length, milestoneId, ids, plan.progress, now()));

  let created: Awaited<ReturnType<PairGigDeps["createMilestone"]>>;
  try {
    created = await d.createMilestone(projectId, { ...planMilestoneInput(gig, plan.plan?.summary ?? ""), goals: goals.slice(0, PERSONAS_MILESTONE_GOALS_PER_CALL) });
  } catch {
    // The default transport never throws; an injected one might.
    created = { ok: false, reason: "personas_unreachable" };
  }
  if (!created.ok) {
    // Degrade: the goals are tracked locally (step-<n>) until a later pairing creates it.
    if (!plan.progress) record(null, []);
    return { ok: false, reason: created.reason };
  }
  let members = created.goals;
  if (goals.length > PERSONAS_MILESTONE_GOALS_PER_CALL) {
    try {
      const added = await d.addMilestoneGoals(created.milestoneId, goals.slice(PERSONAS_MILESTONE_GOALS_PER_CALL));
      const read = added.ok ? await d.getMilestone(created.milestoneId) : null;
      if (read?.ok) members = read.goals;
    } catch {
      // The steps past the eighth stay local (step-<n>); the milestone itself stands.
    }
  }
  const idByTitle = new Map(members.map((m) => [m.title, m.id]));
  record(created.milestoneId, goals.map((g) => idByTitle.get(g.title) ?? null));
  return { ok: true, milestoneId: created.milestoneId, created: true };
}

/** Pair a gig with its own persona. See the header for the steps and the refusals. */
export async function pairGig(workspaceId: string, gigId: string, deps: Partial<PairGigDeps> = {}): Promise<PairGigResult> {
  const d: PairGigDeps = { ...defaultPairGigDeps, ...deps };
  const gig = getGig(workspaceId, gigId);
  if (!gig) return { ok: false, code: "GIG_NOT_FOUND" };
  if (gigTrackOf(gig.arena) === "proposal") return { ok: false, code: "GIG_PROPOSAL_TRACK" };
  if (gig.status === "suspect" || gig.suspectReasons.length > 0) return { ok: false, code: "GIG_SUSPECT", detail: gig.suspectReasons.join(",") || undefined };
  if (!GIG_PAIRABLE_STATUSES.includes(gig.status)) return { ok: false, code: "GIG_NOT_DISPATCHABLE", detail: gig.status };
  const accepted = getAcceptedGigPlan(workspaceId, gigId);
  if (!accepted?.plan) return { ok: false, code: "GIG_PLAN_NOT_ACCEPTED" };

  let prepared: PrepareGigProjectResult;
  try {
    prepared = await d.prepareProject(workspaceId, gigId);
  } catch {
    // The default never throws (its fs errors are reason codes); an injected one might.
    prepared = { ok: false, code: "GIG_WORKSPACE_FAILED", reason: "workdir_io_error" };
  }
  if (!prepared.ok) return prepared.code === "GIG_NOT_FOUND" ? { ok: false, code: "GIG_NOT_FOUND" } : { ok: false, code: "GIG_WORKSPACE_FAILED", detail: prepared.reason };
  const link = prepared.personas;
  if (!link.linked) return { ok: false, code: "GIG_WORKSPACE_FAILED", detail: link.reason };

  const milestone = await ensureMilestone(workspaceId, prepared.gig, accepted, link.projectId, d);
  const plan = getAcceptedGigPlan(workspaceId, gigId) ?? accepted;

  let specialist = getGigSpecialistForGig(workspaceId, gigId);
  let agent = specialist ? getHiredAgent(specialist.hiredAgentId, workspaceId) : null;
  let hired = false;
  if (!specialist || !agent || GIG_PERSONA_DEAD_HIRE_STATUSES.includes(agent.status)) {
    const hire = await d.hirePersona(workspaceId, {
      gig: prepared.gig,
      plan: { summary: plan.plan?.summary ?? "", steps: plan.plan?.steps ?? [], note: plan.note },
      placement: { workspaceId: link.workspaceId, projectId: link.projectId },
    });
    if (!hire.ok) return { ok: false, code: "GIG_PAIRING_HIRE_FAILED", status: hire.status, hireCode: hire.code, hiredAgentId: hire.hiredAgentId };
    specialist = hire.specialist;
    agent = getHiredAgent(hire.hiredAgentId, workspaceId);
    hired = true;
  }

  // The gig's specialist_id names its persona (the sync's "paired, waiting to run" marker).
  let current = getGig(workspaceId, gigId) ?? prepared.gig;
  if (current.specialistId !== specialist.id) {
    const routed = setGigRoute(workspaceId, gigId, { expectedStatus: current.status, specialistId: specialist.id, niche: current.niche });
    if (routed.ok) current = routed.gig;
  }
  const ready = !!agent && !!agent.personaId && GIG_RUNNABLE_HIRE_STATUSES.includes(agent.status);
  return {
    ok: true,
    state: ready ? "ready" : "pending",
    gig: current,
    plan,
    specialist,
    hireStatus: agent?.status ?? null,
    personaId: agent?.personaId ?? null,
    hired,
    workdir: prepared.workdir,
    projectId: link.projectId,
    personasWorkspaceId: link.workspaceId,
    milestone,
  };
}
