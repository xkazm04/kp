// Source guard for the two App-master routes' trust boundaries
// (docs/features/app-master/README.md, P3). Mirrors the house source-guard
// style (attachments-guard.test.ts / rate-limit-contract.test.ts), since
// node:test cannot resolve the "@/" alias to import the handlers themselves.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dossier = readFileSync(fileURLToPath(new URL("./[id]/dossier/route.ts", import.meta.url)), "utf8");
const compose = readFileSync(fileURLToPath(new URL("./[id]/compose-app-master/route.ts", import.meta.url)), "utf8");
const create = readFileSync(fileURLToPath(new URL("./route.ts", import.meta.url)), "utf8");

test("both App-master routes gate on the operator before any work", () => {
  for (const [name, src] of [["dossier", dossier], ["compose", compose]] as const) {
    const gate = src.indexOf("await requireOperator()");
    assert.ok(gate >= 0, `${name}: no operator gate`);
    const body = src.indexOf("request.json");
    // compose takes no body at all — its inputs are already on the row.
    if (body >= 0) assert.ok(gate < body, `${name}: gate must precede body parsing`);
  }
});

test("both routes are workspace-scoped point reads", () => {
  for (const [name, src] of [["dossier", dossier], ["compose", compose]] as const) {
    assert.match(src, /const ws = await currentWorkspace\(\)/, `${name}: no workspace`);
    assert.match(src, /getIntake\(id, ws\)/, `${name}: read is not workspace-scoped`);
  }
});

// The client carries the dossier (P2's scan store is not this module's to reach
// into), so the payload must be clamped at the boundary AND bound to the scan
// THIS intake was created from — otherwise another session's scan output could
// be posted onto this brief.
test("dossier route validates the payload and pins it to the intake's own scan", () => {
  assert.match(dossier, /repoDossierSchema\.safeParse\(body\.dossier\)/);
  assert.match(dossier, /body\.scanId\.trim\(\) !== intake\.scanId/);
  assert.ok(
    dossier.indexOf("repoDossierSchema.safeParse") < dossier.lastIndexOf("runIntakeAppMasterSync("),
    "the payload must be parsed BEFORE any spawn"
  );
});

test("dossier route refuses a session that was not started from a scan", () => {
  assert.match(dossier, /if \(!intake\.scanId\)/);
});

test("compose route refuses the wrong shape, a missing dossier and an empty brief", () => {
  assert.match(compose, /intake\.shape !== "app_master"/);
  assert.match(compose, /if \(!intake\.dossier\)/);
  assert.match(compose, /if \(!intake\.brief\)/);
});

test("compose route composes the spec with the PURE function, never a model", () => {
  assert.match(compose, /briefToAppMasterSpec\(sync\.brief, intake\.dossier\)/);
  // The spec is validated by appMasterSpecSchema inside briefToAppMasterSpec —
  // the route must not hand-build one beside it.
  assert.ok(!/schemaVersion:\s*1/.test(compose), "the route must not assemble a spec itself");
});

test("both routes freeze a promoted session", () => {
  for (const [name, src] of [["dossier", dossier], ["compose", compose]] as const) {
    assert.match(src, /status === "promoted"/, `${name}: promoted sessions must be frozen`);
    assert.match(src, /status: 409/, `${name}: freezing must answer 409`);
  }
});

// Both routes spawn Python and can spend on the agent_fit use case, so both
// self-limit — after the cheap refusals, before the spawn.
test("both routes rate-limit before spending", () => {
  for (const [name, src, key] of [
    ["dossier", dossier, "intake-dossier:"],
    ["compose", compose, "intake-compose:"],
  ] as const) {
    assert.ok(src.includes(key), `${name}: no limiter key`);
    // lastIndexOf: the first occurrence of the runner's name is its import.
    assert.ok(
      src.indexOf("rateLimit(") < src.lastIndexOf("runIntakeAppMasterSync("),
      `${name}: the limiter must precede the spawn`
    );
    assert.ok(
      src.indexOf("getIntake(id, ws)") < src.indexOf("rateLimit("),
      `${name}: the cheap 404 must precede the limiter`
    );
  }
});

// The shape is an ACT, not a triage: a session created with a scanId is
// app_master from its first row, so a reload can resume a running scan.
test("create route stamps the scan id and opens on the app-master opener", () => {
  assert.match(create, /const scanId = typeof body\.scanId === "string"/);
  assert.match(create, /createIntake\(\{[^}]*scanId \}/);
  assert.match(create, /runIntakeOpening\(lang, scanId \? "app_master" : undefined\)/);
});
