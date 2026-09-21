// The Studio kit's one persisted preference — which zones are open — and the two
// guards on it. Pure, so the rules the desk relies on are provable without a DOM:
//
//   node scripts/run-unit-tests.mjs app/_components/studio/studioZones.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readStoredZones, storeZones, toggleZone, zoneKeyGuard } from "./studioZones.ts";

type Zone = "chat" | "sheet" | "notes";
const ZONES = ["chat", "sheet", "notes"] as const;
const isZone = zoneKeyGuard<Zone>(ZONES);

/** A localStorage stand-in installed on `globalThis.window` for one test. */
function withStorage<T>(run: (store: Map<string, string>) => T): T {
  const store = new Map<string, string>();
  const g = globalThis as { window?: unknown };
  const before = g.window;
  g.window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  };
  try {
    return run(store);
  } finally {
    if (before === undefined) delete g.window;
    else g.window = before;
  }
}

test("toggle never hides a pinned zone, and never folds the desk to nothing", () => {
  const all: Zone[] = ["chat", "sheet", "notes"];
  assert.deepEqual(toggleZone(all, "sheet", ["chat"]), ["chat", "notes"], "an unpinned zone folds while others are open");
  assert.equal(toggleZone(all, "chat", ["chat"]), all, "a pinned zone refuses to fold — the SAME array back, so a setter is a no-op");
  const last: Zone[] = ["notes"];
  assert.equal(toggleZone(last, "notes"), last, "the last open zone refuses to fold even unpinned");
  assert.deepEqual(toggleZone(["notes"], "sheet"), ["notes", "sheet"], "a folded zone re-opens");
  assert.deepEqual(toggleZone(["notes"], "chat", ["chat"]), ["notes", "chat"], "a pin only forbids hiding; opening is always allowed");
});

test("storage-key isolation: two consumers on one browser keep two preferences", () => {
  withStorage((store) => {
    storeZones("kp-a-cols", ["chat"] as Zone[]);
    storeZones("kp-b-cols", ["sheet", "notes"] as Zone[]);
    assert.deepEqual(readStoredZones<Zone>("kp-a-cols", ["chat", "sheet", "notes"], isZone), ["chat"]);
    assert.deepEqual(readStoredZones<Zone>("kp-b-cols", ["chat", "sheet", "notes"], isZone), ["sheet", "notes"]);
    assert.equal(store.size, 2, "one slot per key, nothing shared");
  });
});

test("the reader is guarded by the CONSUMER's vocabulary — a foreign zone name is dropped", () => {
  withStorage((store) => {
    // Another consumer's zones, or last version's, under this key.
    store.set("kp-a-cols", JSON.stringify(["draft", "chat", "brief"]));
    assert.deepEqual(readStoredZones<Zone>("kp-a-cols", ["sheet"], isZone), ["chat"], "only names in this consumer's list survive");
    store.set("kp-a-cols", JSON.stringify(["draft"]));
    assert.deepEqual(readStoredZones<Zone>("kp-a-cols", ["sheet"], isZone), ["sheet"], "nothing valid → the fallback, never an empty desk");
    store.set("kp-a-cols", "not json");
    assert.deepEqual(readStoredZones<Zone>("kp-a-cols", ["sheet"], isZone), ["sheet"], "a corrupt slot is the fallback, not a throw");
  });
});

test("SSR guard: with no window, the reader answers the fallback and the writer is a no-op", () => {
  const g = globalThis as { window?: unknown };
  assert.equal(g.window, undefined, "this runner has no DOM — the precondition of the test");
  assert.deepEqual(readStoredZones<Zone>("kp-a-cols", ["chat", "sheet"], isZone), ["chat", "sheet"]);
  assert.doesNotThrow(() => storeZones("kp-a-cols", ["chat"] as Zone[]));
});
