// GET/POST /api/setup/first-run driven as real handlers on a throwaway SQLite file that
// boots the DEFAULT way — blank, no demo (operator triage T1). Both branches of the
// first-run choice, end to end through the route: the choice is open on a blank install,
// "empty" closes it and seeds nothing, "demo" seeds the corpus once and a repeat adds
// nothing. The store's refusal and tenant-stamping cases are db/demo-seed.test.ts's.
//
// unit-db.ts must stay the first project import (isolated throwaway DB). It opts the unit
// suite in to KP_SEED_DEMO; this file is about the blank default, so it opts back out
// before anything opens the database.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";

delete process.env.KP_SEED_DEMO;
delete process.env.KP_EMPTY;

register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// No KP_OPERATOR_PASSWORD: open dev mode folds the caller to owner, the mode a fresh
// local install is in. The capability gate itself is the shared requireCapabilityCoded.
const { GET, POST } = await import("./route.ts");
const { ensureDb } = await import("../../../_lib/db/core.ts");

after(() => cleanupUnitDb());

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/setup/first-run", { method: "POST", body: JSON.stringify(body) }));
const pending = async () => ((await (await GET()).json()) as { pending: boolean }).pending;
const entries = () => (ensureDb().prepare(`SELECT COUNT(*) AS n FROM pipeline_entries`).get() as { n: number }).n;

test("a blank install offers the choice; a malformed answer is refused and changes nothing", async () => {
  assert.equal(await pending(), true);
  const res = await post({ choice: "banana" });
  assert.equal(res.status, 400);
  assert.equal(await pending(), true);
});

test("'Start empty' records the answer, seeds nothing, and the choice never comes back", async () => {
  const res = await post({ choice: "empty" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { outcome: "recorded" });
  assert.equal(await pending(), false);
  assert.equal(entries(), 0);
});

test("'Explore with demo data' seeds the board once; a repeat is a no-op", async () => {
  // Still allowed after "empty": the workspace holds no data, so the demo hides nothing.
  const first = await post({ choice: "demo" });
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { outcome: "seeded" });
  const seeded = entries();
  assert.ok(seeded > 0, "the demo board landed");

  const again = await post({ choice: "demo" });
  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), { outcome: "already-seeded" });
  assert.equal(entries(), seeded, "a second click adds no row");
  assert.equal(await pending(), false);
});
