// Pins the kp.comm.v1 outbound export envelope (E8): the flat legacy fields
// survive verbatim, entry context maps onto candidate/job/stage (contact →
// candidate.email), and a non-entry ref degrades to null context — never a
// missing field. This IS the wire contract documented in
// docs/OUTBOUND_EXPORT.md; a relay is written against exactly these shapes.
//
// Runner: Node's built-in test runner with type stripping — npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildCommEnvelope, COMM_SCHEMA, KNOWN_COMM_KINDS, type CommEnvelopeContext } from "./comms-envelope.ts";

const MSG = { to: "jana@example.cz", subject: "Offer — Backend Engineer", body: "Hi Jana,…", kind: "offer", ref: "m-appl-jana-job-1" };

const ENTRY: CommEnvelopeContext = {
  candidateId: "prof-123",
  candidateLabel: "Jana Nová",
  contact: "jana@example.cz",
  locale: "cs",
  jobId: "job-1",
  jobTitle: "Backend Engineer",
  stage: "Offer",
  sourceChannel: "quick-apply",
};

test("the flat legacy wire fields are preserved verbatim", () => {
  const env = buildCommEnvelope(MSG, ENTRY, "2026-06-11T12:00:00.000Z");
  assert.equal(env.schema, COMM_SCHEMA);
  assert.equal(env.to, MSG.to);
  assert.equal(env.subject, MSG.subject);
  assert.equal(env.body, MSG.body);
  assert.equal(env.kind, MSG.kind);
  assert.equal(env.ref, MSG.ref);
  assert.equal(env.sentAt, "2026-06-11T12:00:00.000Z");
});

test("entry context maps onto candidate/job/stage — contact becomes candidate.email", () => {
  const env = buildCommEnvelope(MSG, ENTRY, "2026-06-11T12:00:00.000Z");
  assert.deepEqual(env.candidate, {
    id: "prof-123",
    label: "Jana Nová",
    email: "jana@example.cz",
    locale: "cs",
    sourceChannel: "quick-apply",
  });
  assert.deepEqual(env.job, { id: "job-1", title: "Backend Engineer" });
  assert.equal(env.stage, "Offer");
});

test("a non-entry ref carries null context, never missing fields", () => {
  const env = buildCommEnvelope({ ...MSG, ref: "dev-lifecycle-9" }, null, "2026-06-11T12:00:00.000Z");
  assert.equal(env.candidate, null);
  assert.equal(env.job, null);
  assert.equal(env.stage, null);
  assert.equal(env.ref, "dev-lifecycle-9");
});

test("an absent ref serializes as null (not undefined — it must survive JSON)", () => {
  const { ref, ...withoutRef } = MSG;
  void ref;
  const env = buildCommEnvelope(withoutRef, null, "2026-06-11T12:00:00.000Z");
  assert.equal(env.ref, null);
  assert.ok(JSON.stringify(env).includes('"ref":null'));
});

test("a blank candidate label reads as null, not an empty string", () => {
  const env = buildCommEnvelope(MSG, { ...ENTRY, candidateLabel: "  " }, "2026-06-11T12:00:00.000Z");
  assert.equal(env.candidate?.label, null);
});

// SOURCE GUARD (repo pattern, cf. channels-tenancy.test.ts / public-routes.test.ts):
// the published kind vocabulary is asserted against the dispatchers themselves, not
// against a copy of the list. The previous test re-asserted the literal array, so it
// stayed green while the list drifted to 8 of 13 emitted kinds — a documented export
// contract that quietly lied to integrators. Every `kind: "…"` handed to sendComm /
// sendCandidateComm in comms-dispatch.ts must appear in KNOWN_COMM_KINDS and vice
// versa: adding a dispatcher without documenting it now fails here.
const dispatchSrc = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "comms-dispatch.ts"),
  "utf8"
);
const emittedKinds = new Set([...dispatchSrc.matchAll(/\bkind:\s*"([a-z_]+)"/g)].map((m) => m[1]));

test("every kind the dispatchers emit is in the documented vocabulary (and vice versa)", () => {
  // Guard the guard: a rename/restructure that stops matching must fail loudly rather
  // than pass on an empty set.
  assert.ok(emittedKinds.size >= 13, `expected >=13 dispatched kinds, found ${emittedKinds.size}`);
  const documented = new Set<string>(KNOWN_COMM_KINDS);
  const undocumented = [...emittedKinds].filter((k) => !documented.has(k)).sort();
  const phantom = [...documented].filter((k) => !emittedKinds.has(k)).sort();
  assert.deepEqual(undocumented, [], `dispatched but absent from KNOWN_COMM_KINDS: ${undocumented.join(", ")}`);
  assert.deepEqual(phantom, [], `documented but no dispatcher emits it: ${phantom.join(", ")}`);
});

test("the documented vocabulary has no duplicates", () => {
  assert.equal(new Set(KNOWN_COMM_KINDS).size, KNOWN_COMM_KINDS.length);
});
