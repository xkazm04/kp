import { test, before } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtempSync } from "node:fs";

// Isolate onto a throwaway DB BEFORE the route (and its db layer) loads.
process.env.KP_DB_PATH = path.join(mkdtempSync(path.join(os.tmpdir(), "kp-comms-")), "kp.sqlite");
delete process.env.DATABASE_URL;

let GET: (typeof import("./route.ts"))["GET"];
let recordOutbox: (typeof import("@/app/_lib/db/devcase"))["recordOutbox"];

before(async () => {
  ({ GET } = await import("./route.ts"));
  ({ recordOutbox } = await import("@/app/_lib/db/devcase"));
  for (let i = 0; i < 60; i++) {
    recordOutbox({
      recipient: `r${i}@x.io`,
      subject: `Row ${i}`,
      body: "b",
      kind: "rejection",
      channel: "email",
      status: "failed",
      ref: `entry-${i}`,
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
  assert.equal(body.outbox.length, 60);
  assert.equal(body.truncated, false);
});
