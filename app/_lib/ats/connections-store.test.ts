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
  AtsConnectionStaleError,
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
  setAtsConnection({ provider: "recruitee", baseUrl: "https://api.recruitee.com", apiToken: TOKEN, fieldMap: MAP });
  const parked = setAtsConnection({ provider: "recruitee", enabled: false });
  assert.equal(parked.enabled, false);
  assert.equal(parked.hasToken, true, "parking is not revoking");
  // …and not de-configuring. baseUrl was the one field written unconditionally, so the
  // documented park NULLed the endpoint: re-enabling gave a connection with a live token
  // and a field map but nothing to call.
  assert.equal(parked.baseUrl, "https://api.recruitee.com/", "parking is not de-configuring");
  const resumed = setAtsConnection({ provider: "recruitee", enabled: true });
  assert.equal(resumed.enabled, true);
  assert.equal(resumed.baseUrl, "https://api.recruitee.com/");
});

test("every field is a PARTIAL update — omit keeps, explicit empty clears", () => {
  setAtsConnection({ provider: "recruitee", baseUrl: "https://api.recruitee.com", apiToken: TOKEN, fieldMap: MAP });
  // A field-map-only edit must not de-configure the endpoint, the same way it must not
  // wipe the token.
  const mapped = setAtsConnection({ provider: "recruitee", fieldMap: { paths: { externalId: "uuid" } } });
  assert.equal(mapped.baseUrl, "https://api.recruitee.com/");
  assert.equal(mapped.hasToken, true);
  // Blanking is still possible — the panel sends an explicit null for an emptied field.
  assert.equal(setAtsConnection({ provider: "recruitee", baseUrl: null }).baseUrl, null);
});

test("a refused token store never silently downgrades to plaintext", () => {
  // Mirrors llm-secret's stance: with no key configured we refuse the write rather than
  // persisting a credential in clear.
  delete process.env.KP_ATS_SECRET_KEY;
  delete process.env.KP_SECRET;
  assert.throws(() => setAtsConnection({ provider: "recruitee", apiToken: TOKEN, fieldMap: MAP }), AtsConnectionError);
  assert.equal(getAtsToken("recruitee"), null);
});

// OPTIMISTIC CONCURRENCY (/perfect wave 41, api-ats-integration). The egress config store
// next door has carried a version since 2026-09-03; this one had none, so two operator
// tabs on the same panel were last-write-wins.
//
// NON-VACUITY: pre-fix there was no `version` on the public view and `expectedVersion`
// was an unread key, so BOTH writes below landed and the assertions on the second one
// read the loser's values back as the stored state.
test("every accepted write bumps the version, and the public view carries it", () => {
  const first = setAtsConnection({ provider: "recruitee", apiToken: TOKEN, fieldMap: MAP });
  assert.equal(first.version, 1, "a fresh connection is version 1, not 0 — 0 is what a pre-upgrade row backfills to");
  assert.equal(setAtsConnection({ provider: "recruitee", enabled: false }).version, 2);
  assert.equal(getAtsConnection("recruitee")?.version, 2);
});

test("two writers: the one composed against a stale read is DROPPED, not merged", () => {
  const read = setAtsConnection({ provider: "recruitee", baseUrl: "https://api.recruitee.com", apiToken: TOKEN, fieldMap: MAP });

  // Tab A saves a new field map against the version both tabs read.
  const tabA = setAtsConnection({
    provider: "recruitee",
    fieldMap: { paths: { externalId: "uuid", contact: "emails.0" } },
    expectedVersion: read.version,
  });
  assert.equal(tabA.version, read.version + 1);

  // Tab B still holds the OLD version and only means to park the connection. Pre-fix that
  // silently reverted tab A's field map.
  assert.throws(
    () => setAtsConnection({ provider: "recruitee", enabled: false, expectedVersion: read.version }),
    AtsConnectionStaleError
  );
  const stored = getAtsConnection("recruitee");
  assert.equal(stored?.fieldMap.paths.contact, "emails.0", "tab A's map survived");
  assert.equal(stored?.enabled, true, "and tab B's park was dropped whole, not half-applied");
  assert.equal(stored?.version, tabA.version, "a refused write does not move the version");

  // Re-reading and re-applying works — the panel's documented recovery.
  assert.equal(setAtsConnection({ provider: "recruitee", enabled: false, expectedVersion: stored!.version }).enabled, false);
});

test("expectedVersion is optional: a server-internal write with no read to be stale about still lands", () => {
  setAtsConnection({ provider: "recruitee", apiToken: TOKEN, fieldMap: MAP });
  assert.equal(setAtsConnection({ provider: "recruitee", enabled: false }).enabled, false);
  // A version we cannot compare refuses as stale rather than writing blind.
  assert.throws(() => setAtsConnection({ provider: "recruitee", enabled: true, expectedVersion: "soon" }), AtsConnectionStaleError);
  assert.throws(() => setAtsConnection({ provider: "recruitee", enabled: true, expectedVersion: -1 }), AtsConnectionStaleError);
});

// CODED REFUSALS. The route answers `errors.<code>` in the reader's language; the English
// message stays in the server log. Pre-fix these errors carried no code at all and the
// route forwarded `.message`, so a Czech operator read canonical English in the panel.
test("every validation refusal carries the code the route answers with", () => {
  const codeOf = (fn: () => unknown): string | undefined => {
    try {
      fn();
    } catch (e) {
      return (e as { code?: string }).code;
    }
    return undefined;
  };
  assert.equal(codeOf(() => setAtsConnection({ provider: "greenhoose" })), "ATS_CONNECTION_PROVIDER_UNKNOWN");
  assert.equal(codeOf(() => setAtsConnection({ provider: "recruitee", baseUrl: "http://api.recruitee.com" })), "ATS_CONNECTION_BASE_URL_INVALID");
  assert.equal(codeOf(() => setAtsConnection({ provider: "recruitee", baseUrl: 7 })), "ATS_CONNECTION_BASE_URL_INVALID");
  assert.equal(codeOf(() => setAtsConnection({ provider: "recruitee", apiToken: 7 })), "ATS_CONNECTION_TOKEN_INVALID");
  assert.equal(
    codeOf(() => setAtsConnection({ provider: "recruitee", fieldMap: { paths: { displayName: "name" } } })),
    "ATS_FIELD_MAP_INVALID"
  );
  delete process.env.KP_ATS_SECRET_KEY;
  delete process.env.KP_SECRET;
  assert.equal(codeOf(() => setAtsConnection({ provider: "recruitee", apiToken: TOKEN })), "ATS_CONNECTION_TOKEN_INVALID");
});

// ROTATION HEALING (Director addendum). A token sealed under the retired key is rewritten
// under the current one on the next save, so the rotation window closes itself instead of
// waiting for `npm run secrets:rotate`.
test("a preserved token sealed under the PREVIOUS key is re-sealed under the current one", () => {
  process.env.KP_ATS_SECRET_KEY = "the-old-ats-key";
  setAtsConnection({ provider: "recruitee", apiToken: TOKEN, fieldMap: MAP });

  process.env.KP_ATS_SECRET_KEY = "the-new-ats-key";
  process.env.KP_ATS_SECRET_KEY_PREVIOUS = "the-old-ats-key";
  // An unrelated edit that does NOT resend the token.
  setAtsConnection({ provider: "recruitee", enabled: false });

  delete process.env.KP_ATS_SECRET_KEY_PREVIOUS;
  assert.equal(getAtsToken("recruitee"), TOKEN, "the row healed itself on the next write");
  process.env.KP_ATS_SECRET_KEY = "unit-test-ats-key";
});
