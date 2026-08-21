// Data contract for the 20 generated /motionize glyph modules in this folder.
//
// These files are machine-traced, and TWO gates deliberately look away from them:
// `eslint.config.mjs` blanket-ignores `app/_components/glyph/glyphs/**` for the
// no-raw-hex design law, and `scripts/design/check-design-tokens.mjs` never reads
// this folder at all. Both exemptions rest on one promise — "MotionizedGlyph runs
// every fill through snapToToken() and emits var(--color-*)". Nothing verified the
// promise. A regeneration that emitted a 3-digit hex, an 8-digit hex, an `rgb(…)`
// or a token that globals.css does not declare would paint a literal colour onto
// the DOM, invisible to both gates, and that colour cannot follow
// [data-theme="dark"]. This file is the missing verification.
//
// It also pins the one motion invariant the tracer gets wrong on its own: see
// "substrate reveals first" below.
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { snapToToken } from "../glyphTokens.ts";
import type { TracedGlyph } from "@/app/_components/glyph/MotionizedGlyph";

import { ANALYTICS_GLYPH } from "./analyticsGlyph.ts";
import { CHANNEL_ADS_GLYPH } from "./channelAdsGlyph.ts";
import { CHANNEL_CAREERS_GLYPH } from "./channelCareersGlyph.ts";
import { CHANNEL_COMMS_GLYPH } from "./channelCommsGlyph.ts";
import { CHANNEL_EMAIL_GLYPH } from "./channelEmailGlyph.ts";
import { DECISIONS_GLYPH } from "./decisionsGlyph.ts";
import { DEV_CASES_GLYPH } from "./devCasesGlyph.ts";
import { JOBS_GLYPH } from "./jobsGlyph.ts";
import { LIBRARY_GLYPH } from "./libraryGlyph.ts";
import { MATRIX_GLYPH } from "./matrixGlyph.ts";
import { ONBOARDING_RUN_GLYPH } from "./onboardingRunGlyph.ts";
import { PIPELINE_GLYPH } from "./pipelineGlyph.ts";
import { PROFILE_MATRIX_GLYPH } from "./profileMatrixGlyph.ts";
import { PROFILE_ROSTER_GLYPH } from "./profileRosterGlyph.ts";
import { SCHEDULE_GLYPH } from "./scheduleGlyph.ts";
import { STEP_CASE_GLYPH } from "./stepCaseGlyph.ts";
import { STEP_CHANNELS_GLYPH } from "./stepChannelsGlyph.ts";
import { STEP_COMPANY_GLYPH } from "./stepCompanyGlyph.ts";
import { STEP_FIRST_ROLE_GLYPH } from "./stepFirstRoleGlyph.ts";
import { STEP_TEAM_GLYPH } from "./stepTeamGlyph.ts";

const GLYPHS: Record<string, TracedGlyph> = {
  analyticsGlyph: ANALYTICS_GLYPH,
  channelAdsGlyph: CHANNEL_ADS_GLYPH,
  channelCareersGlyph: CHANNEL_CAREERS_GLYPH,
  channelCommsGlyph: CHANNEL_COMMS_GLYPH,
  channelEmailGlyph: CHANNEL_EMAIL_GLYPH,
  decisionsGlyph: DECISIONS_GLYPH,
  devCasesGlyph: DEV_CASES_GLYPH,
  jobsGlyph: JOBS_GLYPH,
  libraryGlyph: LIBRARY_GLYPH,
  matrixGlyph: MATRIX_GLYPH,
  onboardingRunGlyph: ONBOARDING_RUN_GLYPH,
  pipelineGlyph: PIPELINE_GLYPH,
  profileMatrixGlyph: PROFILE_MATRIX_GLYPH,
  profileRosterGlyph: PROFILE_ROSTER_GLYPH,
  scheduleGlyph: SCHEDULE_GLYPH,
  stepCaseGlyph: STEP_CASE_GLYPH,
  stepChannelsGlyph: STEP_CHANNELS_GLYPH,
  stepCompanyGlyph: STEP_COMPANY_GLYPH,
  stepFirstRoleGlyph: STEP_FIRST_ROLE_GLYPH,
  stepTeamGlyph: STEP_TEAM_GLYPH,
};

/* ── app/globals.css as the source of truth for what a token IS ───────────── */

const css = readFileSync(fileURLToPath(new URL("../../../globals.css", import.meta.url)), "utf8");

