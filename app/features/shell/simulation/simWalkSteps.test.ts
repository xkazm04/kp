// The walk's chapter sequencing and halt conditions (the click route moved to
// simMove.ts, pinned by simMove.test.ts) — the pure
// decisions inside a 464-line hook that had no test at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { SIM_PHASES, type SimPhaseId } from "./constants.ts";
import {
  SIM_CHAPTERS,
  SIM_HALT_REASONS,
  chaptersMatchPhases,
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

test("every chapter's spotlight hook is rendered by a real surface", () => {
  // A redesigned tab (the Night Post replaced the Channels view, 2026-09-30) must carry the walk's
  // hook over, or the chapter spotlights nothing and the walk narrates an empty page.
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : [];
    });
  const sources = walk(path.join(process.cwd(), "app", "features")).map((f) => readFileSync(f, "utf8")).join("\n");
  for (const c of SIM_CHAPTERS) {
    const hook = /^\[(data-sim[\w-]*)="([^"]+)"\]$/.exec(c.target);
    if (!hook) continue; // "#main" is the whole surface
    assert.ok(sources.includes(`${hook[1]}="${hook[2]}"`), `${c.id}: no surface renders ${c.target}`);
  }
});

test("simChapter throws on an unknown id rather than silently skipping a phase", () => {
  assert.equal(simChapter("design").tab, "intake");
  // A cast, not a suppression: the id is a runtime value in the walk's own
  // navigation, so the guard has to hold for a string TypeScript never saw.
  assert.throws(() => simChapter("nope" as SimPhaseId), /unknown sim chapter/);
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
