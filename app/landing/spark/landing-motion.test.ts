// The landing pages' reduced-motion contract, as a guard rather than a doc line.
//
// docs/features/marketing/README.md ("Reduced motion") states the rule — read the
// query as live external state (`useMedia` in site/land/features/panels/kit.tsx, or
// matchMedia in an effect), never through framer's hook — and why:
// framer's `useReducedMotion` answers `null` during SSR and reads the media query
// exactly ONCE into `useState` on the client — its own source carries the "TODO See
// if people miss automatically updating" note. A component branching on it therefore
// never responds to the preference changing, and one branching its MARKUP on it
// hydrates against HTML the server did not produce (the old hero's confetti did
// exactly that, and took the whole page down with it).
//
// These two checks are the tree-wide half of what AboutCurve.test.ts held until the
// old Spark landing and About (AboutCurve, about-art/*Art.tsx, previews/*) were
// retired on 2026-09-30 for app/landing/site/ (with them trust-art/ and
// spark/useStillMotion.ts, which only they used). The per-file halves went with
// the files they read; these still walk ALL of app/landing/ (site/, spark/market,
// ...), so a framer loop added anywhere in the marketing tree is still caught. The
// new site animates in CSS and gates it with `@media (prefers-reduced-motion)` in
// its scoped sheets, or reads the query through matchMedia / `useMedia` in its
// client islands.
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

/** Comments explain the rules (a file may name `repeat: Infinity` only to say it
 *  deliberately uses a CSS keyframe instead), so both checks read CODE, not prose. */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

const FILES = sources(LANDING);

/* Pre-existing holdouts, recorded rather than hidden: these still read framer's hook
 * and are owned elsewhere (spark/market/* was swept separately). market/CzMap.tsx
 * branches `initial={reduce ? false : …}` on a server-rendered node — the
 * inline-style hydration hazard the rule exists to stop. Delete an entry as it is
 * migrated; the list must only ever shrink. */
const KNOWN_FRAMER_HOOK_HOLDOUTS = new Set([
  "spark/market/CzMap.tsx",
  "spark/market/parts.tsx",
]);

const rel = (f: string) => path.relative(LANDING, f).replace(/\\/g, "/");

test("the landing tree has source files to check", () => {
  assert.ok(FILES.length > 20, `expected the landing tree, found ${FILES.length} files`);
  assert.ok(
    FILES.some((f) => rel(f).startsWith("site/")),
    "the walk must reach app/landing/site/, the live landing and About"
  );
});

test("no landing component reads reduced motion through framer's hook", () => {
  const offenders = FILES.filter((f) => /\buseReducedMotion\b/.test(code(f)))
    .map(rel)
    .filter((f) => !KNOWN_FRAMER_HOOK_HOLDOUTS.has(f));
  assert.deepEqual(
    offenders,
    [],
    `use useMedia (app/landing/site/land/features/panels/kit.tsx) or matchMedia in an effect instead — framer's hook is SSR-wrong ` +
      `and never updates after the first render: ${offenders.join(", ")}`
  );
});

test("every looping landing animation is gated on reduced motion", () => {
  // A helper may take the flag as a `reduceMotion` parameter rather than reading
  // the query itself, so any of these names counts as a gate.
  const ungated = FILES.filter((f) => {
    const src = code(f);
    return /repeat:\s*Infinity/.test(src) && !/useMedia|matchMedia|reduceMotion|useReducedMotion/.test(src);
  }).map(rel);
  assert.deepEqual(
    ungated,
    [],
    `an infinite framer loop must gate its \`animate\` prop on the live reduced-motion preference ` +
      `(gate the prop, never the markup): ${ungated.join(", ")}`
  );
});
