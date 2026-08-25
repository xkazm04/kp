// Source-guard: Radio must not set aria-invalid on <input type="radio">.
// The attribute is not supported by the implicit "radio" role
// (jsx-a11y/role-supports-aria-props). Visual invalid state uses accent-red-500
// only; screen readers discover invalidity from the wrapping form group, not
// from an attribute that ARIA does not allow on this role.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("./Radio.tsx", import.meta.url)), "utf8");

test("Radio input must not carry aria-invalid — the attribute is unsupported on the radio role", () => {
  // Check for the JSX attribute assignment, not the word that may appear in comments.
  assert.ok(
    !src.includes("aria-invalid="),
    "Radio.tsx sets aria-invalid= on <input type='radio'>, which is rejected by jsx-a11y/role-supports-aria-props. Remove the attribute assignment and rely on accent-red-500 for the visual invalid state."
  );
});
