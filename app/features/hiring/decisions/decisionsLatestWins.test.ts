// Pins the companion reads' liveness guard: only the newest read may write, and
// the two guarded call sites in the queue hook actually use it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTicketGate } from "./decisionsLatestWins.ts";

test("the only ticket taken is the latest", () => {
  const gate = createTicketGate();
  const a = gate.take();
  assert.equal(gate.isLatest(a), true);
});

test("a slow FIRST response cannot overwrite a fast second one", () => {
  const gate = createTicketGate();
  const slow = gate.take();
  const fast = gate.take();
  assert.equal(gate.isLatest(fast), true);
  assert.equal(gate.isLatest(slow), false, "the superseded read is dropped, not applied");
});

test("invalidate() drops every outstanding read without starting one", () => {
  const gate = createTicketGate();
  const inflight = gate.take();
  gate.invalidate();
  assert.equal(gate.isLatest(inflight), false);
  assert.equal(gate.isLatest(inflight + 1), true, "…and the gate is still usable after");
});

test("a ticket is never handed out twice, so a dropped read can't be revived", () => {
  const gate = createTicketGate();
  const seen = new Set<number>();
  for (let i = 0; i < 5; i++) {
    const t = gate.take();
    assert.equal(seen.has(t), false);
    seen.add(t);
    gate.invalidate();
  }
});

test("gates are independent — one read's ticket says nothing about another's", () => {
  const a = createTicketGate();
  const b = createTicketGate();
  const ta = a.take();
  b.take();
  b.take();
  assert.equal(a.isLatest(ta), true, "a second read on ANOTHER endpoint doesn't supersede this one");
});

const src = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("both companion reads take a ticket and say why they drop a failure", () => {
  const hook = src("useDecisionsQueue.ts");
  assert.match(hook, /reconsiderGate[\s\S]{0,400}?isLatest\(ticket\)/, "the reconsider read is gated");
  assert.match(hook, /evaluatedGate[\s\S]{0,500}?isLatest\(ticket\)/, "the evaluated read is gated");
  assert.doesNotMatch(hook, /\.catch\(\(\) => undefined\);/, "a swallowed failure states why inside the block");
});
