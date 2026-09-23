// The write doors ask the SEAT, not just the session.
//
// Every route below already ran `requireOperator()` — and every one of them shipped
// with that as its only gate. requireOperator answers "is a trusted, non-demo session
// present?"; in open mode (no KP_OPERATOR_PASSWORD) it answers `true` for everybody,
// and even with a password set it says yes to any signed-in member regardless of
// role. So a VIEWER could seal an adverse decision, move the thresholds that decision
// is judged against, bulk-move a cohort, mint mass candidate tokens, or rewrite the
// relay credentials — none of which a viewer seat is supposed to be able to do.
//
// This file drives the REAL handlers on a throwaway SQLite file with real signed
// sessions and asserts the authorization answer:
//   • viewer  → 403 FORBIDDEN_CAPABILITY, carrying the capability as data
//   • recruiter on an org:manage door → 403 (pipeline:write is not org administration)
//   • no session at all → 401 (requireOperator's answer; unchanged)
//   • an owner is NOT refused (non-vacuity: the gate is a gate, not a wall)
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import type { NextRequest } from "next/server";
import { cleanupUnitDb } from "../_lib/testing/unit-db.ts";

// Point next/server at the shared test shim BEFORE the routes load (hooks only affect
// later resolutions — hence the dynamic imports below).
register(new URL("../_lib/testing/next-server-hooks.mjs", import.meta.url));

// `next/headers` cannot run outside a Next request scope. These tests are ABOUT the
// decision the auth helpers make from the cookie jar, so resolve it to a virtual
// module whose jar this file drives.
const VIRTUAL_HEADERS = "kp-test:next-headers";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpCapTestCookie?: () => string | null }).__kpCapTestCookie = () => cookieValue;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") return { url: VIRTUAL_HEADERS, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === VIRTUAL_HEADERS) {
      return {
        format: "module",
        shortCircuit: true,
        source: `
          export async function cookies() {
            const value = globalThis.__kpCapTestCookie();
            return { get: (name) => (name === ${JSON.stringify(SESSION_COOKIE)} && value ? { name, value } : undefined) };
          }
          export async function headers() { return new Headers(); }
          export async function draftMode() { return { isEnabled: false }; }
        `,
      };
    }
    return nextLoad(url, context);
  },
});

// A signing secret AND an operator password. Without the password every caller folds
// to owner (open dev mode) and there is no authority decision left to prove — which is
// also the honest statement of the acceptance: OPEN MODE IS UNCHANGED by this work.
process.env.KP_SECRET = "write-capability-gate-secret";
process.env.KP_OPERATOR_PASSWORD = "write-capability-gate-password";

