// The director's tool vocabulary is ONE definition read by four doors (the OpenAI
// session config, the ElevenLabs agent config, the browser transports and the
// director route). These checks keep the names list and the definitions from
// drifting apart, which is the failure a hand-maintained pair invites.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DIRECTOR_NOTE_PREFIX,
  DIRECTOR_TOOL_DEFS,
  DIRECTOR_TOOL_NAMES,
  END_REASONS,
  GUARDRAIL_KINDS,
  OVERRUN_ANSWERS,
} from "./director-tools.mjs";

test("every tool name has exactly one definition, in the same order", () => {
  assert.deepEqual(
    DIRECTOR_TOOL_DEFS.map((d) => d.name),
    [...DIRECTOR_TOOL_NAMES],
  );
});

test("every definition is a closed object schema whose required keys exist", () => {
  for (const def of DIRECTOR_TOOL_DEFS) {
    assert.equal(def.parameters.type, "object", def.name);
    assert.equal(def.parameters.additionalProperties, false, `${def.name} must not accept stray arguments`);
    for (const key of def.parameters.required) {
      assert.ok(key in def.parameters.properties, `${def.name}: required ${key} is not a property`);
    }
    assert.ok(def.description.length > 20, `${def.name} needs a description the model can act on`);
  }
});

test("the enum-bearing arguments use the exported vocabularies", () => {
  const byName = Object.fromEntries(DIRECTOR_TOOL_DEFS.map((d) => [d.name, d]));
  assert.deepEqual(byName.report_guardrail.parameters.properties.kind.enum, [...GUARDRAIL_KINDS]);
  assert.deepEqual(byName.end_interview.parameters.properties.reason.enum, [...END_REASONS]);
  assert.deepEqual(byName.report_extra_time.parameters.properties.answer.enum, [...OVERRUN_ANSWERS]);
});

test("the stage-direction prefix is a bracketed tag the brief can name", () => {
  assert.match(DIRECTOR_NOTE_PREFIX, /^\[[A-Za-z]+\]$/);
});
