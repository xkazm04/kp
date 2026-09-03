import { test, before } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtempSync } from "node:fs";

// /perfect wave 21 (internal-explorers): the control room's audit listing was
// deployment-wide by declaration — `dev_audit` is a declared deployment-level table —
// but its rows are NOT deployment-level data: POST /api/devcase/outcomes writes the
// candidate ref straight into `reason`, so one studio's audit panel listed another
// studio's candidates. These tests pin the scope.
//
// Isolate onto a throwaway DB BEFORE dev-control (and db-path) loads: DB_PATH is
// resolved at module-load from KP_DB_PATH and static imports evaluate before any
// top-level statement, so the module is pulled in via dynamic import in `before()`.
process.env.KP_DB_PATH = path.join(mkdtempSync(path.join(os.tmpdir(), "kp-devctl-")), "kp.sqlite");
delete process.env.DATABASE_URL;

let recordAudit: (typeof import("./dev-control.ts"))["recordAudit"];
let listAudit: (typeof import("./dev-control.ts"))["listAudit"];

before(async () => {
  ({ recordAudit, listAudit } = await import("./dev-control.ts"));
});

test("the audit listing never crosses a tenant boundary", () => {
  recordAudit({ actor: "human", action: "outcome_recorded", reason: "ada@acme.test: hired (perf 4)", workspaceId: "team-acme" });
  recordAudit({ actor: "human", action: "outcome_recorded", reason: "bob@rival.test: rejected", workspaceId: "team-rival" });

  const acme = listAudit(200, "team-acme");
  const reasons = acme.map((a) => a.reason ?? "");
  assert.ok(reasons.some((r) => r.includes("ada@acme.test")), "a tenant reads its OWN outcome rows");
  assert.ok(
    !reasons.some((r) => r.includes("bob@rival.test")),
    "another tenant's candidate ref must never reach this panel"
  );

  const rival = listAudit(200, "team-rival");
  assert.ok(!rival.some((a) => (a.reason ?? "").includes("ada@acme.test")), "and the boundary holds in both directions");
});

test("the kill switch stays deployment-wide — every operator sees a pause", () => {
  recordAudit({ actor: "human", action: "paused", reason: "kill switch engaged", workspaceId: "team-acme" });
  recordAudit({ actor: "human", action: "resumed", workspaceId: "team-acme" });

  for (const ws of ["team-acme", "team-rival"]) {
    const actions = listAudit(200, ws).map((a) => a.action);
    assert.ok(actions.includes("paused"), `${ws} sees the pause: autonomy is one global key`);
    assert.ok(actions.includes("resumed"), `${ws} sees the resume`);
  }
});

test("an unattributed write lands on the default workspace, not on everyone", () => {
  // The orchestrator, the pipeline store and offer-finalize all record without a tenant
  // in hand. Those rows fall back to the default workspace: a single-tenant install's
  // panel is unchanged, and a NEWLY minted tenant starts from an empty log instead of
  // inheriting the deployment's history.
  recordAudit({ lifecycleId: "lc-1", actor: "auto", action: "promoted", reason: "score 82 ≥ floor 70" });
  assert.ok(listAudit(200, "workspace").some((a) => a.action === "promoted"), "the default workspace still reads it");
  assert.ok(!listAudit(200, "team-rival").some((a) => a.action === "promoted"), "a fresh tenant does not inherit it");
});

test("listAudit() with no workspace still returns the whole log (tests + maintenance)", () => {
  const all = listAudit(200).map((a) => a.action);
  assert.ok(all.includes("outcome_recorded") && all.includes("promoted"), "the unscoped read is the maintenance view");
});
