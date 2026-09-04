// Set-equality guard over the /motionize preset registry.
//
// The defect this exists to prevent: a `success-settle` "oneshot" preset shipped
// in MOTION_PRESETS and was advertised in `.claude/skills/motionize/SKILL.md`,
// but `MotionizedGlyph` only ever exposed three props (entrance / ambient /
// hover) — so no consumer could reach it and nothing failed. A preset that the
// renderer cannot render is documentation that lies.
//
// 2026-09 sharpened the same rule one notch: `draw` and `hover-response` WERE
// reachable through a prop and still had no consumer in the app, so the props
// went with them. The renderer now composes two layers, entrance and ambient.
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AMBIENT_PRESETS,
  ENTRANCE_PRESETS,
  MOTION_PRESETS,
  ambientStartDelayS,
  type MotionPresetName,
} from "./motionPresets.ts";

// The canonical list: the two records MotionizedGlyph actually reads.
const RENDERABLE = [...Object.keys(ENTRANCE_PRESETS), ...Object.keys(AMBIENT_PRESETS)].sort();

test("every registered preset is reachable through a MotionizedGlyph prop", () => {
  assert.deepEqual(Object.keys(MOTION_PRESETS).sort(), RENDERABLE);
});

test("no renderable layer is missing from the flat registry", () => {
  for (const name of RENDERABLE) {
    assert.ok(MOTION_PRESETS[name as MotionPresetName], `${name} missing from MOTION_PRESETS`);
  }
});

test("each preset declares a kind matching the layer it lives in", () => {
  for (const p of Object.values(ENTRANCE_PRESETS)) assert.equal(p.kind, "entrance");
  for (const p of Object.values(AMBIENT_PRESETS)) assert.equal(p.kind, "loop");
});

test("ambient loops start only after the entrance has fully settled", () => {
  // The taste guardrail in motionPresets.ts: sequence, never overlap.
  for (const entrance of Object.values(ENTRANCE_PRESETS)) {
    const spread = 1.1;
    const last = entrance.stagger ? entrance.stagger(1, spread) : 0;
    assert.ok(ambientStartDelayS(entrance, spread) >= last + entrance.durationS);
  }
});
