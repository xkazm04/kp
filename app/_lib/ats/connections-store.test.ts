// W1.1 — the ingest connection store. Two properties matter more than the CRUD:
//
//   1. the ATS API token is WRITE-ONLY over the API and ENCRYPTED at rest. This token reads
//      every candidate in the customer's ATS account, so it is a more dangerous secret than
//      our own webhook signing key — and the whole-DB export dumps every column, which is
//      exactly how a plaintext token would end up in a customer's own backup.
//   2. `provider` is an allowlist. It namespaces every external id in ats_links, so a typo
//      would open a parallel id namespace and silently re-import the whole pipeline.
//
// unit-db is the FIRST project import (points KP_DB_PATH at a throwaway file).
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import {
  ATS_PROVIDERS,
  AtsConnectionError,
  deleteAtsConnection,
  getAtsConnection,
  getAtsToken,
  isAtsProvider,
  listAtsConnections,
  setAtsConnection,
} from "./connections-store.ts";
import { dumpWorkspace } from "../db-portability.ts";

const TOKEN = "recruitee-live-token-abc123-do-not-leak";
const MAP = { paths: { externalId: "id", displayName: "candidate.name" }, stages: { "1st round": "Interview" } };

beforeEach(() => {
  process.env.KP_ATS_SECRET_KEY = "unit-test-ats-key";
  delete process.env.KP_SECRET;
  for (const p of ATS_PROVIDERS) deleteAtsConnection(p);
});
after(() => cleanupUnitDb());

test("the token never comes back over the read path", () => {
  const saved = setAtsConnection({ provider: "recruitee", baseUrl: "https://api.recruitee.com", apiToken: TOKEN, fieldMap: MAP });
  assert.equal(saved.hasToken, true);
  assert.equal(JSON.stringify(saved).includes(TOKEN), false, "the public view must not carry the token");
  assert.equal(JSON.stringify(getAtsConnection("recruitee")).includes(TOKEN), false);
  assert.equal(JSON.stringify(listAtsConnections()).includes(TOKEN), false);
  // The server-internal reader still yields it, or nothing could ever sync.
  assert.equal(getAtsToken("recruitee"), TOKEN);
});

test("the token is encrypted at rest, so a whole-DB export cannot ship it", () => {
  setAtsConnection({ provider: "recruitee", apiToken: TOKEN, fieldMap: MAP });
  const serialized = JSON.stringify(dumpWorkspace());
  assert.equal(serialized.includes(TOKEN), false, "the export must never contain the plaintext token");
});

test("omit keeps the token, empty string clears it", () => {
  setAtsConnection({ provider: "recruitee", apiToken: TOKEN, fieldMap: MAP });
  // A field-map edit from the UI sends no token — that must not wipe the credential.
  const kept = setAtsConnection({ provider: "recruitee", fieldMap: { paths: { externalId: "uuid" } } });
  assert.equal(kept.hasToken, true);
  assert.equal(getAtsToken("recruitee"), TOKEN);
  assert.equal(kept.fieldMap.paths.externalId, "uuid");

  const cleared = setAtsConnection({ provider: "recruitee", apiToken: "" });
  assert.equal(cleared.hasToken, false);
  assert.equal(getAtsToken("recruitee"), null);
});

test("provider is an allowlist, not free text", () => {
  assert.throws(() => setAtsConnection({ provider: "greenhoose", apiToken: TOKEN, fieldMap: MAP }), AtsConnectionError);
  assert.throws(() => setAtsConnection({ provider: 7, fieldMap: MAP }), AtsConnectionError);
  assert.equal(isAtsProvider("recruitee"), true);
  assert.equal(isAtsProvider("nope"), false);
});

test("baseUrl is held to the same SSRF boundary as the outbound webhook", () => {
  // The server sends an AUTHENTICATED request here: a base URL pointed at a metadata
  // service or a LAN host would hand the customer's ATS token to it.
  assert.throws(() => setAtsConnection({ provider: "recruitee", baseUrl: "http://api.recruitee.com" }), AtsConnectionError);
  assert.throws(() => setAtsConnection({ provider: "recruitee", baseUrl: "https://169.254.169.254/latest" }), AtsConnectionError);
  assert.throws(() => setAtsConnection({ provider: "recruitee", baseUrl: "https://localhost/api" }), AtsConnectionError);
  // Empty disables rather than erroring.
  assert.equal(setAtsConnection({ provider: "recruitee", baseUrl: "", fieldMap: MAP }).baseUrl, null);
});

test("a field map without an externalId path is refused at the write boundary", () => {
  assert.throws(() => setAtsConnection({ provider: "recruitee", fieldMap: { paths: { displayName: "name" } } }), Error);
});

test("a connection can be parked without losing its credentials", () => {
  setAtsConnection({ provider: "recruitee", apiToken: TOKEN, fieldMap: MAP });
  const parked = setAtsConnection({ provider: "recruitee", enabled: false });
  assert.equal(parked.enabled, false);
  assert.equal(parked.hasToken, true, "parking is not revoking");
  assert.equal(setAtsConnection({ provider: "recruitee", enabled: true }).enabled, true);
});

test("a refused token store never silently downgrades to plaintext", () => {
  // Mirrors llm-secret's stance: with no key configured we refuse the write rather than
  // persisting a credential in clear.
  delete process.env.KP_ATS_SECRET_KEY;
  delete process.env.KP_SECRET;
  assert.throws(() => setAtsConnection({ provider: "recruitee", apiToken: TOKEN, fieldMap: MAP }), AtsConnectionError);
  assert.equal(getAtsToken("recruitee"), null);
});
