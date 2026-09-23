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

// "A preset needs a real consumer, not a prop" (motionPresets.ts) — enforced, not
// just stated. A render site is a `.tsx` under app/ passing the name literally
// (`ambient="float"`), or passing `ambientFor(...)` from glyphArrival.ts, whose one
// answer is ARRIVAL_AMBIENT. `pulse` had no consumer at all until the Decisions
// empty state learned to show a screening in flight (challenge-r03 glyph-system/B).
test("every ambient preset has at least one render site in app/", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { ARRIVAL_AMBIENT } = await import("./glyphArrival.ts");
  const appDir = fileURLToPath(new URL("../../", import.meta.url));
  const used = new Set<string>();
  const walk = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === "node_modules" || ent.name.startsWith(".")) continue;
      const p = join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith(".tsx")) {
        const src = readFileSync(p, "utf8");
        for (const m of src.matchAll(/ambient="([a-z-]+)"/g)) used.add(m[1]);
        if (src.includes("ambient={ambientFor(")) used.add(ARRIVAL_AMBIENT);
      }
    }
  };
  walk(appDir);
  for (const name of Object.keys(AMBIENT_PRESETS)) {
    assert.ok(used.has(name), `ambient preset "${name}" has no render site in app/`);
  }
});
