import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { saveProfile, saveAnalysis } from "./db";
import { writeMatchInput } from "./match-input.ts";
import { resolveCandidate } from "./match-candidate.ts";

// Behavioral tenant-isolation coverage for the profile/match RESOLVE paths (Direction 1):
// profiles and analyses are saved workspace-scoped, so writeMatchInput / resolveCandidate
// must refuse a cross-workspace id as not-found rather than resolving another tenant's
// candidate. Proves the scoping holds end to end, beyond the source-regex guards.

const workdirs: string[] = [];
function tempWorkdir(): string {
  const d = mkdtempSync(path.join(tmpdir(), "kp-match-input-"));
  workdirs.push(d);
  return d;
}

after(() => {
  for (const d of workdirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
  cleanupUnitDb();
});

test("a saved profile resolves only in its own workspace", async () => {
  const { id } = saveProfile(
    { label: "Team A candidate", archetype: "bau", roleFamily: "software_engineering", completeness: 80, payload: { skills: ["ts"] } },
    "ws-a"
  );

  const own = await writeMatchInput({ profileId: id }, tempWorkdir(), "ws-a");
  assert.ok(!("error" in own), "team A resolves its own profile");
  assert.ok("inputArgs" in own && own.inputArgs.includes("--profile-json"));

  const cross = await writeMatchInput({ profileId: id }, tempWorkdir(), "ws-b");
  assert.deepEqual(cross, { error: "Profile not found.", status: 404 }, "team B must NOT resolve team A's profile");
});

test("a saved analysis resolves only in its own workspace", async () => {
  const { slug } = saveAnalysis(
    { candidateLabel: "Team A CV", jdSlug: null, score: 72, roleFamily: "software_engineering", seniority: "medior", payload: { candidate: { skills: ["ts"] } } },
    "ws-a"
  );

  const own = resolveCandidate({ analysisSlug: slug }, "ws-a");
  assert.ok(!("error" in own), "team A resolves its own analysis");

  const cross = resolveCandidate({ analysisSlug: slug }, "ws-b");
  assert.deepEqual(cross, { error: "Analysis not found.", status: 404 }, "team B must NOT resolve team A's analysis");
});
