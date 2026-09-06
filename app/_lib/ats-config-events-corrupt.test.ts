// A corrupt `events_json` used to resolve to `[]` in silence — and `[]` is ALSO what an
// operator who deliberately unsubscribed from everything looks like. The two are the same
// value and opposite situations: one is a choice, the other is a deployment that has
// silently stopped mirroring hires into the customer's system of record with nothing
// anywhere saying why. The parse still fails closed (that part is right); it now SAYS so,
// naming the row so the log line is greppable and repairable.
//
// NON-VACUITY: pre-change parseEvents was `try { … } catch { return [] }` with no logging,
// so the console assertions below see nothing at all.
//
// unit-db.ts MUST be the first project import (it sets KP_DB_PATH before any store module
// resolves db-path.ts).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { cleanupUnitDb, UNIT_DB_PATH } from "./testing/unit-db.ts";
import { getAtsConfig, setAtsConfig } from "./ats-config-store.ts";

after(() => cleanupUnitDb());

/** Write events_json straight to the single config row, bypassing validation — the state
 *  a hand-edited DB, a bad restore or a future version's value actually leaves behind. */
function forceEventsJson(raw: string): void {
  const d = new Database(UNIT_DB_PATH);
  try {
    d.pragma("busy_timeout = 5000");
    d.prepare(`UPDATE ats_config SET events_json = ? WHERE id = 1`).run(raw);
  } finally {
    d.close();
  }
}

function captureErrors<T>(fn: () => T): { result: T; lines: string[] } {
  const real = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  };
  try {
    return { result: fn(), lines };
  } finally {
    console.error = real;
  }
}

test("unreadable events_json unsubscribes everything — and says so, naming the row", () => {
  setAtsConfig({ webhookUrl: "https://example.com/hook", events: ["candidate.hired"] });
  forceEventsJson("{not json");
  const { result, lines } = captureErrors(() => getAtsConfig());
  assert.deepEqual(result.events, [], "fail closed — nothing is mirrored on a config we cannot read");
  assert.ok(
    lines.some((l) => l.includes("ats_config row 1") && /events_json/.test(l)),
    `the corruption is reported with the row id — got ${JSON.stringify(lines)}`
  );
});

test("an events_json that is valid JSON but not an array is reported too", () => {
  setAtsConfig({ webhookUrl: "https://example.com/hook", events: ["candidate.hired"] });
  forceEventsJson('{"candidate.hired":true}');
  const { result, lines } = captureErrors(() => getAtsConfig());
  assert.deepEqual(result.events, []);
  assert.ok(lines.some((l) => l.includes("not an array")), `got ${JSON.stringify(lines)}`);
});

test("an unknown event name is dropped and named, while the known ones survive", () => {
  setAtsConfig({ webhookUrl: "https://example.com/hook", events: ["candidate.hired"] });
  forceEventsJson('["candidate.hired","candidate.ghosted"]');
  const { result, lines } = captureErrors(() => getAtsConfig());
  assert.deepEqual(result.events, ["candidate.hired"], "one unreadable name must not disable the readable ones");
  assert.ok(lines.some((l) => l.includes("candidate.ghosted")), `got ${JSON.stringify(lines)}`);
});
