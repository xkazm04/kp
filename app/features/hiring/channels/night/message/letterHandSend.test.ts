// Sending a letter yourself: which letters offer it, the plain-text copy, and the mailto link with
// its length cut (a long body opens with the subject only and is copied instead).
//
// Runner: Node's built-in test runner with type stripping - npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Message } from "../../channelsCommsHelpers.ts";
import { MAILTO_MAX, canHandSend, letterMailto, letterPlainText, mailAddressOf } from "./letterHandSend.ts";

const msg = (over: Partial<Message> = {}): Message => ({
  id: "m1", recipient: "jana@example.com", subject: "Your interview", body: "Hi Jana,\nSee you Monday.", kind: "invite",
  channel: "webhook", status: "queued", ref: "e1", createdAt: "2026-10-22T10:00:00.000Z", ...over,
});

test("offered on queued, failed and bounced letters only", () => {
  assert.equal(canHandSend(msg()), true);
  assert.equal(canHandSend(msg({ status: "failed" })), true);
  assert.equal(canHandSend(msg({ status: "sent", bounced: true })), true);
  assert.equal(canHandSend(msg({ status: "sent" })), false);
  assert.equal(canHandSend(msg({ status: "failed", recovered: true })), false);
  assert.equal(canHandSend(msg({ orphaned: true })), false);
});

test("never on a simulation or refused row, nor a letter with nothing in it", () => {
  assert.equal(canHandSend(msg({ channel: "simulation" })), false);
  assert.equal(canHandSend(msg({ channel: "refused" })), false);
  assert.equal(canHandSend(msg({ subject: null, body: "  " })), false);
});

test("plain text is subject, blank line, body", () => {
  assert.equal(letterPlainText(msg()), "Your interview\n\nHi Jana,\nSee you Monday.");
  assert.equal(letterPlainText(msg({ subject: null })), "Hi Jana,\nSee you Monday.");
  assert.equal(letterPlainText(msg({ body: null })), "Your interview");
});

test("only a single plausible address reaches the link", () => {
  assert.equal(mailAddressOf("jana@example.com"), "jana@example.com");
  assert.equal(mailAddressOf("a@b.cz,c@d.cz"), "");
  assert.equal(mailAddressOf("a@b.cz?cc=x@y.cz"), "");
  assert.equal(mailAddressOf("not an address"), "");
  assert.equal(mailAddressOf(null), "");
});

test("the mailto carries address, subject and a CRLF body, all encoded", () => {
  const { href, cut } = letterMailto(msg({ subject: "Offer & next steps" }));
  assert.equal(cut, false);
  assert.equal(href, "mailto:jana@example.com?subject=Offer%20%26%20next%20steps&body=Hi%20Jana%2C%0D%0ASee%20you%20Monday.");
});

test("no usable address leaves the To field empty", () => {
  assert.match(letterMailto(msg({ recipient: "" })).href, /^mailto:\?subject=/);
});

test("a body past the limit is cut: subject only, flagged for the clipboard", () => {
  const long = msg({ body: "x".repeat(MAILTO_MAX) });
  const { href, cut } = letterMailto(long);
  assert.equal(cut, true);
  assert.equal(href, "mailto:jana@example.com?subject=Your%20interview");
  assert.ok(letterMailto(msg(), 60).cut);
  assert.equal(letterMailto(msg({ body: null })).cut, false);
});
