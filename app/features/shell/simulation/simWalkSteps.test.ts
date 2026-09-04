// The walk's chapter sequencing, halt conditions and click route — the three pure
// decisions inside a 464-line hook that had no test at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SIM_PHASES, type SimPhaseId } from "./constants.ts";
import {
  SIM_CHAPTERS,
  SIM_HALT_REASONS,
  chaptersMatchPhases,
  clickRoute,
  matchHalt,
  offerHalt,
  simChapter,
} from "./simWalkSteps.ts";

test("the walk's chapters ARE the phase strip: same ids, same tabs, same order", () => {
  assert.equal(chaptersMatchPhases(), true);
  assert.deepEqual(
    SIM_CHAPTERS.map((c) => `${c.id}:${c.tab}`),
    SIM_PHASES.map((p) => `${p.id}:${p.tab}`),
    "the strip the viewer watches and the tabs the walk navigates to must not drift"
  );
});

test("every chapter spotlights something", () => {
  for (const c of SIM_CHAPTERS) {
    assert.ok(c.target.length > 0, `${c.id} has a spotlight target`);
    assert.ok(c.target.startsWith("[data-sim") || c.target === "#main", `${c.id}: ${c.target} is a sim hook or the whole surface`);
  }
  assert.equal(new Set(SIM_CHAPTERS.map((c) => c.id)).size, SIM_CHAPTERS.length, "no id appears twice");
});

test("simChapter throws on an unknown id rather than silently skipping a phase", () => {
  assert.equal(simChapter("design").tab, "intake");
  // A cast, not a suppression: the id is a runtime value in the walk's own
  // navigation, so the guard has to hold for a string TypeScript never saw.
  assert.throws(() => simChapter("nope" as SimPhaseId), /unknown sim chapter/);
});

test("clickRoute names the fallback instead of hiding it", () => {
  assert.equal(clickRoute(true), "dom", "a real click on a rendered control");
  assert.equal(clickRoute(false), "api", "the button was not on screen — the run log must SAY the API ran it");
});

test("the halt conditions are the broken preconditions, not cosmetic failures", () => {
  assert.equal(matchHalt({ id: "e1" }), null);
  assert.equal(matchHalt(undefined), "noScreened", "nobody reached the screened column: there is no candidate to follow");
  assert.equal(matchHalt(null), "noScreened");
  assert.equal(offerHalt("tok"), null);
  assert.equal(offerHalt(""), "offerTokenMissing", "an empty token is missing, not a token");
  assert.equal(offerHalt(undefined), "offerTokenMissing");
  assert.deepEqual([...SIM_HALT_REASONS], ["noScreened", "offerTokenMissing"]);
});