const { POST: pipelineCommand } = await import("./pipeline/command/route.ts");
const { POST: pipelineBatch } = await import("./pipeline/batch/route.ts");
const { POST: stageMigration } = await import("./pipeline/stage-migration/route.ts");
const { POST: screenWave } = await import("./decisions/screen-wave/route.ts");
const { POST: decisionConfig } = await import("./decisions/config/route.ts");
const { POST: automationSchedule } = await import("./automation/schedule/route.ts");
const { POST: automationRun } = await import("./automation/run/route.ts");
const { POST: automationTask } = await import("./automation/[task]/route.ts");
const { POST: inviteBulk } = await import("./schedule/invite/bulk/route.ts");
const { POST: inviteSingle } = await import("./schedule/invite/route.ts");
const { POST: schedulePost, PATCH: schedulePatch } = await import("./schedule/route.ts");
const { PUT: prepPut, POST: prepPost, PATCH: prepPatch } = await import("./interview-prep/route.ts");
const { POST: scorecardPost } = await import("./interview-prep/scorecard/route.ts");
const { POST: jdsSave } = await import("./jds/save/route.ts");
const { POST: jobPostingsImport } = await import("./job-postings/route.ts");
const { POST: jdsGenerate } = await import("./jds/generate/route.ts");
const { PATCH: jdPatch } = await import("./jds/[slug]/route.ts");
const { POST: commsRelay } = await import("./comms/relay/route.ts");
const { POST: atsConnections, DELETE: atsConnectionDelete } = await import("./ats/connections/route.ts");
const { POST: atsConfig } = await import("./ats/config/route.ts");
const { POST: edgeConfigSave } = await import("./edge/route.ts");
const { POST: edgeDrain } = await import("./edge/drain/route.ts");
const { POST: edgePair } = await import("./edge/pair/route.ts");
const { POST: llmKeyTest } = await import("./llm/keys/test/route.ts");
const { POST: llmCanary } = await import("./llm/test/route.ts");
const { POST: agentsPair } = await import("./agents/pair/route.ts");
const { DELETE: agentsBridgeDisconnect } = await import("./agents/bridge/route.ts");
const { POST: agentsDispatch } = await import("./agents/dispatch/route.ts");
const { POST: agentsRefresh } = await import("./agents/[id]/refresh/route.ts");
const { POST: commsResend } = await import("./comms/[id]/resend/route.ts");
const { DELETE: interviewRecordingDelete } = await import("./interview/sessions/[id]/recording/route.ts");
const { POST: pipelineEntryPost } = await import("./pipeline/[id]/route.ts");
const { POST: hireOutcomePost, GET: hireOutcomeGet } = await import("./pipeline/outcomes/route.ts");
const { PUT: brandPut } = await import("./brand/route.ts");

const { createWorkspace } = await import("../_lib/db/workspaces.ts");
const { createUser } = await import("../_lib/db/users.ts");
const { upsertMembership } = await import("../_lib/db/memberships.ts");
const { signSession } = await import("../_lib/auth/session.ts");

after(() => cleanupUnitDb());

const ORG = "org-caps";
const team = createWorkspace("Caps team", ORG);
const mk = (slug: string, role: "owner" | "admin" | "recruiter" | "viewer") => {
  const u = createUser({ orgId: ORG, email: `caps.${slug}@caps.test`, name: `Caps ${slug}`, status: "active", password: `caps-pw-${slug}-1` });
  upsertMembership(u.id, team.id, role);
  return u;
};
const owner = mk("owner", "owner");
const recruiter = mk("recruiter", "recruiter");
const viewer = mk("viewer", "viewer");
const admin = mk("admin", "admin");

function signedInAs(user: { id: string; orgId: string } | null): void {
  cookieValue = user === null ? null : signSession(team.id, Date.now(), { sub: user.id, org: user.orgId });
}

const req = (body?: unknown): NextRequest =>
  new Request("http://localhost/api/test", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.1" },
  }) as unknown as NextRequest;

const params = <T,>(p: T) => ({ params: Promise.resolve(p) });

/** One door: the handler, the capability it must require, and a call that reaches it. */
type Door = { name: string; capability: "pipeline:write" | "org:manage"; call: () => Promise<Response> };

