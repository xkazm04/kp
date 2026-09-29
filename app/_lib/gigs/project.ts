import { getGig, setGigWorkspace } from "../db/gigs";
import {
  ensurePersonasProject,
  ensurePersonasWorkspace,
  type EnsurePersonasProjectResult,
  type EnsurePersonasWorkspaceResult,
  type PersonasPlaceFailureReason,
} from "./personas-places";
import { GIG_TYPE_LABEL, gigTypeOf, type GigType } from "./gig-type";
import type { Gig, GigArena } from "./types";
import { scaffoldGigWorkdir, type ScaffoldGigWorkdirResult } from "./workdir";

// A Personas workspace per gig TYPE (or, for the older niche specialists, per arena), a
// Personas project per gig (docs/features/gigs/README.md "Pairing"):
//   - the type's workspace ("Gigs · Security", gig-type.ts) holds each gig persona and its
//     gig's project (pairing.ts files the persona there through `placement`); the arena's
//     workspace holds the niche specialists hired before one-persona-per-gig (specialist.ts)
//     and the projects of the gigs they worked;
//   - each gig's project is rooted at the gig's own folder (workdir.ts), so a run dispatched
//     with `_projectId` executes IN that folder (dispatch.ts).
// A project already registered in the arena's workspace (a gig prepared before pairing) is
// never moved: placing it by type answers 409 project_in_other_workspace, and the pairing
// then files the persona beside it in the arena's workspace (`placeBy: "type"` below).
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

/** The Personas workspace a gig persona and its gig's project are filed in. */
export function gigTypeWorkspaceName(type: GigType): string {
  return `Gigs · ${GIG_TYPE_LABEL[type]}`;
}

export function gigTypeWorkspaceDescription(type: GigType): string {
  return `${GIG_TYPE_LABEL[type]} gigs: one persona and one project per gig, managed by kp's Gigs module. kp drafts; the operator reviews and sends.`;
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
  | { linked: true; projectId: string; workspaceId: string; created: boolean; placedBy?: "type" | "arena" }
  | { linked: false; reason: PersonasPlaceFailureReason };

export type PrepareGigProjectResult =
  | { ok: true; gig: Gig; workdir: string; created: string[]; personas: GigPersonasLink }
  | { ok: false; code: "GIG_NOT_FOUND" }
  | { ok: false; code: "GIG_WORKSPACE_FAILED"; reason: "workdir_outside_root" | "workdir_io_error" };

/** Ensure the gig type's Personas workspace. Never throws. */
export async function ensureGigTypeWorkspace(
  type: GigType,
  ensure: typeof ensurePersonasWorkspace = ensurePersonasWorkspace
): Promise<EnsurePersonasWorkspaceResult> {
  try {
    return await ensure({ name: gigTypeWorkspaceName(type), description: gigTypeWorkspaceDescription(type) });
  } catch {
    // The default transport never throws; an injected one might. Same outcome either way.
    return { ok: false, reason: "personas_unreachable" };
  }
}

export type PrepareGigProjectOptions = {
  /** Which workspace the project is filed in. `arena` (the default: the workspace door and
   *  the legacy niche dispatch) or `type` (a gig persona's pairing), which falls back to the
   *  arena's workspace when the project already lives there. */
  placeBy?: "arena" | "type";
};

async function linkProject(
  gig: Gig,
  workdir: string,
  d: GigProjectDeps,
  placedBy: "type" | "arena"
): Promise<GigPersonasLink> {
  const ws = placedBy === "type" ? await ensureGigTypeWorkspace(gigTypeOf(gig), d.ensureWorkspace) : await ensureGigArenaWorkspace(gig.arena, d.ensureWorkspace);
  if (!ws.ok) return { linked: false, reason: ws.reason };
  let project: EnsurePersonasProjectResult;
  try {
    project = await d.ensureProject({
      name: gigProjectName(gig),
      rootPath: workdir,
      workspaceId: ws.id,
      description: gig.url || undefined,
      techStack: gig.brief?.category || null,
    });
  } catch {
    // As above: an injected transport that throws reads as an unreachable Personas.
    project = { ok: false, reason: "personas_unreachable" };
  }
  return project.ok
    ? { linked: true, projectId: project.id, workspaceId: ws.id, created: project.created, placedBy }
    : { linked: false, reason: project.reason };
}

/** Scaffold the gig's folder -> ensure the workspace (the arena's, or the type's) -> ensure
 *  the project rooted there -> record both. Idempotent: every step is create-if-absent on its
 *  own side. */
export async function prepareGigProject(
  workspaceId: string,
  gigId: string,
  deps: Partial<GigProjectDeps> = {},
  opts: PrepareGigProjectOptions = {}
): Promise<PrepareGigProjectResult> {
  const d: GigProjectDeps = { ...defaultDeps, ...deps };
  const gig = getGig(workspaceId, gigId);
  if (!gig) return { ok: false, code: "GIG_NOT_FOUND" };

  const folder = d.scaffold(gig);
  if (!folder.ok) return { ok: false, code: "GIG_WORKSPACE_FAILED", reason: folder.reason };

  let personas = await linkProject(gig, folder.workdir, d, opts.placeBy === "type" ? "type" : "arena");
  // A project registered in the arena's workspace before pairing existed stays where it is;
  // the persona is filed beside it instead (Personas binds a run only to a project in the
  // persona's own workspace).
  if (!personas.linked && personas.reason === "personas_project_conflict" && opts.placeBy === "type") {
    personas = await linkProject(gig, folder.workdir, d, "arena");
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
