// The screening wave's fairness gate follows the LIVE archetype registry
// (archetype-live.ts), not the copy app/_lib/archetypes.ts bundled at build time.
//
// Before: a custom archetype an operator registered after the build was "unknown" to
// the wave - shielded only by the fail-closed default, and audited as
// 'fairness_gate_unknown_archetype' on every committed wave although it is registered.
// Runs against an ISOLATED throwaway DB (testing/unit-db.ts must be the first project
// import) and a TEMP registry file, never the checked-in archetypes.json.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { createPipelineEntry, listPipelineEventsForEntry } from "./db/pipeline.ts";
import { runScreenWave } from "./screen-wave.ts";
import { setLiveRegistryPathForTest } from "./archetype-live.ts";
import { isKnownArchetype } from "./archetypes.ts";

const dir = mkdtempSync(path.join(tmpdir(), "kp-screen-wave-live-"));
const file = path.join(dir, "archetypes.json");
const bundled = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../pipeline/jobfit/archetypes.json", import.meta.url)), "utf8")
) as { archetypes: Record<string, unknown>[] };
bundled.archetypes.push({
  id: "ops_lead",
  label: "Operations lead",
  badge: "Ops lead",
  fairnessProtected: true,
  scoringModel: "experienced",
  weights: { skills: 0.5, career: 0.35, personal: 0.15 },
  dimensionLabels: { skills: "Skills", career: "Career", personal: "Personal" },
  checklist: [],
});
writeFileSync(file, JSON.stringify(bundled, null, 2), "utf8");
setLiveRegistryPathForTest(file);

after(() => {
  setLiveRegistryPathForTest(null);
  rmSync(dir, { recursive: true, force: true });
  cleanupUnitDb();
});

let seq = 0;
function seed(jobId: string, label: string, matchScore: number, archetype: string) {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `swl-c${seq}`,
    candidateLabel: label,
    jobId,
    jobTitle: "Live Archetype Role",
    stage: "Screened",
    matchScore,
    archetype,
    contact: `swl-c${seq}@example.com`,
  });
  return entry;
}

const RULE = { autoRejectEnabled: true, rejectBottomPercent: 100, maxMatchToReject: 45 };
const UNKNOWN_EVENT = "fairness_gate_unknown_archetype";

test("case 7: a live-registered protected archetype is shielded as early-career, and a commit audits it as KNOWN", async () => {
  assert.equal(isKnownArchetype("ops_lead"), false, "precondition: the bundled copy does not know it");
  const jobId = "swl-job";
  const ops = seed(jobId, "Ops Lead 10", 10, "ops_lead");
  const stray = seed(jobId, "Stray 12", 12, "quantum_alchemist"); // unknown to BOTH readers
  seed(jobId, "High 90", 90, "bau");

  const preview = await runScreenWave(jobId, RULE, { dryRun: true });
  const row = preview.decisions.find((d) => d.entryId === ops.id)!;
  assert.equal(row.action, "keep", "below floor, in the bottom %, but shielded");
  assert.equal(row.reasonCode, "earlyCareer", "shielded as a protected archetype, not as an unknown one");
  const strayRow = preview.decisions.find((d) => d.entryId === stray.id)!;
  assert.equal(strayRow.reasonCode, "unknownArchetype", "the fail-closed default still holds for a truly unknown id");

  await runScreenWave(jobId, RULE, {
    dryRun: false,
    approval: { approvedBy: "Live Registry Approver", token: preview.approvalToken },
  });
  assert.equal(
    listPipelineEventsForEntry(ops.id).filter((e) => e.kind === UNKNOWN_EVENT).length,
    0,
    "a registered archetype is not data drift - no 'Unknown archetype' audit event"
  );
  assert.equal(
    listPipelineEventsForEntry(stray.id).filter((e) => e.kind === UNKNOWN_EVENT).length,
    1,
    "the drift marker still fires for an id neither registry knows"
  );
});
