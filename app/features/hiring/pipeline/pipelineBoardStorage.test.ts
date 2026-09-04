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
  readStoredViews,
  writeStoredSla,
  writeStoredViews,
  type KeyValueStore,
} from "./pipelineBoardStorage.ts";
import type { SavedView } from "./pipelineBoardFilters.ts";

function fakeStore(seed: Record<string, string> = {}): KeyValueStore & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const viewA: SavedView = {
  id: "v-a",
  name: "Berlin seniors — waiting on Ada",
  query: "ada",
  quicks: ["aging"],
  quick: "aging",
  score: [],
  source: [],
  sort: "score",
  stage: "Interview",
  isDefault: true,
};

test("a workspace switch never hydrates the other tenant's saved views — the leak", () => {
  const store = fakeStore();
  writeStoredViews(store, "ws-a", [viewA]);
  // Same browser, same origin, team switched: tenant B reads its OWN key.
  assert.deepEqual(readStoredViews(store, "ws-b"), [], "tenant B must see none of A's views");
  // …and A still has them, so the scoping is not just a wipe.
  assert.equal(readStoredViews(store, "ws-a").length, 1);
  // The default marking rides the view, so B also has no default to auto-apply —
  // which is what stopped A's filter combination opening on B's bare visit.
  assert.equal(readStoredViews(store, "ws-b").some((v) => v.isDefault), false);
});

test("a workspace switch never hydrates the other tenant's SLA overrides", () => {
  const store = fakeStore();
  writeStoredSla(store, "ws-a", { Interview: 3 });
  assert.deepEqual(readStoredSla(store, "ws-b"), {});
  assert.deepEqual(readStoredSla(store, "ws-a"), { Interview: 3 });
});

test("nothing is read or written until the workspace resolves", () => {
  const store = fakeStore({ [pipelineViewsKey("ws-a")]: JSON.stringify([viewA]) });
  assert.deepEqual(readStoredViews(store, null), [], "an unresolved tenant hydrates nothing");
  assert.deepEqual(readStoredSla(store, null), {});
  writeStoredViews(store, null, [viewA]);
  writeStoredSla(store, null, { Interview: 3 });
  assert.equal(store.map.size, 1, "an unresolved tenant writes nothing anywhere");
});

test("the legacy global keys migrate ONCE into the current tenant, then are removed", () => {
  const store = fakeStore({
    [LEGACY_VIEWS_KEY]: JSON.stringify([{ ...viewA, isDefault: undefined }]),
    [LEGACY_SLA_KEY]: JSON.stringify({ Interview: 4 }),
  });
  assert.equal(migrateLegacyKey(store, LEGACY_VIEWS_KEY, pipelineViewsKey("ws-a")), true);
  assert.equal(migrateLegacyKey(store, LEGACY_SLA_KEY, pipelineSlaKey("ws-a")), true);
  assert.equal(readStoredViews(store, "ws-a").length, 1, "the operator's own list survives the move");
  assert.deepEqual(readStoredSla(store, "ws-a"), { Interview: 4 });
  assert.equal(store.getItem(LEGACY_VIEWS_KEY), null, "the global key is gone");
  assert.equal(store.getItem(LEGACY_SLA_KEY), null);
  // …so a SECOND workspace resolving later can never adopt it.
  assert.equal(migrateLegacyKey(store, LEGACY_VIEWS_KEY, pipelineViewsKey("ws-b")), false);
  assert.deepEqual(readStoredViews(store, "ws-b"), []);
});

test("migration never clobbers a tenant list that already exists", () => {
  const store = fakeStore({
    [LEGACY_VIEWS_KEY]: JSON.stringify([viewA]),
    [pipelineViewsKey("ws-a")]: JSON.stringify([{ ...viewA, id: "v-own", name: "mine" }]),
  });
  assert.equal(migrateLegacyKey(store, LEGACY_VIEWS_KEY, pipelineViewsKey("ws-a")), false);
  assert.equal(readStoredViews(store, "ws-a")[0]!.name, "mine");
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
  assert.deepEqual(readStoredViews(broken, "ws-a"), []);
  assert.deepEqual(readStoredSla(broken, "ws-a"), {});
  assert.doesNotThrow(() => writeStoredViews(broken, "ws-a", [viewA]));
  assert.doesNotThrow(() => writeStoredSla(broken, "ws-a", { Interview: 3 }));
  assert.equal(migrateLegacyKey(broken, LEGACY_VIEWS_KEY, pipelineViewsKey("ws-a")), false);
  assert.deepEqual(readStoredViews(fakeStore({ [pipelineViewsKey("ws-a")]: "{not json" }), "ws-a"), []);
});
