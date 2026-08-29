// Source guard for the attachments route's trust boundary: the operator gate
// runs first, JD bodies are resolved SERVER-SIDE from the workspace's library
// (never trusted from the client), the caps exist, and every store write goes
// through the workspace-scoped accessor. Mirrors the house source-guard style
// (rate-limit-contract.test.ts) since node:test can't resolve the "@/" alias.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("./[id]/attachments/route.ts", import.meta.url)), "utf8");
// The caps live in a sibling module (a non-handler `export const` in a route file
// aborts `next build` — backlog item 57), so the cap guard reads that file.
const limitsSrc = readFileSync(fileURLToPath(new URL("./[id]/attachments/attachment-limits.ts", import.meta.url)), "utf8");

test("attachments route: operator gate before any work", () => {
  const gate = src.indexOf("await requireOperator()");
  assert.ok(gate >= 0 && gate < src.indexOf("request.json"));
});

test("attachments route: JD bodies resolve server-side from the workspace library", () => {
  assert.match(src, /loadJd\(jdSlug, ws\)/);
  // The client's text field is only ever read for kind "note" — a jd attachment
  // must not carry client-authored body text.
  assert.ok(!/kind === "jd"[\s\S]{0,400}body\.text/.test(src), "jd attachments must not read body.text");
});

test("attachments route: caps are pinned", () => {
  assert.match(limitsSrc, /ATTACHMENT_LIMIT = 5/);
  assert.match(limitsSrc, /ATTACHMENT_TEXT_MAX = 20_000/);
  // …and the route still imports them rather than re-declaring its own.
  assert.match(src, /import \{ ATTACHMENT_LIMIT, ATTACHMENT_TEXT_MAX \} from "\.\/attachment-limits"/);
  assert.match(src, /slice\(0, ATTACHMENT_TEXT_MAX\)/);
});

test("attachments route: writes go through the workspace-scoped accessor and promoted sessions are frozen", () => {
  assert.match(src, /updateIntakeAttachments\(id, next, ws\)/);
  assert.match(src, /status === "promoted"/);
});
