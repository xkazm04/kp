import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { upsertBrainEntry } from "./db/companion.ts";
import { createWorkspace, getCompanionBrainConsent } from "./db/workspaces.ts";
import { companionBrainStatus, companionMemoryEnabled, recordCompanionBrainConsent } from "./companion-brain.ts";

after(() => cleanupUnitDb());

// The CONSENT RULE (WP4) — the one decision that stands between kp and a folder
// of markdown in the operator's own home directory. Candi's memory is a tree
// shared with Personas' Athena; kp is not entitled to read it, write it or
// create it until somebody says yes, and this function is where "yes" is decided
// for every companion turn.
//
// Two arms, and the second is the whole reason it is a function rather than a
// column read:
//   EXPLICIT  the workspace answered the first-run step
//   IMPLICIT  companion_brain_index already holds an episode kp itself wrote
//
// The probe (which spawns Python) is deliberately NOT part of this: the rule has
// to be cheap enough for every message turn, and disk presence is the wrong
// question anyway — a brain that exists because Athena made it is somebody
// else's mind, and adopting it silently is exactly what the gate is for.

/** One episode pointer, as `companion_brain.py`'s kp lane would have left it. */
function mirrorEpisode(workspaceId: string, nodeId: string): void {
  upsertBrainEntry(
    { nodeId, path: `episodes/2026/08/24/${nodeId}_user.md`, excerpt: "What needs me today?" },
    workspaceId
  );
}

test("a fresh workspace has no consent and no memory", () => {
  const ws = createWorkspace("Fresh").id;
  assert.equal(getCompanionBrainConsent(ws), null);
  assert.equal(companionMemoryEnabled(ws), false);
});

test("recording a choice maps it to the stored state and turns memory on", () => {
  const ws = createWorkspace("Answered").id;
  recordCompanionBrainConsent("connect", ws);
  assert.equal(getCompanionBrainConsent(ws), "connected");
  assert.equal(companionMemoryEnabled(ws), true);

  recordCompanionBrainConsent("birth", ws);
  assert.equal(getCompanionBrainConsent(ws), "birthed");
  assert.equal(companionMemoryEnabled(ws), true);
});

test("IMPLICIT CONSENT: episodes kp already wrote count as a yes", () => {
  // The install that predates the consent step — the operator has been talking
  // to Candi for weeks. A feature that arrived afterwards must not switch their
  // memory off, and a row here exists only because append_episode put it there,
  // so it is evidence of USE and not merely of installation.
  const ws = createWorkspace("Veteran").id;
  assert.equal(companionMemoryEnabled(ws), false);
  mirrorEpisode(ws, "ep_implicit1");
  assert.equal(companionMemoryEnabled(ws), true);
  // …and still nothing was recorded: the rule reads the evidence, it does not
  // manufacture a consent row the operator never gave.
  assert.equal(getCompanionBrainConsent(ws), null);
});

test("implicit consent is per TENANT, not per machine", () => {
  // The brain tree is machine-wide but consent is a workspace fact. Another
  // team's episodes on the same disk must not enable this team's memory —
  // otherwise a shared install would leak one tenant's answer into another's.
  const veteran = createWorkspace("Veteran two").id;
  const fresh = createWorkspace("Fresh two").id;
  mirrorEpisode(veteran, "ep_implicit2");
  assert.equal(companionMemoryEnabled(veteran), true);
  assert.equal(companionMemoryEnabled(fresh), false);
});

test("skipping is stable — memory off cannot bootstrap itself into a yes", () => {
  // With memory off no episode is ever written, so the implicit arm has nothing
  // to find. That is the property that makes "Skip for now" an answer rather
  // than a delay: it stays skipped until somebody says otherwise.
  const ws = createWorkspace("Skipper").id;
  assert.equal(companionMemoryEnabled(ws), false);
  assert.equal(companionMemoryEnabled(ws), false);
  assert.equal(getCompanionBrainConsent(ws), null);
});

test("the status payload carries the probe plus both workspace facts", () => {
  const probe = { present: true, episodes: 12, identitySections: 4, constitutionOrigin: "personas" as const };
  const ws = createWorkspace("Status").id;
  assert.deepEqual(companionBrainStatus(probe, ws), { ...probe, consent: null, memoryEnabled: false });

  recordCompanionBrainConsent("connect", ws);
  assert.deepEqual(companionBrainStatus(probe, ws), { ...probe, consent: "connected", memoryEnabled: true });
});
