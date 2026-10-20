import { test } from "node:test";
import assert from "node:assert/strict";
import { messageBlocks } from "./messageBlocks.ts";

const BID = [
  "Hello, your storefront brief is clear and I would like to build it.",
  "",
  "How I would approach it:",
  "- A static HTML/CSS catalog with a cart kept in the browser",
  "- A small server endpoint for the PhonePe payment and its callback",
  "",
  "To get started once we agree, I would need:",
  "- PhonePe merchant or sandbox credentials",
  "- A logo and colours (optional)",
  "",
  "Happy to adapt the plan. Just reply here.",
  "",
  "This proposal was prepared with the help of AI tools and reviewed by me before sending.",
].join("\n");

test("the bid's shape: paragraphs, and each '- ' run a list headed by the line before it", () => {
  const b = messageBlocks(BID);
  assert.deepEqual(
    b.map((x) => (x.kind === "p" ? `p:${x.text.slice(0, 12)}` : `list:${x.lead}:${x.items.length}`)),
    ["p:Hello, your ", "list:How I would approach it::2", "list:To get started once we agree, I would need::2", "p:Happy to ada", "p:This proposa"]
  );
});

test("a list with no lead line, prose after a list in the same paragraph, CRLF, and no list at all", () => {
  assert.deepEqual(messageBlocks("Hi.\r\n- a\r\n- b\r\nThanks."), [
    { kind: "p", text: "Hi." },
    { kind: "list", lead: null, items: ["a", "b"] },
    { kind: "p", text: "Thanks." },
  ]);
  assert.deepEqual(messageBlocks("One line\nwrapped here."), [{ kind: "p", text: "One line wrapped here." }]);
  assert.deepEqual(messageBlocks(""), []);
});
