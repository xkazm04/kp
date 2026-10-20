// A modal-initiated Regenerate STAGES its plan (r09 schedule-interview-prep/B): the new
// generator-owned keys land under `payload.pendingPlan` and the committed plan stays
// exactly as it was until the interviewer accepts. Driven through the real commit seam
// (commitGeneratedPrep, what runInterviewPrep does after its Python-backed generation)
// and the real PATCH handler with a signed session.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import type { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";

register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const VIRTUAL_HEADERS = "kp-test:next-headers";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpPendingPlanTestCookie?: () => string | null }).__kpPendingPlanTestCookie = () => cookieValue;
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
            const value = globalThis.__kpPendingPlanTestCookie();
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

process.env.KP_SECRET = "interview-prep-pending-secret";
process.env.KP_OPERATOR_PASSWORD = "interview-prep-pending-password";

const { PATCH } = await import("./route.ts");
const { getInterviewPrep, saveInterviewPrep } = await import("../../_lib/interview-prep.ts");
const { commitGeneratedPrep } = await import("../../_lib/interview-prep-run.ts");
const { createPipelineEntry } = await import("../../_lib/db/pipeline.ts");
const { createWorkspace } = await import("../../_lib/db/workspaces.ts");
const { createUser } = await import("../../_lib/db/users.ts");
const { upsertMembership } = await import("../../_lib/db/memberships.ts");
const { signSession } = await import("../../_lib/auth/session.ts");

after(() => cleanupUnitDb());

const ORG = "org-pending";
const team = createWorkspace("Pending team", ORG);
const other = createWorkspace("Pending other", ORG);
const owner = createUser({ orgId: ORG, email: "pending.owner@pending.test", name: "Pending owner", status: "active", password: "pending-pw-owner-1" });
upsertMembership(owner.id, team.id, "owner");
const viewer = createUser({ orgId: ORG, email: "pending.viewer@pending.test", name: "Pending viewer", status: "active", password: "pending-pw-viewer-1" });
upsertMembership(viewer.id, team.id, "viewer");
function signedInAs(user: { id: string; orgId: string }): void {
  cookieValue = signSession(team.id, Date.now(), { sub: user.id, org: user.orgId });
}

const OLD_CHRONOLOGY = [
  { topic: "Intro", goal: "Rapport", questions: ["Hi?"], fromMin: 0, toMin: 5 },
  { topic: "System design", goal: "Depth", questions: ["Design a queue?"], fromMin: 5, toMin: 20 },
  { topic: "Wrap", goal: "Close", questions: ["Questions?"], fromMin: 20, toMin: 25 },
];
const NEW_CHRONOLOGY = [
  { topic: "Intro", goal: "Rapport", questions: ["Hi?"], fromMin: 0, toMin: 5 },
  { topic: "Testing", goal: "Depth", questions: ["How do you test?"], fromMin: 5, toMin: 20 },
  { topic: "Wrap", goal: "Close", questions: ["Questions?"], fromMin: 20, toMin: 25 },
];
const generated = {
  scenario: "A fresh plan.",
  durationMin: 25,
  focusAreas: ["testing"],
  chronology: NEW_CHRONOLOGY,
  signals: ["Probed testing"],
  source: "llm",
  lang: "en",
  rubricCoverage: { gap: null, roleFamily: null, axisKeys: [] },
};
// The human-owned keys a plan decision must never touch.
const HUMAN = {
  userProgress: { checked: { "c-1": true }, notes: "strong on queues" },
  interviewer: "amy@corp.test",
  humanScorecard: { ratings: [{ competency: "Communication", rating: 4 }], source: "human" },
  humanScorecards: [{ ratings: [{ competency: "Communication", rating: 4 }], source: "human", author: "u1", authorLabel: "Amy", stage: "interview", savedAt: "2026-09-20T10:00:00.000Z" }],
  importedQuestions: [{ question: "Q1", blockRef: "System design" }],
  kitOverlay: { version: 1, dropped: ["q-first"], edited: [], added: [] },
};

let seq = 0;
function packedEntry(ws: string = team.id, withPack = true) {
  const n = ++seq;
  const { entry } = createPipelineEntry({ candidateId: `cand-pp-${n}`, candidateLabel: `Kandidat ${n}`, jobId: `job-pp-${n}`, jobTitle: "QA Engineer", workspaceId: ws });
  if (withPack) {
    saveInterviewPrep(entry.id, entry.candidateLabel ?? null, "QA Engineer", {
      scenario: "The old plan.",
      durationMin: 25,
      focusAreas: ["design"],
      chronology: OLD_CHRONOLOGY,
      signals: ["Probed design"],
      source: "llm",
      lang: "en",
      ...HUMAN,
    }, { regenerated: true });
  }
  return entry.id;
}

