// challenge-r05 pipeline-actions-commands/B — undo a command-bar reject wave.
//
// A typed `reject below 40%` closes out and emails a whole cohort in one confirm. The
// undo restores exactly the wave's still-untouched members to the stage they stood on
// (never the Screened landing column the auto-reject reversal uses), seals each
// reversal as a NEW decision under the undoer's name, reports how many had already
// been sent the letter (a sent letter cannot be recalled), and leaves alone anything
// that moved since or belongs to another team.
//
// unit-db.ts MUST be the first project import (sets KP_DB_PATH before any store
// module resolves db-path.ts).
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { ensureDb } from "../../../_lib/db/core.ts";
import {
  actOnPipelineEntry,
  createPipelineEntry,
  getPipelineEntry,
  listPipelineEventsForEntry,
  recordAutomationEvent,
  reinstatePipelineEntry,
} from "../../../_lib/db/pipeline.ts";
import { listDecisionRecords } from "../../../_lib/decision-record-store.ts";
import { commandRejectDetail, planWaveReversal } from "../../../_lib/pipeline-command.ts";
import { runScreenWave } from "../../../_lib/screen-wave.ts";
import { restoreCommandRejection, reverseCommandWave } from "./reverse.ts";
import { NextRequest } from "next/server";
import { POST as reversePost } from "./reverse/route.ts";

after(() => cleanupUnitDb());
before(() => {
  ensureDb().prepare(`DELETE FROM pipeline_entries`).run();
});

const ACTOR = "human:Undo Tester";
const OTHER_WS = "team-undo-other";

let seq = 0;
function entryFixture(overrides: Partial<Parameters<typeof createPipelineEntry>[0]> = {}) {
  seq += 1;
  return createPipelineEntry({
    candidateId: `undo-c${seq}`,
    candidateLabel: `Undo Candidate ${seq}`,
    jobId: `undo-job-${seq}`,
    jobTitle: "Undo Role",
    contact: `undo-c${seq}@example.com`,
    matchScore: 20,
    ...overrides,
  }).entry;
}

/** What a command-bar reject leaves behind, row for row: the store write with the
 *  bar's detail literal under a named human (execute.ts → runPipelineEntryAction). */
function waveReject(id: string, stage: string, threshold = 40, ws?: string) {
  const r = actOnPipelineEntry(id, "reject", commandRejectDetail(threshold), { expectedStage: stage, actor: "human", actorRef: "human:recruiter" }, ws);
  assert.ok(r && r.status === "rejected", "fixture: the wave rejected the entry");
}

function rawRow(id: string): unknown {
  return ensureDb().prepare(`SELECT * FROM pipeline_entries WHERE id = ?`).get(id);
}

// ---- case 5: restore where they stood, sealed to the undoer ---------------
test("an entry command-rejected at 'Interview' comes back active on 'Interview', with a named reinstated event and a sealed reversal", () => {
  const e = entryFixture({ stage: "Interview" });
  waveReject(e.id, "Interview");

  const out = reverseCommandWave({ ids: [e.id], threshold: 40, workspaceId: "workspace", actor: ACTOR });
  assert.deepEqual(out, { restored: 1, notified: 0, skipped: 0 });

  const back = getPipelineEntry(e.id)!;
  assert.equal(back.status, "active");
  assert.equal(back.stage, "Interview", "restored to the stage it stood on, not the screened landing column");

  const reinstated = listPipelineEventsForEntry(e.id).filter((ev) => ev.kind === "reinstated");
  assert.equal(reinstated.length, 1);
  assert.equal(reinstated[0].actor, ACTOR, "the reversal names the person who undid the wave");
  assert.equal(reinstated[0].fromStage, "Interview");
  assert.equal(reinstated[0].toStage, "Interview");

  const seals = listDecisionRecords({ candidateRef: e.id }).filter((r) => r.kind === "reinstated");
  assert.equal(seals.length, 1, "the reversal is a NEW sealed decision");
  assert.equal(seals[0].reasonCode, "command_wave_reversed");
  assert.equal(seals[0].actor, ACTOR);
  const inputs = (JSON.parse(seals[0].payloadJson) as { inputs: { threshold: number; restoredStage: string; notified: boolean } }).inputs;
  assert.equal(inputs.threshold, 40);
  assert.equal(inputs.restoredStage, "Interview");
  assert.equal(inputs.notified, false);
});

test("restoreCommandRejection refuses a row whose stage moved since the wave (compare-and-swap on the stage the wave left)", () => {
  const e = entryFixture({ stage: "Screened" });
  waveReject(e.id, "Screened");
  // Force the stage out from under the wave's record — the CAS must hold.
  ensureDb().prepare(`UPDATE pipeline_entries SET stage='Interview' WHERE id = ?`).run(e.id);
  const before = rawRow(e.id);
  const r = restoreCommandRejection(e.id, "workspace", { plan: (snap) => planWaveReversal(snap, 40), actorRef: ACTOR });
  assert.deepEqual(r, { restored: false, reason: "moved" });
  assert.deepEqual(rawRow(e.id), before, "a moved row is never overwritten");
});

