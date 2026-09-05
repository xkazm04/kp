// The attachments pane's two disclosures, asserted at the SOURCE: the component
// needs React, framer-motion and next-intl to run, and both properties are
// structural rather than computational. Runner: `npm run test:unit`.
//
// Red-first premise: the pane imported `ATTACHMENT_TEXT_MAX` and nothing else,
// so the note-length cap was disclosed before the send while the COUNT cap was
// not. A sixth attachment looked addable, the click spent a round trip, and the
// route's `INTAKE_ATTACHMENT_LIMIT` refusal (400, with `max` alongside) came
// back to a form that showed one generic red line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ATTACHMENT_LIMIT, ATTACHMENT_TEXT_MAX } from "@/app/api/intake/[id]/attachments/attachment-limits";

const SRC = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "JdsIntakeAttachmentsPane.tsx"),
  "utf8"
).replace(/\r\n/g, "\n");

test("the pane states the count cap and stops at it", () => {
  // BOTH caps come from the route's module — never re-typed here, so the
  // composer's disclosure and the server's refusal cannot drift apart.
  assert.match(SRC, /import \{ ATTACHMENT_LIMIT, ATTACHMENT_TEXT_MAX \} from "@\/app\/api\/intake\/\[id\]\/attachments\/attachment-limits"/);
  assert.ok(!/const ATTACHMENT_LIMIT =/.test(SRC), "the cap is imported, not re-declared");

  // "N of LIMIT", localized, with the imported number interpolated.
  assert.match(SRC, /t\("countOfMax", \{ used: attachments\.length, max: ATTACHMENT_LIMIT \}\)/);

  // The add controls are DISABLED at the cap, not merely refused after a click.
  assert.match(SRC, /const atLimit = attachments\.length >= ATTACHMENT_LIMIT;/);
  const addBlock = SRC.slice(SRC.indexOf('mode === "none"'), SRC.indexOf('mode === "note" ?'));
  assert.equal(
    (addBlock.match(/disabled=\{atLimit\}/g) ?? []).length,
    2,
    "both the note and the JD opener stop at the cap"
  );

  // …and the reason is the ROUTE's code, resolved in the reader's language,
  // never a second sentence invented here that could disagree with it.
  assert.match(SRC, /useErrorMessage\(\)/);
  assert.match(SRC, /resolveError\(\{ code: "INTAKE_ATTACHMENT_LIMIT" \}/);
});

test("the caps the pane discloses are the caps the route enforces", () => {
  // NON-VACUITY for the assertions above: if either constant moved, the pane's
  // sentence would still be right, because it never holds a literal.
  assert.equal(ATTACHMENT_LIMIT, 5);
  assert.equal(ATTACHMENT_TEXT_MAX, 20_000);
  assert.ok(!SRC.includes("of 5"), "the count sentence must not carry a literal cap");
});
