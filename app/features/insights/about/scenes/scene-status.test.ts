// SceneStatus is TSX, so this gate reads the source rather than mounting it.
// The status line is the deck's greppable narration; without a persistent live
// region, screen-reader users never hear the beat sighted users watch.
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const shared = readFileSync(path.join(HERE, "shared.tsx"), "utf8");

test("SceneStatus is a persistent polite live region, not a silent p", () => {
  const fn = shared.match(/export function SceneStatus\([\s\S]*?\n\}/);
  assert.ok(fn, "could not find SceneStatus in shared.tsx");
  const body = fn[0];
  assert.match(body, /aria-live="polite"/, "the outer p must be a live region mounted from beat 0");
  assert.match(body, /aria-atomic="true"/, "each status swap must be announced whole, not as a diff");
  assert.equal(
    (body.match(/<p\b/g) ?? []).length,
    1,
    "aria-live belongs on the always-mounted outer p, not a second wrapper",
  );
  assert.match(body, /<p\b[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.match(body, /key=\{text\}/, "the inner span stays keyed so the visual fade still runs");
});

test("every scene announces through SceneStatus", () => {
  const scenes = [
    "jd/JdGrounding.tsx",
    "scoring/ScoringBuckets.tsx",
    "screening/ScreeningLadder.tsx",
    "archetypes/ArchetypeRouter.tsx",
    "assignments/CaseBaseline.tsx",
    "gates/GatesQueue.tsx",
  ];
  for (const rel of scenes) {
    const src = readFileSync(path.join(HERE, rel), "utf8");
    assert.match(src, /<SceneStatus\b/, `${rel} must render SceneStatus so the live region exists from beat 0`);
  }
});
