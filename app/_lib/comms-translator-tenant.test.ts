// The candidate-letter TENANT contract (lot CM, wave 37).
//
// `commsTranslator` resolves a NULL candidate locale through the WORKSPACE's
// `default_locale`. Handed no workspace it resolves against the DEFAULT team — so a
// candidate filed into a second team, with no recorded language, was written to in
// the default team's language. This pins the two live letters that had that defect
// (the dev-case feedback brief and, by its call shape, the intake acknowledgement)
// plus the translator itself.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { commsTranslator } from "./comms-translator.ts";
import { buildFeedbackBrief } from "./devcase-feedback.ts";
import { createWorkspace, setWorkspaceDefaultLocale, DEFAULT_WORKSPACE_ID } from "./db/workspaces.ts";

after(() => cleanupUnitDb());

// The DEFAULT team speaks English; a SECOND team speaks Czech. Every assertion below
// is about which of the two a tenant-less resolution picks.
setWorkspaceDefaultLocale("en", DEFAULT_WORKSPACE_ID);
const czech = createWorkspace("Česká pobočka");
setWorkspaceDefaultLocale("cs", czech.id);

test("a NULL-locale candidate in a Czech workspace is written to in Czech", async () => {
  const tCz = await commsTranslator(null, czech.id);
  const tDefault = await commsTranslator(null, DEFAULT_WORKSPACE_ID);
  assert.notEqual(tCz("ack.subject"), tDefault("ack.subject"), "the two tenants must not resolve to one language");
  // The catalogs are the authority on the wording; what is pinned here is WHICH one.
  const tCsDirect = await commsTranslator("cs");
  const tEnDirect = await commsTranslator("en");
  assert.equal(tCz("ack.subject"), tCsDirect("ack.subject"), "the Czech team's NULL-locale candidate gets cs");
  assert.equal(tDefault("ack.subject"), tEnDirect("ack.subject"), "the default team's still gets its own en");
});

test("an explicit candidate locale still outranks the tenant default", async () => {
  const t = await commsTranslator("fr", czech.id);
  const tFr = await commsTranslator("fr");
  assert.equal(t("ack.subject"), tFr("ack.subject"));
});

test("the dev-case feedback brief resolves its language against the submission's team", async () => {
  const cz = await buildFeedbackBrief({
    candidateRef: "Jana",
    roleTitle: null,
    strengths: [],
    concerns: [],
    gaps: [],
    locale: null,
    workspaceId: czech.id,
  });
  const def = await buildFeedbackBrief({
    candidateRef: "Jana",
    roleTitle: null,
    strengths: [],
    concerns: [],
    gaps: [],
    locale: null,
    workspaceId: DEFAULT_WORKSPACE_ID,
  });
  assert.notEqual(cz.subject, def.subject, "a NULL-locale candidate must not get the default team's language");
  const tCs = await commsTranslator("cs");
  assert.equal(cz.subject, tCs("devcaseFeedback.subject"));
});
