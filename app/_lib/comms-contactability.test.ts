// ONE contactability verdict, asked BEFORE a door mints a candidate link
// (challenge-r09 comms-locale-optout/A).
//
// `commsSendSuppression` (comms.ts) is the send gate the channel enforces, but it runs
// inside `sendComm` — i.e. AFTER an invite door has already minted a live capability
// link. `contactVerdict` is the pure ordering of every reason a candidate cannot be
// written to; `entryContactability` gathers its facts by asking THE send gate itself,
// never a second copy of it.
//
// unit-db.ts MUST be the first project import (sets KP_DB_PATH before any store module
// resolves db-path.ts) — the adapter half reaches the pipeline store.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { contactVerdict, entryContactability } from "./comms-contactability.ts";
import { resolveCandidateRecipient } from "./comms-recipient.ts";
import { candidateRecipient } from "./comms-dispatch.ts";
import { partitionBulkInviteTargets } from "./bulk-invite.ts";
import { createPipelineEntry, getPipelineEntry } from "./db/pipeline.ts";
import { ensureDb } from "./db/core.ts";

after(() => cleanupUnitDb());

test("case 1: an agent on the slate is refused as agent_population, ahead of every other reason", () => {
  const v = contactVerdict({ population: "agent", contact: "a@b.cz", suppression: null, halt: null }, "schedule_invite");
  assert.equal(v.ok, false);
  assert.equal(!v.ok && v.reason, "agent_population");
  // …even when consent has ALSO lapsed and the sequence is halted: the agent refusal wins.
  const all = contactVerdict({ population: "agent", contact: null, suppression: "consent_expired", halt: "candidate" }, "outreach");
  assert.equal(!all.ok && all.reason, "agent_population");
});

test("case 2: a lapsed consent is refused with COMMS_SUPPRESSED — before addressability", () => {
  const v = contactVerdict({ contact: "jane@firma.cz", suppression: "consent_expired", halt: null }, "schedule_invite");
  assert.deepEqual(v, { ok: false, reason: "consent_expired", code: "COMMS_SUPPRESSED" });
  // No contact AND a lapsed consent: the irreversible gate is named, not "unaddressable".
  const noContact = contactVerdict({ contact: null, suppression: "consent_expired", halt: null }, "schedule_invite");
  assert.deepEqual(noContact, { ok: false, reason: "consent_expired", code: "COMMS_SUPPRESSED" });
  const erased = contactVerdict({ contact: "jane@firma.cz", suppression: "anonymized", halt: null }, "interview_invite");
  assert.deepEqual(erased, { ok: false, reason: "anonymized", code: "COMMS_SUPPRESSED" });
  // A plain unaddressable person carries no suppression code: the copy panel stays owed.
  const unaddressable = contactVerdict({ contact: "Jane Doe", suppression: null, halt: null }, "schedule_invite");
  assert.deepEqual(unaddressable, { ok: false, reason: "unaddressable" });
});

test("case 3: the candidate's opt-out halts OUTREACH only — transactional mail is still owed", () => {
  const facts = { contact: "jane@firma.cz", suppression: null, halt: "candidate" };
  assert.deepEqual(contactVerdict(facts, "schedule_invite"), { ok: true });
  assert.deepEqual(contactVerdict(facts, "interview_invite"), { ok: true });
  const outreach = contactVerdict(facts, "outreach");
  assert.equal(outreach.ok, false);
  assert.equal(!outreach.ok && outreach.reason, "candidate");
  assert.equal(!outreach.ok && outreach.code, "COMMS_SUPPRESSED");
});

let seq = 0;
function entry(contact: string | null) {
  seq += 1;
  return createPipelineEntry({
    candidateId: `cc-c${seq}`,
    candidateLabel: `Contact Candidate ${seq}`,
    jobId: `cc-job-${seq}`,
    jobTitle: "Contactability Role",
    contact,
  }).entry;
}

test("adapter: entryContactability asks the send gate — a lapsed-but-unswept consent is refused", () => {
  const live = entry("live@example.com");
  assert.deepEqual(entryContactability(live, "schedule_invite"), { ok: true });

  const lapsed = entry("lapsed@example.com");
  ensureDb().prepare(`UPDATE pipeline_entries SET consent_given_at = ?, consent_expires_at = ? WHERE id = ?`).run(
    "2019-01-01T00:00:00.000Z",
    "2020-01-01T00:00:00.000Z",
    lapsed.id
  );
  const reread = getPipelineEntry(lapsed.id)!;
  // Not yet anonymized: the contact is still on the row, which is exactly the window.
  assert.equal(reread.anonymizedAt ?? null, null);
  assert.equal(reread.contact, "lapsed@example.com");
  assert.deepEqual(entryContactability(reread, "schedule_invite"), {
    ok: false,
    reason: "consent_expired",
    code: "COMMS_SUPPRESSED",
  });

  const nameOnly = entry(null);
  assert.deepEqual(entryContactability(nameOnly, "schedule_invite"), { ok: false, reason: "unaddressable" });
});

test("case 8: the bulk planner resolves recipients through the ONE cascade comms-dispatch uses", () => {
  const fixtures = [
    { contact: " jane@firma.cz ", candidateLabel: "Jane", candidateId: "c1" },
    { contact: "", candidateLabel: "Jan Novák", candidateId: "c2" },
    { contact: null, candidateLabel: "  ", candidateId: "c3" },
    { contact: null, candidateLabel: null, candidateId: null },
    { contact: "x@y.cz", candidateLabel: "Agent X", candidateId: "c5", population: "agent" },
  ];
  for (const f of fixtures) {
    assert.equal(resolveCandidateRecipient(f), candidateRecipient(f), `same address for ${JSON.stringify(f)}`);
  }
  // …and the planner's split agrees with that resolution: only the first is mailable.
  const { inviteable, unaddressable } = partitionBulkInviteTargets(fixtures);
  assert.deepEqual(inviteable, [fixtures[0]]);
  assert.equal(unaddressable.length, 4, "a name, an id, the literal and an AGENT are all unaddressable");
});
