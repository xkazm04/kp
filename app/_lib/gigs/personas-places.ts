import {
  AGENT_BRIDGE_KEY_UNREADABLE,
  BRIDGE_TIMEOUT_MS,
  isRedirectResponse,
  readBridgeJson,
  resolveBridgeOrFail,
} from "../agent-hire/bridge-client";
import { markBridgeOk } from "../agent-hire/bridge-store";

// Where a gig's work lives in Personas: one WORKSPACE per gig type (a gig persona and its
// project, pairing.ts) or per arena (the older niche specialists, project.ts), one PROJECT
// per gig whose root is the gig's own folder on disk
// (gigs/workdir.ts), so a run bound to the project executes in that folder and nowhere else.
//
//   POST {bridge}/api/dev/workspaces {name, description?, color?}
//        -> {success, data: {id, name, groupTeamId, created}}      idempotent by name
//   POST {bridge}/api/dev/projects   {name, rootPath, description?, techStack?, workspaceId?}
//        -> {success, data: {id, name, rootPath, workspaceId, created}}   idempotent on rootPath
//        404 workspace_not_found · 409 project_in_other_workspace · 400 a bad path
//
// Both need `personas:build`, which kp's paired key holds (PAIRING_SCOPES). Both routes are
// NEWER than the Personas builds already paired in the field, so a 404/405 on the route
// itself is `personas_route_missing` - a named degrade the callers act on (hire without a
// placement, dispatch without a project), never an outage.
//
// Same transport rules as personas-exec.ts, reused from bridge-client.ts: the paired base
// URL and pk_ key, the 5 s deadline, the bounded body read, redirects never followed.
// Every failure is a REASON CODE; nothing here throws.

export type PersonasPlaceFailureReason =
  | "personas_unpaired"
  | "personas_key_unreadable"
  | "personas_key_invalid"
  | "personas_scope_missing"
  | "personas_route_missing"
  | "personas_workspace_not_found"
  | "personas_project_conflict"
  | "personas_bad_path"
  | "personas_redirect"
  | "personas_unreachable"
  | "personas_response_too_large"
  | "personas_bad_response"
  | "personas_persona_missing"
  | "personas_not_ours"
  | `personas_http_${number}`;

export type PersonasPlaceFailure = { ok: false; reason: PersonasPlaceFailureReason; status?: number };

export type PersonasWorkspace = { id: string; name: string; groupTeamId: string | null; created: boolean };
export type PersonasProject = { id: string; name: string; rootPath: string; workspaceId: string | null; created: boolean };

export type EnsurePersonasWorkspaceResult = ({ ok: true } & PersonasWorkspace) | PersonasPlaceFailure;
export type EnsurePersonasProjectResult = ({ ok: true } & PersonasProject) | PersonasPlaceFailure;

export type PersonasPlaceOptions = {
  /** Test seam: the fetch to dial with (default: the global fetch). */
  fetchImpl?: typeof fetch;
};

type Bridge = { baseUrl: string; apiKey: string };

function bridgeOrReason(): { ok: true; bridge: Bridge } | PersonasPlaceFailure {
  const resolved = resolveBridgeOrFail();
  if (!resolved.ok) {
    return { ok: false, reason: resolved.failure.code === AGENT_BRIDGE_KEY_UNREADABLE ? "personas_key_unreadable" : "personas_unpaired" };
  }
  if (!resolved.bridge.apiKey) return { ok: false, reason: "personas_unpaired" };
  return { ok: true, bridge: { baseUrl: resolved.bridge.baseUrl, apiKey: resolved.bridge.apiKey } };
}

/** Every string an error body carries (`error`, `code`, `error.code`, `data.code`), lower-cased
 *  and joined - what a 404/409 is told apart by. Personas' envelope puts the machine word in
 *  `error`; a flatter body may put it in `code`. */
function errorText(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const b = body as Record<string, unknown>;
  const parts: unknown[] = [b.error, b.code, b.message, b.reason];
  if (b.error && typeof b.error === "object") parts.push((b.error as Record<string, unknown>).code, (b.error as Record<string, unknown>).message);
  if (b.data && typeof b.data === "object") parts.push((b.data as Record<string, unknown>).code, (b.data as Record<string, unknown>).error);
  return parts.filter((p): p is string => typeof p === "string").join(" ").toLowerCase();
}

