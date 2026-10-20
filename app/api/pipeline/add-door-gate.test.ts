// POST /api/pipeline — the add door's two front-door refusals (pipeline-board rework).
//
//  1. THE SEAT. The door files candidates, reopens rejected entries and seals Match
//     verdicts, and asked no capability: a viewer could do all three. It now asks
//     pipeline:write FIRST, so a refused seat spends no throttle and seals nothing.
//  2. THE TERMINAL STAGE. set_stage refuses the hire stage (PIPELINE_TERMINAL_NOT_MANUAL)
//     because it is reached by an accepted offer; the add door let a request name it
//     and file a "hired" entry with no offer. Resolved by ROLE on the workspace's axis.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";

register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// `cookies()` cannot run outside a Next request scope; drive the session jar by hand.
const VIRTUAL_HEADERS = "kp-test:next-headers-add-door";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpAddDoorCookie?: () => string | null }).__kpAddDoorCookie = () => cookieValue;
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
            const value = globalThis.__kpAddDoorCookie();
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

// A password, so the seat's role decides authority (open dev mode folds everyone to owner).
process.env.KP_SECRET = "add-door-test-secret";
process.env.KP_OPERATOR_PASSWORD = "add-door-test-password";

const { POST } = await import("./route.ts");
const { getPipelineEntry, listPipelineEventsForEntry, createPipelineEntry, actOnPipelineEntry } = await import("../../_lib/db/pipeline.ts");
const { listDecisionRecords } = await import("../../_lib/decision-record-store.ts");
const { recordMatchRun } = await import("../../_lib/db/match-runs.ts");
const { setDecisionConfig } = await import("../../_lib/decision-config-store.ts");
const { createUser } = await import("../../_lib/db/users.ts");
const { upsertMembership } = await import("../../_lib/db/memberships.ts");
const { signSession, DEFAULT_WORKSPACE } = await import("../../_lib/auth/session.ts");

after(() => cleanupUnitDb());

const ORG = "org-default";
const recruiter = createUser({ orgId: ORG, email: "add.rec@csas.cz", name: "Add Rec", status: "active", password: "rec-pw-12345" });
const viewer = createUser({ orgId: ORG, email: "add.view@csas.cz", name: "Add View", status: "active", password: "view-pw-12345" });
upsertMembership(recruiter.id, DEFAULT_WORKSPACE, "recruiter");
upsertMembership(viewer.id, DEFAULT_WORKSPACE, "viewer");
const signedInAs = (u: { id: string; orgId: string }) => {
  cookieValue = signSession(DEFAULT_WORKSPACE, Date.now(), { sub: u.id, org: u.orgId });
};

// A renamed terminal column, so "by role, not by the literal Hired" is a claim about
// more than the shipped five; plus a retired tombstone.
setDecisionConfig(
  "pipelineStages",
  {
    stages: [
      { id: "Accepted", label: "Applied", role: "entry" },
      { id: "Screened", label: "Screened", role: "screening", actions: ["screen"] },
      { id: "Interview", label: "Interview", role: "interview" },
      { id: "Offer", label: "Offer", role: "offer" },
      { id: "Onboarded", label: "Onboarded", role: "terminal" },
    ],
    retired: [{ id: "Old", label: "Old column", role: "custom" }],
  },
  DEFAULT_WORKSPACE,
  "team"
);