const DOORS: Door[] = [
  { name: "POST /api/pipeline/command", capability: "pipeline:write", call: () => pipelineCommand(req({ text: "reject everyone", confirm: true })) },
  { name: "POST /api/pipeline/batch", capability: "pipeline:write", call: () => pipelineBatch(req({ items: [{ id: "x", action: "reject" }] })) },
  { name: "POST /api/pipeline/stage-migration", capability: "pipeline:write", call: () => stageMigration(req({ config: { steps: [] } })) },
  { name: "POST /api/decisions/screen-wave", capability: "pipeline:write", call: () => screenWave(req({ jobId: "job-1" })) },
  { name: "POST /api/decisions/config", capability: "pipeline:write", call: () => decisionConfig(req({ phase: "screening", config: {} })) },
  { name: "POST /api/automation/schedule", capability: "pipeline:write", call: () => automationSchedule(req({ enabled: true })) },
  { name: "POST /api/automation/run", capability: "pipeline:write", call: () => automationRun(req({ dryRun: true })) },
  { name: "POST /api/automation/[task]", capability: "pipeline:write", call: () => automationTask(req({ entryId: "e1" }), params({ task: "screen" })) },
  { name: "POST /api/schedule/invite/bulk", capability: "pipeline:write", call: () => inviteBulk(req({ entryIds: ["e1"] })) },
  // /perfect wave 40 (scheduling-and-interview-prep): the four doors that mirror the
  // bulk row above and were still identity-only. A viewer could mint and mail a
  // scheduling link, cancel or move a booked interview, rewrite the join link, save
  // an interviewer’s checklist/notes onto another seat’s prep pack, merge questions
  // into it, and file the human scorecard whose recommendation OPENS the
  // Interview→Offer gate and seals a decision record. Every one of those is a
  // recruiter act, so every one asks pipeline:write.
  { name: "POST /api/schedule/invite", capability: "pipeline:write", call: () => inviteSingle(req({ entryId: "e1" })) },
  { name: "POST /api/schedule", capability: "pipeline:write", call: () => schedulePost(req({ action: "cancel", token: "t1" })) },
  { name: "PATCH /api/schedule", capability: "pipeline:write", call: () => schedulePatch(req({ token: "t1", meetingUrl: "https://meet.test/x" })) },
  { name: "PUT /api/interview-prep", capability: "pipeline:write", call: () => prepPut(req({ notes: "x" })) },
  { name: "POST /api/interview-prep", capability: "pipeline:write", call: () => prepPost(req({ questions: ["q"] })) },
  { name: "PATCH /api/interview-prep", capability: "pipeline:write", call: () => prepPatch(req({ question: "q", blockRef: null })) },
  { name: "POST /api/interview-prep/scorecard", capability: "pipeline:write", call: () => scorecardPost(req({ ratings: [] })) },
  { name: "POST /api/jds/save", capability: "pipeline:write", call: () => jdsSave(req({ slug: "x", markdown: "# x" })) },
  { name: "POST /api/job-postings", capability: "pipeline:write", call: () => jobPostingsImport(req({ source: "paste", title: "x", text: "y" })) },
  { name: "POST /api/jds/generate", capability: "pipeline:write", call: () => jdsGenerate(req({ role: "Dev" })) },
  { name: "PATCH /api/jds/[slug]", capability: "pipeline:write", call: () => jdPatch(req({ archived: true }), params({ slug: "x" })) },
  { name: "POST /api/comms/relay", capability: "org:manage", call: () => commsRelay(req({ provider: "webhook", webhookUrl: "https://evil.test/hook" })) },
  { name: "POST /api/ats/connections", capability: "org:manage", call: () => atsConnections(req({ provider: "greenhouse", apiKey: "k" })) },
  { name: "DELETE /api/ats/connections", capability: "org:manage", call: () => atsConnectionDelete(req({ provider: "greenhouse" })) },
  { name: "POST /api/ats/config", capability: "org:manage", call: () => atsConfig(req({ config: {} })) },
  // /perfect wave 43 (the-edge-config-door-requires-org-manage): the door its own
  // siblings guard. POST /api/edge decides WHICH remote queue this installation
  // accepts inbound candidate events from and holds the secret that authenticates
  // it, and `url: ""` unpairs and resets the cursor. Drain and pair already ask
  // org:manage; the door that WRITES the pairing asked only for a session.
  { name: "POST /api/edge", capability: "org:manage", call: () => edgeConfigSave(req({ url: "https://edge.attacker.test", secret: "theirs" })) },
  { name: "POST /api/edge/drain", capability: "org:manage", call: () => edgeDrain() },
  { name: "POST /api/edge/pair", capability: "org:manage", call: () => edgePair() },
  { name: "POST /api/llm/keys/test", capability: "org:manage", call: () => llmKeyTest(req({ provider: "openai", scope: "byom" })) },
  // Its sibling on the same panel: /api/llm/keys/test proves a KEY, /api/llm/test
  // proves a PIN, and both do it by spending a real billable completion. Only the
  // first asked a capability.
  { name: "POST /api/llm/test", capability: "org:manage", call: () => llmCanary(req({ useCase: "match_reasoning" })) },
  // scan-sweep (llm-config-and-agent-workforce): the four agent-workforce doors
  // route-capability-coverage.test.ts had carried as "slice 2 candidate - not yet
  // judged" since the ratchet landed. Judged now, and they split along the same
  // line every other door does. `pair` persists the base URL this deployment points
  // at and redeems the pk_ key every dispatch authenticates with, and `bridge`
  // DELETE drops that same key: installation configuration, exactly like the edge
  // pairing door and the comms relay - `org:manage`. `dispatch` commits a monthly
  // USD budget and files a card on the board, and `refresh` can move that card into
  // the terminal column: recruiter acts - `pipeline:write`. A viewer could do all
  // four.
  { name: "POST /api/agents/pair", capability: "org:manage", call: () => agentsPair(req({ phase: "start", baseUrl: "http://127.0.0.1:9999" })) },
  { name: "DELETE /api/agents/bridge", capability: "org:manage", call: () => agentsBridgeDisconnect() },
  { name: "POST /api/agents/dispatch", capability: "pipeline:write", call: () => agentsDispatch(req({ jobId: "job-1" })) },
  { name: "POST /api/agents/[id]/refresh", capability: "pipeline:write", call: () => agentsRefresh(req(), params({ id: "agent-1" })) },
  // Resend is the one outbox door that spends the live relay on demand. Identity
  // (requireOperator) is not authority: a viewer still passed it, and comms_relay_config
  // is a single global row, so a viewer click dispatched a real candidate envelope.
  { name: "POST /api/comms/[id]/resend", capability: "pipeline:write", call: () => commsResend(req(), params({ id: "x" })) },
  // WP4 — the recruiter's deletion of a candidate's interview audio. Irreversible, and
  // the file is the candidate's own voice, so identity is not authority here either: a
  // viewer seat may listen (the playback door is a read) and may not destroy.
  {
    name: "DELETE /api/interview/sessions/[id]/recording",
    capability: "pipeline:write",
    call: () => interviewRecordingDelete(req(), params({ id: "iv-1" })),
  },
  // challenge-r07 pipeline-api/A — the per-card door the bulk doors were written to be
  // in lock-step with, and the hire-rating write. Each action's seat is read from the
  // declared table (app/api/pipeline/[id]/entry-actions.ts), so every action is covered.
  { name: "POST /api/pipeline/[id]", capability: "pipeline:write", call: () => pipelineEntryPost(req({ action: "reject" }), params({ id: "x" })) },
  { name: "POST /api/pipeline/outcomes", capability: "pipeline:write", call: () => hireOutcomePost(req({ entryId: "x", performance: 4 })) },
  // challenge-r07 shell-setup-wizard/A: the brand paints every member's workspace and
  // every candidate-facing page — org settings, owner-only in roles.ts.
  { name: "PUT /api/brand", capability: "org:manage", call: () => brandPut(req({ displayName: "Not yours", accentColor: "#0057B8" })) },
];

