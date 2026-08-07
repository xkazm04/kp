import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAtsRecord } from "../ats-record.ts";
import {
  ATS_INBOUND_SCHEMA_VERSION,
  AtsInboundError,
  parseInboundCandidate,
  toAtsEntryInput,
} from "./inbound.ts";
import { applyFieldMap, mapStage, parseFieldMap, readPath, AtsFieldMapError } from "./field-map.ts";

const minimal = { provider: "recruitee", externalId: "42" };

test("a minimal record parses and falls back to the vendor id for a name", () => {
  const c = parseInboundCandidate(minimal);
  assert.equal(c.schemaVersion, ATS_INBOUND_SCHEMA_VERSION);
  assert.equal(c.provider, "recruitee");
  assert.equal(c.externalId, "42");
  // An unnamed application is still a real application; the vendor id IS the identity.
  assert.equal(c.displayName, "42");
  assert.equal(c.contact, null);
  assert.equal(c.stage, null);
});

test("the two unfaultable fields throw; everything else nulls quietly", () => {
  // A missing name is cosmetic and a recruiter can fix it. A missing external id breaks
  // sync identity and silently duplicates people on every run — hence the asymmetry.
  assert.throws(() => parseInboundCandidate({ provider: "recruitee" }), AtsInboundError);
  assert.throws(() => parseInboundCandidate({ externalId: "42" }), AtsInboundError);
  assert.throws(() => parseInboundCandidate(null), AtsInboundError);
  assert.throws(() => parseInboundCandidate("not an object"), AtsInboundError);

  const c = parseInboundCandidate({ ...minimal, contact: 12345, jobTitle: {}, cvText: [] });
  assert.equal(c.contact, null);
  assert.equal(c.jobTitle, null);
  assert.equal(c.cvText, null);
});

test("only a real kp stage is accepted from outside", () => {
  assert.equal(parseInboundCandidate({ ...minimal, stage: "Interview" }).stage, "Interview");
  assert.equal(parseInboundCandidate({ ...minimal, stage: "Phone screen" }).stage, null);
  assert.equal(parseInboundCandidate({ ...minimal, stage: "Hired " }).stage, null, "no fuzzy matching from an external payload");
});

test("appliedAt takes ISO or nothing — never a coerced guess", () => {
  // A wrong applied-at silently skews every time-to-hire figure, and the metric pack
  // publishes those, so a vendor's loose format must be converted by the connector.
  assert.equal(parseInboundCandidate({ ...minimal, appliedAt: "2026-03-01T08:00:00Z" }).appliedAt, "2026-03-01T08:00:00.000Z");
  assert.equal(parseInboundCandidate({ ...minimal, appliedAt: "2026/03/01" }).appliedAt, null);
  assert.equal(parseInboundCandidate({ ...minimal, appliedAt: "2026" }).appliedAt, null);
  assert.equal(parseInboundCandidate({ ...minimal, appliedAt: 1772000000000 }).appliedAt, null);
  assert.equal(parseInboundCandidate({ ...minimal, appliedAt: "not a date" }).appliedAt, null);
});

test("oversized external text is bounded, not rejected", () => {
  const c = parseInboundCandidate({ ...minimal, displayName: "x".repeat(500), cvText: "y".repeat(200_000) });
  assert.equal(c.displayName.length, 200);
  assert.equal(c.cvText!.length, 60_000);
});

test("kp-derived truth cannot be asserted from outside", () => {
  // The inbound shape has no slot for a match score, an archetype or a sealed decision.
  // An ATS asserting those would launder an external opinion into our own scoring and
  // audit trail, so the projection hard-nulls them.
  const entry = toAtsEntryInput(parseInboundCandidate({ ...minimal, displayName: "Jana N." }), { entryId: "e1" });
  assert.equal(entry.matchScore, null);
  assert.equal(entry.archetype, null);
  assert.equal(entry.roleFamily, null);
  assert.equal(entry.candidateId, null);
});

test("an unmapped stage falls back explicitly, never to a silent guess", () => {
  const c = parseInboundCandidate(minimal);
  assert.equal(toAtsEntryInput(c, { entryId: "e1" }).stage, "Accepted");
  assert.equal(toAtsEntryInput(c, { entryId: "e1", stageFallback: "Screened" }).stage, "Screened");
});

// ---- the W1.1 acceptance invariant -------------------------------------------------

