// The Fit Matrix pool cap must be observable, not silent (skill-matrix-coverage
// #1). listMatrixProfiles caps the scored pool at MATRIX_POOL_CAP; countMatrixProfiles
// reports the true (unclamped) size so the route/UI can say "Showing N of M"
// instead of quietly omitting candidates past the cap.
// (testing/unit-db.ts must be the first project import.)
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { saveProfile, listMatrixProfiles, countMatrixProfiles, MATRIX_POOL_CAP } from "./profiles.ts";

after(() => cleanupUnitDb());

const WS = "ws-matrix-cap";

test("listMatrixProfiles caps at MATRIX_POOL_CAP while countMatrixProfiles reports the true total", () => {
  const OVER = MATRIX_POOL_CAP + 5;
  for (let i = 0; i < OVER; i += 1) {
    saveProfile({ label: `Cand ${i}`, archetype: "bau", roleFamily: "engineering_backend", completeness: 0.5, payload: {} }, WS);
  }
  assert.equal(countMatrixProfiles(WS), OVER, "the count reflects every profile in the workspace");
  assert.equal(listMatrixProfiles(MATRIX_POOL_CAP, WS).length, MATRIX_POOL_CAP, "the scored pool is capped");
  // The cap is a real omission the caller can now detect (count > cap).
  assert.ok(countMatrixProfiles(WS) > MATRIX_POOL_CAP, "the truncation is observable via the count");
});

test("countMatrixProfiles is workspace-scoped", () => {
  saveProfile({ label: "Solo", archetype: "bau", roleFamily: "engineering_backend", completeness: 0.5, payload: {} }, "ws-matrix-solo");
  assert.equal(countMatrixProfiles("ws-matrix-solo"), 1);
  assert.equal(countMatrixProfiles("ws-matrix-empty"), 0);
});