// ---- a viewer is refused, with a CODE that names the capability ----------------

for (const door of DOORS) {
  test(`${door.name} refuses a viewer with FORBIDDEN_CAPABILITY (${door.capability})`, async () => {
    signedInAs(viewer);
    const r = await door.call();
    assert.equal(r.status, 403, `${door.name} let a viewer through`);
    const body = (await r.json()) as { code?: string; capability?: string; error?: string };
    assert.equal(body.code, "FORBIDDEN_CAPABILITY", "the client renders errors.<CODE>, never the server's sentence");
    assert.equal(body.capability, door.capability, "the capability rides as DATA so the UI can name what the seat is missing");
  });
}

// ---- a recruiter holds pipeline:write but NOT org administration ---------------

for (const door of DOORS.filter((d) => d.capability === "org:manage")) {
  test(`${door.name} refuses a recruiter — installation config is not a recruiter act`, async () => {
    signedInAs(recruiter);
    const r = await door.call();
    assert.equal(r.status, 403, `${door.name} let a recruiter rewrite installation configuration`);
    assert.equal(((await r.json()) as { capability?: string }).capability, "org:manage");
  });
}

// ---- unauthenticated stays 401 (requireOperator's answer, unchanged) ------------

for (const door of DOORS) {
  test(`${door.name} answers 401 with no session at all`, async () => {
    signedInAs(null);
    const r = await door.call();
    assert.equal(r.status, 401, "a caller with no session has nothing to be told about capabilities");
  });
}

