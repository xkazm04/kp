// FIRST project import, load-bearing: it scrubs the ambient env (operator password,
// multi-workspace, relay, DATABASE_URL, …) and points KP_DB_PATH at this process's
// throwaway DB before the route or its db layer evaluates. The hand-rolled mkdtemp
// isolation this file used to carry set only KP_DB_PATH, so a shell or suite-wide
// variable could still change which workspace the route read.
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const SEEDED = 60;
const MARK = "comms-route-test";

after(() => cleanupUnitDb());

let GET: (typeof import("./route.ts"))["GET"];
let recordOutbox: (typeof import("@/app/_lib/db/devcase"))["recordOutbox"];

before(async () => {
  ({ GET } = await import("./route.ts"));
  ({ recordOutbox } = await import("@/app/_lib/db/devcase"));
  for (let i = 0; i < SEEDED; i++) {
    recordOutbox({
      recipient: `r${i}@x.io`,
      subject: `Row ${i}`,
      body: "b",
      kind: "rejection",
      channel: "email",
      status: "failed",
      ref: `${MARK}-${i}`,
    });
  }
});

function get(query = ""): Request {
  return new Request(`http://localhost/api/devcase/comms${query}`, { method: "GET" });
}

test("limit=50 on 60 rows is truncated with 50 items", async () => {
  const res = await GET(get("?limit=50") as never);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { outbox: unknown[]; truncated: boolean; limit: number };
  assert.equal(body.limit, 50);
  assert.equal(body.outbox.length, 50);
  assert.equal(body.truncated, true);
});

test("a page that fits is not claimed as truncated", async () => {
  const res = await GET(get("?limit=500") as never);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { outbox: unknown[]; truncated: boolean; limit: number };
  assert.equal(body.limit, 500);
  // Assert on the rows THIS file seeded, not on the table's total: the page must hold
  // every one of them and must not claim truncation while it does.
  const ours = (body.outbox as Array<{ ref: string | null }>).filter((r) => r.ref?.startsWith(`${MARK}-`));
  assert.equal(ours.length, SEEDED);
  assert.equal(body.truncated, false);
});
