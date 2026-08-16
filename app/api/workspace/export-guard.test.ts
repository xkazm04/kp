// The scope guard on both halves of portability.
//
// HISTORY, because it explains the shape of these assertions: both routes used to
// move the WHOLE DATABASE. `dumpWorkspace()` read every table with no predicate and
// `loadWorkspace()` DROPped and recreated every table in the file — safe only under
// the single-tenant lock, so both routes carried a hard 503 refusal once
// KP_MULTI_WORKSPACE was on, and this test existed to make "must be reworked before
// the flag goes on" enforceable. The rework landed: the pair is now org-scoped
// (`dumpOrg` / `restoreOrg`, driven by the tenancy manifest, DELETE-by-scope instead
// of DROP), so the 503 is gone and what needs pinning is the replacement.
//
// Three things must stay true, and each is a real leak if it stops being true:
//   1. Neither route reaches for the whole-DB engine again.
//   2. Both are gated by org:manage, not just by "some valid session" —
//      requireOperator is deliberately coarse (it reads no membership and no role),
//      so on a multi-workspace deployment it alone would let any signed-in member
//      download every team's candidates, contacts and transcripts.
//   3. The import restores into the CALLER'S org, never the org named by the file.
//
// Source-level: both handlers need a request scope the unit runner cannot give them,
// and the contract being pinned is "which guard is present, and in what order",
// which the source states exactly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const exportSrc = readFileSync(path.join(HERE, "export", "route.ts"), "utf8");
const importSrc = readFileSync(path.join(HERE, "import", "route.ts"), "utf8");

test("neither route touches the whole-database engine", () => {
  for (const [name, src] of [["export", exportSrc], ["import", importSrc]] as const) {
    assert.doesNotMatch(src, /\bdumpWorkspace\b/, `${name}: dumpWorkspace reads every tenant's rows`);
    assert.doesNotMatch(src, /\bloadWorkspace\b/, `${name}: loadWorkspace DROPs tables other tenants share`);
    assert.doesNotMatch(src, /\bplanImport\b/, `${name}: the whole-DB planner reports a whole-DB scope`);
  }
});

test("both halves are gated by org:manage, and the gate runs before the work", () => {
  for (const [name, src, work] of [
    ["export", exportSrc, "dumpOrg("],
    ["import", importSrc, "planOrgRestore("],
  ] as const) {
    // requireOperator is kept as the authentication half: it rejects the anonymous
    // demo session, which the proxy would otherwise accept. The two gates answer
    // different questions and neither replaces the other.
    const op = src.indexOf("await requireOperator()");
    const cap = src.indexOf('await requireOrgCapability("org:manage")');
    const at = src.indexOf(work);
    assert.ok(op > 0, `${name}: must keep the authentication gate`);
    assert.ok(cap > 0, `${name}: must require org:manage — a recruiter does not back up the company`);
    assert.ok(at > 0, `${name}: must call the org-scoped engine`);
    assert.ok(op < cap, `${name}: authenticate before authorizing`);
    assert.ok(cap < at, `${name}: refuse BEFORE reading the organization into memory`);
  }
});

test("the export scopes the dump to the CALLER'S org, resolved server-side", () => {
  // The org must come from the session, never from a query string or body — a
  // client-supplied org id turns this endpoint into cross-tenant exfiltration.
  assert.match(exportSrc, /const orgId = \(await currentUser\(\)\)\.orgId \?\? DEFAULT_ORG_ID/);
  assert.match(exportSrc, /dumpOrg\(orgId\)/, "the dump is scoped by that org");
});

test("the import restores into the caller's own org and refuses a foreign backup", () => {
  assert.match(importSrc, /const orgId = \(await currentUser\(\)\)\.orgId \?\? DEFAULT_ORG_ID/);
  assert.match(importSrc, /coerced\.payload\.orgId !== orgId/, "a file naming another org is refused");
  // …and refused BEFORE the plan runs, so a foreign file cannot even be surveyed.
  const refusal = importSrc.indexOf("coerced.payload.orgId !== orgId");
  const plan = importSrc.indexOf("planOrgRestore(");
  assert.ok(refusal > 0 && plan > refusal, "the org check precedes the dry run");
  // Both restore calls take the SERVER's org id, never the payload's.
  assert.match(importSrc, /restoreOrg\(coerced\.payload, orgId\)/);
  assert.doesNotMatch(importSrc, /restoreOrg\([^)]*payload\.orgId/);
});

test("writing needs an explicit apply, and destroying needs an explicit replace", () => {
  // The dry run is the default: no `apply` ⇒ the plan comes back and nothing is
  // written. And when the restore would delete rows, that has to be confirmed on
  // its own — "12 tables" must never stand in for "4,000 rows are about to go".
  assert.match(importSrc, /if \(!body\.apply\) return NextResponse\.json\(\{ plan \}\)/);
  assert.match(importSrc, /plan\.totalExisting > 0 && !body\.replace/);
  const guard = importSrc.indexOf("plan.totalExisting > 0 && !body.replace");
  const restore = importSrc.indexOf("restoreOrg(coerced.payload, orgId)");
  assert.ok(guard > 0 && restore > guard, "the replace confirmation precedes the write");
});