// ---- NON-VACUITY: the gate is a gate, not a wall --------------------------------
//
// Without this the whole file would pass just as happily if every door 403'd
// unconditionally. Two doors — one per capability — are driven by an OWNER and must
// not be refused BY THE CAPABILITY GATE. What they answer instead (400 for a bad
// body, 404 for a missing row, 200) is each route's own business and deliberately not
// asserted here; only "not a capability refusal" is.

test("an owner is not refused by the pipeline:write gate", async () => {
  signedInAs(owner);
  const r = await pipelineBatch(req({ items: [] }));
  assert.notEqual(r.status, 403, "an owner holds pipeline:write");
  assert.notEqual(r.status, 401);
});

test("an owner is not refused by the org:manage gate", async () => {
  signedInAs(owner);
  const r = await atsConfig(req({ config: {} }));
  assert.notEqual(r.status, 403, "an owner holds org:manage");
  assert.notEqual(r.status, 401);
});

// ---- the task doors (challenge-r05 workspace-config-api/A) ------------------------
//
// POST /api/tasks, its retry door and its cancel door asked no seat: a viewer could
// spend a board-wide screen sweep, replay a colleague's run or cancel it. Each door now
// asks the capability the KIND declares (app/_lib/task-admission.ts) — the start door of
// the posted kind, retry and cancel of the STORED row's kind, after the tenant read.
// They are not in DOORS: retry and cancel need a real row in the caller's own team to
// get past the ownership 404 that (correctly) comes first.
const { POST: tasksStart } = await import("./tasks/route.ts");
const { DELETE: taskCancel } = await import("./tasks/[id]/route.ts");
const { POST: taskRetry } = await import("./tasks/[id]/retry/route.ts");
const taskStore = await import("../_lib/db/tasks.ts");

const taskReq = (body?: unknown): NextRequest =>
  new Request("http://localhost/api/tasks", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.9" },
  }) as unknown as NextRequest;

async function assertCapabilityRefusal(r: Response, what: string): Promise<void> {
  assert.equal(r.status, 403, `${what} let a viewer through`);
  const body = (await r.json()) as { code?: string; capability?: string };
  assert.equal(body.code, "FORBIDDEN_CAPABILITY");
  assert.equal(body.capability, "pipeline:write");
}

test("POST /api/tasks refuses a viewer's batch_screen with FORBIDDEN_CAPABILITY (pipeline:write)", async () => {
  signedInAs(viewer);
  await assertCapabilityRefusal(await tasksStart(taskReq({ kind: "batch_screen", params: { entryIds: ["e1"] } })), "POST /api/tasks");
});

