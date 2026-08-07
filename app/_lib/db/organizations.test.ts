import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { DEFAULT_ORG_ID, getOrganization, createOrganization, updateOrganization, listOrganizations } from "./organizations.ts";
import { getWorkspaceOrgId } from "./workspaces.ts";

after(() => cleanupUnitDb());

test("the default org is seeded (Česká spořitelna) and the default workspace links to it", () => {
  const org = getOrganization();
  assert.ok(org, "default org should exist");
  assert.equal(org!.id, DEFAULT_ORG_ID);
  assert.equal(org!.name, "Česká spořitelna");
  assert.equal(getWorkspaceOrgId("workspace"), DEFAULT_ORG_ID);
});

test("create + update an organization (domain preserved when not patched)", () => {
  const org = createOrganization("Acme a.s.", "acme.cz");
  assert.equal(org.name, "Acme a.s.");
  assert.equal(org.domain, "acme.cz");
  assert.ok(getOrganization(org.id));
  assert.equal(updateOrganization(org.id, { name: "Acme Group" }), true);
  assert.equal(getOrganization(org.id)!.name, "Acme Group");
  assert.equal(getOrganization(org.id)!.domain, "acme.cz");
  assert.equal(updateOrganization("nope", { name: "x" }), false);
});

test("listOrganizations includes the default org", () => {
  assert.ok(listOrganizations().some((o) => o.id === DEFAULT_ORG_ID));
});
