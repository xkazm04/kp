// C5 — a revoked calendar grant becomes a need with Reconnect. Driven against the real catalog
// (GET /api/connect): the grant Google withdrew is recorded by the calendar edge
// (markCalendarHealth), the catalog row carries `repair: "reconnect"`, the plumbing ranks the need
// `calendarReconnect` and the deck's calendar card offers Reconnect instead of another probe.
//
// unit-db.ts must stay the first project import.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../../../../../_lib/testing/unit-db.ts";
import { GET } from "../../../../../api/connect/route.ts";
import { markCalendarHealth, saveCalendarConnection } from "../../../../../_lib/calendar/token-store.ts";
import { NEEDS_SHOWN, plumbingModel, type PlumbingInput } from "../channelsNightPlumbing.ts";
import { calendarNeedsReconnect, deckCard, parseConnectBody } from "./connectorsDeckModel.ts";

before(() => {
  process.env.KP_ATS_SECRET_KEY = "unit-test-ats-key";
  process.env.GOOGLE_OAUTH_CLIENT_ID = "unit-client-id";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "unit-client-secret";
});
after(() => {
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  cleanupUnitDb();
});

const QUIET: PlumbingInput = {
  jobs: [{ id: "job-1" }], receivers: [], receiversTruncated: false, waiting: 0, messages: [], olderExist: false,
  relay: "configured", edge: null, settled: true,
};

async function rows() {
  const r = parseConnectBody(await (await GET()).json());
  assert.ok(r);
  return r;
}

function connect() {
  saveCalendarConnection({
    tokens: { accessToken: "at-unit", refreshToken: "rt-unit", expiresAt: new Date(Date.now() + 3600_000).toISOString(), scopes: [] },
    accountEmail: "recruiter@example.test",
  });
}

test("a healthy grant is no need, and its card offers a probe", async () => {
  connect();
  const list = await rows();
  assert.equal(calendarNeedsReconnect(list), false);
  const cal = list.find((r) => r.id === "calendar");
  assert.equal(cal?.health, "unverified");
  assert.equal(cal && deckCard(cal).door, "probe");
  assert.ok(!plumbingModel({ ...QUIET, calendarReconnect: false }).needs.some((n) => n.key === "calendarReconnect"));
});

test("a revoked grant appears as a need with Reconnect, worst-first above the quiet items", async () => {
  connect();
  markCalendarHealth("revoked");
  const list = await rows();
  const cal = list.find((r) => r.id === "calendar");
  assert.equal(cal?.health, "failing");
  assert.equal(cal?.repair, "reconnect");
  assert.equal(cal && deckCard(cal).door, "reconnect", "another probe cannot fix a revoked grant");
  assert.equal(calendarNeedsReconnect(list), true);

  const model = plumbingModel({ ...QUIET, calendarReconnect: calendarNeedsReconnect(list) });
  const need = model.needs.find((n) => n.key === "calendarReconnect");
  assert.ok(need, "the revoked grant is a need");
  assert.ok(need.sev >= NEEDS_SHOWN, "listed on level 0");
  assert.equal(need.tone, "bad");
  assert.deepEqual(need.target, { level: 1, deck: "connectors", focus: "calendar" }, "its door opens the deck on the calendar");
  assert.equal(model.headline.kind, "need");
});

test("a re-save (the Reconnect's own effect) clears the need", async () => {
  connect();
  markCalendarHealth("revoked");
  connect();
  assert.equal(calendarNeedsReconnect(await rows()), false);
});

test("an unread catalog is not 'no reconnect needed'", () => {
  assert.equal(calendarNeedsReconnect(null), null);
  assert.ok(!plumbingModel({ ...QUIET, calendarReconnect: null }).needs.some((n) => n.key === "calendarReconnect"));
});
