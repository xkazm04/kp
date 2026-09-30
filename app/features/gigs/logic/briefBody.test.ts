// Pure logic for the brief's Markdown cuts (briefBody.ts): "Sources read" and "Expected
// challenges" are taken out by the server's sections, and the first section on request.
// Runner: node --test (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { briefBody } from "./briefBody.ts";

const MD = ["## What the gig is", "A client needs a workbook.", "", "## What it asks for", "- One file", "", "## Expected challenges", "- Scope is open", "", "## Notes", "Tail prose.", "", "## Sources read", "- none"].join("\n");
const SECTIONS = [
  { id: "what-the-gig-is", text: "What the gig is", level: 2 as const },
  { id: "what-it-asks-for", text: "What it asks for", level: 2 as const },
  { id: "expected-challenges", text: "Expected challenges", level: 2 as const },
  { id: "notes", text: "Notes", level: 2 as const },
  { id: "sources-read", text: "Sources read", level: 2 as const },
];

test("briefBody: challenges and sources come out; the prose around them stays", () => {
  const b = briefBody(MD, SECTIONS, "Expected challenges", true);
  assert.ok(b.body.startsWith("## What the gig is"));
  assert.ok(b.body.includes("## What it asks for") && !b.body.includes("Expected challenges"));
  assert.equal(b.challenges?.id, "expected-challenges");
  assert.equal(b.after.trim(), "## Notes\nTail prose.");
  assert.equal(b.sources?.id, "sources-read");
});

test("briefBody: no challenge rows leaves the section in the prose", () => {
  const b = briefBody(MD, SECTIONS, "Expected challenges", false);
  assert.equal(b.challenges, null);
  assert.ok(b.body.includes("## Expected challenges"));
  assert.equal(b.after, "");
});

test("briefBody: dropFirst takes out the section the hero already set", () => {
  const b = briefBody(MD, SECTIONS, "Expected challenges", true, true);
  assert.ok(b.body.startsWith("## What it asks for"), b.body);
  assert.ok(!b.body.includes("A client needs a workbook."));
});
