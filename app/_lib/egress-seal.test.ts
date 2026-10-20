// C3 — ONE egress seal. KP_NO_COMMS_EGRESS=1 means "this process may not speak to any
// outside party about a candidate", and it has to hold at EVERY outbound boundary, not
// only the comms relay. Each test below installs a fetch spy, seals the process, drives
// one boundary through its real code, and asserts the spy saw nothing.
//
// The ATS flush, the calendar edge and the two probe routes have their own files beside
// the code they exercise (ats-egress-seal.test.ts, calendar/egress-seal.test.ts,
// api/*/test/seal.test.ts); this file holds the gate itself, the relay send and the pull.
//
// unit-db.ts must stay the first project import.
import { test, after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { egressSealed } from "./egress-seal.ts";
import { commsEgressSealed } from "./comms-relay.ts";
import { sendComm, setRelayHostLookupForTests } from "./comms.ts";
import { createChannelWebhook, listPullSources, setChannelPull } from "./db/channels.ts";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces.ts";
import { pullOneSource, runPullPass } from "./pull-pass.ts";

after(() => cleanupUnitDb());

const realFetch = globalThis.fetch;
let calls: string[] = [];
beforeEach(() => {
  calls = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    calls.push(String(url instanceof Request ? url.url : url));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  process.env.KP_NO_COMMS_EGRESS = "1";
});
afterEach(() => {
  globalThis.fetch = realFetch;
  setRelayHostLookupForTests(undefined);
  delete process.env.KP_NO_COMMS_EGRESS;
  delete process.env.COMMS_WEBHOOK_URL;
});

test("the gate is the one predicate: only the exact value 1 seals, and the relay re-uses it", () => {
  assert.equal(egressSealed({ KP_NO_COMMS_EGRESS: "1" }), true);
  assert.equal(egressSealed({ KP_NO_COMMS_EGRESS: "true" }), false);
  assert.equal(egressSealed({}), false);
  // KP_OFFLINE is a different question (it seals the Claude CLI too) and must not seal this.
  assert.equal(egressSealed({ KP_OFFLINE: "1" }), false);
  assert.equal(commsEgressSealed({ KP_NO_COMMS_EGRESS: "1" }), true);
  assert.equal(commsEgressSealed({}), false);
});

test("relay send: a configured relay is not dialled under the seal, the message is queued", async () => {
  process.env.COMMS_WEBHOOK_URL = "https://relay.example.test/hook";
  setRelayHostLookupForTests(async () => [{ address: "93.184.216.34" }]);
  const entry = await sendComm({ to: "jana@example.cz", subject: "Offer", body: "...", kind: "offer" });
  assert.equal(calls.length, 0, `no fetch under the seal, saw: ${calls.join(", ")}`);
  assert.equal(entry.status, "queued");
});

test("pull pass: sources are skipped under the seal — 0 fetches, and none marked failed", async () => {
  const hook = createChannelWebhook({ channel: "boards", jobId: "job-seal", lang: "en" }, DEFAULT_WORKSPACE_ID);
  assert.ok(setChannelPull(hook.token, { url: "https://pull.example.test/leads" }, DEFAULT_WORKSPACE_ID));
  const summary = await runPullPass();
  assert.equal(calls.length, 0, `no fetch under the seal, saw: ${calls.join(", ")}`);
  assert.equal(summary.failed, 0, "a sealed source is skipped, not failed");
  const source = listPullSources().find((s) => s.token === hook.token);
  assert.ok(source);
  const outcome = await pullOneSource(source, "https://kp.example.test");
  assert.equal(outcome.error, null);
  assert.equal(calls.length, 0);
});
