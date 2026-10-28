// C5 — the connectors deck's model: sealed and not_configured never share a label key, a keyless
// install reads every connector not_configured, missing free/busy reads unknown (never free), and
// smtp's card never offers a probe (operator rule, 2026-10-28: its probe is a real letter).
//
// unit-db.ts must stay the first project import (the keyless test reads the real catalog).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../../../../../_lib/testing/unit-db.ts";
import { GET } from "../../../../../api/connect/route.ts";
import { CONNECTOR_IDS, HEALTH_WORDS, type ConnectorHealth, type ConnectorId } from "../../../../../_lib/connect/catalog.ts";
import {
  HEALTH_CONDITION, HEALTH_LABEL, deckCard, deckCards, deckSummary, doorOf, parseConnectBody, probeUrl, type ConnectorWire,
} from "./connectorsDeckModel.ts";

after(() => cleanupUnitDb());

const wire = (id: ConnectorId, health: ConnectorHealth): ConnectorWire => ({ id, health, lastOkAt: null, lastFailure: null });

test("sealed and not_configured render different label keys (and different marks)", () => {
  assert.notEqual(deckCard(wire("comms_relay", "sealed")).label, deckCard(wire("comms_relay", "not_configured")).label);
  assert.notEqual(HEALTH_CONDITION.sealed, HEALTH_CONDITION.not_configured);
  // Every health word has its own key: the vocabulary is never flattened.
  assert.equal(new Set(Object.values(HEALTH_LABEL)).size, HEALTH_WORDS.length);
});

test("a fresh keyless DB: GET /api/connect -> every connector card reads not_configured", async () => {
  delete process.env.KP_NO_COMMS_EGRESS;
  delete process.env.COMMS_WEBHOOK_URL;
  const res = await GET();
  const rows = parseConnectBody(await res.json());
  assert.ok(rows, "the catalog parses");
  assert.deepEqual(rows.map((r) => r.id).sort(), [...CONNECTOR_IDS].sort(), "every connector is on the deck");
  const cards = Object.values(deckCards(rows)).flat();
  assert.equal(cards.length, CONNECTOR_IDS.length);
  for (const c of cards) {
    assert.equal(c.health, "not_configured", c.id);
    assert.equal(c.label, HEALTH_LABEL.not_configured, c.id);
    assert.equal(c.condition, "off", c.id);
  }
  assert.deepEqual(deckSummary(rows), { total: CONNECTOR_IDS.length, connected: 0, failing: 0, sealed: false });
});

test("missing busy data reads unknown, never free: only a proven calendar counts as read", () => {
  for (const h of HEALTH_WORDS) {
    assert.equal(deckCard(wire("calendar", h)).busy, h === "connected" ? "read" : "unknown", h);
  }
  assert.equal(deckCard(wire("smtp", "connected")).busy, undefined, "busy is the calendar's fact only");
});

test("smtp never offers a probe, in any health; the hub has no probe URL for it", () => {
  for (const h of HEALTH_WORDS) assert.equal(doorOf(wire("smtp", h)), "sender", h);
  assert.equal(probeUrl("smtp"), null);
  assert.equal(probeUrl("ats_inbound:recruitee"), "/api/connect/ats_inbound%3Arecruitee/probe");
});

test("doors: sealed has nothing to press, a saved connector offers Probe, an empty relay opens the sender", () => {
  assert.equal(doorOf(wire("comms_relay", "sealed")), null);
  assert.equal(doorOf(wire("ats_webhook", "not_configured")), null);
  assert.equal(doorOf(wire("comms_relay", "not_configured")), "sender");
  for (const h of ["unverified", "connected", "failing"] as const) assert.equal(doorOf(wire("calendar", h)), "probe");
});

test("cards group by what the studio talks to and keep the catalog's order inside a group", () => {
  const g = deckCards([wire("comms_relay", "connected"), wire("smtp", "unverified"), wire("ats_webhook", "failing"), wire("calendar", "unverified"), wire("ats_inbound:teamio", "unverified")]);
  assert.deepEqual(g.delivery.map((c) => c.id), ["comms_relay", "smtp"]);
  assert.deepEqual(g.ats.map((c) => c.id), ["ats_webhook", "ats_inbound:teamio"]);
  assert.equal(g.ats[1].provider, "teamio");
  assert.deepEqual(g.calendar.map((c) => c.id), ["calendar"]);
});

test("the parse drops what it does not know and never carries a field value", () => {
  const rows = parseConnectBody({
    connectors: [
      { id: "smtp", health: "unverified", lastOkAt: null, lastFailure: null, fields: [{ key: "password", secret: true, hasSecret: true }] },
      { id: "ftp", health: "connected" },
      { id: "calendar", health: "asleep" },
    ],
  });
  assert.deepEqual(rows, [{ id: "smtp", health: "unverified", lastOkAt: null, lastFailure: null }]);
  assert.equal(parseConnectBody({ error: "Unauthorized" }), null, "a refusal is unknown, not an empty catalog");
  assert.equal(deckSummary(null), null);
});

test("an all-sealed catalog says so on the door", () => {
  assert.equal(deckSummary([wire("comms_relay", "sealed"), wire("smtp", "sealed")])?.sealed, true);
});