/** Slice a top-level `<selector> { … }` block by brace balance (as design:check does). */
function cssBlock(opener: string): string {
  const start = css.indexOf(opener);
  assert.notEqual(start, -1, `app/globals.css has no \`${opener}\` block`);
  let depth = 0;
  for (let i = start + opener.length - 1; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(start, i);
  }
  throw new Error(`unbalanced braces after \`${opener}\``);
}
const names = (src: string) => new Set([...src.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((m) => m[1]!));
const LIGHT = names(cssBlock("@theme {"));
const DARK = names(cssBlock('[data-theme="dark"] {'));

// A gate that quietly matches nothing is worse than no gate (same guard rail as
// scripts/design/check-design-tokens.mjs).
test("self-check: the fixtures this file reasons over are actually present", () => {
  assert.equal(Object.keys(GLYPHS).length, 20);
  assert.ok(LIGHT.size >= 8 && DARK.size >= 8, `parsed ${LIGHT.size} light / ${DARK.size} dark tokens`);
  assert.ok(
    Object.values(GLYPHS).every((g) => g.data.length > 0),
    "a glyph module exported an empty path list",
  );
});

/* ── 1. Every fill leaves snapToToken as a token both themes declare ───────── */

test("every fill resolves to a --color-* token declared in BOTH themes", () => {
  for (const [name, glyph] of Object.entries(GLYPHS)) {
    for (const [i, p] of glyph.data.entries()) {
      const where = `${name}[${i}] fill=${JSON.stringify(p.fill)}`;
      // The tracer may only emit a 6-digit hex (what snapToToken's rgb() parses)
      // or a var(--color-…) it resolved itself. Anything else falls through the
      // snap untouched and is painted literally — a colour that cannot theme.
      assert.ok(
        /^#[0-9a-fA-F]{6}$/.test(p.fill) || /^var\(--color-[a-z0-9-]+\)$/.test(p.fill),
        `${where}: not a 6-digit hex nor a var(--color-…) — snapToToken would paint it raw`,
      );
      const paint = snapToToken(p.fill).paint;
      const token = /^var\(--color-([a-z0-9-]+)\)$/.exec(paint)?.[1];
      assert.ok(token, `${where}: snapToToken returned ${JSON.stringify(paint)}, not a var(--color-…)`);
      assert.ok(LIGHT.has(token), `${where}: --color-${token} is not declared in the @theme block`);
      assert.ok(DARK.has(token), `${where}: --color-${token} has no [data-theme="dark"] value — invisible in dark`);
    }
  }
});

/* ── 2. Geometry envelope ─────────────────────────────────────────────────── */

/** `"0 0 W H"` -> `[W, H]`. Anything else makes the <svg> render at a wrong scale. */
function extents(viewBox: string): [number, number] {
  const n = viewBox.trim().split(/\s+/).map(Number);
  assert.equal(n.length, 4, `viewBox ${JSON.stringify(viewBox)} is not 4 numbers`);
  assert.ok(
    n.every((v) => Number.isFinite(v)),
    `viewBox ${JSON.stringify(viewBox)} has a non-numeric value`,
  );
  assert.equal(n[0], 0, `viewBox ${JSON.stringify(viewBox)} does not start at the origin`);
  assert.equal(n[1], 0, `viewBox ${JSON.stringify(viewBox)} does not start at the origin`);
  assert.ok(n[2]! > 0 && n[3]! > 0, `viewBox ${JSON.stringify(viewBox)} has a non-positive extent`);
  return [n[2]!, n[3]!];
}

/**
 * The tracer's full-canvas substrate layer: `M0 0h{W}v{H}H0z`, optionally carrying
 * the negative-space holes as further subpaths. The close command is `z` in most
 * emitted files and `Z` in decisionsGlyph — SVG treats them identically, so this
 * predicate has to as well.
 */
const substrate = (d: string, w: number, h: number) =>
  new RegExp(`^M0 0h${w}v${h}H0[zZ]`).test(d.trim());

test("every viewBox parses and matches the traced canvas", () => {
  for (const [name, glyph] of Object.entries(GLYPHS)) {
    const [w, h] = extents(glyph.viewBox);
    // The trace always opens with a full-canvas rect. If its numbers and the
    // viewBox ever disagree the art clips or floats inside the box.
    assert.ok(substrate(glyph.data[0]!.d, w, h), `${name}: first path is not the ${w}x${h} full-canvas substrate`);
  }
});

test("no path is traced twice inside one glyph", () => {
  for (const [name, glyph] of Object.entries(GLYPHS)) {
    const seen = new Map<string, number>();
    for (const [i, p] of glyph.data.entries()) {
      assert.equal(seen.get(p.d), undefined, `${name}[${i}] duplicates the geometry of [${seen.get(p.d)}]`);
      seen.set(p.d, i);
    }
  }
});

/* ── 3. Motion metadata ───────────────────────────────────────────────────── */

test("every delay is a finite 0..1 reveal position", () => {
  for (const [name, glyph] of Object.entries(GLYPHS)) {
    for (const [i, p] of glyph.data.entries()) {
      // MotionizedGlyph maps this through `0.08 + delay * spread` into seconds.
      // A NaN yields `animation-delay: NaNs` (ignored -> the path pops in at 0);
      // a negative starts mid-animation; >1 stretches the reveal past its budget.
      assert.equal(typeof p.delay, "number", `${name}[${i}]: delay is not a number`);
      assert.ok(Number.isFinite(p.delay), `${name}[${i}]: delay is not finite`);
      assert.ok(p.delay >= 0 && p.delay <= 1, `${name}[${i}]: delay ${p.delay} is outside 0..1`);
    }
  }
});

test("the full-canvas substrate reveals first, not last", () => {
  // The tracer derives `delay` from a path's radius, so the full-canvas layers —
  // the ground and the negative-space sheet the art sits on — come out at the
  // MAXIMUM radius and therefore last. Rendered, that means the illustration
  // draws itself on the bare panel and only then does its own ground fade and
  // scale up behind it: in Spark Dark, --color-paper (#141b24) against a
  // PANEL_SUNKEN bg-stone-50 (#222d39), a hard-edged darker rectangle swelling
  // in ~1.2s after everything else has settled. The substrate is what the art
  // sits ON; it has to be there first.
  //
  // If a regeneration reinstates the radial value here, set the leading
  // full-canvas layers back to 0 (and fix the emitter in
  // .claude/skills/motionize) rather than relaxing this assertion.
  for (const [name, glyph] of Object.entries(GLYPHS)) {
    const [w, h] = extents(glyph.viewBox);
    for (const [i, p] of glyph.data.entries()) {
      if (!substrate(p.d, w, h)) break; // substrate layers are the leading ones
      assert.equal(p.delay, 0, `${name}[${i}]: full-canvas substrate reveals at ${p.delay}, must be 0`);
    }
  }
});
