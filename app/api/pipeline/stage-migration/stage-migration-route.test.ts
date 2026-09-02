// Handler-level coverage for POST /api/pipeline/stage-migration — the route that
// applies a board-shape change AND the candidate moves it forces.
//
// The refusals are the point. This is the one settings write that can leave real
// people off the board, so the server must not take the client's word for who is
// stranded: it recomputes occupancy and rejects an unaccounted removal even
// though the composer's Save button already refuses it. These tests exercise the
// server half directly, with the client nowhere in sight.
//
// Runs against an ISOLATED throwaway DB (testing/unit-db.ts must stay the first
// project import) which SELF-SEEDS the demo corpus, so counts are deltas.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { POST as migratePost } from "./route.ts";
import { GET as impactGet } from "../stage-impact/route.ts";
import { GET as boardGet } from "../route.ts";
import { countPipelineByStage, createPipelineEntry, setPipelineEntryStage } from "../../../_lib/db/pipeline.ts";
import { DEFAULT_STAGE_AXIS } from "../../../_lib/pipeline-stages.ts";

after(() => cleanupUnitDb());

const post = (body: unknown) =>
  migratePost(
    new NextRequest("http://localhost/api/pipeline/stage-migration", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    })
  );

const wire = (s: { id: string; label: string; role: string }) => ({ id: s.id, label: s.label, role: s.role });
const SHIPPED = DEFAULT_STAGE_AXIS.map(wire);
/** The shipped axis minus one column, with that column tombstoned. */
const without = (dropId: string) => ({
  stages: SHIPPED.filter((s) => s.id !== dropId),
  retired: [wire(DEFAULT_STAGE_AXIS.find((s) => s.id === dropId)!)],
});
const restore = { stages: SHIPPED, retired: [] };

let seq = 0;
function entryAt(stage: string): string {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `smr-c${seq}`,
    candidateLabel: `Migration Route Candidate ${seq}`,
    jobId: "smr-job",
    jobTitle: "Migration Route Role",
  });
  setPipelineEntryStage(entry.id, stage);
  return entry.id;
}
const at = (stage: string) => countPipelineByStage()[stage] ?? 0;

test("a malformed axis is refused before anything is touched", async () => {
  const res = await post({ config: { stages: [{ id: "Only", label: "Only", role: "entry" }], retired: [] } });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, "PIPELINE_AXIS_INVALID");
});

test("removing an OCCUPIED step with no mapping is refused, and names who is on it", async () => {
  entryAt("Interview");
  const occupants = at("Interview");
  assert.ok(occupants > 0, "precondition");

  const res = await post({ config: without("Interview"), migrate: {} });
  assert.equal(res.status, 409, "a conflict, not a validation error — the axis is fine, the timing is not");
  const body = (await res.json()) as { code: string; unmapped: { stage: string; count: number }[] };
  assert.equal(body.code, "PIPELINE_MIGRATION_REQUIRED");
  assert.deepEqual(body.unmapped, [{ stage: "Interview", count: occupants }]);

  // Refused means REFUSED: the axis is untouched and nobody moved.
  const board = (await (await boardGet()).json()) as { stages: { id: string }[] };
  assert.deepEqual(board.stages.map((s) => s.id), [...SHIPPED.map((s) => s.id)]);
  assert.equal(at("Interview"), occupants);
});

test("a destination the same edit removes is refused — no moving out of one hole into another", async () => {
  const res = await post({ config: without("Interview"), migrate: { Interview: "Interview" } });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, "PIPELINE_MIGRATION_MAPPING_INVALID");

  const other = await post({ config: without("Interview"), migrate: { Interview: "Nowhere" } });
  assert.equal(other.status, 400);
  assert.equal((await other.json()).code, "PIPELINE_MIGRATION_MAPPING_INVALID");
});

test("a mapping that would empty a step the new axis KEEPS is refused", async () => {
  // The route's contract is "remove this column, and send the people on it to that
  // one" — the moves a SHAPE CHANGE forces. A mapping whose source survives the edit
  // forces nothing: it silently empties a live column while the response reports
  // `removed: []`. The source was never validated (only the destination was), so this
  // single call moved every Interview candidate to Screened on an unchanged board.
  const stranded = entryAt("Interview");
  const before = at("Interview");

  const res = await post({ config: { stages: SHIPPED, retired: [] }, migrate: { Interview: "Screened" } });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, "PIPELINE_MIGRATION_MAPPING_INVALID");
  assert.equal(at("Interview"), before, "refused means refused — nobody moved");
  assert.ok(stranded);

  // The legitimate shape is unchanged: the same mapping IS accepted when the edit
  // actually removes the column.
  const ok = await post({ config: without("Interview"), migrate: { Interview: "Screened" } });
  assert.equal(ok.status, 200);
  assert.equal(at("Interview"), 0);
  assert.equal((await post({ config: restore, migrate: {} })).status, 200);
});

test("a mapped removal moves everyone, writes the axis, and leaves the board off-axis-free", async () => {
  entryAt("Interview");
  const occupants = at("Interview");
  const onScreened = at("Screened");

  const res = await post({ config: without("Interview"), migrate: { Interview: "Screened" } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; moved: number; removed: string[] };
  assert.equal(body.moved, occupants);
  assert.deepEqual(body.removed, ["Interview"]);

  assert.equal(at("Interview"), 0);
  assert.equal(at("Screened"), onScreened + occupants);

  const board = (await (await boardGet()).json()) as { entries: { stage: string }[]; stages: { id: string }[]; retiredStages: { id: string }[] };
  assert.deepEqual(board.stages.map((s) => s.id), ["Accepted", "Screened", "Offer", "Hired"]);
  assert.deepEqual(board.retiredStages.map((s) => s.id), ["Interview"], "the dropped column is a tombstone, not a deletion");
  const known = new Set(board.stages.map((s) => s.id));
  assert.deepEqual(
    board.entries.filter((e) => !known.has(e.stage)),
    [],
    "nobody is left standing off the board"
  );
});

test("removing an EMPTY step needs no mapping at all", async () => {
  // Interview was emptied by the previous test and is already retired; drop the
  // now-empty Offer column instead.
  const emptied = await post({ config: { stages: SHIPPED, retired: [] }, migrate: {} }); // put Interview back first
  assert.equal(emptied.status, 200);

  const before = at("Offer");
  if (before > 0) {
    const clear = await post({ config: without("Offer"), migrate: { Offer: "Screened" } });
    assert.equal(clear.status, 200);
    const back = await post({ config: restore, migrate: {} });
    assert.equal(back.status, 200);
  }
  assert.equal(at("Offer"), 0, "precondition: the column we drop is empty");

  const res = await post({ config: without("Offer"), migrate: {} });
  assert.equal(res.status, 200, "an empty column is free to remove");
  assert.equal((await res.json()).moved, 0);

  // Leave the shipped axis in place for any later test in this file.
  assert.equal((await post({ config: restore, migrate: {} })).status, 200);
});

test("GET /api/pipeline/stage-impact reports occupancy alongside the axis", async () => {
  entryAt("Screened");
  const res = await impactGet();
  assert.equal(res.status, 200);
  const body = (await res.json()) as { counts: Record<string, number>; stages: { id: string }[]; retiredStages: unknown[] };
  assert.equal(body.counts["Screened"], at("Screened"));
  assert.deepEqual(body.stages.map((s) => s.id), [...SHIPPED.map((s) => s.id)]);
  assert.ok(Array.isArray(body.retiredStages));
});