function envelopeData(body: unknown): Record<string, unknown> | null {
  if (body && typeof body === "object" && "success" in body) {
    const env = body as { success?: unknown; data?: unknown };
    return env.success === true && env.data && typeof env.data === "object" ? (env.data as Record<string, unknown>) : null;
  }
  return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

type Posted = { ok: true; status: number; data: Record<string, unknown> | null } | { ok: false; status: number; text: string } | PersonasPlaceFailure;

async function post(path: string, body: Record<string, unknown>, opts: PersonasPlaceOptions): Promise<Posted> {
  return call("POST", path, body, opts);
}

async function call(method: "GET" | "POST", path: string, body: Record<string, unknown> | null, opts: PersonasPlaceOptions): Promise<Posted> {
  const b = bridgeOrReason();
  if (!b.ok) return b;
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const r = await doFetch(`${b.bridge.baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${b.bridge.apiKey}` },
      ...(body !== null ? { body: JSON.stringify(body) } : {}),
      redirect: "manual",
      signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
    });
    if (isRedirectResponse(r)) return { ok: false, reason: "personas_redirect" };
    const read = await readBridgeJson<unknown>(r);
    if (!read.ok) return { ok: false, reason: "personas_response_too_large" };
    if (!r.ok) return { ok: false, status: r.status, text: errorText(read.value) };
    return { ok: true, status: r.status, data: envelopeData(read.value) };
  } catch {
    // Timeout, refused connection: Personas is not answering. The undici message is not
    // the operator's to read; the code says what happened.
    return { ok: false, reason: "personas_unreachable" };
  }
}

/** The shared HTTP-status map; the route-specific words (workspace_not_found,
 *  project_in_other_workspace) are checked by the caller first. */
function statusReason(status: number): PersonasPlaceFailureReason {
  if (status === 401) return "personas_key_invalid";
  if (status === 403) return "personas_scope_missing";
  if (status === 404 || status === 405) return "personas_route_missing";
  return `personas_http_${status}`;
}

/** Ensure the Personas workspace named `name` exists (idempotent by name on the Personas
 *  side: a second call answers the same id with `created: false`). Never throws. */
export async function ensurePersonasWorkspace(
  input: { name: string; description?: string; color?: string },
  opts: PersonasPlaceOptions = {}
): Promise<EnsurePersonasWorkspaceResult> {
  const res = await post(
    "/api/dev/workspaces",
    {
      name: input.name,
      ...(input.description ? { description: input.description } : {}),
      ...(input.color ? { color: input.color } : {}),
    },
    opts
  );
  if ("reason" in res) return res;
  if (!res.ok) return { ok: false, reason: statusReason(res.status), status: res.status };
  const id = str(res.data?.id);
  if (!id) return { ok: false, reason: "personas_bad_response" };
  markBridgeOk();
  return {
    ok: true,
    id,
    name: str(res.data?.name) ?? input.name,
    groupTeamId: str(res.data?.groupTeamId),
    created: res.data?.created === true,
  };
}

/** Ensure the Personas project rooted at `rootPath` exists in `workspaceId` (idempotent on
 *  rootPath). A project already registered for that root in ANOTHER workspace is 409
 *  `personas_project_conflict` - never silently moved. Never throws. */
