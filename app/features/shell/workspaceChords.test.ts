import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveChords, isChordPrefix, matchChord } from "./workspaceChords.ts";
import { NAV_GROUPS } from "./tabs.ts";

const CHORDS = deriveChords();
const byId = new Map(CHORDS.map((c) => [c.id, c.keys]));

// Muscle memory: every tab that had a single-letter chord keeps EXACTLY the same
// one. If a NAV_GROUPS edit ever shifts one of these, this fails loudly — the whole
// point of the two-pass scheme is that adding the overflow chords changed none of
// these. (Runs with ABOUT_TAB_IN_NAV on, as NODE_ENV !== "production" under test.)
test("existing single-letter chords are unchanged", () => {
  const expected: Record<string, string> = {
    pipeline: "p",
    channels: "c",
    decisions: "d",
    schedule: "s",
    onboarding: "o",
    jobs: "j",
    library: "l",
    profile: "r",
    match: "m",
    analyze: "a",
    interview: "i",
    dev: "e",
    analytics: "n",
    matrix: "t",
    about: "b",
    organization: "g",
    workspace: "w",
  };
  for (const [id, key] of Object.entries(expected)) {
    assert.deepEqual(byId.get(id as never), [key], `${id} should be g ${key}`);
  }
});

// The bug this direction fixes: billing / models / branding used to fall off the
// end with no chord at all. Now every nav tab has one.
test("every nav tab gets a chord", () => {
  const tabs = NAV_GROUPS.flatMap((g) => g.items);
  assert.equal(CHORDS.length, tabs.length);
  for (const def of tabs) {
    const keys = byId.get(def.id);
    assert.ok(keys && keys.length >= 1 && keys.length <= 2, `${def.id} has a 1–2 key chord`);
    assert.ok(
      keys!.every((k) => /^[a-z]$/.test(k)),
      `${def.id} chord keys are single letters`
    );
  }
});

test("the previously-dropped tabs now have two-key chords", () => {
  assert.deepEqual(byId.get("branding"), ["f", "b"]);
  assert.deepEqual(byId.get("billing"), ["f", "i"]);
  assert.deepEqual(byId.get("models"), ["f", "m"]);
});

// Agents sits INSIDE the first (hiring) group but is marked chordOverflow, so it
// takes a two-key chord instead of stealing `a` from Analyze (which would have
// cascaded through analytics too). Every pinned single above stays untouched.
test("agents (chordOverflow) gets a two-key chord and steals no pinned single", () => {
  assert.deepEqual(byId.get("agents"), ["f", "a"]);
});

// Collision-free BY CONSTRUCTION: no two chords share a full sequence, and no
// single-letter chord equals the FIRST key of any two-key chord (which would make
// `g <that letter>` ambiguous — the single would fire before the second key).
test("chords are collision-free", () => {
  const seen = new Set<string>();
  for (const c of CHORDS) {
    const sig = c.keys.join(" ");
    assert.ok(!seen.has(sig), `duplicate chord sequence "g ${sig}"`);
    seen.add(sig);
  }
  const singles = new Set(CHORDS.filter((c) => c.keys.length === 1).map((c) => c.keys[0]));
  const twoKeyPrefixes = CHORDS.filter((c) => c.keys.length === 2).map((c) => c.keys[0]);
  for (const p of twoKeyPrefixes) {
    assert.ok(!singles.has(p), `two-key prefix "${p}" collides with a single-letter chord`);
  }
  // All two-key chords share one reserved prefix (deterministic).
  assert.equal(new Set(twoKeyPrefixes).size, twoKeyPrefixes.length > 0 ? 1 : 0);
});

test("matchChord fires only on the exact full sequence", () => {
  assert.equal(matchChord(CHORDS, ["p"])?.id, "pipeline");
  assert.equal(matchChord(CHORDS, ["g"])?.id, "organization");
  assert.equal(matchChord(CHORDS, ["f", "b"])?.id, "branding");
  // The reserved prefix alone is not a chord — it must wait for the second key.
  assert.equal(matchChord(CHORDS, ["f"]), undefined);
  assert.equal(matchChord(CHORDS, ["z"]), undefined);
});

test("isChordPrefix waits only where a longer chord continues", () => {
  // `g f …` is incomplete — a two-key chord continues it.
  assert.equal(isChordPrefix(CHORDS, ["f"]), true);
  // A single-letter chord is terminal — nothing longer continues it.
  assert.equal(isChordPrefix(CHORDS, ["p"]), false);
  // A completed two-key chord has nothing after it.
  assert.equal(isChordPrefix(CHORDS, ["f", "b"]), false);
});

test("derivation is deterministic", () => {
  assert.deepEqual(deriveChords(), deriveChords());
});
