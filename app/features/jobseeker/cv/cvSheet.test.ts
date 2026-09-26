import { test } from "node:test";
import assert from "node:assert/strict";
import { cssString, cvHeadingsOf } from "./cvSheet";

test("the running head's CSS string cannot leave its literal, whatever the seeker's name", () => {
  assert.equal(cssString("Jörg Weißhaupt"), '"Jörg Weißhaupt"');
  assert.equal(cssString("Jana O'Neill-Nováková"), `"Jana O'Neill-Nováková"`);
  const hostile = cssString('x"}</style><script>alert(1)</script>\\');
  assert.ok(!/["\\](?![0-9a-f])/.test(hostile.slice(1, -1).replace(/\\[0-9a-f]+ /g, "")), hostile);
  assert.ok(!hostile.includes("<") && !hostile.includes("}"), hostile);
  assert.equal(cssString("a\nb"), '"a\\a b"');
});

test("the headings carry a projects heading in every CV language", () => {
  for (const lang of ["en", "cs", "de", "fr"] as const) assert.ok(cvHeadingsOf({ lang }).projects.length > 0, lang);
});
