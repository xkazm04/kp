import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import {
  DecisionConfigStaleError,
  getDecisionConfig,
  getDecisionConfigVersion,
  getAllDecisionConfigVersions,
  setDecisionConfig,
  type ScreeningRule,
} from "./decision-config-store.ts";

after(() => cleanupUnitDb());

// The lost update this closes: the Hiring composer READS the plan, the operator edits
// for a minute, and a second operator saves in between. The second save is silently
// overwritten by the first one's stale draft — on the rules that decide who is
// auto-rejected, with both saves reporting success.

const rule = (pct: number) => ({ autoRejectEnabled: true, rejectBottomPercent: pct, maxMatchToReject: 40 });
const read = (ws: string) => getDecisionConfig<ScreeningRule>("screening", ws).rejectBottomPercent;

test("a phase with nothing stored has no version, and a write mints one", () => {
  assert.equal(getDecisionConfigVersion("screening", "ws-v1"), null);
  setDecisionConfig("screening", rule(20), "ws-v1", "team");
  const v = getDecisionConfigVersion("screening", "ws-v1");
  assert.ok(v, "a stored row carries a version");
  assert.equal(getAllDecisionConfigVersions("ws-v1").screening, v);
});

test("every write moves the version STRICTLY forward, even inside one millisecond", () => {
  setDecisionConfig("screening", rule(21), "ws-v2", "team");
  const seen = new Set<string>();
  for (let i = 22; i < 30; i += 1) {
    setDecisionConfig("screening", rule(i), "ws-v2", "team");
    const v = getDecisionConfigVersion("screening", "ws-v2");
    assert.ok(v && !seen.has(v), "a version is never reused — a same-ms write must still be detectable");
    seen.add(v);
  }
});

test("a write against a STALE version is refused, and changes nothing", () => {
  setDecisionConfig("screening", rule(20), "ws-v3", "team");
  const stale = getDecisionConfigVersion("screening", "ws-v3");

  // Somebody else saves first.
  setDecisionConfig("screening", rule(55), "ws-v3", "team");
  assert.equal(read("ws-v3"), 55);

  assert.throws(
    () => setDecisionConfig("screening", rule(20), "ws-v3", "team", { expectedUpdatedAt: stale }),
    DecisionConfigStaleError
  );
  assert.equal(read("ws-v3"), 55, "the newer save survives — the stale draft is dropped, not merged");
});

test("a write against the CURRENT version lands, and the version moves", () => {
  setDecisionConfig("screening", rule(20), "ws-v4", "team");
  const current = getDecisionConfigVersion("screening", "ws-v4");
  setDecisionConfig("screening", rule(44), "ws-v4", "team", { expectedUpdatedAt: current });
  assert.equal(read("ws-v4"), 44);
  assert.notEqual(getDecisionConfigVersion("screening", "ws-v4"), current);
});

test("a first write expecting 'nothing stored' lands, and one expecting nothing over a stored row is refused", () => {
  setDecisionConfig("screening", rule(31), "ws-v5", "team", { expectedUpdatedAt: null });
  assert.equal(read("ws-v5"), 31);
  assert.throws(
    () => setDecisionConfig("screening", rule(32), "ws-v5", "team", { expectedUpdatedAt: null }),
    DecisionConfigStaleError,
    "a client that read an empty phase must not clobber a row saved since"
  );
});
