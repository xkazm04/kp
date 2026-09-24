#!/usr/bin/env node
// KPI meter — Analytics & Reporting API error-response hygiene.
//
// Counts how many handlers in the Analytics & Reporting group's API surface still
// hand a RAW thrown error's own message to the client — the information-disclosure /
// un-localizable-error debt that docs/architecture/api-contracts.md §1.1 forbids and
// app/api/error-response-contract.test.ts ratchets repo-wide. This meter is the slice
// of that ratchet owned by ONE bare context group, so the group carries a movable
// number toward 0 rather than relying on the repo-wide gate (which only prevents the
// count from GROWING; it never drives it down).
//
// Source of truth: the LEAK_CEILING + FORWARD_CEILING maps declared in
// app/api/error-response-contract.test.ts. Those maps are keyed by route file
// (relative to app/api/) and each row's value is the declared offender count for that
// file; the ratchet test asserts the actual count never exceeds the ceiling and flags
// any file that dropped below it, so the ceiling sum is the group's declared debt and
// a fix that lands DELETES the row (sum drops).
//
// The measurement: sum the ceiling values for the route files this group owns.
// Keyless, node-only, deterministic, from the repo root:
//     node scripts/kpi/analytics-error-hygiene.mjs
// stdout is ONLY the integer debt count (target 0); stderr carries the breakdown.
import { readFileSync } from "node:fs";

// The Analytics & Reporting group's API route surface (app/api/-relative), as mapped
// in the project context map. A leak in any of these is this group's to answer.
const ANALYTICS_ROUTES = new Set([
  "analytics/route.ts",
  "analytics/decisions/route.ts",
  "analytics/spend/route.ts",
  "analytics/targets/route.ts",
  "analytics/calibration/route.ts",
  "analytics/calibration/band/route.ts",
  "analytics/calibration/threshold-history/route.ts",
  "analytics/calibration/apply-threshold/route.ts",
  "benchmarks/route.ts",
  "benchmarks/salary/route.ts",
  "match/route.ts",
  "match/reasoning/route.ts",
  "matrix/route.ts",
  "profile/route.ts",
  "profile/candidates/route.ts",
  "profile/draft/route.ts",
]);

const CONTRACT = "app/api/error-response-contract.test.ts";
const src = readFileSync(CONTRACT, "utf8");

// The two ceiling maps sit between `const LEAK_CEILING` and the first test(); every
// row is `["<route>.ts", <n>]` on its own line (interspersed comments are ignored by
// the per-line match). This captures both LEAK_CEILING and FORWARD_CEILING.
const start = src.indexOf("const LEAK_CEILING");
const end = src.indexOf('test("no NEW route');
if (start < 0 || end < 0) {
  process.stderr.write(`could not locate the ceiling maps in ${CONTRACT}\n`);
  process.exit(2);
}
const block = src.slice(start, end);
const rows = [...block.matchAll(/^\s*\["([^"]+\.ts)",\s*(\d+)\]/gm)];

let total = 0;
const hits = [];
for (const m of rows) {
  const file = m[1];
  const n = Number(m[2]);
  if (ANALYTICS_ROUTES.has(file)) {
    total += n;
    hits.push(`${file} (${n})`);
  }
}

process.stderr.write(
  `Analytics & Reporting API error-response debt = ${total} across ${hits.length} route file(s)\n` +
    hits.map((h) => `  - ${h}`).join("\n") +
    `\n(source: ${CONTRACT} LEAK_CEILING+FORWARD_CEILING; target 0 = every analytics handler answers safeJsonError + a STORE_ERRORS code)\n`,
);
process.stdout.write(String(total) + "\n");
