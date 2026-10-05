// The Night Post's places on the kit's level stack (app/_components/kit/scene/levelStack.test.ts pins the
// generic rules and the layer modes): its reducer binding, the channel / message steps, the ?sec= grammar.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LEDGER_ALL, NIGHT_CHANNELS, NIGHT_ROOT, channelOf, layerKey, nightArrivalParam, nightReduce, parseNightArrival,
  stepChannel, stepMessage, type NightEntry, type NightStack,
} from "./channelsNightNav.ts";

const relay: NightEntry = { level: 1, channel: "relay", focus: null };
const email: NightEntry = { level: 1, channel: "email", focus: null };
const msg = (id: string, list = ["a", "b", "c"]): NightEntry => ({ level: 3, id, list });

test("push opens a level over the current one; pop returns; the root never leaves", () => {
  let s: NightStack = NIGHT_ROOT;
  s = nightReduce(s, { type: "push", entry: relay });
  s = nightReduce(s, { type: "push", entry: LEDGER_ALL });
  assert.deepEqual(s.map((e) => e.level), [0, 1, 2]);
  s = nightReduce(s, { type: "pop" });
  assert.deepEqual(s, [NIGHT_ROOT[0], relay]);
  s = nightReduce(nightReduce(s, { type: "pop" }), { type: "pop" });
  assert.deepEqual(s, NIGHT_ROOT, "popping at the root stays at the root");
});

test("a push of a place already on the stack returns to it instead of looping", () => {
  let s: NightStack = [NIGHT_ROOT[0], relay, LEDGER_ALL, msg("a")];
  s = nightReduce(s, { type: "push", entry: { level: 1, channel: "relay", focus: "x" } });
  assert.deepEqual(s.map((e) => e.level), [0, 1]);
  assert.equal(nightReduce(s, { type: "push", entry: { level: 0 } }).length, 1, "pushing the plumbing is going home");
});

test("popTo is a breadcrumb click; replaceTop keeps its level", () => {
  const s: NightStack = [NIGHT_ROOT[0], relay, LEDGER_ALL, msg("a")];
  assert.deepEqual(nightReduce(s, { type: "popTo", depth: 1 }), [NIGHT_ROOT[0], relay]);
  assert.deepEqual(nightReduce(s, { type: "popTo", depth: 0 }), NIGHT_ROOT);
  assert.deepEqual(nightReduce(s, { type: "replaceTop", entry: msg("b") }).at(-1), msg("b"));
  assert.equal(nightReduce(s, { type: "replaceTop", entry: email }), s, "a sideways step cannot change the level");
  assert.equal(nightReduce(NIGHT_ROOT, { type: "replaceTop", entry: email }), NIGHT_ROOT, "the root is not replaced");
});

test("a reset to a stack without the plumbing at its root is refused", () => {
  assert.deepEqual(nightReduce([NIGHT_ROOT[0], relay], { type: "reset", stack: [relay] }), NIGHT_ROOT);
});

test("channels step round the six in order; messages stop at the ends", () => {
  assert.equal(stepChannel("careers", -1), "edge");
  assert.equal(stepChannel("edge", 1), "careers");
  assert.equal(stepChannel("ads", 1), "feeds");
  assert.equal(stepMessage({ level: 3, id: "a", list: ["a", "b"] }, -1), null);
  assert.equal(stepMessage({ level: 3, id: "a", list: ["a", "b"] }, 1), "b");
  assert.equal(stepMessage({ level: 3, id: "z", list: ["a", "b"] }, 1), null);
});

test("every old ?sec= link still lands: comms is the ledger, the three doors are their channels", () => {
  assert.deepEqual(parseNightArrival("comms"), [NIGHT_ROOT[0], LEDGER_ALL]);
  for (const door of ["careers", "email", "ads"] as const) {
    assert.deepEqual(parseNightArrival(door), [NIGHT_ROOT[0], { level: 1, channel: door, focus: null }]);
  }
});

test("the new grammar: channels with a focus, verdict filters, a message over the ledger", () => {
  assert.deepEqual(parseNightArrival("feeds:hook_abc-1"), [NIGHT_ROOT[0], { level: 1, channel: "feeds", focus: "hook_abc-1" }]);
  assert.deepEqual(parseNightArrival("dead")?.at(-1), { level: 2, verdict: "dead", role: null, from: null });
  assert.deepEqual(parseNightArrival("bounced")?.at(-1), { level: 2, verdict: "bounced", role: null, from: null });
  assert.deepEqual(parseNightArrival("msg:out-42")?.map((e) => e.level), [0, 2, 3]);
  assert.deepEqual(parseNightArrival("plumbing"), NIGHT_ROOT);
});

test("anything that is not ours is ignored, never a guess", () => {
  for (const raw of [null, "", "  ", "quality", "msg", "msg:", "relay:../../etc", "comms:x", "dead:1", "plumbing:x"]) {
    assert.equal(parseNightArrival(raw), null, String(raw));
  }
});

test("nightArrivalParam is the inverse of the grammar for every addressable place", () => {
  const places: NightEntry[] = [
    NIGHT_ROOT[0],
    LEDGER_ALL,
    { level: 2, verdict: "dead", role: null, from: null },
    ...NIGHT_CHANNELS.map((channel) => ({ level: 1 as const, channel, focus: null })),
    { level: 1, channel: "email", focus: "tok_1" },
  ];
  for (const p of places) assert.deepEqual(parseNightArrival(nightArrivalParam(p))?.at(-1), p);
  assert.deepEqual(parseNightArrival(nightArrivalParam(msg("m-1", ["m-1"])))?.at(-1), msg("m-1", ["m-1"]));
});

test("layer keys differ per place, and the owner channel is known per level", () => {
  assert.notEqual(layerKey(relay, 1), layerKey(email, 1));
  assert.notEqual(layerKey(msg("a"), 3), layerKey(msg("b"), 3));
  assert.equal(channelOf(relay), "relay");
  assert.equal(channelOf(LEDGER_ALL), "book");
  assert.equal(channelOf(NIGHT_ROOT[0]), null);
});
