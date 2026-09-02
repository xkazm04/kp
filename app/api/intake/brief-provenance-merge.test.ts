// Source guard for the ONE thing the pure tests in app/_lib/brief-edit.test.ts
// cannot see: that the PATCH door actually hands the STORED brief to the
// sanitizer. The provenance rule is only worth anything if the route feeds it
// the record — `sanitizeEditedBrief(body.brief)` with no basis was exactly the
// hole (an unattributed payload used to stamp every row "stated"), and it is a
// one-argument call away from coming back.
//
// Source-guard style (mirrors attachments-guard.test.ts / voice-close-guard
// .test.ts): node:test cannot resolve the "@/" alias, so the route is asserted
// over its source text.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const route = read("./[id]/brief/route.ts");
const briefEdit = read("../../_lib/brief-edit.ts");

test("PATCH resolves provenance against the stored brief, not the payload alone", () => {
  assert.match(route, /import \{ sanitizeEditedBrief \} from "@\/app\/_lib\/brief-edit"/);
  assert.match(
    route,
    /sanitizeEditedBrief\(body\.brief, intake\.brief\)/,
    "the stored brief is the merge basis — a one-argument call is the old hole"
  );
  // The basis has to come from the workspace-scoped read of THIS intake.
  assert.match(route, /const intake = getIntake\(id, ws\)/);
});

test("the sanitizer's basis parameter is required, so no caller can drop it", () => {
  const signature = /export function sanitizeEditedBrief\(([^)]*)\)/.exec(briefEdit)?.[1] ?? "";
  assert.match(signature, /original: RoleBrief \| null/, "the stored brief is a parameter, not an assumption");
  assert.ok(
    !/original\s*:\s*RoleBrief \| null\s*=/.test(signature),
    "a default would silently restore the unattributed-payload hole for the next caller"
  );
});

test("PATCH reads and writes the brief with nothing awaited in between", () => {
  // read -> compute -> write over one row. The body parse used to sit between
  // the read and the write, which is a yield the store cannot compensate for
  // (updateIntakeBrief replaces brief_json wholesale).
  assert.ok(route.indexOf("await request.json()") < route.indexOf("getIntake(id, ws)"));
  const window = route.slice(route.indexOf("getIntake(id, ws)"), route.indexOf("updateIntakeBrief("));
  assert.ok(window.length > 0, "the read must precede the write");
  assert.ok(!/\bawait\b/.test(window), "an await between the read and the write loses the merge basis");
});

test("PATCH still freezes a promoted session and still writes brief_json only", () => {
  assert.ok(route.indexOf("await requireOperator()") < route.indexOf("request.json"));
  assert.match(route, /intake\.status === "promoted"/);
  const freezeAt = route.indexOf('intake.status === "promoted"');
  // The freeze answers through the refusal chokepoint now (a CODE, not prose),
  // so the status rides in the jsonRefusal call rather than a NextResponse init.
  assert.match(route.slice(freezeAt, freezeAt + 200), /jsonRefusal\("INTAKE_FROZEN", 409\)/);
  // The only store call is the brief writer — an edit never rewrites the
  // dialog record (updateIntakeTranscript and friends have no business here).
  assert.deepEqual([...route.matchAll(/\b(update|append)[A-Za-z]*Intake[A-Za-z]*\(/g)].map((m) => m[0]), [
    "updateIntakeBrief(",
  ]);
});
