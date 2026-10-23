import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COPY } from "./copy.ts";

// An owner who opens /setup/studio by following a link lands on the empty state. It must
// tell them this page is optional and where the normal setup is, or they conclude the
// product needs a terminal installer to start.
test("the empty state says the studio is optional and where the normal setup is", () => {
  assert.match(COPY.emptyOptional, /do not need this/i);
  assert.match(COPY.emptyOptional, /Sign in/);
  const src = readFileSync(new URL("./SetupStudio.tsx", import.meta.url), "utf8");
  assert.match(src, /kind === "none" \? <p[^>]*>\{COPY\.emptyOptional\}/);
});
