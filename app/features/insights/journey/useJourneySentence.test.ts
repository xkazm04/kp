// The pairing this module exists to get right: a row's catalog key and the
// arguments that key needs.
//
// This is a regression guard with a scar. The board shipped resolving an
// unmapped kind through the ORDINARY branch, whose arguments are the row's
// `facts` — which never carry `kind`, because the kind is not a fact about the
// event, it IS the event. The first real board threw:
//
//   FORMATTING_ERROR: The intl string context variable "kind" was not provided
//   to the string "An event of kind {kind} was recorded"
//
// and every row of an unmapped kind failed to render. kp writes at least 11
// pipeline event kinds render-keys.ts has no word for (interview_scorecard,
// intake_degraded, rematched, outreach_sent, group_eval, …), so that path is
// ordinary traffic, not an edge case.
//
// So the test is not "does the unknown case pass a kind". It is the general
// property: for EVERY key this module can emit, every ICU placeholder the
// English message declares is present in the values handed alongside it. A new
// message that asks for an argument nobody supplies fails here rather than in a
// browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JOURNEY_TOPIC_CODES } from "@/app/_lib/journey/types";
import { allJourneyKinds } from "@/app/_lib/journey/render-keys";
import { journeySentenceArgs } from "./useJourneySentence.ts";

const dir = path.dirname(fileURLToPath(import.meta.url));
const en = JSON.parse(
  readFileSync(path.join(dir, "..", "..", "..", "..", "messages", "en.json"), "utf8")
) as { journey: Record<string, unknown> };

/** `journey.events.advanced` -> the message, from a dotted path under `journey`. */
function message(dotted: string): string {
  let cur: unknown = en.journey;
  for (const part of dotted.split(".")) {
    cur = (cur as Record<string, unknown>)[part];
  }
  assert.equal(typeof cur, "string", `journey.${dotted} is missing from messages/en.json`);
  return cur as string;
}

/** The simple ICU arguments a message declares. Enough for this catalog: the
 *  journey namespace uses plain `{name}` interpolation, no plural/select arms. */
function placeholders(msg: string): string[] {
  return [...msg.matchAll(/\{\s*([A-Za-z0-9_]+)\s*[,}]/g)].map((m) => m[1]);
}

test("every placeholder an event message declares is supplied with it", () => {
  // One representative event per emittable key, built the way the projection
  // builds them: facts carry what the message interpolates.
  const factsFor = (key: string): Record<string, string | number> => {
    const needed = placeholders(message(key));
    const facts: Record<string, string | number> = {};
    // `kind` is deliberately NOT supplied as a fact — it is the event's own
    // identity, and supplying it here would hide the exact bug this pins.
    for (const name of needed.filter((n) => n !== "kind")) facts[name] = "x";
    return facts;
  };

  // One row per mapped kind, plus a kind nothing maps: between them these cover
  // every message `journeyEventMessageKey` can return.
  for (const kind of [...allJourneyKinds(), "a_kind_nothing_maps"]) {
    const resolved = journeySentenceArgs({ kind, facts: {} }).key;
    const { key, values } = journeySentenceArgs({ kind, facts: factsFor(resolved) });
    for (const name of placeholders(message(key))) {
      assert.ok(
        Object.hasOwn(values, name),
        `journey.${key} declares {${name}} but the renderer supplies ${JSON.stringify(Object.keys(values))}`
      );
    }
  }
});

test("an unmapped kind renders through events.unknown WITH the kind", () => {
  const { key, values } = journeySentenceArgs({ kind: "group_eval", facts: {} });
  assert.equal(key, "events.unknown");
  assert.equal(values.kind, "group_eval", "the kind is the argument that message interpolates");
});

test("a mapped kind does not get a spurious kind argument", () => {
  const { key, values } = journeySentenceArgs({ kind: "advanced", facts: { to: "Interview" } });
  assert.equal(key, "events.advanced");
  assert.equal(values.to, "Interview");
  assert.ok(!Object.hasOwn(values, "kind"), "kind is only an argument of events.unknown");
});

test("a rail STEP has no facts, so every placeholder stands in as an ellipsis", () => {
  // A step is the shape of a sentence, not an occurrence: "Candidate advanced
  // to …" is the honest rendering, and it must not report a missing argument.
  const { key, values } = journeySentenceArgs({ kind: "advanced" }, message("events.advanced"));
  assert.equal(key, "events.advanced");
  assert.equal(values.to, "…");
  assert.ok(Object.hasOwn(values, "to"), "a REAL own property: a Proxy here went missing when spread");
});

test("an unmapped rail step still carries its kind, not an ellipsis", () => {
  const { key, values } = journeySentenceArgs({ kind: "group_eval" }, message("events.unknown"));
  assert.equal(key, "events.unknown");
  assert.equal(values.kind, "group_eval", "an ellipsis here would name no kind at all");
});

test("a conversational round renders through its topic, which takes no arguments", () => {
  for (const code of JOURNEY_TOPIC_CODES) {
    const { key, values } = journeySentenceArgs({ kind: "interview_round", topicCode: code, facts: {} });
    assert.equal(key, `topics.${code}`);
    assert.deepEqual(placeholders(message(key)), [], `journey.${key} must take no ICU arguments`);
    assert.ok(!Object.hasOwn(values, "kind"));
  }
});

test("an unscored analysis takes the message that does not ask for a score", () => {
  const scored = journeySentenceArgs({ kind: "analysis", facts: { score: 72 } });
  assert.equal(scored.key, "events.analysis");
  const unscored = journeySentenceArgs({ kind: "analysis", facts: { score: null } });
  assert.equal(unscored.key, "events.analysisUnscored");
  assert.deepEqual(placeholders(message(unscored.key)), [], "…so it needs no score to render");
});
