// The gig sources catalog (sources-catalog.ts) - pure, no DB.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gigHostForAdapter } from "./adapters/registry.ts";
import { GIG_ADAPTERS, GIG_ADAPTER_ARENA, GIG_ADAPTER_TIER } from "./types.ts";
import { gigCatalogEntry, gigSourcesCatalog, gigSourceTermsCurrent, gigTermsHashOf } from "./sources-catalog.ts";

test("one entry per adapter, in vocabulary order, tier and arena from the contract", () => {
  const catalog = gigSourcesCatalog();
  assert.deepEqual(catalog.map((e) => e.adapter), [...GIG_ADAPTERS]);
  for (const e of catalog) {
    assert.equal(e.tier, GIG_ADAPTER_TIER[e.adapter], e.adapter);
    assert.equal(e.arena, GIG_ADAPTER_ARENA[e.adapter], e.adapter);
    assert.ok(e.termsSummary.length > 40, `${e.adapter} states its exposure`);
    assert.match(e.checkedOn, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("every host is the one the adapter really talks to (no drift from adapters/registry.ts)", () => {
  for (const e of gigSourcesCatalog()) assert.equal(e.host, gigHostForAdapter(e.adapter), e.adapter);
});

test("tier B carries a sha256 terms hash of its summary; tier A carries none", () => {
  for (const e of gigSourcesCatalog()) {
    if (e.tier === "B") {
      assert.equal(e.termsHash, gigTermsHashOf(e.termsSummary), e.adapter);
      assert.match(e.termsHash!, /^[0-9a-f]{64}$/);
      assert.ok(e.termsUrl, `${e.adapter} says where to read the original`);
    } else {
      assert.equal(e.termsHash, null, e.adapter);
    }
  }
});

test("keyed adapters name their env vars (never values); manual cannot be created", () => {
  assert.deepEqual(gigCatalogEntry("kaggle").envVars, ["KAGGLE_USERNAME", "KAGGLE_KEY"]);
  assert.equal(gigCatalogEntry("kaggle").needsKey, true);
  assert.deepEqual(gigCatalogEntry("hackerone").envVars, ["HACKERONE_API_USERNAME", "HACKERONE_API_TOKEN"]);
  assert.equal(gigCatalogEntry("hackerone").needsKey, false, "keyless falls back to the public dataset");
  assert.equal(gigCatalogEntry("upwork_api").needsKey, true);
  assert.match(gigCatalogEntry("upwork_api").keylessBehaviour, /robots/);
  assert.equal(gigCatalogEntry("manual").creatable, false);
  assert.equal(gigCatalogEntry("algora").declines, "no_public_api");
  // A copy, not the table.
  gigCatalogEntry("kaggle").envVars.push("X");
  assert.equal(gigCatalogEntry("kaggle").envVars.length, 2);
});

test("gigSourceTermsCurrent: tier A always; tier B only on the current hash", () => {
  const hash = gigCatalogEntry("kaggle").termsHash;
  assert.equal(gigSourceTermsCurrent({ adapter: "github_bounty", tier: "A", acknowledgedTermsHash: null }), true);
  assert.equal(gigSourceTermsCurrent({ adapter: "kaggle", tier: "B", acknowledgedTermsHash: null }), false);
  assert.equal(gigSourceTermsCurrent({ adapter: "kaggle", tier: "B", acknowledgedTermsHash: "0".repeat(64) }), false);
  assert.equal(gigSourceTermsCurrent({ adapter: "kaggle", tier: "B", acknowledgedTermsHash: hash }), true);
});