test("POST /api/tasks does not refuse an owner, nor anyone in open mode, at the seat", async () => {
  signedInAs(owner);
  const r = await tasksStart(taskReq({ kind: "batch_screen", params: { entryIds: ["e-owner-none"] } }));
  assert.notEqual(r.status, 403, "an owner holds pipeline:write");
  assert.notEqual(r.status, 401);
  const saved = process.env.KP_OPERATOR_PASSWORD;
  delete process.env.KP_OPERATOR_PASSWORD;
  try {
    signedInAs(null);
    const open = await tasksStart(taskReq({ kind: "batch_screen", params: { entryIds: ["e-open-none"] } }));
    assert.notEqual(open.status, 403, "open mode folds to owner — the guided walk keeps its door");
    assert.notEqual(open.status, 401);
  } finally {
    process.env.KP_OPERATOR_PASSWORD = saved;
  }
});

test("POST /api/tasks/[id]/retry refuses a viewer on its own team's failed row", async () => {
  taskStore.createTask("t-cap-retry", "batch_screen", null, "Screen", { entryIds: ["e1"] }, team.id);
  taskStore.finishTask("t-cap-retry", "failed", { error: "boom" });
  signedInAs(viewer);
  await assertCapabilityRefusal(await taskRetry(taskReq(), params({ id: "t-cap-retry" })), "retry");
  // Tenancy still comes first: another team's id is a 404, never a capability answer.
  assert.equal((await taskRetry(taskReq(), params({ id: "t-cap-nowhere" }))).status, 404);
});

test("DELETE /api/tasks/[id] refuses a viewer and leaves the row running", async () => {
  taskStore.createTask("t-cap-cancel", "batch_screen", null, "Screen", { entryIds: ["e1"] }, team.id);
  taskStore.markTaskRunning("t-cap-cancel");
  signedInAs(viewer);
  await assertCapabilityRefusal(await taskCancel(taskReq(), params({ id: "t-cap-cancel" })), "DELETE");
  assert.equal(taskStore.getTask("t-cap-cancel", team.id)?.status, "running", "a refused cancel must not abort");
  // Non-vacuity: an owner's cancel goes through.
  signedInAs(owner);
  const r = await taskCancel(taskReq(), params({ id: "t-cap-cancel" }));
  assert.equal(r.status, 200);
});

test("retry of a SERVER kind is not the dock rule: an owner's analyze replay reaches the inputs check", async () => {
  // Retry replays params a server route authored and stored — it never takes the
  // client's. So a server kind is admitted at the seat and judged on its own merits:
  // this row's workdir is gone, so the answer is the replay refusal, not the dock's.
  taskStore.createTask("t-cap-analyze", "analyze", null, "Analyze", { baseDir: "/nonexistent-kp-cap/jobfit-x", variants: [] }, team.id);
  taskStore.finishTask("t-cap-analyze", "failed", { error: "boom" });
  signedInAs(owner);
  const r = await taskRetry(taskReq(), params({ id: "t-cap-analyze" }));
  assert.equal(r.status, 409);
  assert.equal(((await r.json()) as { code?: string }).code, "TASK_REPLAY_INPUTS_GONE");
});

// ---- the single-entry door and the hire-rating door (challenge-r07 pipeline-api/A) --
//
// The DOORS rows above prove the refusal on a made-up id. These drive a REAL entry in
// the caller's own team, so "refused" also means "nothing happened": the entry keeps
// its status and gains no event, and no rating is recorded.
const pipelineStore = await import("../_lib/db/pipeline.ts");
const { NextRequest: ShimNextRequest } = await import("next/server");

const entryIn = (label: string, stage: string) =>
  pipelineStore.createPipelineEntry({
    candidateId: `caps-${label}`,
    candidateLabel: `Caps ${label}`,
    jobId: `caps-job-${label}`,
    jobTitle: "Caps Role",
    stage,
    workspaceId: team.id,
  }).entry;