test("ROUND TRIP: an imported candidate emits a stable egress record", () => {
  // The seam's contract. A candidate that arrived through a connector must produce the
  // same kp.ats.v1 shape as one who applied directly — otherwise ingest and egress drift
  // and a customer's two-way sync starts disagreeing with itself.
  const vendorPayload = {
    id: 907,
    candidate: { name: "Jana Nováková", emails: ["jana@example.com"] },
    offer: { id: "req-12", title: "Backend Engineer" },
    stage: { name: "1st round" },
    created_at: "2026-03-01T08:00:00Z",
  };
  const map = parseFieldMap({
    paths: {
      externalId: "id",
      displayName: "candidate.name",
      contact: "candidate.emails.0",
      externalJobId: "offer.id",
      jobTitle: "offer.title",
      externalStage: "stage.name",
      appliedAt: "created_at",
    },
    stages: { "1st round": "Interview" },
  });

  const inbound = applyFieldMap(map, "recruitee", vendorPayload);
  assert.equal(inbound.externalId, "907", "a numeric vendor id becomes a string id");
  assert.equal(inbound.stage, "Interview");
  assert.equal(inbound.externalStage, "1st round", "the vendor's own wording is kept for audit");

  const record = buildAtsRecord({
    entry: toAtsEntryInput(inbound, { entryId: "kp-entry-1", kpJobId: "kp-job-9" }),
    exportedAt: "2026-03-02T00:00:00.000Z",
  });

  assert.equal(record.schemaVersion, "kp.ats.v1");
  assert.equal(record.candidate.ref, "kp-entry-1");
  assert.equal(record.candidate.displayName, "Jana Nováková");
  assert.equal(record.candidate.contact, "jana@example.com");
  assert.equal(record.role.jobId, "kp-job-9", "the kp job id wins over the vendor's once resolved");
  assert.equal(record.role.title, "Backend Engineer");
  assert.equal(record.pipeline.stage, "Interview");
  assert.equal(record.pipeline.enteredAt, "2026-03-01T08:00:00.000Z");
  // Nothing kp-derived was invented on the way through.
  assert.equal(record.pipeline.matchScore, null);
  assert.equal(record.decision, null);
  assert.equal(record.offer, null);
});

test("an unresolved job keeps the EXTERNAL id rather than detaching the candidate", () => {
  const inbound = parseInboundCandidate({ ...minimal, externalJobId: "req-12" });
  assert.equal(toAtsEntryInput(inbound, { entryId: "e1" }).jobId, "req-12");
});

// ---- field map ---------------------------------------------------------------------

test("readPath walks objects and array indices", () => {
  const payload = { a: { b: [{ c: "hit" }] } };
  assert.equal(readPath(payload, "a.b.0.c"), "hit");
  assert.equal(readPath(payload, "a.b.1.c"), undefined);
  assert.equal(readPath(payload, "a.missing.c"), undefined);
  assert.equal(readPath(payload, ""), undefined);
});

test("readPath refuses prototype keys and unbounded depth", () => {
  assert.equal(readPath({ x: 1 }, "__proto__.polluted"), undefined);
  assert.equal(readPath({ x: 1 }, "constructor.name"), undefined);
  assert.equal(readPath({ a: { b: { c: { d: { e: { f: { g: { h: { i: 1 } } } } } } } } }, "a.b.c.d.e.f.g.h.i"), undefined);
});

test("stage mapping is case- and whitespace-insensitive", () => {
  const map = parseFieldMap({ paths: { externalId: "id" }, stages: { "Phone Screen": "Screened" } });
  assert.equal(mapStage(map, "phone screen"), "Screened");
  assert.equal(mapStage(map, "  PHONE SCREEN  "), "Screened");
  assert.equal(mapStage(map, "Onsite"), null, "an unmapped vendor stage must not guess");
  assert.equal(mapStage(map, 7), null);
});

test("a field map without externalId is rejected at the write boundary", () => {
  // The one path whose absence would re-import every candidate as new, every sync.
  assert.throws(() => parseFieldMap({ paths: { displayName: "name" } }), AtsFieldMapError);
  assert.throws(() => parseFieldMap({ paths: { externalId: "id", nope: "x" } }), AtsFieldMapError);
  assert.throws(() => parseFieldMap({ paths: { externalId: "" } }), AtsFieldMapError);
  assert.throws(() => parseFieldMap({ paths: { externalId: "id" }, stages: { x: "Nowhere" } }), AtsFieldMapError);
  assert.throws(() => parseFieldMap(null), AtsFieldMapError);
});

test("a mapped payload gets the same validation as a hand-built one", () => {
  const map = parseFieldMap({ paths: { externalId: "id", displayName: "name" } });
  // The map is a convenience, not a bypass: a missing external id still throws.
  assert.throws(() => applyFieldMap(map, "recruitee", { name: "No Id" }), Error);
  // And an object where a scalar belongs is dropped rather than stringified into
  // "[object Object]", which would collide across every candidate.
  assert.throws(() => applyFieldMap(map, "recruitee", { id: { nested: true } }), Error);
});

test("a payload cannot claim to be a different provider", () => {
  // provider is deliberately unmappable — it identifies the CONNECTION, and a vendor
  // record asserting another provider's name would poison that provider's id namespace.
  const map = parseFieldMap({ paths: { externalId: "id" } });
  const c = applyFieldMap(map, "recruitee", { id: "1", provider: "greenhouse" });
  assert.equal(c.provider, "recruitee");
});
