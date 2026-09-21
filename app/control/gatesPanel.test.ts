// Pins the Art. 22 gate queue: every pending row offers a Review destination
// on Assignments that carries the lifecycle id. Approve stays the two-step
// no-edit path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("./GatesPanel.tsx", import.meta.url)), "utf8").replace(/\r\n/g, "\n");

test("every pending gate offers a Review link to Assignments with the lifecycle id", () => {
  assert.match(
    src,
    /href=\{\`\/\?tab=assignments&lifecycle=\$\{encodeURIComponent\(g\.id\)\}\`\}/,
    "the review href must include the lifecycle id"
  );
  assert.match(src, /t\("review"\)/);
  assert.match(src, /gateKey\(g\.id, g\.detail\)/, "Approve arms by gateKey so a changed detail re-arms");
  assert.match(src, /guard\(key, \(\) => onApprove\(g\.id\)\)/, "Approve still receives the lifecycle id");
});
