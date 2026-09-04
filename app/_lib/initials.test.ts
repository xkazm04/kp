// The monogram helper reconciled six drifted copies into one behaviour, and then
// had no test — so the one thing all six copies got wrong survived the
// reconciliation: `word[0]` is a UTF-16 CODE UNIT, not a character. For any name
// starting outside the basic multilingual plane that returns a LONE SURROGATE, and
// an avatar renders "�" for a name the rest of the app handles fine. The same
// indexing strips a combining mark, so "Ångström" spelled A + U+030A monograms as a
// bare "A".
//
// These are not exotic inputs for a 4-locale product that reads names off CVs and
// apply forms. Each assertion below fails against `part[0]`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { firstGrapheme, initials } from "./initials.ts";
import { initialsLabel } from "./pipeline-events-public.ts";

// U+1D49C MATHEMATICAL SCRIPT CAPITAL A — two UTF-16 units, so `"𝒜lice"[0]` is the
// high surrogate alone. A real shape: stylized display names arrive from CVs and
// social profiles constantly.
const ASTRAL_NAME = "\u{1D49C}lice Nguyen";
// A base letter plus a COMBINING RING ABOVE, the decomposed (NFD) spelling — which
// is what macOS filesystems and many PDF extractors produce.
const COMBINING_NAME = "Ångström Larsson";

test("an astral-plane first letter survives whole — never a lone surrogate", () => {
  const got = initials(ASTRAL_NAME);
  assert.equal(got, "\u{1D49C}N", "the script capital must stay intact and pair with the surname letter");
  // The precise failure `part[0]` produced: an unpaired high surrogate.
  for (const unit of got) {
    const code = unit.codePointAt(0) ?? 0;
    assert.ok(
      !(code >= 0xd800 && code <= 0xdfff) || unit.length === 2,
      `no lone surrogate may appear in a monogram (got ${JSON.stringify(got)})`
    );
  }
  assert.equal([...got].length, 2, "two graphemes, however many code units that takes");
});

test("a combining mark stays attached to its base letter", () => {
  assert.equal(initials(COMBINING_NAME), "ÅL", "Å (decomposed) + Larsson, not a bare A");
});

test("an emoji ZWJ sequence counts as one character", () => {
  // A company "name" that starts with an emoji is a real offer-page logo-slot input,
  // and a ZWJ family sequence is many code points that render as ONE glyph. Cutting
  // it anywhere yields a different picture.
  const flag = "\u{1F1E8}\u{1F1FF} Prague Studio"; // regional indicators CZ
  assert.equal(initials(flag), "\u{1F1E8}\u{1F1FF}P", "the flag is one grapheme, not two half-letters");
});

test("the ordinary cases the six copies already agreed on still hold", () => {
  assert.equal(initials("Marie Kovová"), "MK");
  assert.equal(initials("jan"), "J");
  assert.equal(initials("Jean-Claude van Damme"), "JV", "first two whitespace tokens only");
  assert.equal(initials("  spaced    out  name "), "SO", "any run of whitespace splits");
  assert.equal(initials("Ärzte Zentrum"), "ÄZ", "a precomposed accent is one character already");
});

test("nothing to show → the caller's fallback, and the default is empty", () => {
  for (const empty of [null, undefined, "", "   ", "\t\n "]) {
    assert.equal(initials(empty), "", `${JSON.stringify(empty)} → "" by default`);
    assert.equal(initials(empty, "?"), "?", "…or the caller's fallback");
    assert.equal(initials(empty, "•"), "•");
  }
});

test("firstGrapheme is the shared primitive, not a formatting choice", () => {
  assert.equal(firstGrapheme("Alice"), "A");
  assert.equal(firstGrapheme("\u{1D49C}lice"), "\u{1D49C}", "a surrogate pair is one grapheme");
  assert.equal(firstGrapheme("Ångstrom"), "Å", "base + combining mark is one grapheme");
  assert.equal(firstGrapheme(""), "");
});

test("initialsLabel shares the letter-taking and keeps its own output contract", () => {
  // Reuse, proven where it matters: the public feed's projection must not emit a
  // half character either.
  assert.equal(initialsLabel(ASTRAL_NAME), "\u{1D49C}. N.");
  assert.equal(initialsLabel(COMBINING_NAME), "Å. L.");
  // …while the CONTRACT stays different on purpose: dots + spaces, and null (not a
  // fallback) for nothing to show.
  assert.equal(initialsLabel("Marie Kovová"), "M. K.");
  assert.equal(initialsLabel("Jan"), "J.");
  assert.equal(initialsLabel("  "), null);
  assert.equal(initialsLabel(null), null);
  assert.notEqual(initialsLabel("Marie Kovová"), initials("Marie Kovová"), "two contracts, one primitive");
});
