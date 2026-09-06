// /perfect wave 41 (api-ats-integration) — the INBOUND ATS connections door.
//
// Three properties, none of which the route had:
//
//   1. every refusal answers a CODE. It used to answer five hand-written English
//      sentences AND forward every message the connection store and the field-map parser
//      threw, straight into a panel that renders through useErrorMessage in four
//      languages (.claude/CLAUDE.md, "a failure is answered with a CODE").
//   2. a save composed against a connection a second tab has replaced is REFUSED (409),
//      not applied on top of it.
//   3. removing a connection forgets its links in EVERY workspace. ats_connections is
//      keyed by provider alone; ats_links is per-tenant, so the workspace-scoped drop
//      left other teams bound to a provider whose credential no longer exists.
//
// NON-VACUITY: against pre-fix code every `code` assertion below reads `undefined` (the
// route shipped `{ error: "<English>" }` with no code at all), the stale POST answers 200
// having clobbered the other tab's field map, and the org-wide count reads 1 instead of 2.
//
// unit-db.ts must stay the first project import (isolated throwaway DB), and next/server
// is resolved to the shared shim BEFORE the route loads — hence the dynamic imports.
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";

register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

type Route = {
  POST: (req: Request) => Promise<Response>;
  DELETE: (req: Request) => Promise<Response>;
  GET: () => Promise<Response>;
};
type Store = typeof import("../../../_lib/ats/connections-store.ts");
type Links = typeof import("../../../_lib/ats/links-store.ts");

let route: Route;
// A REAL second workspace row: the org-wide link drop enumerates listWorkspaces() so that
// every statement it runs binds workspace_id (tenancy-coverage.test.ts).
let OTHER_WS: string;
let store: Store;
let links: Links;

const TOKEN = "recruitee-live-token-abc123-do-not-leak";
const MAP = { paths: { externalId: "id" }, stages: {} };

before(async () => {
  process.env.KP_ATS_SECRET_KEY = "unit-test-ats-key";
  route = (await import("./route.ts")) as unknown as Route;
  store = await import("../../../_lib/ats/connections-store.ts");
  links = await import("../../../_lib/ats/links-store.ts");
  OTHER_WS = (await import("../../../_lib/db/workspaces.ts")).createWorkspace("ATS route fixture tenant").id;
});

beforeEach(() => {
  // Open mode (no KP_OPERATOR_PASSWORD) = trusted local dev; the operator gate is pinned
  // next door in ats-routes-auth.test.ts, so these tests are about what it lets through.
  delete process.env.KP_OPERATOR_PASSWORD;
  process.env.KP_ATS_SECRET_KEY = "unit-test-ats-key";
  for (const p of store.ATS_PROVIDERS) {
    store.deleteAtsConnection(p);
    links.deleteAtsLinksForProviderEverywhere(p);
  }
});
after(() => cleanupUnitDb());

const post = (body: unknown): Promise<Response> =>
  route.POST(
    new Request("http://localhost/api/ats/connections", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    })
  );
const del = (query: string): Promise<Response> =>
  route.DELETE(new Request(`http://localhost/api/ats/connections?${query}`, { method: "DELETE" }));

async function refusal(res: Response): Promise<{ status: number; code: string | undefined }> {
  const body = (await res.json()) as { code?: string };
  return { status: res.status, code: body.code };
}

test("every save refusal answers a code, never the store's English message", async () => {
  assert.deepEqual(await refusal(await post({ provider: "greenhoose" })), {
    status: 400,
    code: "ATS_CONNECTION_PROVIDER_UNKNOWN",
  });
  assert.deepEqual(await refusal(await post({ provider: "recruitee", baseUrl: "https://169.254.169.254/latest" })), {
    status: 400,
    code: "ATS_CONNECTION_BASE_URL_INVALID",
  });
  assert.deepEqual(await refusal(await post({ provider: "recruitee", apiToken: 7 })), {
    status: 400,
    code: "ATS_CONNECTION_TOKEN_INVALID",
  });
  assert.deepEqual(await refusal(await post({ provider: "recruitee", fieldMap: { paths: { displayName: "n" } } })), {
    status: 400,
    code: "ATS_FIELD_MAP_INVALID",
  });
});

