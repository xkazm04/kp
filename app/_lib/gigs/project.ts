import { getGig, setGigWorkspace } from "../db/gigs";
import {
  ensurePersonasProject,
  ensurePersonasWorkspace,
  type EnsurePersonasProjectResult,
  type EnsurePersonasWorkspaceResult,
  type PersonasPlaceFailureReason,
} from "./personas-places";
import type { Gig, GigArena } from "./types";
import { scaffoldGigWorkdir, type ScaffoldGigWorkdirResult } from "./workdir";

// A Personas workspace per arena, a Personas project per gig (docs/features/gigs/README.md
// "Workspaces and projects"):
//   - the arena's workspace holds the specialists hired for it (specialist.ts files each
//     hire there through `placement`);
//   - each gig's project is rooted at the gig's own folder (workdir.ts), so a run dispatched
//     with `_projectId` executes IN that folder (dispatch.ts).
//
// Degrade, stated once: the FOLDER never depends on Personas. prepareGigProject scaffolds and
// records the workdir first; an unpaired, unreachable or older Personas leaves
// personasProjectId as it was and the result says why (`personas.reason`). Only a folder that
// cannot be made is a failure of the whole step.
//
// No transaction spans any of this: the Personas calls are network, and the one DB write
// (setGigWorkspace) is a single UPDATE after them.

/** The Personas workspace each arena's specialists and projects are filed in. */
export const GIG_ARENA_WORKSPACE_NAME: Readonly<Record<GigArena, string>> = {
  freelance: "Freelance",
  oss_bounty: "OSS bounties",
  competition: "Competitions",
  security: "Security programs",
};

export function gigArenaWorkspaceDescription(arena: GigArena): string {
  return `${GIG_ARENA_WORKSPACE_NAME[arena]}: specialists and one project per gig, managed by kp's Gigs module. kp drafts; the operator reviews and sends.`;
}

const PROJECT_TITLE_MAX = 80;

/** `Gig · <brief title or listing title>`, the title bounded to 80 characters. */
export function gigProjectName(gig: Pick<Gig, "title" | "brief">): string {
  const title = (gig.brief?.title || gig.title).replace(/\s+/g, " ").trim().slice(0, PROJECT_TITLE_MAX).trim();
  return `Gig · ${title || "untitled"}`;
}

export type GigProjectDeps = {
  scaffold: (gig: Gig) => ScaffoldGigWorkdirResult;
  ensureWorkspace: typeof ensurePersonasWorkspace;
  ensureProject: typeof ensurePersonasProject;
};

const defaultDeps: GigProjectDeps = {
  scaffold: (gig) => scaffoldGigWorkdir(gig),
  ensureWorkspace: (input, opts) => ensurePersonasWorkspace(input, opts),
  ensureProject: (input, opts) => ensurePersonasProject(input, opts),
};

/** Ensure the arena's Personas workspace. Never throws. */
export async function ensureGigArenaWorkspace(
  arena: GigArena,
  ensure: typeof ensurePersonasWorkspace = ensurePersonasWorkspace
): Promise<EnsurePersonasWorkspaceResult> {
  try {
    return await ensure({ name: GIG_ARENA_WORKSPACE_NAME[arena], description: gigArenaWorkspaceDescription(arena) });
  } catch {
    // The default transport never throws; an injected one might. Same outcome either way.
    return { ok: false, reason: "personas_unreachable" };
  }
}

export type GigPersonasLink =
  | { linked: true; projectId: string; workspaceId: string; created: boolean }
  | { linked: false; reason: PersonasPlaceFailureReason };

export type PrepareGigProjectResult =
  | { ok: true; gig: Gig; workdir: string; created: string[]; personas: GigPersonasLink }
  | { ok: false; code: "GIG_NOT_FOUND" }
  | { ok: false; code: "GIG_WORKSPACE_FAILED"; reason: "workdir_outside_root" | "workdir_io_error" };

/** Scaffold the gig's folder -> ensure the arena workspace -> ensure the project rooted there
 *  -> record both. Idempotent: every step is create-if-absent on its own side. */
export async function prepareGigProject(
  workspaceId: string,
  gigId: string,
  deps: Partial<GigProjectDeps> = {}
): Promise<PrepareGigProjectResult> {
  const d: GigProjectDeps = { ...defaultDeps, ...deps };
  const gig = getGig(workspaceId, gigId);
  if (!gig) return { ok: false, code: "GIG_NOT_FOUND" };

  const folder = d.scaffold(gig);
  if (!folder.ok) return { ok: false, code: "GIG_WORKSPACE_FAILED", reason: folder.reason };

  let personas: GigPersonasLink;
  const ws = await ensureGigArenaWorkspace(gig.arena, d.ensureWorkspace);
  if (!ws.ok) personas = { linked: false, reason: ws.reason };
  else {
    let project: EnsurePersonasProjectResult;
    try {
      project = await d.ensureProject({
        name: gigProjectName(gig),
        rootPath: folder.workdir,
        workspaceId: ws.id,
        description: gig.url || undefined,
        techStack: gig.brief?.category || null,
      });
    } catch {
      // As above: an injected transport that throws reads as an unreachable Personas.
      project = { ok: false, reason: "personas_unreachable" };
    }
    personas = project.ok
      ? { linked: true, projectId: project.id, workspaceId: ws.id, created: project.created }
      : { linked: false, reason: project.reason };
  }

  const stored = setGigWorkspace(workspaceId, gigId, {
    workdir: folder.workdir,
    // Linked: the id Personas answered. A conflict or a vanished workspace means the stored
    // id (if any) no longer names this folder's project, so it is cleared. Unpaired,
    // unreachable or an older build say nothing about the project - the id is kept.
    ...(personas.linked
      ? { personasProjectId: personas.projectId }
      : personas.reason === "personas_project_conflict" || personas.reason === "personas_workspace_not_found"
        ? { personasProjectId: null }
        : {}),
  });
  if (!stored) return { ok: false, code: "GIG_NOT_FOUND" };
  return { ok: true, gig: stored, workdir: folder.workdir, created: folder.created, personas };
}