export async function ensurePersonasProject(
  input: { name: string; rootPath: string; workspaceId: string | null; description?: string; techStack?: string | null },
  opts: PersonasPlaceOptions = {}
): Promise<EnsurePersonasProjectResult> {
  const res = await post(
    "/api/dev/projects",
    {
      name: input.name,
      rootPath: input.rootPath,
      ...(input.description ? { description: input.description } : {}),
      ...(input.techStack ? { techStack: input.techStack } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    },
    opts
  );
  if ("reason" in res) return res;
  if (!res.ok) {
    // A 404 that NAMES the workspace is the workspace, not the route (the route answered).
    if (res.status === 404 && res.text.includes("workspace_not_found")) {
      return { ok: false, reason: "personas_workspace_not_found", status: 404 };
    }
    if (res.status === 409) return { ok: false, reason: "personas_project_conflict", status: 409 };
    if (res.status === 400) return { ok: false, reason: "personas_bad_path", status: 400 };
    return { ok: false, reason: statusReason(res.status), status: res.status };
  }
  const id = str(res.data?.id);
  if (!id) return { ok: false, reason: "personas_bad_response" };
  markBridgeOk();
  return {
    ok: true,
    id,
    name: str(res.data?.name) ?? input.name,
    rootPath: str(res.data?.rootPath) ?? input.rootPath,
    workspaceId: str(res.data?.workspaceId) ?? input.workspaceId,
    created: res.data?.created === true,
  };
}

// ---------------------------------------------------------------------------
// The gig's milestone (its accepted plan, one goal per step) and the persona's retirement
// (gig-mastery S2: gigs/pairing.ts creates the milestone, gigs/plan-status.ts patches its
// goals, gigs/sync.ts retires the persona):
//
//   POST {bridge}/api/dev/projects/{pid}/milestones {name, goal?, description?, goals:[{title, description?}]}
//        -> {success, data: {project, milestone: {id, ..., items:[{itemKind, itemId, name}]}, goals}}
//        goals are idempotent by title within the project; at most 8 per call
//   POST {bridge}/api/dev/milestones/{mid}/goals {goals:[...]}   -> {milestoneId, created, bound}
//   GET  {bridge}/api/dev/milestones/{mid}                      -> {project, milestone}
//   POST {bridge}/api/dev/goals/{gid} {status?, progress?}      -> the goal
//   POST {bridge}/api/kp/personas/{personaId}/retire            -> {retired: true[, already: true]}
//        403 not kp's persona, 404 unknown persona
// Source: personas src-tauri/src/engine/management_api/ship.rs (the dev routes) and the
// gig-mastery WP3 contract (retire). Same transport and reason codes as above.
// ---------------------------------------------------------------------------

/** Personas' per-call goal cap (ship.rs validate_ship_goals, SHIP_MILESTONE_MAX_ROWS). */
export const PERSONAS_MILESTONE_GOALS_PER_CALL = 8;
/** Personas' bounds (approval_exec_ship.rs): a milestone name or goal title 300 characters,
 *  the milestone's short goal title 72, a milestone or goal description 1200. */
export const PERSONAS_NAME_MAX = 300;
export const PERSONAS_MILESTONE_GOAL_MAX = 72;
export const PERSONAS_DESCRIPTION_MAX = 1200;

export type PersonasMilestoneGoal = { id: string; title: string };
export type PersonasMilestone = { milestoneId: string; goals: PersonasMilestoneGoal[] };
export type PersonasMilestoneResult = ({ ok: true } & PersonasMilestone) | PersonasPlaceFailure;
export type PersonasOkResult = { ok: true } | PersonasPlaceFailure;

/** The goal members of a milestone view (`milestone.items[]` whose itemKind is "goal"). */
function milestoneFrom(data: Record<string, unknown> | null): PersonasMilestone | null {
  const m = data?.milestone && typeof data.milestone === "object" ? (data.milestone as Record<string, unknown>) : null;
  const milestoneId = str(m?.id);
  if (!m || !milestoneId) return null;
  const goals: PersonasMilestoneGoal[] = [];
  for (const it of Array.isArray(m.items) ? m.items : []) {
    const item = it && typeof it === "object" ? (it as Record<string, unknown>) : null;
    const id = str(item?.itemId);
    if (item?.itemKind === "goal" && id) goals.push({ id, title: str(item.name) ?? "" });
  }
  return { milestoneId, goals };
}

/** A 404 whose body names something (a JSON error) is the project or milestone; an empty
 *  404 is a Personas build without the route. */
function shipFailure(res: { status: number; text: string }): PersonasPlaceFailure {
  if (res.status === 404 && res.text) return { ok: false, reason: "personas_workspace_not_found", status: 404 };
  return { ok: false, reason: statusReason(res.status), status: res.status };
}

function goalRows(goals: readonly { title: string; description?: string }[]): Record<string, string>[] {
  return goals.slice(0, PERSONAS_MILESTONE_GOALS_PER_CALL).map((g) => ({ title: g.title, ...(g.description ? { description: g.description } : {}) }));
}

/** Create a milestone in a project with its first goals (<= 8). NOT idempotent by milestone
 *  on the Personas side: the caller creates it once and records the id it answers. */
export async function createPersonasMilestone(
  projectId: string,
  input: { name: string; goal?: string; description?: string; goals: readonly { title: string; description?: string }[] },
  opts: PersonasPlaceOptions = {}
): Promise<PersonasMilestoneResult> {
  const res = await post(
    `/api/dev/projects/${encodeURIComponent(projectId)}/milestones`,
    {
      name: input.name,
      ...(input.goal ? { goal: input.goal } : {}),
      ...(input.description ? { description: input.description } : {}),
      goals: goalRows(input.goals),
    },
    opts
  );
  if ("reason" in res) return res;
  if (!res.ok) return shipFailure(res);
  const m = milestoneFrom(res.data);
  if (!m) return { ok: false, reason: "personas_bad_response" };
  markBridgeOk();
  return { ok: true, ...m };
}

/** Add goals to an existing milestone (<= 8 per call; idempotent by title). */
export async function addPersonasMilestoneGoals(
  milestoneId: string,
  goals: readonly { title: string; description?: string }[],
  opts: PersonasPlaceOptions = {}
): Promise<PersonasOkResult> {
  const res = await post(`/api/dev/milestones/${encodeURIComponent(milestoneId)}/goals`, { goals: goalRows(goals) }, opts);
  if ("reason" in res) return res;
  if (!res.ok) return shipFailure(res);
  markBridgeOk();
  return { ok: true };
}

/** Read a milestone's goal members back (their ids, by title). */
export async function getPersonasMilestone(milestoneId: string, opts: PersonasPlaceOptions = {}): Promise<PersonasMilestoneResult> {
  const res = await call("GET", `/api/dev/milestones/${encodeURIComponent(milestoneId)}`, null, opts);
  if ("reason" in res) return res;
  if (!res.ok) return shipFailure(res);
  const m = milestoneFrom(res.data);
  if (!m) return { ok: false, reason: "personas_bad_response" };
  markBridgeOk();
  return { ok: true, ...m };
}

/** Patch one goal's status and progress (progress clamped to 0..100). */
export async function patchPersonasGoal(
  goalId: string,
  patch: { status?: string; progress?: number },
  opts: PersonasPlaceOptions = {}
): Promise<PersonasOkResult> {
  const res = await post(
    `/api/dev/goals/${encodeURIComponent(goalId)}`,
    {
      ...(patch.status ? { status: patch.status } : {}),
      ...(typeof patch.progress === "number" && Number.isFinite(patch.progress) ? { progress: Math.max(0, Math.min(100, Math.round(patch.progress))) } : {}),
    },
    opts
  );
  if ("reason" in res) return res;
  if (!res.ok) return shipFailure(res);
  markBridgeOk();
  return { ok: true };
}

export type RetirePersonaResult = { ok: true; already: boolean } | PersonasPlaceFailure;

/** Retire a persona kp hired. 403 = not kp's (`personas_not_ours`); a 404 that names the
 *  persona (a JSON error body) = `personas_persona_missing` (gone - nothing left to retire);
 *  an empty 404 or a 405 = a Personas build without the route (`personas_route_missing`). */
export async function retirePersonasPersona(personaId: string, opts: PersonasPlaceOptions = {}): Promise<RetirePersonaResult> {
  const res = await post(`/api/kp/personas/${encodeURIComponent(personaId)}/retire`, {}, opts);
  if ("reason" in res) return res;
  if (!res.ok) {
    if (res.status === 403) return { ok: false, reason: "personas_not_ours", status: 403 };
    if (res.status === 404 && res.text) return { ok: false, reason: "personas_persona_missing", status: 404 };
    return { ok: false, reason: statusReason(res.status), status: res.status };
  }
  if (res.data?.retired !== true) return { ok: false, reason: "personas_bad_response" };
  markBridgeOk();
  return { ok: true, already: res.data?.already === true };
}
