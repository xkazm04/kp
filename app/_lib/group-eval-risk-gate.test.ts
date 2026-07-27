// The group-eval "lower fit" watch-out gate. It read
//   c.score != null && c.score > 0 && c.score < 55
// which is wrong twice: post-REC-03 a null score ALREADY means unscored (nothing is
// ever fabricated as 0), so `> 0` exempted exactly the WORST measured candidate in the
// field from the flag; and 55 re-hardcoded the shared FIT_PROMISING_FLOOR whose own
// test requires consuming surfaces to derive from it.
//
// buildGroupEval is not loadable under this runner (it pulls the db barrel + the
// python runner), so this test lifts the SHIPPED condition out of the source and
// evaluates it — a real behavioural check on the expression that runs in production,
// with no refactor.
//
// The GATE is unchanged; only what it pushes moved: eval-speaks-your-language made the
// risk a STRUCTURED FACT (`{ kind: "low_fit", … }`) instead of an English sentence, so
// the anchor below matches the fact literal rather than the template string.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { FIT_PROMISING_FLOOR } from "./fit-thresholds.ts";

const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "group-eval-run.ts"), "utf8");

const m = src.match(/if \((c\.score != null && [^)]*)\) risks\.push\(\{ kind: "low_fit"/);
assert.ok(m, "could not locate the lower-fit risk gate in group-eval-run.ts");
const flagsLowerFit = new Function("c", "FIT_PROMISING_FLOOR", `return !!(${m![1]});`) as (
  c: { score: number | null },
  floor: number
) => boolean;
const flags = (score: number | null) => flagsLowerFit({ score }, FIT_PROMISING_FLOOR);

test("a measured 0 — the worst candidate in the field — IS flagged as lower fit", () => {
  assert.equal(flags(0), true);
});

test("everything below the promising floor is flagged; the floor itself and above is not", () => {
  assert.equal(flags(1), true);
  assert.equal(flags(FIT_PROMISING_FLOOR - 1), true);
  assert.equal(flags(FIT_PROMISING_FLOOR), false);
  assert.equal(flags(FIT_PROMISING_FLOOR + 1), false);
});

test("an UNSCORED candidate is not flagged — absence is not a low score", () => {
  assert.equal(flags(null), false);
});

test("the gate derives from FIT_PROMISING_FLOOR and has no `> 0` exemption", () => {
  assert.match(m![1], /FIT_PROMISING_FLOOR/, "the gate must use the shared floor, not a literal");
  assert.doesNotMatch(m![1], /> 0/, "the `> 0` clause exempted a genuine 0 and must be gone");
  assert.match(src, /import \{ FIT_PROMISING_FLOOR \} from "\.\/fit-thresholds"/);
});
