// The company step of the first-run checklist — the one step that was not
// tenant-scoped.
//
// `companyStep` used to be `own-cookie OR getBrand()`, and both halves are shared
// state on a multi-tenant install: `brand_settings` is a SINGLETON (one row, fixed id
// — brand-store.ts), so the first tenant to set a display name, accent or logo ticked
// this step for every other tenant on the box; and `kp_org_name` is the CALLER'S OWN
// cookie, so one tenant read a tick or a blank depending on which browser they opened.
// The checklist's whole promise is that "every mark reflects a real workspace fact"
// (setupGettingStartedModel.ts), and this mark reflected another tenant's fact.
//
// Pure function, no DB: computeGettingStarted feeds it the org row, the brand and the
// cookie so the branch itself is testable without a request.
//   node scripts/run-unit-tests.mjs "app/_lib/getting-started.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { companyStep } from "./getting-started.ts";
import { DEFAULT_ORG_NAME } from "./org-settings.ts";

const NO_BRAND = { displayName: null, accentColor: null, logoUrl: null };
const BRANDED = { displayName: "Rival Corp", accentColor: null, logoUrl: null };

test("an org that named itself completes the step from its OWN row", () => {
  const step = companyStep(null, NO_BRAND, { name: "Moravia Steel" });
  assert.equal(step.company, true);
  assert.equal(step.companySignal, "org", "the answer came from the tenant, so say so");
});

test("a tenant does NOT inherit the tick from another tenant's brand row", () => {
  // The regression: same deployment-wide brand, an org that has not named itself.
  // This used to answer true, and the reason was a row belonging to someone else.
  const step = companyStep(null, BRANDED, { name: DEFAULT_ORG_NAME });
  assert.equal(step.company, false, "the brand singleton is not this org's evidence");
  assert.equal(step.companySignal, "org");
});

test("the placeholder name createOrganization writes is not an answer", () => {
  assert.equal(companyStep(null, NO_BRAND, { name: "Untitled organization" }).company, false);
  assert.equal(companyStep(null, NO_BRAND, { name: "   " }).company, false);
});

test("the caller's own cookie cannot tick the step for an org either", () => {
  // The other half of the leak: the cookie is per-browser, so it made the mark depend
  // on who was looking rather than on what the tenant had done.
  const step = companyStep("Someone Else s.r.o.", NO_BRAND, { name: DEFAULT_ORG_NAME });
  assert.equal(step.company, false);
});

test("with no org on the session the deployment-wide read stands — and is labelled", () => {
  // Open dev and the single-tenant self-host: there IS no per-tenant name to read, so
  // the old signal is still the best available one. What changes is that the payload
  // says which signal answered instead of passing it off as a tenant fact.
  const branded = companyStep(null, BRANDED, null);
  assert.equal(branded.company, true);
  assert.equal(branded.companySignal, "deployment");

  const named = companyStep("Česká spořitelna a.s.", NO_BRAND, null);
  assert.equal(named.company, true, "a stored org-name cookie still completes the step here");
  assert.equal(named.companySignal, "deployment");

  const nothing = companyStep(null, NO_BRAND, null);
  assert.equal(nothing.company, false);
  assert.equal(nothing.companySignal, "deployment");
});

test("whitespace-only cookie is not a stored name", () => {
  assert.equal(companyStep("   ", NO_BRAND, null).company, false);
});
