// board-storage-is-keyed-by-tenant — the invariant this file exists for: a workspace
// switch in ONE browser must never hydrate the other team's saved views or SLA
// overrides. Before the keying, both lived under a bare `kp.pipelineViews` /
// `kp.pipelineStageSla` and localStorage is scoped to the ORIGIN, not the session, so
// tenant A's view NAMES (and the stage ids they encode) opened on tenant B's board —
// and a view A had marked default auto-applied A's filter combination on a bare visit.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_SLA_KEY,
  LEGACY_VIEWS_KEY,
  migrateLegacyKey,
  pipelineSlaKey,
  pipelineViewsKey,
  readStoredSla,
  clearStoredSla,
  type KeyValueStore,
} from "./pipelineBoardStorage.ts";

function fakeStore(seed: Record<string, string> = {}): KeyValueStore & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

test("a workspace switch never hydrates the other tenant's SLA overrides", () => {
  const store = fakeStore({ [pipelineSlaKey("ws-a")]: JSON.stringify({ Interview: 3 }) });
  assert.deepEqual(readStoredSla(store, "ws-b"), {});
  assert.deepEqual(readStoredSla(store, "ws-a"), { Interview: 3 });
});

// Cadences are team data now (challenge-r03 pipeline-board-ui/A): the per-browser map
// is only read (to OFFER it to the team) and cleared, per tenant, once adopted or
// discarded. Clearing one team's leftovers must not touch another's.
test("clearing a tenant's leftover SLA overrides touches only that tenant", () => {
  const store = fakeStore({
    [pipelineSlaKey("ws-a")]: JSON.stringify({ Interview: 3 }),
    [pipelineSlaKey("ws-b")]: JSON.stringify({ Screened: 4 }),
  });
  clearStoredSla(store, "ws-a");
  assert.deepEqual(readStoredSla(store, "ws-a"), {});
  assert.deepEqual(readStoredSla(store, "ws-b"), { Screened: 4 });
  clearStoredSla(store, null);
  assert.deepEqual(readStoredSla(store, "ws-b"), { Screened: 4 }, "an unresolved tenant clears nothing");
});

test("nothing is read until the workspace resolves", () => {
  const store = fakeStore({ [pipelineSlaKey("ws-a")]: JSON.stringify({ Interview: 3 }) });
  assert.deepEqual(readStoredSla(store, null), {});
});

test("the legacy global keys migrate ONCE into the current tenant, then are removed", () => {
  const views = JSON.stringify([{ id: "v-a", name: "mine" }]);
  const store = fakeStore({
    [LEGACY_VIEWS_KEY]: views,
    [LEGACY_SLA_KEY]: JSON.stringify({ Interview: 4 }),
  });
  assert.equal(migrateLegacyKey(store, LEGACY_VIEWS_KEY, pipelineViewsKey("ws-a")), true);
  assert.equal(migrateLegacyKey(store, LEGACY_SLA_KEY, pipelineSlaKey("ws-a")), true);
  assert.equal(store.getItem(pipelineViewsKey("ws-a")), views, "the operator's own list survives the move");
  assert.deepEqual(readStoredSla(store, "ws-a"), { Interview: 4 });
  assert.equal(store.getItem(LEGACY_VIEWS_KEY), null, "the global key is gone");
  assert.equal(store.getItem(LEGACY_SLA_KEY), null);
  // …so a SECOND workspace resolving later can never adopt it.
  assert.equal(migrateLegacyKey(store, LEGACY_VIEWS_KEY, pipelineViewsKey("ws-b")), false);
  assert.equal(store.getItem(pipelineViewsKey("ws-b")), null);
});

test("migration never clobbers a tenant list that already exists", () => {
  const store = fakeStore({
    [LEGACY_VIEWS_KEY]: JSON.stringify([{ id: "v-a", name: "legacy" }]),
    [pipelineViewsKey("ws-a")]: JSON.stringify([{ id: "v-own", name: "mine" }]),
  });
  assert.equal(migrateLegacyKey(store, LEGACY_VIEWS_KEY, pipelineViewsKey("ws-a")), false);
  assert.equal(JSON.parse(store.getItem(pipelineViewsKey("ws-a"))!)[0].name, "mine");
  assert.equal(store.getItem(LEGACY_VIEWS_KEY), null, "still cleaned up");
});

test("a corrupt or absent store degrades to empty, never throws", () => {
  const broken: KeyValueStore = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: () => {},
  };
  assert.deepEqual(readStoredSla(broken, "ws-a"), {});
  assert.doesNotThrow(() => clearStoredSla({ ...broken, removeItem: () => { throw new Error("SecurityError"); } }, "ws-a"));
  assert.equal(migrateLegacyKey(broken, LEGACY_VIEWS_KEY, pipelineViewsKey("ws-a")), false);
  assert.deepEqual(readStoredSla(fakeStore({ [pipelineSlaKey("ws-a")]: "{not json" }), "ws-a"), {});
});
