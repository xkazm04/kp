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
    assert.match(src, /jsonRefusal\("INTAKE_FROZEN", 409\)/, `${name}: freezing must answer 409 with its code`);
  }
});

// EVERY refusal carries a machine code (docs/architecture/api-contracts.md §1.1).
// They were bare English strings, so the card could only render "compose failed"
// — one line for a throttle, a scan that has not landed, a brief nobody has
// filled in and a promoted session, in English, to every locale.
test("no refusal on either route answers with a bare English string", () => {
  for (const [name, src] of [["dossier", dossier], ["compose", compose]] as const) {
    const bare = [...src.matchAll(/NextResponse\.json\(\{\s*error:/g)];
    assert.equal(bare.length, 0, `${name}: ${bare.length} refusal(s) still answer without a code`);
  }
});

test("each route's refusals map to the codes the card resolves", () => {
  for (const code of ["INTAKE_NOT_FOUND", "INTAKE_FROZEN", "INTAKE_NOT_FROM_SCAN", "INTAKE_SCAN_MISMATCH", "INTAKE_DOSSIER_INVALID"]) {
    assert.ok(dossier.includes(`jsonRefusal("${code}"`), `dossier: ${code} is not answered`);
  }
  for (const code of ["INTAKE_NOT_FOUND", "INTAKE_FROZEN", "INTAKE_NOT_APP_MASTER", "INTAKE_SCAN_NOT_LANDED", "INTAKE_BRIEF_EMPTY"]) {
    assert.ok(compose.includes(`jsonRefusal("${code}"`), `compose: ${code} is not answered`);
  }
  // The throttle is the SHARED generic code, not a private one — the card must
  // not need a per-route entry to say "too many requests".
  for (const [name, src] of [["dossier", dossier], ["compose", compose]] as const) {
    assert.match(src, /jsonRefusal\("TOO_MANY_REQUESTS", 429\)/, `${name}: the 429 has no code`);
  }
});

// A compose can hold a Python process for minutes. The runner already accepts an
// AbortSignal; both routes dropped `request.signal`, so a requestor who cancelled
// (or navigated away) left the spawn running and possibly spending.
test("both routes thread the caller's abort signal into the spawn", () => {
  for (const [name, src] of [["dossier", dossier], ["compose", compose]] as const) {
    const call = src.slice(src.lastIndexOf("runIntakeAppMasterSync("));
    assert.match(call, /request\.signal/, `${name}: the spawn cannot be cancelled`);
    // …and an abort is not filed as a store fault.
    assert.match(src, /request\.signal\.aborted/, `${name}: an abort must not be logged as a 500`);
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

// Both writes are computed across a Python spawn that can take minutes, so the
// row version read BEFORE the spawn has to be carried into the UPDATE — an
// unconditional write here silently regresses a value the requestor stated
// during the wait. The behavioral proof is app/_lib/db/intake-app-master-cas.test.ts;
// this pins that the ROUTES actually pass the pre-spawn version and answer the
// refusal with its code rather than swallowing it into a 404.
test("both routes carry the pre-spawn row version into the write", () => {
  for (const [name, src] of [["dossier", dossier], ["compose", compose]] as const) {
    assert.match(src, /expectedUpdatedAt: intake\.updatedAt/, `${name}: the write is not a compare-and-swap`);
    // The version must come from the read that PRECEDED the spawn, never from a
    // fresh read after it (which would re-open the whole window).
    assert.equal(
      (src.match(/getIntake\(id, ws\)/g) ?? []).length,
      1,
      `${name}: a second read after the spawn would defeat the precondition`
    );
    assert.match(src, /write === "moved"/, `${name}: a moved row must be distinguished from a missing one`);
    assert.match(src, /jsonRefusal\("INTAKE_BRIEF_MOVED", 409\)/, `${name}: the refusal needs its code`);
  }
});

// The merged brief is the expensive half of what the spawn produced. Compose
// used to return it and store only the spec, so the client adopted a brief the
// row did not hold and the next reload reverted it.
test("compose persists the merged brief in the same write as the spec", () => {
  assert.match(compose, /updateIntakeAppMaster\(id, compose, ws, \{\s*brief: sync\.brief/);
});

// The shape is an ACT, not a triage: a session created with a scanId is
// app_master from its first row, so a reload can resume a running scan.
test("create route stamps the scan id and opens on the app-master opener", () => {
  assert.match(create, /const scanId = typeof body\.scanId === "string"/);
  assert.match(create, /createIntake\(\{[^}]*scanId \}/);
  assert.match(create, /runIntakeOpening\(lang, scanId \? "app_master" : undefined\)/);
});
