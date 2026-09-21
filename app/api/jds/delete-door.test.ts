import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { canDeleteJd } from "../../_lib/jds-delete-rule.ts";

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

// The JD delete door: "accessible only for the user who created the description or
// any admin", and never for a live role. The RULE half is pure and driven directly;
// the WIRING half is a source guard, because these route modules import through the
// "@/..." alias and pull in next/server, which the bare runner cannot execute.

// ---- The rule ---------------------------------------------------------------

test("an admin may delete anything, including an unattributed row", () => {
  const admin = { userId: "u-admin", isAdmin: true };
  assert.equal(canDeleteJd(admin, "someone-else"), true);
  assert.equal(canDeleteJd(admin, null), true);
});

test("a non-admin may delete only their OWN description", () => {
  const me = { userId: "u-me", isAdmin: false };
  assert.equal(canDeleteJd(me, "u-me"), true);
  assert.equal(canDeleteJd(me, "u-other"), false);
});

test("a NULL creator claim matches nobody — never everybody", () => {
  // The fail-closed direction, and the one a `createdBy === actor.userId` written
  // without the guards would get backwards: a legacy row (NULL) read against an
  // identity-less session (null userId) is null === null, i.e. every recruiter on
  // the team could delete every pre-migration draft.
  assert.equal(canDeleteJd({ userId: "u-me", isAdmin: false }, null), false);
  assert.equal(canDeleteJd({ userId: null, isAdmin: false }, null), false);
  assert.equal(canDeleteJd({ userId: null, isAdmin: false }, "u-someone"), false);
});

// ---- The wiring -------------------------------------------------------------

test("DELETE /api/jds/[slug] gates, then checks authority, then checks liveness", () => {
  const src = read("./[slug]/route.ts");
  const at = src.indexOf("export async function DELETE");
  assert.ok(at >= 0, "the route must export a DELETE handler");
  const body = src.slice(at);

  assert.match(body, /const\s+denied\s*=\s*await\s+requireOperator\(\)/, "DELETE must apply the shared operator gate");
  assert.match(body, /requireCapabilityCoded\("pipeline:write"/, "DELETE must ask the seat for the write capability");

  const authorityAt = body.search(/canDeleteJd\(/);
  const liveAt = body.search(/isJobOpenForApplications\(/);
  const deleteAt = body.search(/deleteJd\(/);
  assert.ok(authorityAt > 0, "DELETE must resolve authority through the shared rule, not re-derive it");
  assert.ok(liveAt > 0, "DELETE must read liveness from the job lifecycle authority");
  assert.ok(deleteAt > authorityAt && deleteAt > liveAt, "both checks must precede the store write");

  assert.match(body, /jsonRefusal\("JD_DELETE_FORBIDDEN",\s*403\)/, "the authority refusal is a coded 403");
  assert.match(body, /jsonRefusal\("JD_LIVE_CANNOT_DELETE",\s*409\)/, "the liveness refusal is a coded 409");
  assert.match(body, /safeJsonError\(error,\s*"api:jds\/\[slug\]",\s*"JD_DELETE_FAILED"\)/, "store failures answer with a code");
});

test("the delete codes exist in the shared registries", () => {
  const src = read("../../_lib/api-response.ts");
  assert.match(src, /JD_DELETE_FAILED:/, "STORE_ERRORS must carry the generic delete failure");
  assert.match(src, /JD_LIVE_CANNOT_DELETE:/, "REFUSAL_ERRORS must carry the live-role refusal");
  assert.match(src, /JD_DELETE_FORBIDDEN:/, "REFUSAL_ERRORS must carry the authority refusal");
});

test("GET /api/jds carries canDelete per row and does NOT leak the author id", () => {
  const src = read("./route.ts");
  assert.match(src, /canDelete:\s*canDeleteJd\(actor,\s*created_by\)/, "the list must fold the SAME rule the door enforces");
  // The fold's whole point: the identity stays server-side. The row is destructured
  // so `created_by` cannot ride the spread onto the wire.
  assert.match(src, /const\s*\{\s*created_by,\s*\.\.\.listRow\s*\}\s*=\s*row/, "created_by must be stripped from the payload");
  assert.doesNotMatch(src, /\.\.\.row,/, "the raw store row must not be spread into the response");
});

test("GET /api/jds/[slug] strips the author id from the detail payload too", () => {
  const src = read("./[slug]/route.ts");
  assert.match(src, /\.\.\.rest,\s*created_by:\s*undefined/, "the detail payload must blank the author id");
});

test("the ledger row shows the trash icon only when the server said so AND the role is not live", () => {
  const src = readFileSync(fileURLToPath(new URL("../../features/library/jds/JdsLedgerRow.tsx", import.meta.url)), "utf8");
  assert.match(
    src,
    /row\.canDelete\s*&&\s*statusCategory\(row\)\s*!==\s*"live"\s*\?\s*<RowDelete/,
    "both conditions must gate the icon — a live row never offers a delete",
  );
});
