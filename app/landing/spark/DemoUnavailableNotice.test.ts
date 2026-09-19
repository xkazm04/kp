// The gated demo door used to land on a dismiss-only banner. The notice now
// also offers /about (the public pipeline story) so the CTA is not a dead end.
//
// SOURCE-LEVEL: DemoUnavailableNotice is a client component (useSearchParams)
// and the unit runner has no React renderer. The contract is "which href is
// rendered, and that dismiss still exists", which the source states exactly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(HERE, "DemoUnavailableNotice.tsx"), "utf8");

test("the unavailable-demo banner offers /about as a next step, and still dismisses", () => {
  assert.match(src, /href="\/about"/, "the fallback must be a real navigation to /about");
  assert.match(src, /t\("nav\.about"\)/, "the link label is catalog-keyed (landing.nav.about)");
  assert.match(src, /t\("demoNotice\.dismiss"\)/, "dismiss stays — the banner is not a trap");
  assert.doesNotMatch(
    src,
    /router\.(replace|push)|location\.(assign|replace)|window\.location/,
    "a gated deploy must not auto-redirect away from the landing",
  );
});
