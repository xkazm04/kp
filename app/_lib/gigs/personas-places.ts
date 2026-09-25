import {
  AGENT_BRIDGE_KEY_UNREADABLE,
  BRIDGE_TIMEOUT_MS,
  isRedirectResponse,
  readBridgeJson,
  resolveBridgeOrFail,
} from "../agent-hire/bridge-client";
import { markBridgeOk } from "../agent-hire/bridge-store";

// Where a gig's work lives in Personas: one WORKSPACE per arena (the specialists are filed
// into it) and one PROJECT per gig whose root is the gig's own folder on disk
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
  const b = bridgeOrReason();
  if (!b.ok) return b;
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const r = await doFetch(`${b.bridge.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${b.bridge.apiKey}` },
      body: JSON.stringify(body),
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
