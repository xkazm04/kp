// Pins positiveNumericEnv — the single guard every operability env knob (cache
// TTL, the spawn buffer ceiling, future tunables) routes through. These lock the
// three reject paths (missing / non-numeric / ≤ 0 → fallback), that a scale both
// multiplies AND floors to an exact integer, and that the no-scale path passes a
// fractional value through unrounded (so 0.5 cache hours survives).
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { positiveNumericEnv } from "./env.ts";

const VAR = "KP_TEST_POSITIVE_NUMERIC_ENV";

// Set (or clear, for undefined) the probe var, run fn, then restore the prior
// value so tests don't leak env state into one another.
function withEnv(value: string | undefined, fn: () => void): void {
  const prior = process.env[VAR];
  if (value === undefined) delete process.env[VAR];
  else process.env[VAR] = value;
  try {
    fn();
  } finally {
    if (prior === undefined) delete process.env[VAR];
    else process.env[VAR] = prior;
  }
}

test("falls back when the var is missing, empty, non-numeric, zero, or negative", () => {
  for (const bad of [undefined, "", "abc", "0", "-5"]) {
    withEnv(bad, () => {
      assert.equal(positiveNumericEnv(VAR, 24), 24, `${String(bad)} should yield the fallback`);
    });
  }
});

test("returns the parsed value for a positive override", () => {
  withEnv("48", () => {
    assert.equal(positiveNumericEnv(VAR, 24), 48);
  });
});

test("preserves a fractional value when no scale is given (e.g. 0.5 cache hours)", () => {
  withEnv("0.5", () => {
    assert.equal(positiveNumericEnv(VAR, 24), 0.5);
  });
});

test("scales and floors the override to an exact integer (MB → bytes)", () => {
  withEnv("128", () => {
    assert.equal(positiveNumericEnv(VAR, 64, { scale: 1024 * 1024 }), 128 * 1024 * 1024);
  });
  withEnv("1.7", () => {
    // 1.7 MB is not a whole number of bytes, so it must floor — never a fraction.
    assert.equal(positiveNumericEnv(VAR, 64, { scale: 1024 * 1024 }), Math.floor(1.7 * 1024 * 1024));
  });
});

test("scales the fallback too, so the default is in the same unit as the var", () => {
  withEnv(undefined, () => {
    assert.equal(positiveNumericEnv(VAR, 64, { scale: 1024 * 1024 }), 64 * 1024 * 1024);
  });
});