const tick = () => new Promise((r) => setTimeout(r, 5));
const url = (entryId: string) => `http://localhost/api/interview-prep?entry=${encodeURIComponent(entryId)}`;
function patch(entryId: string, body: unknown): NextRequest {
  const r = new Request(url(entryId), {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.11" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
  Object.defineProperty(r, "nextUrl", { value: new URL(url(entryId)) });
  return r;
}
const humanKeys = (payload: Record<string, unknown>) =>
  JSON.stringify({
    userProgress: payload.userProgress,
    interviewer: payload.interviewer,
    humanScorecard: payload.humanScorecard,
    humanScorecards: payload.humanScorecards,
    importedQuestions: payload.importedQuestions,
    kitOverlay: payload.kitOverlay,
  });

test("a staged regeneration of an existing pack leaves the committed plan and created_at alone", async () => {
  const entryId = packedEntry();
  const before = getInterviewPrep(entryId, team.id)!;
  await tick();
  const result = commitGeneratedPrep(entryId, "Kandidat", "QA Engineer", generated, team.id, { stage: true });
  const after = getInterviewPrep(entryId, team.id)!;
  assert.deepEqual(after.payload.chronology, OLD_CHRONOLOGY);
  assert.equal(after.payload.scenario, "The old plan.");
  assert.deepEqual(after.payload.signals, ["Probed design"]);
  assert.deepEqual(after.payload.pendingPlan, generated, "the new generator-owned keys wait under pendingPlan");
  assert.equal(after.createdAt, before.createdAt, "a staged plan is not a regeneration yet");
  assert.deepEqual(result.pendingPlan, generated, "the task result carries the pending plan to the modal");
});

test("a staged regeneration with NO existing pack commits directly, as today", () => {
  const entryId = packedEntry(team.id, false);
  commitGeneratedPrep(entryId, "Kandidat", "QA Engineer", generated, team.id, { stage: true });
  const prep = getInterviewPrep(entryId, team.id)!;
  assert.deepEqual(prep.payload.chronology, NEW_CHRONOLOGY);
  assert.equal("pendingPlan" in prep.payload, false);
  assert.ok(prep.createdAt, "created_at set by the first generation");
});

test("PATCH {plan:'accept'} swaps the pending plan in, moves created_at, and touches no human key; a second accept changes nothing", async () => {
  const entryId = packedEntry();
  commitGeneratedPrep(entryId, "Kandidat", "QA Engineer", generated, team.id, { stage: true });
  const before = getInterviewPrep(entryId, team.id)!;
  await tick();
  signedInAs(owner);
  const r = await PATCH(patch(entryId, { plan: "accept" }));
  assert.equal(r.status, 200);
  const body = (await r.json()) as { applied: boolean; prep?: { payload: Record<string, unknown>; createdAt: string } };
  assert.equal(body.applied, true);
  const after = getInterviewPrep(entryId, team.id)!;
  assert.deepEqual(after.payload.chronology, NEW_CHRONOLOGY);
  assert.equal(after.payload.scenario, "A fresh plan.");
  assert.equal("pendingPlan" in after.payload, false, "the pending plan is gone once accepted");
  assert.ok(after.createdAt > before.createdAt, "created_at moved, so the stale chip clears truthfully");
  assert.equal(humanKeys(after.payload), humanKeys(before.payload), "every human key is byte-identical");
  assert.deepEqual(body.prep?.payload, after.payload, "the answer carries the accepted pack for the modal to re-seed");

  const again = await PATCH(patch(entryId, { plan: "accept" }));
  assert.equal(again.status, 200);
  assert.equal(((await again.json()) as { applied: boolean }).applied, false);
  assert.deepEqual(getInterviewPrep(entryId, team.id), after, "a second accept changes nothing");
});

test("PATCH {plan:'discard'} drops the pending plan; the committed plan and created_at are unchanged", async () => {
  const entryId = packedEntry();
  commitGeneratedPrep(entryId, "Kandidat", "QA Engineer", generated, team.id, { stage: true });
  const before = getInterviewPrep(entryId, team.id)!;
  await tick();
  signedInAs(owner);
  const r = await PATCH(patch(entryId, { plan: "discard" }));
  assert.equal(r.status, 200);
  assert.equal(((await r.json()) as { applied: boolean }).applied, true);
  const after = getInterviewPrep(entryId, team.id)!;
  assert.equal("pendingPlan" in after.payload, false);
  assert.deepEqual(after.payload.chronology, OLD_CHRONOLOGY);
  assert.equal(after.createdAt, before.createdAt);
  assert.equal(humanKeys(after.payload), humanKeys(before.payload));
});

test("an UNSTAGED regeneration (the Decisions-queue accept) commits and clears a pending plan", () => {
  const entryId = packedEntry();
  commitGeneratedPrep(entryId, "Kandidat", "QA Engineer", generated, team.id, { stage: true });
  const unstaged = { ...generated, scenario: "Queue-accept plan." };
  commitGeneratedPrep(entryId, "Kandidat", "QA Engineer", unstaged, team.id, {});
  const after = getInterviewPrep(entryId, team.id)!;
  assert.equal(after.payload.scenario, "Queue-accept plan.");
  assert.equal("pendingPlan" in after.payload, false, "a stale candidate is never carried forward");
  assert.deepEqual(after.payload.humanScorecards, HUMAN.humanScorecards, "slot A's scorecard list rides through untouched");
});

test("the plan decision asks the seat and the tenancy read like every sibling verb", async () => {
  const entryId = packedEntry();
  commitGeneratedPrep(entryId, "Kandidat", "QA Engineer", generated, team.id, { stage: true });
  signedInAs(viewer);
  const refused = await PATCH(patch(entryId, { plan: "accept" }));
  assert.equal(refused.status, 403);
  assert.ok(getInterviewPrep(entryId, team.id)!.payload.pendingPlan, "a refused seat changes nothing");

  const foreign = packedEntry(other.id);
  commitGeneratedPrep(foreign, "Kandidat", "QA Engineer", generated, other.id, { stage: true });
  signedInAs(owner);
  const r = await PATCH(patch(foreign, { plan: "accept" }));
  assert.equal(r.status, 404);
  assert.equal(((await r.json()) as { code?: string }).code, "INTERVIEW_PREP_NOT_FOUND");
  assert.deepEqual(getInterviewPrep(foreign, other.id)!.payload.chronology, OLD_CHRONOLOGY, "another team's plan is never swapped");
});
