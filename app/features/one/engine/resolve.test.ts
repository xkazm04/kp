// /one's conductor: deterministic intents, the honest fallback, and the reply rules the
// governing standard makes binding (say is a key with no figure, ≤ 4 ops, data changes
// only as `propose`). Run: node scripts/run-unit-tests.mjs "app/features/one/**/*.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchIntent, resolve, roleOf, FALLBACK_CHIPS } from "./resolve.ts";
import { validateReply } from "./validate.ts";
import { CHIP_IDS, MAX_OPS, type Reply } from "../types.ts";

const ctx = { attention: null };
const attention = { decisions: 2, pipeline: 1, schedule: 0, jobs: 3, channels: 0, companion: 0 };

function rules(r: Reply) {
  assert.ok(r.ops.length <= MAX_OPS, "≤ 4 ops");
  assert.ok(r.chips.length <= 4, "≤ 4 chips");
  for (const v of Object.values(r.say.values ?? {})) assert.doesNotMatch(v, /\d/, "say carries no figure");
  // The deterministic conductor's own replies pass the door untouched.
  assert.equal(validateReply(r).dropped, 0);
}

test("every chip resolves to a known reply that passes the door", () => {
  for (const chip of CHIP_IDS) {
    const r = resolve({ chip }, ctx);
    assert.equal(r.fallback, undefined, chip);
    rules(r);
    assert.ok(!r.chips.includes(chip), `${chip} is not offered again right after being pressed`);
  }
});

test("typed intents map to the expected view", () => {
  const cases: [string, string][] = [
    ["what needs me today?", "needs"],
    ["any decisions waiting on me", "decisionsQueue"],
    ["show me the pipeline", "pipelineSlice"],
    ["who is stalled", "pipelineSlice"],
    ["interviews this week", "calendar"],
    ["upcoming interviews", "scheduleAhead"],
    ["who is waiting for an interview", "calendar"],
    ["calendar", "calendar"],
    ["emails to approve", "letters"],
    ["drafts waiting", "letters"],
    ["outreach", "letters"],
    ["how are we doing", "funnel"],
    ["new arrivals", "pipelineSlice"],
    ["drafts to publish", "jobDrafts"],
    ["what was sent", "outbox"],
  ];
  for (const [text, panel] of cases) {
    const r = resolve({ text }, ctx);
    rules(r);
    const show = r.ops.find((o) => o.op === "show");
    assert.equal(show && show.op === "show" ? show.panel : null, panel, text);
  }
});

test("a role in the user's words travels as a param, never into say", () => {
  const r = resolve({ text: "pipeline for Backend Engineer 2" }, ctx);
  rules(r);
  assert.equal(r.say.key, "pipelineRoleShown");
  assert.deepEqual(r.ops[0], { op: "show", panel: "pipelineSlice", params: { role: "Backend Engineer 2" } });
  assert.equal(roleOf("what needs me for today"), null);
});

test("reject below N% [on role] proposes a wave and shows the slice; nothing is applied", () => {
  const r = resolve({ text: "reject everyone below 40% on backend" }, ctx);
  rules(r);
  assert.equal(r.say.key, "waveRejectProposed");
  assert.deepEqual(r.ops[1], { op: "propose", act: "wave", params: { mode: "reject", threshold: "40", role: "backend" } });
  const big = resolve({ text: "reject below 400" }, ctx);
  const p = big.ops.find((o) => o.op === "propose");
  assert.equal(p && p.op === "propose" ? p.params.threshold : null, "100", "threshold clamps to 1..100");
});

test("advance top N proposes a wave", () => {
  const r = resolve({ text: "advance the top 3" }, ctx);
  rules(r);
  assert.deepEqual(r.ops[1], { op: "propose", act: "wave", params: { mode: "advance", count: "3" } });
});

test("companion acts propose, the specific beats the general ('draft a JD' is not 'drafts')", () => {
  assert.equal(matchIntent("draft a JD for a designer")?.intent, "companionJd");
  assert.equal(matchIntent("analyse this CV")?.intent, "companionAnalyse");
  assert.equal(matchIntent("draft outreach to Jana")?.intent, "companionOutreach");
  assert.equal(matchIntent("today's digest")?.intent, "companionDigest");
  const r = resolve({ chip: "digest" }, ctx);
  assert.deepEqual(r.ops[0], { op: "propose", act: "companion", params: { action: "generate_digest" } });
});

test("unknown words get the honest fallback with three chips — never a guess", () => {
  for (const text of ["", "   ", "sing me a song", "xyzzy"]) {
    const r = resolve({ text }, ctx);
    assert.equal(r.fallback, true, text);
    assert.equal(r.say.key, "notYet");
    assert.deepEqual(r.ops, []);
    assert.deepEqual(r.chips, [...FALLBACK_CHIPS]);
  }
});

test("follow-up chips lead with what the attention read says needs the user", () => {
  const r = resolve({ chip: "funnel" }, { attention });
  assert.deepEqual(r.chips, ["decisions", "stalled", "drafts"]);
});

test("console offers a navigate op (a link), nothing else", () => {
  const r = resolve({ text: "open the console" }, ctx);
  assert.deepEqual(r.ops, [{ op: "navigate", tab: "pipeline" }]);
});

test("open <name> binds to ONE candidate; ambiguous, unknown or unread names show the matching slice", () => {
  const entries = [
    { id: "pe-1", label: "Jana Nováková" },
    { id: "pe-2", label: "Jan Novák" },
    { id: "pe-3", label: "Petr Dvořák" },
  ];
  const one = resolve({ text: "open petr dvorak" }, { attention: null, entries });
  rules(one);
  assert.equal(one.say.key, "profileShown");
  assert.deepEqual(one.ops, [{ op: "show", panel: "profile", params: { entryId: "pe-3", label: "Petr Dvořák" } }]);
  const many = resolve({ text: "open Novák" }, { attention: null, entries });
  assert.equal(many.say.key, "profileMany");
  assert.deepEqual(many.ops, [{ op: "show", panel: "pipelineSlice", params: { name: "Novák" } }]);
  assert.equal(resolve({ text: "profile of Zed" }, { attention: null, entries }).say.key, "profileNone");
  assert.equal(resolve({ text: "open Petr" }, ctx).say.key, "profileMany", "pipeline not read yet: the slice decides");
  assert.equal(matchIntent("open the pipeline")?.intent, "pipeline", "a view word is not a name");
  assert.equal(matchIntent("open the calendar")?.intent, "calendar");
});
