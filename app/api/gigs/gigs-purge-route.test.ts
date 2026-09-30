// POST /api/gigs/purge on an isolated DB, in open auth mode (unit-db.ts scrubs the password).
// Proves: a request without `dryRun: false` is a DRY RUN and deletes nothing; bad rules and a
// non-boolean dryRun are refused 400 GIG_INPUT_INVALID with the field; a real run deletes the
// matched gigs and answers `deleted`; the door throttles at 5 per 10 minutes (the contract
// itself is pinned in app/api/rate-limit-contract.test.ts). The limiter is per IP and every
// call here shares one, so the calls are counted: 5 pass the limiter, the 6th is refused.
//
// unit-db.ts must be the first project import (it sets KP_DB_PATH before any store opens).
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_WORKSPACE_ID } from "../../_lib/db/workspaces.ts";
import { getGig, upsertGigFromRaw } from "../../_lib/db/gigs.ts";
import type { GigArena, GigReward } from "../../_lib/gigs/types.ts";
import { POST as PURGE } from "./purge/route.ts";

const WS = DEFAULT_WORKSPACE_ID;
after(() => cleanupUnitDb());

function req(body: unknown): Request {
  return new Request("http://localhost/api/gigs/purge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
let seq = 0;
function gig(arena: GigArena, reward: GigReward | null) {
  seq += 1;
  return upsertGigFromRaw(WS, {
    sourceId: "gsrc-r",
    arena,
    raw: { externalKey: `r-${seq}`, url: `https://example.test/r/${seq}`, title: `Route ${seq}`, org: null, reward, deadlineAt: null, postedAt: null, bodyText: "x", bodyHtml: null, tags: [] },
    suspectReasons: [],
  }).gig;
}

test("the purge door: coded refusals, a default dry run, a real run, then the limiter", async () => {
  const none = gig("security", null);
  const kept = gig("freelance", { amount: 30, currency: "USD", text: "$30-$250 USD" });

  for (const [body, field] of [
    [{ rules: ["everything"] }, "rules"],
    [{ rules: ["no_reward"], dryRun: "no" }, "dryRun"],
  ] as const) {
    const res = await PURGE(req(body));
    assert.equal(res.status, 400);
    const json = (await res.json()) as { code: string; field: string };
    assert.deepEqual([json.code, json.field], ["GIG_INPUT_INVALID", field]);
  }

  const dry = await PURGE(req({ rules: ["no_reward", "below_floor"] }));
  assert.equal(dry.status, 200);
  const d = (await dry.json()) as { dryRun: boolean; count: number; byRule: Record<string, number>; sample: { id: string }[]; deleted?: number };
  assert.equal(d.dryRun, true, "no dryRun field = a dry run");
  assert.deepEqual([d.count, d.byRule.no_reward, d.deleted], [1, 1, undefined]);
  assert.deepEqual(d.sample.map((s) => s.id), [none.id]);
  assert.ok(getGig(WS, none.id), "the dry run deleted nothing");

  const real = await PURGE(req({ rules: ["no_reward"], dryRun: false }));
  assert.equal(real.status, 200);
  const r = (await real.json()) as { dryRun: boolean; deleted: number; personasRetired: number };
  assert.deepEqual([r.dryRun, r.deleted, r.personasRetired], [false, 1, 0]);
  assert.equal(getGig(WS, none.id), null);
  assert.ok(getGig(WS, kept.id));

  assert.equal((await PURGE(req({ rules: [] }))).status, 400, "an empty rule list is refused too");
  const throttled = await PURGE(req({ rules: ["no_reward"] }));
  assert.equal(throttled.status, 429);
  assert.equal(((await throttled.json()) as { code: string }).code, "TOO_MANY_REQUESTS");
});
