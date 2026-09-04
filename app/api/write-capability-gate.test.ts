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
const { POST: jdsGenerate } = await import("./jds/generate/route.ts");
const { PATCH: jdPatch } = await import("./jds/[slug]/route.ts");
const { POST: commsRelay } = await import("./comms/relay/route.ts");
const { POST: atsConnections, DELETE: atsConnectionDelete } = await import("./ats/connections/route.ts");
const { POST: atsConfig } = await import("./ats/config/route.ts");
const { POST: edgeDrain } = await import("./edge/drain/route.ts");
const { POST: edgePair } = await import("./edge/pair/route.ts");
const { POST: llmKeyTest } = await import("./llm/keys/test/route.ts");

const { createWorkspace } = await import("../_lib/db/workspaces.ts");
const { createUser } = await import("../_lib/db/users.ts");
const { upsertMembership } = await import("../_lib/db/memberships.ts");
const { signSession } = await import("../_lib/auth/session.ts");

after(() => cleanupUnitDb());

const ORG = "org-caps";
const team = createWorkspace("Caps team", ORG);
const mk = (slug: string, role: "owner" | "recruiter" | "viewer") => {
  const u = createUser({ orgId: ORG, email: `caps.${slug}@caps.test`, name: `Caps ${slug}`, status: "active", password: `caps-pw-${slug}-1` });
  upsertMembership(u.id, team.id, role);
  return u;
};
const owner = mk("owner", "owner");
const recruiter = mk("recruiter", "recruiter");
const viewer = mk("viewer", "viewer");

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
  { name: "POST /api/jds/generate", capability: "pipeline:write", call: () => jdsGenerate(req({ role: "Dev" })) },
  { name: "PATCH /api/jds/[slug]", capability: "pipeline:write", call: () => jdPatch(req({ archived: true }), params({ slug: "x" })) },
  { name: "POST /api/comms/relay", capability: "org:manage", call: () => commsRelay(req({ provider: "webhook", webhookUrl: "https://evil.test/hook" })) },
  { name: "POST /api/ats/connections", capability: "org:manage", call: () => atsConnections(req({ provider: "greenhouse", apiKey: "k" })) },
  { name: "DELETE /api/ats/connections", capability: "org:manage", call: () => atsConnectionDelete(req({ provider: "greenhouse" })) },
  { name: "POST /api/ats/config", capability: "org:manage", call: () => atsConfig(req({ config: {} })) },
  { name: "POST /api/edge/drain", capability: "org:manage", call: () => edgeDrain() },
  { name: "POST /api/edge/pair", capability: "org:manage", call: () => edgePair() },
  { name: "POST /api/llm/keys/test", capability: "org:manage", call: () => llmKeyTest(req({ provider: "openai", scope: "byom" })) },
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
