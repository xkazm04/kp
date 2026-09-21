import { test } from "node:test";
import assert from "node:assert/strict";
import { voiceScriptPreview } from "./DevCaseDetail.script.ts";

test("a case with phases renders intro, titles and spoken probes", () => {
  const script = voiceScriptPreview({
    caseIntro: "Order notifications fire twice.",
    source: "llm",
    phases: [
      { phase: "Mechanism probes", probe: "Why might it be set up this way?", listenFor: "INTERNAL" },
      { phase: "Coachability", probe: "  " },
    ],
  });
  assert.deepEqual(script, {
    intro: "Order notifications fire twice.",
    phases: [
      { title: "Mechanism probes", probe: "Why might it be set up this way?" },
      { title: "Coachability", probe: "" },
    ],
    degraded: false,
  });
  assert.equal(
    JSON.stringify(script).includes("INTERNAL"),
    false,
    "listen-for notes stay out of the recruiter-facing script",
  );
});

test("a case without phases renders nothing, not an empty script", () => {
  assert.equal(voiceScriptPreview(null), null);
  assert.equal(voiceScriptPreview({}), null);
  assert.equal(voiceScriptPreview({ phases: [] }), null);
  assert.equal(voiceScriptPreview({ phases: [{ probe: "orphan" }] }), null);
});

test("template / deterministic source is marked degraded with the same reason publish uses", () => {
  assert.equal(voiceScriptPreview({ phases: [{ phase: "Warm-up" }], source: "deterministic" })?.degraded, true);
  assert.equal(voiceScriptPreview({ phases: [{ phase: "Warm-up" }], source: "partial" })?.degraded, true);
  assert.equal(voiceScriptPreview({ phases: [{ phase: "Warm-up" }], source: "llm" })?.degraded, false);
  assert.equal(voiceScriptPreview({ phases: [{ phase: "Warm-up" }] })?.degraded, false);
});
