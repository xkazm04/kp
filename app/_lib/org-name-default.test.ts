import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { companyOrDefault, DEFAULT_ORG_NAME, pickOrgName } from "./org-settings.ts";

// A role created with its company field blank used to be stored with NO company,
// so the apply page a candidate opened named nobody — even though the owner had
// named their company in the first-run wizard. Every server door that creates a
// role a candidate can apply to now fills a blank company from the org name
// (org-name-server.ts `effectiveOrgName`), never over one the user typed.

test("the org name: the browser's cookie, then the brand's display name, then the seed gate", () => {
  assert.equal(pickOrgName("Acme%20Studio", "Brand Co", true), "Acme Studio", "the stored name wins");
  assert.equal(pickOrgName(null, "  Brand   Co ", true), "Brand Co", "another browser still sees the brand row");
  assert.equal(pickOrgName("", null, true), DEFAULT_ORG_NAME, "the seeded demo falls back to its company");
  assert.equal(pickOrgName(undefined, "", false), "", "an unseeded, unnamed install names nobody");
});

test("a typed company always wins; only a blank one takes the org name", () => {
  assert.equal(companyOrDefault("Typed s.r.o.", "Acme"), "Typed s.r.o.");
  assert.equal(companyOrDefault("   ", "Acme"), "Acme");
  assert.equal(companyOrDefault(undefined, "Acme"), "Acme");
  assert.equal(companyOrDefault(null, "Acme"), "Acme");
  assert.equal(companyOrDefault(42, "Acme"), "Acme", "a non-string from an untrusted body is blank");
  assert.equal(companyOrDefault("", ""), undefined, "nameless stays NULL, never an empty string");
});

// Source pin: every request door that writes a candidate-applicable role (insertJob,
// ingestStructuredJob, or a detached jd_build whose ingest writes one) resolves the
// org name IN the request — a detached build has no cookie to read.
const ROOT = path.resolve(import.meta.dirname, "../..");
const DOORS = [
  "app/api/jobs/ingest/route.ts",
  "app/api/jds/save/route.ts",
  "app/api/jds/generate/route.ts",
  "app/api/jds/[slug]/route.ts",
  "app/api/jds/[slug]/ingest-job/route.ts",
  "app/api/jds/[slug]/revisions/route.ts",
  "app/api/jds/[slug]/retry-analysis/route.ts",
  "app/api/intake/[id]/promote/route.ts",
  "app/_lib/companion-actions.ts",
];

for (const rel of DOORS) {
  test(`${rel} fills a blank company from the org name`, () => {
    const src = readFileSync(path.join(ROOT, rel), "utf8");
    assert.match(src, /effectiveOrgName\(\)/, `${rel} must resolve the org name for a blank company`);
  });
}
