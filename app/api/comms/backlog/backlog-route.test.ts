// POST/GET /api/comms/backlog — the door behind the owner's one "Send". Driven as the REAL
// handlers: no operator session is refused the way the sibling studio routes answer (401),
// an operator is served, and a letter id of another workspace is never sent.
//
// unit-db.ts must be the first project import.
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";

register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const { GET, POST } = await import("./route.ts");
const { recordOutbox, listOutboxFiltered } = await import("../../../_lib/db/devcase.ts");
const { setRelayHostLookupForTests } = await import("../../../_lib/comms.ts");
const { setEgressTransportForTests } = await import("../../../_lib/pinned-request.ts");
const { DEFAULT_WORKSPACE_ID } = await import("../../../_lib/db/workspaces.ts");

after(() => cleanupUnitDb());
afterEach(() => {
  setEgressTransportForTests(undefined);
  setRelayHostLookupForTests(undefined);
  delete process.env.COMMS_WEBHOOK_URL;
  delete process.env.KP_OPERATOR_PASSWORD;
});

function relay() {
  process.env.COMMS_WEBHOOK_URL = "https://relay.example.test/hook";
  setRelayHostLookupForTests(async () => [{ address: "93.184.216.34" }]);
  const posts: string[] = [];
  setEgressTransportForTests(async (_url, init) => {
    posts.push(String(init.body));
    return new Response(null, { status: 200 });
  });
  return posts;
}

let seq = 0;
const waiting = (workspaceId: string) => {
  seq += 1;
  return recordOutbox({
    recipient: `route-${seq}@example.com`,
    subject: `Route letter ${seq}`,
    body: "Body.",
    kind: "rejection",
    channel: "outbox",
    status: "queued",
    ref: null,
    workspaceId,
  });
};

const post = (ids: unknown) =>
  POST(new Request("http://localhost/api/comms/backlog", { method: "POST", body: JSON.stringify({ ids }) }));
const get = () => GET();

test("no operator session: both verbs are refused with 401 and nothing is sent", async () => {
  const letter = waiting(DEFAULT_WORKSPACE_ID);
  const posts = relay();
  process.env.KP_OPERATOR_PASSWORD = "a-password-for-the-test";
  const read = await get();
  const send = await post([letter.id]);
  assert.equal(read.status, 401);
  assert.equal(send.status, 401);
  assert.equal(posts.length, 0);
  assert.equal(listOutboxFiltered({}, DEFAULT_WORKSPACE_ID).filter((m) => m.status === "sent").length, 0);
});

test("an operator sees the offer and one confirmation sends the batch once", async () => {
  const a = waiting(DEFAULT_WORKSPACE_ID);
  const b = waiting(DEFAULT_WORKSPACE_ID);
  const posts = relay();
  const offer = (await (await get()).json()) as { relayReady: boolean; letters: { id: string }[] };
  assert.equal(offer.relayReady, true);
  assert.ok([a.id, b.id].every((id) => offer.letters.some((l) => l.id === id)));

  const res = await post([a.id, b.id]);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; results: { id: string; outcome: string }[] };
  assert.deepEqual(body.results.map((r) => r.outcome), ["sent", "sent"]);
  assert.equal(posts.length, 2);

  const again = (await (await post([a.id, b.id])).json()) as { results: { outcome: string; reason?: string }[] };
  assert.deepEqual(again.results.map((r) => r.reason), ["already_sent", "already_sent"]);
  assert.equal(posts.length, 2, "a retried press sends nothing more");
});

test("a letter id of another workspace is refused as not found", async () => {
  const foreign = waiting("route-other-ws");
  const posts = relay();
  const body = (await (await post([foreign.id])).json()) as { results: { outcome: string; reason?: string }[] };
  assert.deepEqual(body.results, [{ id: foreign.id, outcome: "skipped", reason: "not_found" }]);
  assert.equal(posts.length, 0);
});

test("a body that is not a list of ids confirms nothing", async () => {
  const posts = relay();
  waiting(DEFAULT_WORKSPACE_ID);
  const body = (await (await post("everything")).json()) as { results: unknown[] };
  assert.deepEqual(body.results, []);
  assert.equal(posts.length, 0);
});
