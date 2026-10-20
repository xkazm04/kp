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

// The transport row (stage/transport.ts). It rides beside the status line in
// every scene because every scene already renders SceneStatus, so no scene
// file had to change to gain it.
test("SceneStatus renders the transport outside the live region", () => {
  const fn = shared.match(/export function SceneStatus\([\s\S]*?\n\}/);
  assert.ok(fn, "could not find SceneStatus in shared.tsx");
  const body = fn[0];
  assert.match(body, /<SceneTransport\b/, "every scene gets stop, step and scrub through SceneStatus");
  const p = body.slice(body.indexOf("<p"), body.indexOf("</p>"));
  assert.doesNotMatch(p, /SceneTransport/, "a beat counter inside the live region would be read out every 900ms");
});

test("the transport is labelled from about.transport.* and is never a live region", () => {
  const fn = shared.match(/function SceneTransport\([\s\S]*?\n\}/);
  assert.ok(fn, "could not find SceneTransport in shared.tsx");
  const body = fn[0];
  assert.match(body, /useTranslations\("about\.transport"\)/);
  const buttons = body.match(/<button\b[\s\S]*?>/g) ?? [];
  assert.ok(buttons.length >= 3, "step back, play/stop and step forward are buttons");
  for (const b of buttons) {
    assert.match(b, /aria-label=\{[^}]*\bt\("/, `every transport button is named from the catalog: ${b}`);
  }
  assert.match(body, /type="range"[\s\S]*?aria-label=\{t\(/, "the scrubber is a named range input");
  assert.doesNotMatch(body, /aria-live/, "the position changes every beat; it must not be announced");
  assert.doesNotMatch(body, /onKeyDown/, "restart is a labelled act, never a key toggle");
});

test("the deck header offers one stop for every chapter", () => {
  const tab = readFileSync(path.join(HERE, "..", "AboutTab.tsx"), "utf8");
  assert.match(tab, /createDeckTransport\(/);
  assert.match(tab, /t\("transport\.stopAll"\)/);
  assert.match(tab, /t\("transport\.playAll"\)/);
  assert.match(tab, /loadDeckStop\(/, "the remembered stop is read through the guarded loader");
});
