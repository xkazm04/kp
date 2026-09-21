// RouteError is TSX, so this gate reads the source rather than mounting it.
// The digest is the server-side correlation id; without a Report action that
// POSTs it, the printed hex is only useful as a screenshot.
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(HERE, "RouteError.tsx"), "utf8");

test("RouteError can file the digest through /api/feedback", () => {
  assert.match(src, /fetch\("\/api\/feedback"/, "Report POSTs the same door as FeedbackDialog");
  assert.match(src, /digest=\$\{digest\}/, "the body carries the server digest, not a screenshot of it");
  assert.match(src, /route:\s*pathname/, "the body carries the route the crash replaced");
  assert.match(src, /t\("report"\)/, "the secondary action is the catalog Report label");
  assert.match(src, /disabled=\{report !== "idle"\}/, "Report disables after success so it cannot double-file");
  assert.equal(src.includes("error.message"), false, "the thrown English line must never enter the feedback row");
});
