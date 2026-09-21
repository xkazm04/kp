// Pins that a successful Generate keeps the returned slug as a library-row href.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateSuccessHref, readGenerateSlug } from "./jdsBuilderGenerate.ts";

test("a generate payload's slug becomes a library-row href", () => {
  const slug = readGenerateSlug({ slug: "staff-eng", taskId: "t1" });
  assert.equal(slug, "staff-eng");
  assert.equal(generateSuccessHref(slug), "/?tab=library&jd=staff-eng");
});

test("the success handler never drops a present slug", () => {
  const href = generateSuccessHref(readGenerateSlug({ slug: "role-x", taskId: "abc" }));
  assert.match(href, /[?&]jd=role-x(?:&|$)/);
  assert.match(href, /[?&]tab=library(?:&|$)/);
});

test("a missing or blank slug still links at the library tab", () => {
  assert.equal(readGenerateSlug({ taskId: "t1" }), null);
  assert.equal(readGenerateSlug({ slug: "  " }), null);
  assert.equal(readGenerateSlug(null), null);
  assert.equal(generateSuccessHref(null), "/?tab=library");
});

test("runGenerate reads the slug and the builder renders it as a link", () => {
  const logic = readFileSync(new URL("./jdsBuilderLogic.ts", import.meta.url), "utf8");
  assert.ok(logic.includes("readGenerateSlug("), "success path must parse the slug");
  assert.ok(logic.includes("generateSuccessHref("), "success path must keep a library href");
  const ui = readFileSync(new URL("./JdsBuilder.tsx", import.meta.url), "utf8");
  assert.ok(ui.includes("queuedHref"), "the queued chip must carry the href");
  assert.ok(/<Link\b[^>]*href=\{queuedHref\}/.test(ui), "the queued status must be a link to that href");
});