// ---- cases 6 + 7: the mixed wave, then idempotency -------------------------
test("a mixed wave restores only its untouched members, reports who was told, and leaves moved and foreign rows byte-identical; a second undo is a no-op", () => {
  const a = entryFixture({ stage: "Screened" });
  const b = entryFixture({ stage: "Interview" });
  const c = entryFixture({ stage: "Screened" });
  const x = entryFixture({ stage: "Screened", workspaceId: OTHER_WS });
  waveReject(a.id, "Screened");
  waveReject(b.id, "Interview");
  recordAutomationEvent(b.id, "rejection_sent", "manual reject · feedback:none", "workspace");
  waveReject(c.id, "Screened");
  // c: a human reinstated them after the wave — no longer this wave's to undo.
  assert.ok(reinstatePipelineEntry(c.id, "workspace", "human:Someone Else"));
  waveReject(x.id, "Screened", 40, OTHER_WS);

  const cBefore = rawRow(c.id);
  const xBefore = rawRow(x.id);

  const ids = [a.id, b.id, c.id, x.id];
  const first = reverseCommandWave({ ids, threshold: 40, workspaceId: "workspace", actor: ACTOR });
  assert.deepEqual(first, { restored: 2, notified: 1, skipped: 2 });
  assert.equal(getPipelineEntry(a.id)!.status, "active");
  assert.equal(getPipelineEntry(b.id)!.stage, "Interview");
  assert.deepEqual(rawRow(c.id), cBefore, "a row a human moved since is left alone");
  assert.deepEqual(rawRow(x.id), xBefore, "another team's row is never touched");

  const second = reverseCommandWave({ ids, threshold: 40, workspaceId: "workspace", actor: ACTOR });
  assert.deepEqual(second, { restored: 0, notified: 0, skipped: 4 });
  for (const id of [a.id, b.id]) {
    assert.equal(
      listDecisionRecords({ candidateRef: id }).filter((r) => r.kind === "reinstated").length,
      1,
      "the undo cannot double-seal"
    );
  }
});

// ---- case 8: one literal, shared by the writer and the matcher -------------
test("execute.ts builds its reject detail with commandRejectDetail, the function planWaveReversal matches against", () => {
  const src = readFileSync(fileURLToPath(new URL("./execute.ts", import.meta.url)), "utf8");
  assert.match(src, /detail:\s*commandRejectDetail\(threshold/);
  assert.doesNotMatch(src, /`Command bar: below/, "no hand-typed copy of the literal beside the shared function");
});

// ---- critic revision: the declared screen-wave interaction -----------------
// A wave-restored entry carries a `reinstated` event, and screen-wave.ts spares any
// entry with one from the next auto-reject pass (the reinstatement shield). That is
// INTENDED: a recruiter who undid a rejection has made a human call on this person,
// and the machine must not re-reject them on the same evidence. They stay rejectable
// by hand.
test("a wave-restored candidate is spared by the next screen-wave with the 'reinstated' keep-reason (intended)", async () => {
  const jobId = "undo-screen-wave-job";
  const e = entryFixture({ jobId, stage: "Screened", matchScore: 12, archetype: "bau" });
  waveReject(e.id, "Screened");
  assert.deepEqual(reverseCommandWave({ ids: [e.id], threshold: 40, workspaceId: "workspace", actor: ACTOR }), {
    restored: 1,
    notified: 0,
    skipped: 0,
  });
  const wave = await runScreenWave(jobId, { autoRejectEnabled: true, rejectBottomPercent: 100, maxMatchToReject: 50, holdoutPercent: 0 }, { dryRun: true });
  const row = wave.decisions.find((d) => d.entryId === e.id)!;
  assert.equal(row.action, "keep");
  assert.equal(row.reasonCode, "reinstated");
});

// ---- the door: the route derives the threshold with the command parser -----
const postReverse = (body: unknown): Promise<Response> =>
  reversePost(
    new NextRequest("http://localhost/api/pipeline/command/reverse", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    })
  );

test("POST /api/pipeline/command/reverse restores a wave from the typed command and names the session's actor", async () => {
  const e = entryFixture({ stage: "Interview" });
  waveReject(e.id, "Interview", 55);
  const res = await postReverse({ ids: [e.id], text: "reject everyone below 55%" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { restored: 1, notified: 0, skipped: 0 });
  const ev = listPipelineEventsForEntry(e.id).filter((x) => x.kind === "reinstated");
  assert.equal(ev.length, 1);
  assert.equal(ev[0].actor, "human:recruiter", "open mode: the role token, never NULL");
});

test("POST /api/pipeline/command/reverse refuses a body with no ids or no threshold, with a code", async () => {
  for (const body of [{}, { ids: [] }, { ids: ["x"] }, { ids: ["x"], text: "advance the top 3" }, { ids: Array.from({ length: 201 }, (_, i) => `id-${i}`), threshold: 40 }]) {
    const res = await postReverse(body);
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { code?: string }).code, "PIPELINE_BATCH_PAYLOAD_INVALID");
  }
});
