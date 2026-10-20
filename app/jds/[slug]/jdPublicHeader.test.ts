// Pins the public JD header: Analyze CV and job-board Publish are operator
// tools, never part of the candidate share-link chrome.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isPublicJdApplyOpen, publicJdAlternates, publicJdHeaderActions } from "./jdPublicHeader.ts";

test("live JD metadata advertises only the languages it serves, never all four by default", () => {
  const alt = publicJdAlternates("backend-eng", { archived: false, sourceLang: "en", servedLangs: ["cs"], requested: null });
  assert.equal(alt.canonical, "/jds/backend-eng");
  assert.deepEqual(alt.languages, {
    en: "/jds/backend-eng?lang=en",
    cs: "/jds/backend-eng?lang=cs",
    "x-default": "/jds/backend-eng",
  });
  // The old aspirational claim — de/fr alternates with no German or French content.
  assert.equal("de" in alt.languages, false);
  assert.equal("fr" in alt.languages, false);
  assert.deepEqual(publicJdAlternates("backend-eng", { archived: true, sourceLang: "en", servedLangs: ["cs"], requested: null }), {
    canonical: "/jds/backend-eng",
    languages: {},
  });
  const src = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
  assert.match(src, /publicJdAlternates\(slug,/);
});

test("an anonymous header has no Analyze CV or Publish controls", () => {
  const actions = publicJdHeaderActions({ canManage: false, applyOpen: true });
  assert.equal(actions.includes("analyzeCv"), false);
  assert.equal(actions.includes("publish"), false);
  assert.deepEqual(actions, ["apply"]);
});

test("a closed anonymous header still has no operator tools", () => {
  const actions = publicJdHeaderActions({ canManage: false, applyOpen: false });
  assert.equal(actions.includes("analyzeCv"), false);
  assert.equal(actions.includes("publish"), false);
  assert.deepEqual(actions, ["notAccepting"]);
});

test("an operator header still has Analyze CV and Publish beside Apply", () => {
  const actions = publicJdHeaderActions({ canManage: true, applyOpen: true });
  assert.ok(actions.includes("analyzeCv"));
  assert.ok(actions.includes("publish"));
  assert.ok(actions.includes("apply"));
});

test("the public page renders the header from publicJdHeaderActions, not a parallel branch", () => {
  const src = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
  assert.ok(src.includes("publicJdHeaderActions("), "the page must call the helper");
  assert.ok(src.includes("headerActions.map"), "the header must iterate the helper's list");
  assert.ok(src.includes("isPublicJdApplyOpen("), "applyOpen must go through the archived-aware helper");
});

test("an archived JD is not accepting even when the linked job is still open", () => {
  const applyOpen = isPublicJdApplyOpen({
    hasLinkedJob: true,
    jobOpenForApplications: true,
    archivedAt: "2026-09-01T00:00:00Z",
  });
  assert.equal(applyOpen, false);
  assert.deepEqual(publicJdHeaderActions({ canManage: false, applyOpen }), ["notAccepting"]);
});

test("an open unarchived JD with a linked job still shows Apply", () => {
  assert.equal(
    isPublicJdApplyOpen({ hasLinkedJob: true, jobOpenForApplications: true, archivedAt: null }),
    true
  );
  assert.equal(
    isPublicJdApplyOpen({ hasLinkedJob: true, jobOpenForApplications: true, archivedAt: undefined }),
    true
  );
});

test("a missing or closed job never opens Apply, archived or not", () => {
  assert.equal(
    isPublicJdApplyOpen({ hasLinkedJob: false, jobOpenForApplications: true, archivedAt: null }),
    false
  );
  assert.equal(
    isPublicJdApplyOpen({ hasLinkedJob: true, jobOpenForApplications: false, archivedAt: null }),
    false
  );
});
