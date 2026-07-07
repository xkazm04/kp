import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { createTemplate, listTemplates, getTemplate, updateTemplate, deleteTemplate } from "./templates-store.ts";

after(() => cleanupUnitDb());

// Behavioral tenancy for the curated shared-library tier (P2): org-shared templates
// (scope 'org', workspace_id NULL) are the company library every team reads; a team's
// private drafts (scope 'team') are isolated to that team.

test("org-shared templates are visible to every team; team-private ones are isolated", () => {
  const orgT = createTemplate({ name: "Company JD", body: "{{role}}", scope: "org" }, "ws-a");
  const privA = createTemplate({ name: "A private", body: "{{role}}", scope: "team" }, "ws-a");
  const privB = createTemplate({ name: "B private", body: "{{role}}", scope: "team" }, "ws-b");
  assert.equal(orgT.scope, "org");
  assert.equal(privA.scope, "team");

  const listA = listTemplates("ws-a").map((t) => t.id);
  assert.ok(listA.includes(orgT.id), "ws-a sees the org-shared template");
  assert.ok(listA.includes(privA.id), "ws-a sees its own private template");
  assert.ok(!listA.includes(privB.id), "ws-a must NOT see ws-b's private template");

  // by-id: the org template is readable by every team; a private one only by its owner.
  assert.ok(getTemplate(orgT.id, "ws-a") && getTemplate(orgT.id, "ws-b"), "org template readable by all teams");
  assert.ok(getTemplate(privB.id, "ws-b"), "ws-b reads its own private template");
  assert.equal(getTemplate(privB.id, "ws-a"), null, "ws-a can't read ws-b's private template by id");
});

test("a team can't edit or delete another team's private template", () => {
  const privB = createTemplate({ name: "B secret", body: "{{role}}", scope: "team" }, "ws-b");
  assert.equal(updateTemplate(privB.id, { name: "hacked" }, "ws-a"), null, "cross-team edit is a no-op");
  deleteTemplate(privB.id, "ws-a"); // scoped DELETE matches nothing under ws-a
  const survivor = getTemplate(privB.id, "ws-b");
  assert.equal(survivor?.name, "B secret", "ws-b's private template survives a cross-team edit + delete");
});