const post = (body: unknown) =>
  POST(new NextRequest("http://localhost/api/pipeline", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
const codeOf = async (r: Response) => ((await r.json()) as { code?: string }).code;
const entryIdOf = (candidateId: string, jobId: string) => `m-${candidateId}-${jobId}`;

const MATCH_FACTS = {
  fitTier: "promising",
  best: { labelCode: "foundation", percent: 77 },
  worst: { labelCode: "fit", percent: 51 },
  matched: ["SQL"],
  unproven: [],
  missing: ["Spark"],
  matchScore: 64,
  scorerVersion: "match-scorer.v1",
};
/** A Match add carrying a held run, so it would seal a verdict if it got past the door. */
function matchAdd(candidateId: string, jobId: string, extra: Record<string, unknown> = {}) {
  const matchRunId = recordMatchRun({ workspaceId: DEFAULT_WORKSPACE, candidateId, weights: null, results: [{ jobId, facts: MATCH_FACTS as never }] });
  return { candidateId, candidateLabel: candidateId, jobId, jobTitle: jobId, source: "match", matchScore: 64, matchFacts: MATCH_FACTS, matchRunId, ...extra };
}
function assertNothingFiled(candidateId: string, jobId: string, note: string) {
  const id = entryIdOf(candidateId, jobId);
  assert.equal(getPipelineEntry(id), null, `${note}: no entry`);
  assert.deepEqual(listPipelineEventsForEntry(id), [], `${note}: no event`);
  assert.equal(listDecisionRecords({ candidateRef: id }).length, 0, `${note}: no sealed verdict`);
}

test("a viewer seat is refused FORBIDDEN_CAPABILITY and files nothing — no entry, event or sealed verdict", async () => {
  signedInAs(viewer);
  const res = await post(matchAdd("gate-viewer", "gate-job-1"));
  assert.equal(res.status, 403);
  assert.equal(await codeOf(res), "FORBIDDEN_CAPABILITY");
  assertNothingFiled("gate-viewer", "gate-job-1", "viewer");
});

test("a viewer cannot reopen a rejected entry through the re-add door", async () => {
  signedInAs(recruiter);
  const created = createPipelineEntry({ candidateId: "gate-reopen", candidateLabel: "Reopen", jobId: "gate-job-2", jobTitle: "J", workspaceId: DEFAULT_WORKSPACE });
  actOnPipelineEntry(created.entry.id, "reject");
  signedInAs(viewer);
  const res = await post({ candidateId: "gate-reopen", candidateLabel: "Reopen", jobId: "gate-job-2", jobTitle: "J" });
  assert.equal(res.status, 403);
  assert.equal(getPipelineEntry(created.entry.id)?.status, "rejected", "the rejection stands");
});

test("a seat holding pipeline:write still files", async () => {
  signedInAs(recruiter);
  const res = await post({ candidateId: "gate-rec", candidateLabel: "Rec", jobId: "gate-job-3", jobTitle: "J", stage: "Screened" });
  assert.equal(res.status, 200);
  assert.equal(getPipelineEntry(entryIdOf("gate-rec", "gate-job-3"))?.stage, "Screened");
});

test("an add naming the terminal stage is 422 PIPELINE_TERMINAL_NOT_MANUAL and files nothing (Match verdict unsealed)", async () => {
  signedInAs(recruiter);
  // By role: this workspace's terminal column is 'Onboarded'.
  const res = await post(matchAdd("gate-term", "gate-job-4", { stage: "Onboarded" }));
  assert.equal(res.status, 422);
  assert.equal(await codeOf(res), "PIPELINE_TERMINAL_NOT_MANUAL");
  assertNothingFiled("gate-term", "gate-job-4", "terminal add");
});

test("a re-add naming the terminal stage is refused and leaves the existing entry where it stood", async () => {
  signedInAs(recruiter);
  const created = createPipelineEntry({ candidateId: "gate-readd", candidateLabel: "Readd", jobId: "gate-job-5", jobTitle: "J", stage: "Interview", workspaceId: DEFAULT_WORKSPACE });
  actOnPipelineEntry(created.entry.id, "reject");
  const events = listPipelineEventsForEntry(created.entry.id).length;
  const res = await post({ candidateId: "gate-readd", candidateLabel: "Readd", jobId: "gate-job-5", jobTitle: "J", stage: "Onboarded" });
  assert.equal(res.status, 422);
  assert.equal(await codeOf(res), "PIPELINE_TERMINAL_NOT_MANUAL");
  const after = getPipelineEntry(created.entry.id);
  assert.equal(after?.status, "rejected", "not reopened");
  assert.equal(after?.stage, "Interview");
  assert.equal(listPipelineEventsForEntry(created.entry.id).length, events, "no new event");
});

test("a non-terminal stage and a retired stage still file", async () => {
  signedInAs(recruiter);
  for (const [cid, stage] of [["gate-ok", "Offer"], ["gate-retired", "Old"]] as const) {
    const res = await post({ candidateId: cid, candidateLabel: cid, jobId: "gate-job-6", jobTitle: "J", stage });
    assert.equal(res.status, 200, stage);
    assert.equal(getPipelineEntry(entryIdOf(cid, "gate-job-6"))?.stage, stage);
  }
});
