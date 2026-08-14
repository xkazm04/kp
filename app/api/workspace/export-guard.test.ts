// `dumpWorkspace()` reads EVERY table with no workspace filter, and
// `requireOperator()` is deliberately coarse — open mode, or any valid non-demo
// session, passes it; it reads no membership and no role. Under the single-tenant
// lock that pairing is fine. With KP_MULTI_WORKSPACE on it means any signed-in
// member of any team can download every other team's candidates, contacts,
// transcripts, decision records and consent events in one request.
//
// The import route grew a mode-guard for exactly this reason. Export — the
// exfiltration half — did not, which is the asymmetry pinned here. Both route
// files carry a SCOPE NOTE saying they must be reworked before the flag goes on;
// this test is what makes "must" enforceable.
//
// Source-level: both handlers need a request scope the unit runner cannot give
// them, and the contract being pinned is "which guard is present", which the
// source states exactly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const exportSrc = readFileSync(path.join(HERE, "export", "route.ts"), "utf8");
const importSrc = readFileSync(path.join(HERE, "import", "route.ts"), "utf8");

test("both halves of whole-database portability refuse multi-workspace mode", () => {
  for (const [name, src] of [["export", exportSrc], ["import", importSrc]] as const) {
    assert.match(src, /import \{ multiWorkspaceEnabled \} from "@\/app\/_lib\/workspace-lock"/, `${name}: must import the flag`);
    assert.match(src, /if \(multiWorkspaceEnabled\(\)\)\s*\{[\s\S]*?status: 503/, `${name}: must refuse with 503 when the flag is on`);
  }
});

test("the export guard runs before the dump, not after", () => {
  const guard = exportSrc.indexOf("if (multiWorkspaceEnabled())");
  // The CALL, not the import of the same name at the top of the file.
  const dump = exportSrc.indexOf("const payload = dumpWorkspace()");
  assert.ok(guard > 0 && dump > 0, "both the guard and the dump call must be present");
  assert.ok(guard < dump, "refuse BEFORE reading every table into memory");
});

test("the operator gate is kept as well — the mode guard replaces nothing", () => {
  // requireOperator still rejects the anonymous demo session, which the proxy
  // would otherwise accept. The two guards answer different questions.
  assert.match(exportSrc, /const denied = await requireOperator\(\);/);
  const op = exportSrc.indexOf("await requireOperator()");
  const guard = exportSrc.indexOf("if (multiWorkspaceEnabled())");
  assert.ok(op < guard, "authentication is checked before deployment mode");
});
