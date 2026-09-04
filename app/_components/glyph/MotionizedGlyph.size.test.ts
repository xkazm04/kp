/*
 * The renderer's DEFAULT size must come from the size vocabulary.
 *
 * `glyphSizes.ts` exists because fourteen sites had invented five sizes between
 * them; it declares four steps and `h-36 w-36` is the largest. The renderer's
 * own fallback was `h-40 w-40` — a fifth size, off the scale it was introduced
 * to replace, and the one size nobody chose deliberately: it applies precisely
 * where a consumer forgot to say. Today every call site passes a `GLYPH_SIZE`
 * step, so the default is unreachable in this tree and free to move; the point
 * of pinning it is the NEXT one, which will land on the scale by default rather
 * than off it.
 *
 * A source-guard rather than a render: the assertion is about the default in the
 * signature, which a rendered tree cannot distinguish from a passed className.
 *
 *   npm run test:unit
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GLYPH_SIZE } from "./glyphSizes.ts";

const src = readFileSync(fileURLToPath(new URL("./MotionizedGlyph.tsx", import.meta.url)), "utf8");

test("self-check: the renderer source was read", () => {
  assert.ok(src.includes("export function MotionizedGlyph"), "MotionizedGlyph.tsx did not parse as expected");
});

test("the default className is a step of GLYPH_SIZE, named not re-typed", () => {
  assert.match(
    src,
    /className = GLYPH_SIZE\.(sm|md|lg|xl),/,
    "the default size must reference a GLYPH_SIZE step — a hand-typed `h-N w-N` default is a size off the scale"
  );
});

test("no hand-typed square size literal survives in the renderer", () => {
  const literals = src.match(/["'`]h-\d+ w-\d+["'`]/g) ?? [];
  assert.deepEqual(literals, [], `hand-typed glyph sizes in MotionizedGlyph.tsx: ${literals.join(", ")}`);
});

test("the vocabulary tops out below the size the default used to be", () => {
  // Guards the premise of this whole file: if `xl` ever grows to h-40, the
  // default above stopped being off-scale and this test's story needs rewriting.
  assert.equal(GLYPH_SIZE.xl, "h-36 w-36");
  assert.equal(GLYPH_SIZE.lg, "h-28 w-28");
});
