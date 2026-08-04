import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFeedbackBrief } from "./devcase-feedback.ts";

const NO_ADVERSE = /reject|unsuccessful|not selected|declined|turned down|did not pass/i;

test("builds a warm brief with strengths and reframed growth areas", async () => {
  const b = await buildFeedbackBrief({
    candidateRef: "Alex",
    roleTitle: "Backend Engineer",
    strengths: ["Clear commit hygiene", "Good test coverage"],
    concerns: ["Limited error handling"],
    gaps: ["No async experience shown"],
  });
  assert.match(b.subject, /Backend Engineer/);
  assert.match(b.body, /Hi Alex,/);
  assert.match(b.body, /What stood out:/);
  assert.match(b.body, /Clear commit hygiene/);
  assert.match(b.body, /Areas to keep growing:/);
  assert.match(b.body, /Limited error handling/);
  assert.match(b.body, /No async experience shown/); // gaps fold into growth
});

test("carries NO adverse / rejection wording — that stays human-gated", async () => {
  const b = await buildFeedbackBrief({
    candidateRef: "Sam",
    roleTitle: "Data Eng",
    strengths: ["X"],
    concerns: ["Y"],
    gaps: [],
  });
  assert.doesNotMatch(b.body, NO_ADVERSE);
  assert.doesNotMatch(b.subject, NO_ADVERSE);
});

test("an empty evaluation still yields a kind, non-empty note", async () => {
  const b = await buildFeedbackBrief({ candidateRef: "Pat", roleTitle: null, strengths: [], concerns: [], gaps: [] });
  assert.match(b.body, /appreciated your effort/i);
  assert.doesNotMatch(b.body, NO_ADVERSE);
  assert.doesNotMatch(b.body, /What stood out/); // no empty section header
});

test("blank entries are dropped, not rendered as empty bullets", async () => {
  const b = await buildFeedbackBrief({ candidateRef: "Lee", strengths: ["Real", "  "], concerns: [""], gaps: [] });
  const bullets = b.body.split("\n").filter((l) => l.startsWith("- "));
  assert.deepEqual(bullets, ["- Real"]);
});

test("falls back to a generic greeting/subject when fields are missing", async () => {
  const b = await buildFeedbackBrief({ candidateRef: "", strengths: [], concerns: [], gaps: [] });
  assert.match(b.body, /Hi there,/);
  assert.match(b.subject, /take-home exercise/i);
});
