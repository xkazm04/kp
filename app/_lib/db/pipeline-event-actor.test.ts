// UAT LUC-ANA-4 — "V mém světě má rozhodnutí JMÉNO. Tady má třídu."
//
// `pipeline_events` carried no actor column at all (the schema ran entry_id → created_at
// and stopped), so the decision log's *Kdo* column could only ever derive a CLASS from
// `kind`: AUTO / ČLOVĚK / NEZNÁMÉ. Five identified users with memberships sat in the same
// database and not one decision named a person.
//
// This file pins the column end to end — migration, write, read-back through all three
// list functions — and, just as importantly, pins what it must NOT do: never invent an
// actor for a row whose writer could not name one (guardrail G3).
//
// (testing/unit-db.ts must be the first project import — see that module's header.)
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { ensureDb, recordEvent } from "./core.ts";
import {
  actOnPipelineEntry,
  createPipelineEntry,
  listPipelineEvents,
  listPipelineEventsForEntry,
  listPipelineEventsSince,
  recordAutomationEvent,
  reinstatePipelineEntry,
  setPipelineEntryStage,
} from "./pipeline.ts";

after(() => cleanupUnitDb());

const WS = "actor-ws";

function entry(id: string, stage = "Screened") {
  return createPipelineEntry({
    candidateId: id,
    candidateLabel: id,
    jobId: "actor-job",
    jobTitle: "Role",
    stage,
    workspaceId: WS,
  }).entry;
}

const eventsFor = (entryId: string) => listPipelineEventsForEntry(entryId, 50, WS);

test("the actor column exists on a migrated DB and is nullable", () => {
  const cols = (ensureDb().prepare(`PRAGMA table_info(pipeline_events)`).all() as { name: string; notnull: number }[]).filter(
    (c) => c.name === "actor"
  );
  assert.equal(cols.length, 1, "pipeline_events is missing the actor column");
  // NOT NULL would have forced every writer to invent a value — the exact defect.
  assert.equal(cols[0].notnull, 0, "actor must be nullable so 'not identified' is representable");
});

test("recordEvent persists the actor and reads it back through every list function", () => {
  const e = entry("actor-roundtrip");
  const db = ensureDb();
  recordEvent(db, { entryId: e.id, candidateLabel: e.candidateLabel, jobTitle: "Role", kind: "rejected", actor: "human:Petra Nováková", workspaceId: WS });

  const perEntry = eventsFor(e.id).filter((ev) => ev.kind === "rejected");
  assert.equal(perEntry.length, 1);
  assert.equal(perEntry[0].actor, "human:Petra Nováková");

  const feed = listPipelineEvents(50, 0, ["rejected"], WS).filter((ev) => ev.entryId === e.id);
  assert.equal(feed[0].actor, "human:Petra Nováková", "the decision log page must carry the actor to the wire");

  const since = listPipelineEventsSince(0, 200, WS).filter((ev) => ev.entryId === e.id && ev.kind === "rejected");
  assert.equal(since[0].actor, "human:Petra Nováková", "the live-tail cursor feed must carry it too");
});

test("an unnamed actor stays NULL — no writer defaults to a person", () => {
  const e = entry("actor-absent");
  const db = ensureDb();
  recordEvent(db, { entryId: e.id, kind: "scored", workspaceId: WS });
  // An empty/whitespace string is an absence, not an identification.
  recordEvent(db, { entryId: e.id, kind: "outreach_sent", actor: "   ", workspaceId: WS });
  for (const ev of eventsFor(e.id)) {
    assert.equal(ev.actor, null, `${ev.kind} must read as "not identified", never as a defaulted actor`);
  }
});

test("actOnPipelineEntry attributes its event to the caller's server-derived actor", () => {
  const rejected = entry("actor-reject");
  actOnPipelineEntry(rejected.id, "reject", "Below the bar.", { actor: "human", actorRef: "human:Markéta Svobodová" }, WS);
  const rej = eventsFor(rejected.id).find((ev) => ev.kind === "rejected");
  assert.equal(rej?.actor, "human:Markéta Svobodová");

  // The engine names itself; a machine act must never borrow a person's name.
  const simmed = entry("actor-sim");
  actOnPipelineEntry(simmed.id, "accept", undefined, { actor: "system", actorRef: "auto:sim" }, WS);
  const adv = eventsFor(simmed.id).find((ev) => ev.kind === "auto_advanced");
  assert.equal(adv?.actor, "auto:sim");

  // A caller that passes no actorRef (an unmigrated route) still writes its event —
  // attributed to nobody rather than to whoever happens to be the operator.
  const anon = entry("actor-anon");
  actOnPipelineEntry(anon.id, "reject", undefined, { actor: "human" }, WS);
  assert.equal(eventsFor(anon.id).find((ev) => ev.kind === "rejected")?.actor, null);
});

test("a manual move, an automation marker and a REVERSAL each name their own actor", () => {
  const moved = entry("actor-move");
  setPipelineEntryStage(moved.id, "Interview", { actorRef: "human:Jan Dvořák" }, WS);
  assert.equal(eventsFor(moved.id).find((ev) => ev.kind === "moved")?.actor, "human:Jan Dvořák");

  const marked = entry("actor-marker");
  recordAutomationEvent(marked.id, "screening_hold", "Held for review.", WS, "auto:screen-wave");
  assert.equal(eventsFor(marked.id).find((ev) => ev.kind === "screening_hold")?.actor, "auto:screen-wave");

  // The reversal is the most accountability-bearing act on this surface: a person
  // overruling the machine. It seals to THAT person, and never inherits the actor of the
  // auto_rejected row it reverses.
  const reversed = entry("actor-reinstate");
  actOnPipelineEntry(reversed.id, "reject", undefined, { actor: "system", actorRef: "auto:screen-wave" }, WS);
  assert.ok(reinstatePipelineEntry(reversed.id, WS, "human:Petra Nováková"), "expected the auto-rejection to be reversible");
  const trail = eventsFor(reversed.id);
  assert.equal(trail.find((ev) => ev.kind === "auto_rejected")?.actor, "auto:screen-wave");
  assert.equal(trail.find((ev) => ev.kind === "reinstated")?.actor, "human:Petra Nováková");
});
