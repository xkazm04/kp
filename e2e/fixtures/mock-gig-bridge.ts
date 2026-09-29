import { existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
// `import type`, not a value import (the reason is in mock-personas-bridge.ts: a type-stripping
// loader keeps a bare named import as a runtime import).
import type { AddressInfo } from "node:net";

// A stand-in for the Personas management API as kp's GIG lifecycle uses it, so the whole
// gig path - pairing, the milestone, the persona hire, the run, PLAN-STATUS, retirement - can be
// driven end to end WITHOUT Personas installed (e2e/gig-lifecycle.spec.ts). A sibling of
// mock-personas-bridge.ts rather than an extension of it: that mock models the App-master hire
// (pairing by nonce, the three-step approval ladder), this one the gig desk's routes, and
// merging them would widen a file another spec pins its contract to.
//
// Strict like its sibling: every route answers in the shape the real bridge documents and
// REFUSES what the real one refuses (no bearer, an unknown persona or project, a project in
// another workspace, a bad model profile, more than 8 goals per call), so a kp-side contract
// bug fails HERE. Shapes are copied from the Personas side:
//   src-tauri/src/engine/management_api/kp_gig.rs, ship.rs, management_api.rs and
//   docs/architecture/cloud-integration-bridge.md §10.1, §10.9, §10.14.
//
//   POST /api/dev/workspaces                 {name}  -> {id, name, groupTeamId, created}   idempotent by name
//   POST /api/dev/projects                   {name, rootPath, workspaceId?} -> {id, name, rootPath, workspaceId, created}
//                                            idempotent on rootPath; 409 project_in_other_workspace;
//                                            400 root_path_not_found; 403 root_path_outside_allowed_roots
//   POST /api/dev/projects/{pid}/milestones  {name, goal?, description?, goals[<=8]} -> {project, milestone: {id, items}, goals}
//   POST /api/dev/milestones/{mid}/goals     {goals[<=8]} -> {milestoneId, created, bound}
//   GET  /api/dev/milestones/{mid}           -> {project, milestone}
//   POST /api/dev/goals/{gid}                {status?, progress?} -> the goal
//   POST /api/kp/persona-requests            the hire. A request whose top-level `fit.kind` is
//                                            kp.gig-persona.v1 is APPROVED ON ARRIVAL while the
//                                            gig persona policy is enabled (the default here):
//                                            {requestId, status: "approved", autoApproved: true,
//                                             approvedBy: "policy:kp.gig_persona_policy", personaId, message}
//                                            Any other request waits: {requestId, status: "pending_approval"}
//   GET  /api/kp/persona-requests/{id}       an auto-approved one: first poll `approved` (the build
//                                            has not promoted yet), then `active`; a waiting one `pending`
//   POST /api/execute/{personaId}            {input_data} -> {execution_id, status: "queued"}; the
//                                            spec's `runAgent` hook "runs" it (writes the gig folder)
//   GET  /api/executions/{id}                first read `running`, then `completed` with output_data + cost_usd
//   POST /api/kp/personas/{personaId}/retire -> {retired: true, already, personaId, archived, executeGrantsRevoked}
//                                            403 persona_not_hired_by_this_key · 404 persona_not_found
//   GET  /health, GET /api/kp/connector-catalog
//
// Every management response rides Personas' ApiResult envelope ({success, data} /
// {success: false, error, code}). Loopback only, port 0 (a free port per run).

export const GIG_PERSONA_FIT_KIND = "kp.gig-persona.v1";
const MODEL_PROFILE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const GOAL_STATUSES = ["open", "in-progress", "blocked", "done"];
const GOALS_PER_CALL = 8;

export type BridgeCall = {
  method: string;
  path: string;
  authorized: boolean;
  body: Record<string, unknown> | null;
};

export type MockWorkspace = { id: string; name: string };
export type MockProject = { id: string; name: string; rootPath: string; workspaceId: string | null; techStack: string | null };
export type MockGoal = { id: string; milestoneId: string; projectId: string; title: string; description: string | null; status: string; progress: number };
export type MockMilestone = { id: string; projectId: string; name: string; goal: string | null; description: string | null; goalIds: string[] };
export type MockPersonaRequest = {
  requestId: string;
  body: Record<string, unknown>;
  autoApproved: boolean;
  personaId: string | null;
  personaName: string | null;
  polls: number;
  retired: boolean;
};
export type MockExecution = {
  id: string;
  personaId: string;
  input: Record<string, unknown>;
  reads: number;
  output: string | null;
  costUsd: number | null;
};

/** What the spec's agent does with one run: write the gig folder, answer the output. */
export type RunAgent = (input: Record<string, unknown>, personaId: string) => { output: string; costUsd: number };

export type MockGigBridge = {
  url: string;
  apiKey: string;
  calls: BridgeCall[];
  unauthorizedCalls: number;
  unknownPaths: string[];
  workspaces: MockWorkspace[];
  projects: MockProject[];
  milestones: MockMilestone[];
  goals: MockGoal[];
  /** Every goal patch as it arrived, in order. */
  goalPatches: { goalId: string; body: Record<string, unknown> }[];
  requests: MockPersonaRequest[];
  executions: MockExecution[];
  /** Persona ids a retire call reached, in order (repeats included). */
  retireCalls: string[];
  /** The operator's gig persona policy (Settings -> API Keys in the real app). */
  policy: { enabled: boolean };
  /** Folders a project may be registered under (the real app's allowed HTTP project roots). */
  allowedRoots: string[];
  close(): Promise<void>;
};

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

const ok = (res: ServerResponse, data: unknown, status = 200) => json(res, status, { success: true, data });
const refuse = (res: ServerResponse, status: number, code: string, error?: string) => json(res, status, { success: false, error: error ?? code, code });

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return null;
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Strictly inside one of the roots, component-wise (the real app's containment rule). */
function insideRoots(rootPath: string, roots: readonly string[]): boolean {
  const target = path.resolve(rootPath).toLowerCase();
  return roots.some((r) => {
    const root = path.resolve(r).toLowerCase();
    return target !== root && target.startsWith(root + path.sep);
  });
}

export async function startMockGigBridge(opts: { runAgent: RunAgent; allowedRoots: string[] }): Promise<MockGigBridge> {
  const apiKey = `pk_mockgig_${Math.random().toString(36).slice(2, 10)}`;
  let seq = 0;
  const id = (prefix: string) => `${prefix}-${++seq}`;

  const state: MockGigBridge = {
    url: "",
    apiKey,
    calls: [],
    unauthorizedCalls: 0,
    unknownPaths: [],
    workspaces: [],
    projects: [],
    milestones: [],
    goals: [],
    goalPatches: [],
    requests: [],
    executions: [],
    retireCalls: [],
    policy: { enabled: true },
    allowedRoots: opts.allowedRoots,
    close: async () => undefined,
  };

  const milestoneView = (m: MockMilestone) => ({
    id: m.id,
    name: m.name,
    goal: m.goal,
    description: m.description,
    items: m.goalIds.map((gid) => {
      const g = state.goals.find((x) => x.id === gid)!;
      return { itemKind: "goal", itemId: g.id, name: g.title };
    }),
  });

  /** Goals are idempotent BY TITLE within a project (how Personas dedupes them). */
  function bindGoals(m: MockMilestone, rows: unknown[]): { created: number; bound: number } {
    let created = 0;
    let bound = 0;
    for (const raw of rows) {
      const row = obj(raw);
      const title = str(row?.title);
      if (!title) continue;
      let goal = state.goals.find((g) => g.projectId === m.projectId && g.title === title);
      if (!goal) {
        goal = { id: id("goal"), milestoneId: m.id, projectId: m.projectId, title, description: str(row?.description), status: "open", progress: 0 };
        state.goals.push(goal);
        created += 1;
      }
      if (!m.goalIds.includes(goal.id)) {
        m.goalIds.push(goal.id);
        bound += 1;
      }
    }
    return { created, bound };
  }

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const p = url.pathname;
      const method = (req.method ?? "GET").toUpperCase();
      const authorized = (req.headers.authorization ?? "") === `Bearer ${apiKey}`;
      const body = method === "POST" ? await readJson(req) : null;
      state.calls.push({ method, path: p, authorized, body });

      if (method === "GET" && p === "/health") return json(res, 200, { status: "ok", management: true });
      if (!authorized) {
        state.unauthorizedCalls += 1;
        return refuse(res, 401, "unauthorized", "missing or invalid bearer token");
      }

      if (method === "GET" && p === "/api/kp/connector-catalog") return ok(res, { connectors: [] });

      // ---- workspaces + projects (§10.9) --------------------------------------------------
      if (method === "POST" && p === "/api/dev/workspaces") {
        const name = str(body?.name);
        if (!name || name.length > 80) return refuse(res, 400, "invalid_name");
        const existing = state.workspaces.find((w) => w.name.toLowerCase() === name.toLowerCase());
        if (existing) return ok(res, { ...existing, groupTeamId: `team-${existing.id}`, created: false });
        const w = { id: id("ws"), name };
        state.workspaces.push(w);
        return ok(res, { ...w, groupTeamId: `team-${w.id}`, created: true });
      }

      if (method === "POST" && p === "/api/dev/projects") {
        const name = str(body?.name);
        const rootPath = str(body?.rootPath);
        const workspaceId = str(body?.workspaceId);
        if (!name) return refuse(res, 400, "invalid_name");
        if (!rootPath || !path.isAbsolute(rootPath) || rootPath.split(/[\\/]/).includes("..")) return refuse(res, 400, "invalid_root_path");
        if (!existsSync(rootPath)) return refuse(res, 400, "root_path_not_found");
        if (!statSync(rootPath).isDirectory()) return refuse(res, 400, "root_path_not_a_directory");
        if (!insideRoots(rootPath, state.allowedRoots)) return refuse(res, 403, "root_path_outside_allowed_roots");
        if (workspaceId && !state.workspaces.some((w) => w.id === workspaceId)) return refuse(res, 404, "workspace_not_found");
        const existing = state.projects.find((x) => path.resolve(x.rootPath).toLowerCase() === path.resolve(rootPath).toLowerCase());
        if (existing) {
          if (workspaceId && existing.workspaceId && existing.workspaceId !== workspaceId) return refuse(res, 409, "project_in_other_workspace");
          if (!existing.workspaceId && workspaceId) existing.workspaceId = workspaceId;
          return ok(res, { ...existing, created: false });
        }
        const project: MockProject = { id: id("proj"), name, rootPath, workspaceId, techStack: str(body?.techStack) };
        state.projects.push(project);
        return ok(res, { ...project, created: true });
      }

      // ---- the milestone and its goals (ship.rs) -------------------------------------------
      const msCreate = /^\/api\/dev\/projects\/([^/]+)\/milestones$/.exec(p);
      if (method === "POST" && msCreate) {
        const project = state.projects.find((x) => x.id === decodeURIComponent(msCreate[1]));
        if (!project) return refuse(res, 404, "project_not_found");
        const name = str(body?.name);
        const rows = Array.isArray(body?.goals) ? (body!.goals as unknown[]) : [];
        if (!name) return refuse(res, 400, "invalid_name");
        if (rows.length > GOALS_PER_CALL) return refuse(res, 400, "too_many_goals");
        const m: MockMilestone = { id: id("ms"), projectId: project.id, name, goal: str(body?.goal), description: str(body?.description), goalIds: [] };
        state.milestones.push(m);
        bindGoals(m, rows);
        return ok(res, { project: { id: project.id, name: project.name }, milestone: milestoneView(m), goals: m.goalIds.map((g) => state.goals.find((x) => x.id === g)) });
      }

      const msGoals = /^\/api\/dev\/milestones\/([^/]+)\/goals$/.exec(p);
      if (method === "POST" && msGoals) {
        const m = state.milestones.find((x) => x.id === decodeURIComponent(msGoals[1]));
        if (!m) return refuse(res, 404, "milestone_not_found");
        const rows = Array.isArray(body?.goals) ? (body!.goals as unknown[]) : [];
        if (rows.length > GOALS_PER_CALL) return refuse(res, 400, "too_many_goals");
        return ok(res, { milestoneId: m.id, ...bindGoals(m, rows) });
      }

      const msGet = /^\/api\/dev\/milestones\/([^/]+)$/.exec(p);
      if (method === "GET" && msGet) {
        const m = state.milestones.find((x) => x.id === decodeURIComponent(msGet[1]));
        if (!m) return refuse(res, 404, "milestone_not_found");
        return ok(res, { project: { id: m.projectId }, milestone: milestoneView(m) });
      }

      const goalPatch = /^\/api\/dev\/goals\/([^/]+)$/.exec(p);
      if (method === "POST" && goalPatch) {
        const goal = state.goals.find((g) => g.id === decodeURIComponent(goalPatch[1]));
        if (!goal) return refuse(res, 404, "goal_not_found");
        const status = body?.status;
        const progress = body?.progress;
        if (status !== undefined && (typeof status !== "string" || !GOAL_STATUSES.includes(status))) return refuse(res, 400, "invalid_status");
        if (progress !== undefined && (typeof progress !== "number" || progress < 0 || progress > 100)) return refuse(res, 400, "invalid_progress");
        state.goalPatches.push({ goalId: goal.id, body: body ?? {} });
        if (typeof status === "string") goal.status = status;
        if (typeof progress === "number") goal.progress = progress;
        return ok(res, goal);
      }

      // ---- the hire (§10.1, §10.14) ---------------------------------------------------------
      if (method === "POST" && p === "/api/kp/persona-requests") {
        if (!body) return refuse(res, 400, "invalid_body");
        const spec = obj(body.spec);
        const kp = obj(body.kp);
        if (!spec || !str(spec.name)) return refuse(res, 400, "invalid_spec");
        if (!kp || !str(kp.jobId)) return refuse(res, 400, "invalid_kp_link");
        const profile = spec.modelProfile;
        if (profile !== undefined && profile !== null) {
          const pr = obj(profile);
          const model = pr ? pr.model : undefined;
          const effort = pr ? pr.effort : undefined;
          if (typeof model !== "string" || !model.trim() || model.length > 100 || /\s/.test(model)) return refuse(res, 400, "invalid_model_profile");
          if (effort !== undefined && effort !== null && (typeof effort !== "string" || !MODEL_PROFILE_EFFORTS.includes(effort))) return refuse(res, 400, "invalid_model_profile");
        }
        const placement = obj(body.placement);
        const projectId = placement ? placement.projectId : undefined;
        if (projectId !== undefined) {
          const project = typeof projectId === "string" ? state.projects.find((x) => x.id === projectId) : undefined;
          if (!project) return refuse(res, 404, "project_not_found");
          const wsId = str(placement?.workspaceId);
          if (wsId && project.workspaceId !== wsId) return refuse(res, 403, "project_outside_persona_workspace");
        }
        const requestId = id("req");
        const gigPersona = obj(body.fit)?.kind === GIG_PERSONA_FIT_KIND;
        const autoApproved = gigPersona && state.policy.enabled;
        const personaId = autoApproved ? id("persona") : null;
        state.requests.push({ requestId, body, autoApproved, personaId, personaName: autoApproved ? String(spec.name) : null, polls: 0, retired: false });
        if (autoApproved) {
          return ok(res, {
            requestId,
            status: "approved",
            autoApproved: true,
            approvedBy: "policy:kp.gig_persona_policy",
            personaId,
            message: "Approved by the gig persona policy.",
          });
        }
        return ok(res, { requestId, status: "pending_approval" });
      }

      const reqGet = /^\/api\/kp\/persona-requests\/([^/]+)$/.exec(p);
      if (method === "GET" && reqGet) {
        const r = state.requests.find((x) => x.requestId === decodeURIComponent(reqGet[1]));
        if (!r) return refuse(res, 404, "request_not_found");
        r.polls += 1;
        if (!r.autoApproved) return ok(res, { status: "pending", personaId: null, personaName: null });
        // The status GET reports `approved` until the build promotes, then `active` (§10.14).
        return ok(res, { status: r.polls === 1 ? "approved" : "active", personaId: r.personaId, personaName: r.personaName, buildPhase: r.polls === 1 ? "building" : "promoted" });
      }

      // ---- runs (management_api.rs execute_persona / get_execution) --------------------------
      const exec = /^\/api\/execute\/([^/]+)$/.exec(p);
      if (method === "POST" && exec) {
        const personaId = decodeURIComponent(exec[1]);
        const hire = state.requests.find((x) => x.personaId === personaId);
        if (!hire || hire.retired) return refuse(res, 404, "persona_not_found");
        const input = obj(body?.input_data);
        if (!input) return refuse(res, 400, "invalid_input_data");
        const projectId = input._projectId;
        if (projectId !== undefined) {
          if (typeof projectId !== "string" || !projectId) return refuse(res, 400, "invalid_project_id");
          const project = state.projects.find((x) => x.id === projectId);
          if (!project) return refuse(res, 404, "project_not_found");
          const home = obj(hire.body.placement);
          if (home?.workspaceId && project.workspaceId !== home.workspaceId) return refuse(res, 403, "project_outside_persona_workspace");
        }
        const run = opts.runAgent(input, personaId);
        const e: MockExecution = { id: id("exec"), personaId, input, reads: 0, output: run.output, costUsd: run.costUsd };
        state.executions.push(e);
        return ok(res, { execution_id: e.id, status: "queued" });
      }

      const execGet = /^\/api\/executions\/([^/]+)$/.exec(p);
      if (method === "GET" && execGet) {
        const e = state.executions.find((x) => x.id === decodeURIComponent(execGet[1]));
        if (!e) return refuse(res, 404, "execution_not_found");
        e.reads += 1;
        if (e.reads === 1) return ok(res, { id: e.id, persona_id: e.personaId, status: "running", output_data: null, cost_usd: null, error_message: null });
        return ok(res, { id: e.id, persona_id: e.personaId, status: "completed", output_data: e.output, cost_usd: e.costUsd, error_message: null });
      }

      // ---- retirement (§10.14) --------------------------------------------------------------
      const retire = /^\/api\/kp\/personas\/([^/]+)\/retire$/.exec(p);
      if (method === "POST" && retire) {
        const personaId = decodeURIComponent(retire[1]);
        state.retireCalls.push(personaId);
        const hire = state.requests.find((x) => x.personaId === personaId);
        if (!hire) return refuse(res, 404, "persona_not_found");
        const already = hire.retired;
        hire.retired = true;
        return ok(res, { retired: true, already, personaId, archived: true, executeGrantsRevoked: already ? 0 : 1, mandate: null });
      }

      state.unknownPaths.push(`${method} ${p}`);
      return json(res, 404, { error: "no such route on the mock gig bridge" });
    })().catch(() => {
      // Never leave a socket hanging: kp would read a 5 s timeout as "Personas is down" and
      // hide the real cause.
      if (!res.headersSent) json(res, 500, { success: false, error: "mock bridge failed", code: "mock_failed" });
      else res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  state.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  state.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
  return state;
}
