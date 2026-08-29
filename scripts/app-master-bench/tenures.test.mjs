// Tenure files — the handles of the ONE App master a repo keeps.
//
//   node --test scripts/app-master-bench/
//
// What these are really about: a tenure file is the only thing standing between
// "the preamble is paid once per repo" and "every run mints another persona"
// (31 sweeps, 100+ personas, no C1 reading — c1-exam §0). So a handle that does
// not resolve has to fail LOUDLY at load, and a directory nobody has hired into
// has to read as empty rather than as a crash.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  fleetAudit,
  humanAge,
  listTenureFiles,
  loadTenureFile,
  orphanReport,
  readAllTenures,
  resolveTenurePath,
  tenureNameFor,
  tenureRepoLabel,
  validateTenure,
  writeTenureFile,
} from "./tenures.mjs";

const VALID = {
  repo: "kp",
  hiredAgentId: "agt_1",
  personaId: "p_1",
  requestId: "req_1",
  hiredAt: "2026-08-29T10:00:00.000Z",
  rung: 0,
  probationDays: 30,
};

const dir = () => mkdtempSync(path.join(tmpdir(), "kp-tenures-"));

test("a well-formed tenure validates and normalises", () => {
  const { ok, tenure, errors } = validateTenure({ ...VALID }, { name: "kp-owner" });
  assert.equal(ok, true, errors.join("; "));
  assert.equal(tenure.name, "kp-owner");
  assert.equal(tenure.hiredAgentId, "agt_1");
  assert.equal(tenure.rung, 0, "rung 0 is a rung, not a missing one");
  assert.equal(tenure.probationDays, 30);
});

test("the two handles the loop cannot run without are required, and every problem is reported at once", () => {
  const { ok, errors } = validateTenure({ rung: 7, probationDays: 0 });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("hiredAgentId")), errors.join(" | "));
  assert.ok(errors.some((e) => e.includes("personaId")), errors.join(" | "));
  assert.ok(errors.some((e) => e.includes("repo is required")), errors.join(" | "));
  assert.ok(errors.some((e) => e.includes("rung must be")), errors.join(" | "));
  assert.ok(errors.some((e) => e.includes("probationDays")), errors.join(" | "));
});

test("an absent optional field stays null — a tenure never invents what it was not told", () => {
  const { ok, tenure } = validateTenure({ repo: "kp", hiredAgentId: "a", personaId: "p" });
  assert.equal(ok, true);
  assert.equal(tenure.requestId, null);
  assert.equal(tenure.hiredAt, null);
  assert.equal(tenure.rung, null, "an unrecorded rung is not rung 0");
  assert.equal(tenure.probationDays, null);
});

test("the tenure name follows the REPO, not the scenario that hired it", () => {
  assert.equal(tenureRepoLabel({ name: "kp-default", repo: { rootPath: "C:/Users/x/kiro/kp" } }), "kp");
  assert.equal(tenureNameFor({ name: "kp-default", repo: { rootPath: "/home/me/kp/" } }), "kp-owner");
  assert.equal(tenureNameFor({ name: "personas-self", repo: { rootPath: "/home/me/personas" } }), "personas-owner");
  assert.equal(tenureNameFor({ name: "x", repo: { url: "https://github.com/xkazm04/kp.git" } }), "kp-owner");
  assert.equal(tenureNameFor({ name: "nameless" }), "nameless-owner", "with no repo target the scenario name is the fallback");
});

test("resolveTenurePath takes a bare name, a file name or a path", () => {
  assert.equal(path.basename(resolveTenurePath("kp-owner")), "kp-owner.json");
  assert.equal(path.basename(resolveTenurePath("kp-owner.json")), "kp-owner.json");
  assert.equal(resolveTenurePath("./some/where/t.json"), path.resolve("./some/where/t.json"));
});

test("a written tenure loads back identically, and an invalid one is never written", () => {
  const d = dir();
  const file = path.join(d, "kp-owner.json");
  writeTenureFile(file, VALID);
  const back = loadTenureFile(file);
  assert.equal(back.hiredAgentId, "agt_1");
  assert.equal(back.personaId, "p_1");
  assert.equal(back.file, file);
  assert.throws(
    () => writeTenureFile(path.join(d, "broken.json"), { repo: "kp", hiredAgentId: "a" }),
    /personaId is required/,
    "a tenure with no personaId is a handle no tick can be scoped by"
  );
});

test("a corrupt tenure file fails at LOAD, naming itself", () => {
  const d = dir();
  const file = path.join(d, "bad.json");
  writeFileSync(file, "{ not json", "utf8");
  assert.throws(() => loadTenureFile(file), /tenure bad: not readable JSON/);
});

test("a directory nobody has hired into reads empty, never throws", () => {
  assert.deepEqual(listTenureFiles(path.join(tmpdir(), "kp-tenures-does-not-exist")), []);
  const { tenures, problems } = readAllTenures(path.join(tmpdir(), "kp-tenures-does-not-exist"));
  assert.deepEqual(tenures, []);
  assert.deepEqual(problems, []);
});

