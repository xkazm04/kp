import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// `invalid` is a VISUAL prop by its name — it flips the border to the error tone — and
// the easy way to write these two primitives is to let it stop there. It must not: a
// red border is a claim only a sighted reader can hear, and `aria-invalid` is the one
// that reaches everyone else (and the one a form's error summary is matched against).
// `Select` carries the same pairing and `Select.test.ts` guards its half; these are the
// other two members of the field family, and the three must not drift apart.
//
// JSX has no runner here, so the pairing is pinned at the source level.

const HERE = path.dirname(fileURLToPath(import.meta.url));

for (const [file, element] of [
  ["TextInput.tsx", "input"],
  ["TextArea.tsx", "textarea"],
] as const) {
  const src = readFileSync(path.join(HERE, file), "utf8");

  test(`${file}: invalid reaches aria-invalid on the ${element}`, () => {
    assert.match(src, /invalid = false/, "invalid defaults to false, not undefined");
    // `|| undefined`, not `{invalid}`: aria-invalid="false" is a valid, ANNOUNCED value
    // in some readers ("not invalid"), and every field in the app would carry it.
    assert.match(
      src,
      new RegExp(`<${element}[^>]*aria-invalid=\\{invalid \\|\\| undefined\\}`),
      `the ${element} must expose aria-invalid, and omit it when the field is fine`
    );
  });

  test(`${file}: the error tone and the a11y state come from the SAME prop`, () => {
    // If the border ever reads from something other than `invalid`, the visual claim and
    // the announced one can disagree — a red field that says nothing, or the reverse.
    assert.match(src, /const border = invalid \? "border-red-400"/);
  });
}
