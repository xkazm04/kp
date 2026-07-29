// comms-tenancy-pair — the outbox tenant contract, both halves:
//
//   (1) an ENTRY-LESS dispatch (the KO decline, fired before any pipeline entry
//       exists) files into the team its caller names, NOT the default workspace.
//       Pre-fix, a non-default team's KO-decline notice appeared in the DEFAULT
//       team's Comms Center and NOWHERE in the owning team's — while the decline
//       RECORD (recordKnockoutDecline) was correctly filed in the owning team. The
//       one adverse comm the never-ghost promise rests on was invisible to the
//       recruiters responsible for it.
//   (2) a REF'D comm still derives its tenant from the referenced entry, and an
//       explicit workspaceId can NEVER pull it away from its entry's team — the
//       explicit tenant is a last resort, not an override.
//
// Real, throwaway DB: testing/unit-db.ts must stay the FIRST project import.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { createPipelineEntry, listOutboxFiltered, DEFAULT_WORKSPACE_ID } from "./db.ts";
import { sendComm } from "./comms.ts";
import { dispatchKnockoutDecline } from "./comms-dispatch.ts";

after(() => cleanupUnitDb());

const TEAM = "team-koln"; // a REAL non-default team

test("an entry-less KO decline lands in the declining team's Comms Center only", async () => {
  await dispatchKnockoutDecline({
    email: "lead@example.cz",
    name: "Petra Nováková",
    jobTitle: "Backend Engineer",
    locale: "en",
    workspaceId: TEAM,
  });

  const owning = listOutboxFiltered({ kind: "ko_decline" }, TEAM);
  assert.equal(owning.length, 1, "the owning team sees its own KO-decline notice");
  assert.equal(owning[0].recipient, "lead@example.cz");
  assert.equal(owning[0].ref, null, "entry-less by design — no pipeline entry exists yet");

  assert.deepEqual(
    listOutboxFiltered({ kind: "ko_decline" }, DEFAULT_WORKSPACE_ID),
    [],
    "the DEFAULT team's Comms Center must NOT show another team's KO decline"
  );
});

test("an entry-less dispatch with no tenant still falls back to the default workspace", async () => {
  await sendComm({ to: "system@example.cz", subject: "System note", body: "…", kind: "acknowledgement" });
  const defaults = listOutboxFiltered({ kind: "acknowledgement" }, DEFAULT_WORKSPACE_ID);
  assert.equal(defaults.length, 1, "no ref, no explicit tenant → the default workspace, as before");
});

test("a ref'd comm keeps its ENTRY-derived tenant — an explicit workspaceId cannot re-file it", async () => {
  const { entry } = createPipelineEntry({
    candidateId: "cand-tenancy-1",
    candidateLabel: "Jana Nová",
    jobId: "job-tenancy-1",
    jobTitle: "Backend Engineer",
    stage: "Accepted",
    workspaceId: TEAM,
  });

  // A hostile/mistaken explicit tenant must lose to the entry's own team.
  await sendComm({
    to: "jana@example.cz",
    subject: "Offer",
    body: "…",
    kind: "offer",
    ref: entry.id,
    workspaceId: DEFAULT_WORKSPACE_ID,
  });

  assert.equal(listOutboxFiltered({ ref: entry.id }, TEAM).length, 1, "the row files into the entry's team");
  assert.deepEqual(
    listOutboxFiltered({ ref: entry.id }, DEFAULT_WORKSPACE_ID),
    [],
    "the explicit tenant never overrides an entry-derived one"
  );
});