test("POST /api/pipeline/[id] refuses a viewer's reject on a real entry and changes nothing; an owner's goes through", async () => {
  const entry = entryIn("reject", "Screened");
  const eventsBefore = pipelineStore.listPipelineEventsForEntry(entry.id, 500, team.id).length;
  signedInAs(viewer);
  await assertCapabilityRefusal(await pipelineEntryPost(req({ action: "reject" }), params({ id: entry.id })), "reject");
  assert.equal(pipelineStore.getPipelineEntry(entry.id, team.id)?.status, "active", "a refused reject must not reject");
  assert.equal(pipelineStore.listPipelineEventsForEntry(entry.id, 500, team.id).length, eventsBefore, "a refused reject writes no event");

  signedInAs(null);
  assert.equal((await pipelineEntryPost(req({ action: "reject" }), params({ id: entry.id }))).status, 401);

  // Non-vacuity: an owner is not refused at the seat.
  signedInAs(owner);
  const r = await pipelineEntryPost(req({ action: "reject" }), params({ id: entry.id }));
  assert.equal(r.status, 200);
  assert.equal(pipelineStore.getPipelineEntry(entry.id, team.id)?.status, "rejected");
});

test("POST /api/pipeline/[id] reads the seat from the declared table: set_notes and reinstate are refused too", async () => {
  const noted = entryIn("notes", "Screened");
  signedInAs(viewer);
  await assertCapabilityRefusal(await pipelineEntryPost(req({ action: "set_notes", notes: "x" }), params({ id: noted.id })), "set_notes");
  assert.equal(pipelineStore.getPipelineEntry(noted.id, team.id)?.notes ?? null, null, "a refused note is not written");

  const rejected = entryIn("reinstate", "Screened");
  pipelineStore.actOnPipelineEntry(rejected.id, "reject", undefined, { actor: "system", actorRef: "auto:screen-wave" }, team.id);
  await assertCapabilityRefusal(await pipelineEntryPost(req({ action: "reinstate" }), params({ id: rejected.id })), "reinstate");
  assert.equal(pipelineStore.getPipelineEntry(rejected.id, team.id)?.status, "rejected", "a refused reinstate reverses nothing");
});

test("POST /api/pipeline/outcomes refuses a viewer and records no rating; the GET stays an operator read", async () => {
  const hire = entryIn("hire", "Hired");
  signedInAs(viewer);
  await assertCapabilityRefusal(await hireOutcomePost(req({ entryId: hire.id, performance: 4 })), "hire rating");
  // A viewer may READ (the Quality page's counter and the drawer's card are reads).
  const read = await hireOutcomeGet(new ShimNextRequest(`http://localhost/api/pipeline/outcomes?entry=${hire.id}`) as unknown as NextRequest);
  assert.equal(read.status, 200, "the outcomes GET is operator-gated, not capability-gated");
  assert.equal(((await read.json()) as { performance?: number | null }).performance, null, "no rating was recorded");
});

// ---- PUT /api/brand refuses an ADMIN, not just a recruiter ------------------------
//
// admin holds members:manage and team:manage but not org:manage, and it was the admin
// the shell kept offering the branding editor to (navCapabilities.ts) — edit, save,
// 403. The DOORS row above covers viewer/recruiter/401; this is the seat the defect
// was actually about, plus the owner that must still get through.
test("PUT /api/brand refuses an admin with FORBIDDEN_CAPABILITY (org:manage); an owner is not refused", async () => {
  signedInAs(admin);
  const r = await brandPut(req({ displayName: "Admin brand", accentColor: "#0057B8" }));
  assert.equal(r.status, 403, "an admin lacks org:manage and must not re-skin the org");
  const body = (await r.json()) as { code?: string; capability?: string };
  assert.equal(body.code, "FORBIDDEN_CAPABILITY");
  assert.equal(body.capability, "org:manage");

  signedInAs(owner);
  const ok = await brandPut(req({ displayName: "Owner brand", accentColor: "#0057B8" }));
  assert.notEqual(ok.status, 403, "an owner holds org:manage");
  assert.notEqual(ok.status, 401);
});
