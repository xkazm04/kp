// Behavioral coverage for family-floors: the screening wave resolves each
// candidate's EFFECTIVE auto-reject floor — a per-family override when the entry's
// role family carries one, else the global maxMatchToReject — and the rationale +
// structured reasonParams report the floor ACTUALLY used, never the global one.
// Runs against an ISOLATED throwaway DB (testing/unit-db.ts must be the first import).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { createPipelineEntry } from "./db/pipeline.ts";
import { runScreenWave } from "./screen-wave.ts";

after(() => cleanupUnitDb());

let seq = 0;
function seed(jobId: string, label: string, matchScore: number, roleFamily: string) {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `ff-c${seq}`,
    candidateLabel: label,
    jobId,
    jobTitle: "Family Floor Test Role",
    stage: "Screened",
    matchScore,
    archetype: "bau", // known + NOT fairness-protected, so only the floor decides
    roleFamily,
    contact: `ff-c${seq}@example.com`,
  });
  return entry;
}

test("a family override is applied to its family; other families fall back to the global floor", async () => {
  const jobId = "ff-job";
  // Global floor 45; software_engineering overridden UP to 70. bottom 100% so the
  // bottom-% never masks the floor decision — the floor alone decides each.
  const se = seed(jobId, "SE 60", 60, "software_engineering"); // 60 < 70 override → reject
  const data = seed(jobId, "Data 60", 60, "data_ai"); // 60 ≥ 45 global (no override) → keep

  const wave = await runScreenWave(
    jobId,
    { autoRejectEnabled: true, rejectBottomPercent: 100, maxMatchToReject: 45, familyFloors: { software_engineering: 70 } },
    { dryRun: true }
  );

  const seRow = wave.decisions.find((d) => d.entryId === se.id)!;
  const dataRow = wave.decisions.find((d) => d.entryId === data.id)!;

  // The software candidate is judged against the FAMILY override (70), so 60 rejects…
  assert.equal(seRow.action, "reject", "60 is below the software override floor of 70");
  assert.match(seRow.rationale, /match 60 < 70/, "the rationale reports the effective (override) floor, not the global 45");
  assert.equal(seRow.reasonParams.threshold, 70, "the structured reasonParams carry the floor actually used");

  // …while the data candidate falls back to the GLOBAL floor (45), so 60 is kept.
  assert.equal(dataRow.action, "keep", "60 is at/above the global floor of 45");
});

test("with NO familyFloors the wave is byte-identical — the global floor decides every family", async () => {
  const jobId = "ff-job-global";
  const se = seed(jobId, "SE 40", 40, "software_engineering"); // 40 < 45 global → reject
  const data = seed(jobId, "Data 50", 50, "data_ai"); // 50 ≥ 45 global → keep

  const wave = await runScreenWave(
    jobId,
    { autoRejectEnabled: true, rejectBottomPercent: 100, maxMatchToReject: 45 },
    { dryRun: true }
  );

  const seRow = wave.decisions.find((d) => d.entryId === se.id)!;
  const dataRow = wave.decisions.find((d) => d.entryId === data.id)!;
  assert.equal(seRow.action, "reject");
  assert.match(seRow.rationale, /match 40 < 45/, "no override → the global floor is reported");
  assert.equal(seRow.reasonParams.threshold, 45);
  assert.equal(dataRow.action, "keep");
});