test("the save door caps its body and answers 413 with the cap as data", async () => {
  // Over the wire, not by content-length: a caller can omit or lie about that header.
  const huge = { provider: "recruitee", fieldMap: { paths: { externalId: "x".repeat(40 * 1024) } } };
  const res = await post(huge);
  assert.equal(res.status, 413);
  const body = (await res.json()) as { code?: string; maxBytes?: number };
  assert.equal(body.code, "PAYLOAD_TOO_LARGE");
  assert.equal(typeof body.maxBytes, "number", "the panel is told the cap it exceeded");
});

test("two tabs: the second save is refused 409 and carries what is actually stored", async () => {
  const created = (await (await post({ provider: "recruitee", apiToken: TOKEN, fieldMap: MAP })).json()) as {
    connection: { version: number };
  };
  assert.equal(created.connection.version, 1, "the read view carries the version the next write must echo");

  // Tab A writes a new map against that version.
  const a = await post({
    provider: "recruitee",
    fieldMap: { paths: { externalId: "uuid", contact: "emails.0" } },
    expectedVersion: created.connection.version,
  });
  assert.equal(a.status, 200);

  // Tab B is still holding version 1 and only means to park the connection.
  const b = await post({ provider: "recruitee", enabled: false, expectedVersion: created.connection.version });
  assert.equal(b.status, 409);
  const stale = (await b.json()) as { code?: string; connection?: { version: number; enabled: boolean; fieldMap: { paths: Record<string, string> } } };
  assert.equal(stale.code, "ATS_CONNECTION_STALE");
  assert.equal(stale.connection?.fieldMap.paths.contact, "emails.0", "tab A's map survived");
  assert.equal(stale.connection?.enabled, true, "tab B's park was dropped whole");
  assert.equal(stale.connection?.version, 2, "and the refusal hands the panel the version to re-apply against");
});

test("removing a connection forgets its links in EVERY workspace, and says how many", async () => {
  await post({ provider: "recruitee", apiToken: TOKEN, fieldMap: MAP });
  links.upsertAtsLink({ provider: "recruitee", externalId: "1", entryId: "kp-a" });
  links.upsertAtsLink({ provider: "recruitee", externalId: "9", entryId: "kp-c" }, OTHER_WS);

  const res = await del("provider=recruitee&forgetLinks=1");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; linksDropped: number; linksKept: boolean };
  assert.equal(body.linksDropped, 2, "the count covers the whole installation, not just the caller's team");
  assert.equal(body.linksKept, false);
  assert.equal(links.findAtsLink("recruitee", "1"), null);
  assert.equal(links.findAtsLink("recruitee", "9", OTHER_WS), null, "no tenant is left bound to a dead provider");
});

test("forgetLinks left off keeps every link, in every workspace", async () => {
  await post({ provider: "recruitee", apiToken: TOKEN, fieldMap: MAP });
  links.upsertAtsLink({ provider: "recruitee", externalId: "1", entryId: "kp-a" });
  links.upsertAtsLink({ provider: "recruitee", externalId: "9", entryId: "kp-c" }, OTHER_WS);

  const body = (await (await del("provider=recruitee&forgetLinks=0")).json()) as { linksDropped: number; linksKept: boolean };
  assert.equal(body.linksDropped, 0);
  assert.equal(body.linksKept, true);
  assert.equal(links.findAtsLink("recruitee", "1")?.entryId, "kp-a");
  assert.equal(links.findAtsLink("recruitee", "9", OTHER_WS)?.entryId, "kp-c");
});

test("the removal refusals are coded too", async () => {
  assert.deepEqual(await refusal(await del("")), { status: 400, code: "ATS_CONNECTION_PROVIDER_UNKNOWN" });
  assert.deepEqual(await refusal(await del("provider=recruitis")), { status: 404, code: "ATS_CONNECTION_NOT_FOUND" });
});

test("the read view still never carries the token", async () => {
  await post({ provider: "recruitee", baseUrl: "https://api.recruitee.com", apiToken: TOKEN, fieldMap: MAP });
  const listed = await (await route.GET()).text();
  assert.equal(listed.includes(TOKEN), false, "the secret doctrine survives every change above");
  assert.equal(listed.includes('"version"'), true, "and the panel can read the version it must echo back");
});