test("readAllTenures keeps a broken file as a PROBLEM instead of losing the whole audit", () => {
  const d = dir();
  writeTenureFile(path.join(d, "kp-owner.json"), VALID);
  writeFileSync(path.join(d, "wrecked.json"), "{ not json", "utf8");
  const { tenures, problems } = readAllTenures(d);
  assert.equal(tenures.length, 1, "the readable tenure is still read");
  assert.equal(problems.length, 1);
  assert.match(problems[0].error, /not readable JSON/);
});

// ─── the fleet audit (c1-exam §4) ───────────────────────────────────────────
//
// The guard that turns "100+ agents" into a red preflight the next time it
// starts happening: every LIVE hired agent kp holds, against the tenure files
// on disk. Nothing else in the loop ever notices an agent nobody will retire.

const agent = (over = {}) => ({
  id: "agt_x",
  personaId: "p_x",
  personaName: "App master",
  status: "active",
  createdAt: "2026-08-25T10:00:00.000Z",
  ...over,
});
const NOW = Date.parse("2026-08-29T10:00:00.000Z");

test("an agent no tenure file names is an ORPHAN, with its age", () => {
  const audit = fleetAudit([agent({ id: "agt_1", personaId: "p_1" })], [], { now: NOW });
  assert.equal(audit.live, 1);
  assert.equal(audit.orphans.length, 1);
  assert.equal(audit.orphans[0].id, "agt_1");
  assert.equal(audit.orphans[0].ageMs, 4 * 24 * 3_600_000);
  assert.equal(audit.orphans[0].age, "4d 00h");
});

test("a tenured agent is not an orphan — by either handle", () => {
  const tenures = [{ hiredAgentId: "agt_1", personaId: "p_1" }];
  const byAgent = fleetAudit([agent({ id: "agt_1", personaId: "p_OTHER" })], tenures, { now: NOW });
  assert.deepEqual(byAgent.orphans, [], "the tenure's hiredAgentId claims the row");
  // A re-dispatch can leave the two out of step; an audit that cried orphan
  // over that would be ignored within a week.
  const byPersona = fleetAudit([agent({ id: "agt_OTHER", personaId: "p_1" })], tenures, { now: NOW });
  assert.deepEqual(byPersona.orphans, [], "the tenure's personaId claims it too");
});

test("a finished hire is not an orphan — it is the evidence a teardown worked", () => {
  const rows = ["retired", "rejected", "failed"].map((status, i) => agent({ id: `agt_${i}`, status }));
  const audit = fleetAudit([...rows, agent({ id: "agt_live" })], [], { now: NOW });
  assert.equal(audit.rostered, 4);
  assert.equal(audit.live, 1, "only the live statuses are audited");
  assert.deepEqual(audit.orphans.map((o) => o.id), ["agt_live"]);
});

test("orphans come back oldest first, and an unknown createdAt is an unknown age", () => {
  const audit = fleetAudit(
    [
      agent({ id: "young", createdAt: "2026-08-29T09:00:00.000Z" }),
      agent({ id: "old", createdAt: "2026-08-01T10:00:00.000Z" }),
      agent({ id: "undated", createdAt: null }),
    ],
    [],
    { now: NOW }
  );
  assert.deepEqual(audit.orphans.map((o) => o.id), ["old", "young", "undated"]);
  assert.equal(audit.orphans[2].ageMs, null, "an unparseable createdAt is not an age of zero");
  assert.equal(audit.orphans[2].age, "–");
  assert.equal(audit.orphans[0].age, "28d 00h");
  assert.equal(audit.orphans[1].age, "1h 00m");
});

test("an empty roster audits clean, and a non-array one does not throw", () => {
  assert.deepEqual(fleetAudit([], [], { now: NOW }).orphans, []);
  const nothing = fleetAudit(null, null, { now: NOW });
  assert.deepEqual(nothing, { rostered: 0, live: 0, tenures: 0, orphans: [] });
});

test("the orphan line names each one, its status and its age — one string, three destinations", () => {
  const audit = fleetAudit([agent({ id: "agt_1", personaId: "p_1", status: "onboarding" })], [], { now: NOW });
  const line = orphanReport(audit);
  assert.match(line, /1 of 1 live hired agent/);
  assert.match(line, /agt_1 \/ p_1 \(onboarding, 4d 00h old\)/);
});

test("humanAge reads at the resolution a human does, and never invents one", () => {
  assert.equal(humanAge(null), "–");
  assert.equal(humanAge(Number.NaN), "–");
  assert.equal(humanAge(44_000), "44s");
  assert.equal(humanAge(12 * 60_000), "12m");
  assert.equal(humanAge(6 * 3_600_000 + 12 * 60_000), "6h 12m");
  assert.equal(humanAge(4 * 24 * 3_600_000 + 6 * 3_600_000), "4d 06h");
});
