// The landing pages' reduced-motion contract, as a guard rather than a doc line.
//
// docs/features/marketing/README.md states the rule ("Reduced motion goes through
// `useStillMotion`, never framer's hook") and spark/useStillMotion.ts explains why:
// framer's `useReducedMotion` answers `null` during SSR and reads the media query
// exactly ONCE into `useState` on the client — its own source carries the "TODO See
// if people miss automatically updating" note. A component branching on it therefore
// never responds to the preference changing, and one branching its MARKUP on it
// hydrates against HTML the server did not produce (the hero's confetti did exactly
// that, and took the whole page down with it).
//
// Both rules had drifted before this guard existed: Marquee.tsx was still on framer's
// hook, and AboutCurve's scroll hint ran `repeat: Infinity` with no gate at all.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// This file lives at app/landing/spark/ — the whole marketing tree is app/landing/.
const LANDING = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      sources(full, out);
    } else if (/\.tsx?$/.test(name) && !name.endsWith(".test.ts") && !name.endsWith(".test.tsx")) {
      out.push(full);
    }
  }
  return out;
}

/** Comments explain the rules (InterviewArt names `repeat: Infinity` only to say it
 *  deliberately uses the CSS keyframe instead), so both checks read CODE, not prose. */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

const FILES = sources(LANDING);

/* Pre-existing holdouts, recorded rather than hidden: these four still read framer's
 * hook and are owned elsewhere (SectionRail/FeatureSpotlight are the page shell;
 * spark/market/* was swept separately). Three branch only `initial`/`layoutId` on a
 * client-only subtree, but market/CzMap.tsx branches `initial={reduce ? false : …}`
 * on a server-rendered node — the inline-style hydration hazard the rule exists to
 * stop. Delete an entry as it is migrated; the list must only ever shrink. */
const KNOWN_FRAMER_HOOK_HOLDOUTS = new Set([
  "spark/FeatureSpotlight.tsx",
  "spark/SectionRail.tsx",
  "spark/market/CzMap.tsx",
  "spark/market/parts.tsx",
]);

const rel = (f: string) => path.relative(LANDING, f).replace(/\\/g, "/");

test("the landing tree has source files to check", () => {
  assert.ok(FILES.length > 20, `expected the landing tree, found ${FILES.length} files`);
});

test("no landing component reads reduced motion through framer's hook", () => {
  const offenders = FILES.filter((f) => /\buseReducedMotion\b/.test(code(f)))
    .map(rel)
    .filter((f) => !KNOWN_FRAMER_HOOK_HOLDOUTS.has(f));
  assert.deepEqual(
    offenders,
    [],
    `use useStillMotion (app/landing/spark/useStillMotion.ts) instead — framer's hook is SSR-wrong ` +
      `and never updates after the first render: ${offenders.join(", ")}`
  );
});

test("every looping landing animation is gated on reduced motion", () => {
  // `cycle()` in trust-art/shared.tsx takes the flag as a `reduceMotion` parameter
  // rather than calling the hook itself, so either name counts as a gate.
  const ungated = FILES.filter((f) => {
    const src = code(f);
    return /repeat:\s*Infinity/.test(src) && !/useStillMotion|reduceMotion|useReducedMotion/.test(src);
  }).map(rel);
  assert.deepEqual(
    ungated,
    [],
    `an infinite framer loop must gate its \`animate\` prop on useStillMotion() ` +
      `(gate the prop, never the markup): ${ungated.join(", ")}`
  );
});
