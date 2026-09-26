import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCvDocument } from "./cvDocument";
import { descriptorIn } from "./cvContent";

// The designed CV's content rules, held to registry recruiting/cv-content-construction.
// Every CV here is SYNTHETIC — nobody real.

const DUTY_CV = [
  "JANA NOVÁKOVÁ",
  "DATA ENGINEER",
  "jana@example.invalid",
  "PROFILE",
  "Results-driven data engineer. Builds batch pipelines for retail analytics.",
  "WORK EXPERIENCE",
  "Acme Retail, a.s. 2022 - 2025",
  "Data Engineer",
  "Responsible for the reporting layer. Passionate about clean data models.",
].join("\n");

const DUTY_PROFILE = {
  displayName: "Jana Nováková",
  evidence: [{ kind: "job", title: "Data Engineer — Acme Retail, a.s. (2022 - 2025)", text: "" }],
};

test("a verb never raises the claim: 'Responsible for' stays the seeker's words", () => {
  const doc = buildCvDocument({ profile: DUTY_PROFILE, preferences: { targetTitles: [] }, cvSourceText: DUTY_CV });
  const texts = doc.experience[0]!.bullets.map((b) => b.text);
  assert.ok(texts.includes("Responsible for the reporting layer."), texts.join(" | "));
  assert.ok(!JSON.stringify(doc).includes("Owned"), "no responsibility turned into ownership");
  assert.ok(!doc.improvements.some((i) => (i.kind as string) === "opener"));
});

test("a self-descriptor in the seeker's own text is flagged as a question, never deleted", () => {
  const doc = buildCvDocument({ profile: DUTY_PROFILE, preferences: { targetTitles: [] }, cvSourceText: DUTY_CV });
  assert.ok(doc.summary!.includes("Results-driven data engineer."), "the seeker's words stay on the sheet");
  const flagged = doc.questions.filter((q) => q.kind === "self_descriptor");
  assert.deepEqual(flagged, [
    { kind: "self_descriptor", roleIndex: null, text: "Results-driven data engineer." },
    { kind: "self_descriptor", roleIndex: 0, text: "Passionate about clean data models." },
  ]);
});

test("self-descriptors are read in the four languages the sheet writes", () => {
  assert.equal(descriptorIn("A results driven analyst"), "results driven");
  assert.equal(descriptorIn("Jsem cílevědomá a komunikativní analytička"), "cílevědomá");
  assert.equal(descriptorIn("Teamfähig und belastbar"), "Teamfähig");
  assert.equal(descriptorIn("Esprit d'équipe et rigueur"), "Esprit d'équipe");
  assert.equal(descriptorIn("Built the invoice matching service."), null);
});
