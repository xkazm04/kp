// failure-truth-everywhere — the delivery truth must be the SAME on every surface.
//
// The bug this pins: the Comms Center derived its verdict through deriveCommsView
// (bounce/recovery supersession), while the candidate drawer projected the RAW
// `status` column. So a bounced offer showed a red "Bounced" in Channels and a green
// "sent" in the drawer, and a dead-letter that a later resend recovered stayed red in
// the drawer forever. Both surfaces now read one derivation (`commsVerdict`) reached
// through one projection (`toCandidateComm`).
//
// Also pins the additive `failure_detail` column: comms.ts computes a precise reason
// per relay attempt and the row used to be written without it.
//
// unit-db.ts MUST be the first project import.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { createPipelineEntry } from "./db/pipeline.ts";
import { listOutboxFiltered, recordOutbox } from "./db/devcase.ts";
import { commsVerdict, deriveCommsView } from "./comms-view.ts";
import { candidateDrawerBundle, toCandidateComm } from "./candidate-timeline.ts";

after(() => cleanupUnitDb());

function entry(label: string) {
  return createPipelineEntry({ candidateId: `c-${label}`, candidateLabel: label, jobId: "jd-be", jobTitle: "Backend" }).entry;
}

// --- the persisted failure reason -------------------------------------------

test("a failed send persists WHY it dead-lettered; a successful one carries no reason", () => {
  const e = entry("Fay Lure");
  recordOutbox({
    recipient: "fay@example.com",
    subject: "Offer",
    body: "…",
    kind: "offer",
    channel: "webhook",
    status: "failed",
    ref: e.id,
    failureDetail: "http 503",
  });
  recordOutbox({
    recipient: "fay@example.com",
    subject: "Ack",
    body: "…",
    kind: "acknowledgement",
    channel: "webhook",
    status: "sent",
    ref: e.id,
    // A stale reason on a SUCCESS (the last retry before the one that worked) must not
    // be stored — it would print "http 503" next to a green badge.
    failureDetail: "http 503",
  });
  const rows = listOutboxFiltered({ ref: e.id });
  const failed = rows.find((r) => r.status === "failed")!;
  const sent = rows.find((r) => r.status === "sent")!;
  assert.equal(failed.failureDetail, "http 503");
  assert.equal(sent.failureDetail, null);
});

test("a legacy failure with no recorded reason reads null, never a fabricated one", () => {
  const e = entry("Leg Acy");
  recordOutbox({ recipient: "leg@example.com", subject: "s", body: "b", kind: "offer", channel: "webhook", status: "failed", ref: e.id });
  assert.equal(listOutboxFiltered({ ref: e.id })[0].failureDetail, null);
});

// --- projection parity -------------------------------------------------------

const verdictsOf = (entryId: string) => {
  const derived = deriveCommsView(listOutboxFiltered({ ref: entryId }));
  const projected = candidateDrawerBundle(entryId)!.comms;
  return { derived, projected };
};

test("PARITY: a bounced send reads `bounced` in the drawer projection, not the stored `sent`", () => {
  const e = entry("Bou Nced");
  const send = recordOutbox({ recipient: "bou@example.com", subject: "Offer", body: "…", kind: "offer", channel: "webhook", status: "sent", ref: e.id });
  // The async relay receipt (what /api/comms/callback writes).
  recordOutbox({ recipient: "(relay callback)", subject: "Delivery receipt", body: "550 mailbox unavailable", kind: "offer", channel: "relay-callback", status: "bounced", ref: e.id });

  const { derived, projected } = verdictsOf(e.id);
  const row = derived.find((m) => m.id === send.id)!;
  const drawer = projected.find((m) => m.id === send.id)!;
  assert.equal(commsVerdict(row), "bounced", "the Comms Center derivation says bounced");
  assert.equal(drawer.verdict, "bounced", "and so does the drawer projection");
  // The raw column still says `sent` — which is exactly why the drawer must not read it.
  assert.equal(drawer.status, "sent");
  assert.equal(drawer.bounced, true);
  assert.equal(drawer.bounceDetail, "550 mailbox unavailable");
  // The receipt row itself is not a letter and never reaches the drawer.
  assert.equal(projected.some((m) => m.channel === "relay-callback"), false);
});

test("PARITY: a recovered dead-letter reads `recovered` in the drawer projection, not `failed`", () => {
  const e = entry("Rec Overed");
  const dead = recordOutbox({ recipient: "rec@example.com", subject: "Offer", body: "…", kind: "offer", channel: "webhook", status: "failed", ref: e.id, failureDetail: "getaddrinfo ENOTFOUND relay.example" });
  recordOutbox({ recipient: "rec@example.com", subject: "Offer", body: "…", kind: "offer", channel: "webhook", status: "sent", ref: e.id });

  const { derived, projected } = verdictsOf(e.id);
  const row = derived.find((m) => m.id === dead.id)!;
  const drawer = projected.find((m) => m.id === dead.id)!;
  assert.equal(commsVerdict(row), "recovered");
  assert.equal(drawer.verdict, "recovered");
  assert.equal(drawer.status, "failed");
  assert.equal(drawer.recovered, true);
  // The reason survives the projection too — a recruiter sees WHY the first try died.
  assert.equal(drawer.failureDetail, "getaddrinfo ENOTFOUND relay.example");
});

test("PARITY: every projected comm carries exactly the verdict comms-view derives", () => {
  const e = entry("Mix Ed");
  recordOutbox({ recipient: "mix@example.com", subject: "Ack", body: "…", kind: "acknowledgement", channel: "outbox", status: "queued", ref: e.id });
  recordOutbox({ recipient: "mix@example.com", subject: "Rejection", body: "…", kind: "rejection", channel: "webhook", status: "failed", ref: e.id, failureDetail: "http 400" });
  recordOutbox({ recipient: "mix@example.com", subject: "Offer", body: "…", kind: "offer", channel: "webhook", status: "sent", ref: e.id });
  recordOutbox({ recipient: "(relay callback)", subject: "Delivery receipt", body: "spam complaint", kind: "offer", channel: "relay-callback", status: "bounced", ref: e.id });

  const { derived, projected } = verdictsOf(e.id);
  // One projection, one derivation — asserted row by row rather than spot-checked.
  const expected = new Map(derived.filter((m) => !m.orphaned).map((m) => [m.id, commsVerdict(m)]));
  assert.equal(projected.length, expected.size);
  for (const c of projected) {
    assert.equal(c.verdict, expected.get(c.id), `verdict drift on ${c.kind}`);
  }
  assert.deepEqual(
    [...projected].sort((a, b) => a.id.localeCompare(b.id)),
    derived.filter((m) => !m.orphaned).map(toCandidateComm).sort((a, b) => a.id.localeCompare(b.id)),
    "the drawer payload IS toCandidateComm over the derived view — no second mapping"
  );
});
