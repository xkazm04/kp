import { test } from "node:test";
import assert from "node:assert/strict";
import { companyConfigFor, companyOf, withCompanyKey } from "./companyConfig";
import { hostForAdapter } from "./adapters/registry";

test("a company form's config carries the key its adapter reads", () => {
  assert.deepEqual(companyConfigFor("ats_greenhouse", " anthropic "), { token: "anthropic" });
  assert.deepEqual(companyConfigFor("ats_ashby", "openai"), { board: "openai" });
  assert.deepEqual(companyConfigFor("ats_lever", "mistral"), { site: "mistral" });
  assert.deepEqual(companyConfigFor("ats_workable", "huggingface"), { subdomain: "huggingface" });
  assert.deepEqual(companyConfigFor("ats_recruitee", "acme"), { company: "acme" });
  // Every one of them resolves a host - the create route's first refusal was exactly this.
  for (const adapter of ["ats_greenhouse", "ats_ashby", "ats_lever", "ats_workable", "ats_recruitee", "ats_teamtailor", "ats_personio", "ats_smartrecruiters"] as const) {
    assert.ok(hostForAdapter(adapter, companyConfigFor(adapter, "acme")), adapter);
  }
});

test("a legacy slug moves onto the adapter's key; a config that has the key is left alone", () => {
  assert.deepEqual(withCompanyKey("ats_greenhouse", { slug: "acme" }), { token: "acme" });
  assert.deepEqual(withCompanyKey("ats_greenhouse", { token: "acme", company: "Acme" }), { token: "acme", company: "Acme" });
  assert.deepEqual(withCompanyKey("eures", { slug: "x" }), { slug: "x" });
  assert.ok(hostForAdapter("ats_ashby", withCompanyKey("ats_ashby", { slug: "openai" })));
});

test("the company a source names, under either key", () => {
  assert.equal(companyOf("ats_greenhouse", { token: "anthropic" }), "anthropic");
  assert.equal(companyOf("ats_greenhouse", { slug: "legacy" }), "legacy");
  assert.equal(companyOf("ats_ashby", {}), null);
});
