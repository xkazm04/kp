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

type Ctl = typeof import("./dev-control.ts");
let recordAudit: Ctl["recordAudit"];
let listAudit: Ctl["listAudit"];
let getAutonomy: Ctl["getAutonomy"];
let setAutonomy: Ctl["setAutonomy"];
let getPromoteFloor: Ctl["getPromoteFloor"];
let setPromoteFloor: Ctl["setPromoteFloor"];

before(async () => {
  ({ recordAudit, listAudit, getAutonomy, setAutonomy, getPromoteFloor, setPromoteFloor } = await import("./dev-control.ts"));
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

// ── The dev_control key surface (/perfect wave 28) ───────────────────────────
//
// `dev_control` is two global keys, and both are consequential: `autonomy` is the KILL
// SWITCH the orchestrator reads before auto-advancing anything, and `promote_floor` is
// the threshold every future auto-decision is judged against — the number the control
// room's "Apply suggested → N" button writes. Until now neither had a single test:
// `setPromoteFloor` did not appear in one file under app/. These pin the round trip and
// the two ways a bad value could otherwise become policy.

test("the kill switch round-trips, and an unset store reads as running", () => {
  // Unset must mean "on": a fresh install that failed closed would silently never
  // auto-advance, and the operator would see a paused pipeline they never paused.
  assert.equal(getAutonomy(), "on");
  setAutonomy("paused");
  assert.equal(getAutonomy(), "paused");
  setAutonomy("on");
  assert.equal(getAutonomy(), "on", "the switch is a switch — resuming must actually resume");
});

test("an unset promote floor is null, never a fabricated number", () => {
  // null is how the orchestrator knows to fall back to its DEV_POLICY default. A 0 here
  // would read as "promote everyone" — the opposite of an unset threshold.
  assert.equal(getPromoteFloor(), null);
});

test("the promote floor is clamped into 0..100 and rounded", () => {
  for (const [given, stored] of [
    [55, 55],
    [0, 0],
    [100, 100],
    [-20, 0], // below the scale: the floor cannot mean "less than nothing"
    [140, 100], // above it: nor "more than a perfect score", which would promote no one
    [72.6, 73], // the column is an integer scale; a fraction is not a finer threshold
  ] as const) {
    setPromoteFloor(given);
    assert.equal(getPromoteFloor(), stored, `setPromoteFloor(${given})`);
  }
});

test("a non-finite promote floor is refused, not stringified into the store", () => {
  setPromoteFloor(64);
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => setPromoteFloor(bad), /finite/);
  }
  // The real damage was silent, not the throw: "NaN" persisted, read back as null on the
  // next boot, and the orchestrator quietly reverted to its default floor — a policy
  // change nobody made and nobody could see. The stored value must be untouched.
  assert.equal(getPromoteFloor(), 64, "a refused write leaves the live threshold exactly as it was");
});
