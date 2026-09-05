// Tenant scope (P1) — behavioural proof for the outreach memory.
//
// `outreach_state`'s primary key is `entry_id` alone, so both upserts conflict on the
// entry and NOTHING in the pre-fix `DO UPDATE` re-asserted the tenant: a row minted by
// team A was mutated by a call made under team B. It stayed latent only because entry
// ids are globally unique — but the two writes are reachable from the PUBLIC receiver
// (`recordOutreachReply`) and from a campaign dispatch, and the row they own is the one
// that STOPS further mail to a person. A cross-tenant bump of `sends` is what turns a
// candidate's genuine reply into a "re-application" (outreach-halt.ts reads the counter),
// and a cross-tenant `manual_halt_at` silences another team's sequence.
//
// The reads have always filtered `workspace_id`, so the damage was invisible from the
// owning team's side until the halt failed to hold.
//
// unit-db is the FIRST project import (throwaway KP_DB_PATH) — load-bearing order.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { ensureDb } from "./db/core.ts";
import { haltOutreach, outreachStateFor, recordOutreachReply, recordOutreachSend } from "./outreach-state-store.ts";

after(() => cleanupUnitDb());

const OWNER = "ws-outreach-owner";
const INTRUDER = "ws-outreach-intruder";

function raw(entryId: string): { sends: number; workspace_id: string; manual_halt_at: string | null; replied_at: string | null } {
  return ensureDb()
    .prepare(`SELECT sends, workspace_id, manual_halt_at, replied_at FROM outreach_state WHERE entry_id = ?`)
    .get(entryId) as { sends: number; workspace_id: string; manual_halt_at: string | null; replied_at: string | null };
}

test("recordOutreachSend cannot bump another team's send counter", () => {
  const entryId = "entry-outreach-send";
  recordOutreachSend(entryId, OWNER);
  assert.equal(outreachStateFor(entryId, OWNER).sends, 1);

  // The intruder addresses the SAME entry id under its own workspace. Pre-fix this
  // incremented the owner's counter (ON CONFLICT(entry_id) with no tenant re-assertion).
  recordOutreachSend(entryId, INTRUDER);

  assert.equal(outreachStateFor(entryId, OWNER).sends, 1, "the owner's counter is untouched");
  assert.equal(raw(entryId).workspace_id, OWNER, "the row still belongs to the owner");
  // And the intruder sees nothing of its own — the row is not theirs to read either.
  assert.equal(outreachStateFor(entryId, INTRUDER).sends, 0);
});

test("haltOutreach cannot silence another team's sequence", () => {
  const entryId = "entry-outreach-halt";
  recordOutreachSend(entryId, OWNER);

  haltOutreach(entryId, INTRUDER);

  assert.equal(raw(entryId).manual_halt_at, null, "no cross-tenant manual halt landed on the owner's row");
  assert.equal(raw(entryId).workspace_id, OWNER);
  // The owner's own halt still works — the guard bounds the tenant, not the operation.
  haltOutreach(entryId, OWNER);
  assert.ok(raw(entryId).manual_halt_at, "the owning team can still halt");
});

test("recordOutreachReply is already tenant-scoped and stays so", () => {
  const entryId = "entry-outreach-reply";
  recordOutreachSend(entryId, OWNER);

  assert.equal(recordOutreachReply(entryId, INTRUDER), false, "a foreign team cannot mark the reply");
  assert.equal(raw(entryId).replied_at, null);

  assert.equal(recordOutreachReply(entryId, OWNER), true);
  assert.ok(raw(entryId).replied_at);
});
