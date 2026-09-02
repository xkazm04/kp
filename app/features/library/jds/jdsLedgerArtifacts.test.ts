// The JD ledger's artifact/intent readers — the pure half of the detail modal and
// the Duplicate handoff. Every function here parses SERVER-PERSISTED JSON written
// by a different process (the detached jd_build handler) and by older versions of
// it, so "legacy row", "half-written blob" and "malformed" are the normal inputs,
// not the edge cases. None of it was pinned before this file.
import test from "node:test";
import assert from "node:assert/strict";
import {
  caseTaskLabel,
  hasCaseContent,
  hasRepoGrounding,
  heldAsRevision,
  parseArtifacts,
  readBuildIntent,
  readIntentPrompt,
} from "./jdsLedgerArtifacts.ts";

test("parseArtifacts returns null for absent / malformed analysis_json", () => {
  assert.equal(parseArtifacts(null), null);
  assert.equal(parseArtifacts(undefined), null);
  assert.equal(parseArtifacts(""), null);
  assert.equal(parseArtifacts("{ not json"), null);
});

test("parseArtifacts reads the build's structured payload", () => {
  const parsed = parseArtifacts(JSON.stringify({ role: { title: "Dev" }, salarySources: ["a"], options: { description: true } }));
  assert.equal(parsed?.salarySources?.length, 1);
  assert.equal(parsed?.options?.description, true);
});

test("hasRepoGrounding only counts a snapshot that actually carries something", () => {
  assert.equal(hasRepoGrounding(null), false);
  assert.equal(hasRepoGrounding(undefined), false);
  // A scan that found nothing persists an empty shell — not evidence of grounding.
  assert.equal(hasRepoGrounding({}), false);
  assert.equal(hasRepoGrounding({ languages: [] }), false);
  assert.equal(hasRepoGrounding({ ref: "main" }), true);
  assert.equal(hasRepoGrounding({ loc: 1200 }), true);
});

test("hasCaseContent distinguishes an empty case shell from a real one", () => {
  assert.equal(hasCaseContent(null), false);
  assert.equal(hasCaseContent({}), false);
  assert.equal(hasCaseContent({ tasks: [] }), false);
  assert.equal(hasCaseContent({ title: "Refactor" }), true);
  assert.equal(hasCaseContent({ tasks: ["one"] }), true);
});

test("caseTaskLabel prefers the first readable field and never invents English", () => {
  assert.equal(caseTaskLabel("Write a parser", "FALLBACK"), "Write a parser");
  assert.equal(caseTaskLabel({ title: "T", prompt: "P" }, "FALLBACK"), "T");
  assert.equal(caseTaskLabel({ prompt: "P" }, "FALLBACK"), "P");
  assert.equal(caseTaskLabel({ description: "D" }, "FALLBACK"), "D");
  // The i18n contract: an unreadable task yields the CALLER's localized string,
  // never a hardcoded "Task" rendered into a cs/de/fr panel.
  assert.equal(caseTaskLabel({}, "FALLBACK"), "FALLBACK");
  assert.equal(caseTaskLabel(null, "FALLBACK"), "FALLBACK");
  assert.equal(caseTaskLabel(42, "FALLBACK"), "FALLBACK");
  // An empty/whitespace label is not a label.
  assert.equal(caseTaskLabel("   ", "FALLBACK"), "FALLBACK");
  assert.equal(caseTaskLabel({ title: "" }, "FALLBACK"), "FALLBACK");
});

test("readBuildIntent is null for a legacy row and for a non-object blob", () => {
  assert.equal(readBuildIntent(null), null);
  assert.equal(readBuildIntent(""), null);
  assert.equal(readBuildIntent("nope"), null);
  assert.equal(readBuildIntent("[1,2]"), null);
  assert.equal(readBuildIntent("null"), null);
});

test("readBuildIntent normalizes every field the Duplicate re-seed reads", () => {
  const intent = readBuildIntent(
    JSON.stringify({
      needText: "  A senior Rust role  ",
      company: "Acme",
      seniority: "senior",
      roleFamily: "software_engineering",
      repoUrl: "https://example.test/repo",
      lang: "cs",
      templateId: "tpl_1",
      options: { description: true },
    })
  );
  assert.deepEqual(intent, {
    needText: "A senior Rust role",
    company: "Acme",
    seniority: "senior",
    roleFamily: "software_engineering",
    repoUrl: "https://example.test/repo",
    lang: "cs",
    templateId: "tpl_1",
  });
});

test("readBuildIntent maps a missing or non-string field to the empty string", () => {
  // The blob is written by several versions of the generate route; a caller must be
  // able to treat "absent" and "empty" identically instead of guarding each field.
  const intent = readBuildIntent(JSON.stringify({ needText: "x", lang: 7, templateId: null }));
  assert.equal(intent?.lang, "");
  assert.equal(intent?.templateId, "");
  assert.equal(intent?.company, "");
});

test("readIntentPrompt is readBuildIntent's needText, trimmed, else empty", () => {
  assert.equal(readIntentPrompt(JSON.stringify({ needText: "  build me a role  " })), "build me a role");
  assert.equal(readIntentPrompt(JSON.stringify({ templateId: "t" })), "");
  assert.equal(readIntentPrompt("{ broken"), "");
  assert.equal(readIntentPrompt(null), "");
});

test("heldAsRevision reads only the literal true flag off a task result", () => {
  assert.equal(heldAsRevision({ bodyHeldAsRevision: true }), true);
  // The flag rides ALONGSIDE the ordinary build payload, so a normal success must
  // not read as held.
  assert.equal(heldAsRevision({ markdown: "# Role", salarySource: "grounded" }), false);
  assert.equal(heldAsRevision({ bodyHeldAsRevision: false }), false);
  // Truthy-but-not-true never counts: this drives a claim about the recruiter's own
  // text, and a stringly-typed "false" would invert it.
  assert.equal(heldAsRevision({ bodyHeldAsRevision: "false" }), false);
  assert.equal(heldAsRevision({ bodyHeldAsRevision: 1 }), false);
  assert.equal(heldAsRevision(null), false);
  assert.equal(heldAsRevision(undefined), false);
  assert.equal(heldAsRevision("bodyHeldAsRevision"), false);
});
