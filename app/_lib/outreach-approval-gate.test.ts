// THE OUTREACH APPROVAL GATE (comms scope C2, night package 3): a first-contact letter
// leaves only as the exact text, to the exact recipient, in the exact language a NAMED person
// approved — and the check lives in ONE place, the send seam (comms-dispatch.ts
// dispatchOutreach), not in each caller.
//
//   1. the CONTRACT: who may call the seam, who may approve, and that the seam takes a letter
//      id rather than text (a new caller cannot hand it words of its own);
//   2. the seam refuses an unapproved, an unattributed, a tampered and a re-addressed letter,
//      with no side effect (no outbox row, no timeline event);
//   3. the RACES: two approvers, approve vs edit, edit vs a live release claim.
//
// unit-db.ts MUST be the first project import.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { createPipelineEntry, getPipelineEntry, listPipelineEventsForEntry } from "./db/pipeline.ts";
import { listOutboxFiltered } from "./db/devcase.ts";
import { ensureDb } from "./db/core.ts";
import {
  outreachLetterApprove,
  outreachLetterById,
  outreachLetterClaimRelease,
  outreachLetterDraft,
  outreachLetterEdit,
} from "./db/outreach-letters.ts";
import { dispatchOutreach } from "./comms-dispatch.ts";
import { approveOutreachLetter, releaseOutreachLetter } from "./outreach-release.ts";
import { OutreachApprovalError, namedOutreachApprover, outreachApprovalDigest, outreachSendRefusal } from "./outreach-approval.ts";
import { DEFAULT_WORKSPACE_ID as WS } from "./db/workspaces.ts";

after(() => cleanupUnitDb());

const APPROVER = "human:Eva Approver";
const OTHER = "human:Petr Approver";

let seq = 0;
function held(body = "We'd love to talk about the role.") {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `gate-c${seq}`,
    candidateLabel: `Gate Candidate ${seq}`,
    jobId: `gate-job-${seq}`,
    jobTitle: "Backend Engineer",
    locale: "en",
    contact: `gate${seq}@example.cz`,
    stage: "Screened",
    workspaceId: WS,
  });
  const { letter } = outreachLetterDraft({ entryId: entry.id, subject: "A role for you", body, lang: "en" }, WS);
  return { entry, letter };
}

/** Nothing left and nothing was recorded as having left. */
function assertNothingSent(entryId: string) {
  assert.equal(listOutboxFiltered({ ref: entryId, kind: "outreach" }).length, 0, "no outbox row");
  const kinds = listPipelineEventsForEntry(entryId, 50, WS).map((e) => e.kind);
  assert.ok(!kinds.includes("outreach_sent"), "no outreach_sent event");
  assert.ok(!kinds.includes("outreach_suppressed"), "the gate refuses before the consent audit");
}

async function seamRefusal(entryId: string, letterId: string): Promise<string> {
  const entry = getPipelineEntry(entryId, WS)!;
  try {
    await dispatchOutreach(entry, { letterId });
  } catch (err) {
    assert.ok(err instanceof OutreachApprovalError, `expected OutreachApprovalError, got ${String(err)}`);
    return err.code;
  }
  assert.fail("the seam sent a letter it should have refused");
}

// --- 1. the contract -------------------------------------------------------------------

const ROOT = join(import.meta.dirname, "..", "..");
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx|mjs)$/.test(name) && !/\.test\.(ts|tsx|mjs)$/.test(name)) out.push(p);
  }
  return out;
}
const PRODUCTION = ["app", "packages", "edge", "scripts"]
  .flatMap((d) => {
    try {
      return sourceFiles(join(ROOT, d));
    } catch {
      // best-effort: a tree without this top-level directory has no callers in it
      return [];
    }
  })
  .filter((p) => !p.includes(`${sep}testing${sep}`));

/** Files whose CODE (comment lines dropped) calls `name(`. */
function callers(name: string): string[] {
  const call = new RegExp(`(?<![\\w.])${name}\\(`);
  return PRODUCTION.filter((p) =>
    readFileSync(p, "utf8")
      .split("\n")
      .some((line) => {
        const code = line.trim();
        if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return false;
        return call.test(code.replace(/\/\/.*$/, "")) && !new RegExp(`function ${name}\\(`).test(code);
      })
  )
    .map((p) => relative(ROOT, p).split(sep).join("/"))
    .sort();
}

test("contract: the outreach send seam has ONE caller, the release of an approved letter", () => {
  assert.deepEqual(
    callers("dispatchOutreach"),
    ["app/_lib/outreach-release.ts"],
    "a new door that sends outreach must go through releaseOutreachLetter (approve, then release), never dispatchOutreach directly"
  );
  assert.deepEqual(callers("releaseOutreachLetter"), ["app/api/outreach-letters/[id]/release/route.ts"]);
});

test("contract: only the session-bound approve door approves; an automation can draft but never approve", () => {
  assert.deepEqual(callers("outreachLetterApprove"), ["app/_lib/outreach-release.ts"]);
  assert.deepEqual(callers("approveOutreachLetter"), ["app/api/outreach-letters/[id]/approve/route.ts"]);
  // The machine actors the automation layer writes are not approvers, and neither is the
  // role token a session without identity resolves to.
  for (const actor of ["auto:outreach", "engine:llm", "human:recruiter", "human:", "human:operator (single-operator deployment)", "Eva"]) {
    assert.equal(namedOutreachApprover(actor), false, actor);
  }
  assert.equal(namedOutreachApprover(APPROVER), true);
  const { letter } = held();
  assert.throws(() => outreachLetterApprove(letter.id, { revision: 1, approvedBy: "human:recruiter", digest: "v1:x" }, WS), /named human actor/);
  assert.throws(() => outreachLetterApprove(letter.id, { revision: 1, approvedBy: "auto:outreach", digest: "v1:x" }, WS), /named human actor/);
});

test("contract: the seam takes a letter id, never text, and checks the approval before anything else", () => {
  const src = readFileSync(join(import.meta.dirname, "comms-dispatch.ts"), "utf8");
  const fn = src.slice(src.indexOf("export async function dispatchOutreach("));
  const signature = fn.slice(0, fn.indexOf("): Promise<OutreachResult>"));
  assert.match(signature, /release: \{ letterId: string \}/);
  assert.doesNotMatch(signature, /subject|body/, "a caller must not be able to hand the seam its own text");
  const gateAt = fn.indexOf("outreachSendRefusal(");
  for (const later of ["candidateOutreachSuppression(", "outreachHaltFor(", "sendCandidateComm(", "recordAutomationEvent("]) {
    assert.ok(gateAt > 0 && gateAt < fn.indexOf(later), `the approval gate runs before ${later}`);
  }
});

// --- 2. the seam refuses ---------------------------------------------------------------

test("an unapproved draft is refused at the seam with no side effect", async () => {
  const { entry, letter } = held();
  assert.equal(await seamRefusal(entry.id, letter.id), "OUTREACH_LETTER_CONFLICT");
  assertNothingSent(entry.id);
});

test("a letter of ANOTHER application is refused at the seam", async () => {
  const a = held();
  const b = held();
  approveOutreachLetter(b.letter.id, { revision: 1, approvedBy: APPROVER }, WS);
  assert.equal(await seamRefusal(a.entry.id, b.letter.id), "OUTREACH_LETTER_CONFLICT");
  assertNothingSent(a.entry.id);
});

test("an approval that names nobody (the role token, written before this gate) is stale", async () => {
  const { entry, letter } = held();
  approveOutreachLetter(letter.id, { revision: 1, approvedBy: APPROVER }, WS);
  ensureDb().prepare(`UPDATE outreach_letters SET approved_by = 'human:recruiter' WHERE id = ?`).run(letter.id);
  assert.equal(await seamRefusal(entry.id, letter.id), "OUTREACH_APPROVAL_STALE");
  assertNothingSent(entry.id);
});

test("HASH MISMATCH: text changed under an approval is refused, and the release re-closes the gate", async () => {
  const { entry, letter } = held();
  const approved = approveOutreachLetter(letter.id, { revision: 1, approvedBy: APPROVER }, WS)!;
  assert.ok(approved.approvedDigest?.startsWith("v1:"));
  // A write that bypasses every door (a future UPDATE, a hand edit of the DB).
  ensureDb().prepare(`UPDATE outreach_letters SET body = ? WHERE id = ?`).run("Wire the deposit to this account.", letter.id);
  assert.equal(await seamRefusal(entry.id, letter.id), "OUTREACH_APPROVAL_STALE");

  const out = await releaseOutreachLetter(letter.id, WS, APPROVER);
  assert.deepEqual(out, { ok: false, status: 409, code: "OUTREACH_APPROVAL_STALE", extra: { state: "drafted" } });
  const row = outreachLetterById(letter.id, WS)!;
  assert.equal(row.state, "drafted", "the gate re-closed");
  assert.equal(row.revision, 2, "a new revision: a client holding the old one cannot approve it");
  assert.equal(row.approvedBy, null);
  assert.equal(row.approvedDigest, null);
  assertNothingSent(entry.id);
});

test("a RE-ADDRESSED letter (the contact changed after approval) is refused", async () => {
  const { entry, letter } = held();
  approveOutreachLetter(letter.id, { revision: 1, approvedBy: APPROVER }, WS);
  ensureDb().prepare(`UPDATE pipeline_entries SET contact = ? WHERE id = ?`).run("someone.else@example.cz", entry.id);
  const out = await releaseOutreachLetter(letter.id, WS, APPROVER);
  assert.equal(out.ok, false);
  assert.equal(!out.ok && out.code, "OUTREACH_APPROVAL_STALE");
  assertNothingSent(entry.id);
});

test("an approval from before the digest existed is re-closed, then a fresh approval releases", async () => {
  const { entry, letter } = held();
  approveOutreachLetter(letter.id, { revision: 1, approvedBy: APPROVER }, WS);
  ensureDb().prepare(`UPDATE outreach_letters SET approved_digest = NULL WHERE id = ?`).run(letter.id);
  const refused = await releaseOutreachLetter(letter.id, WS, APPROVER);
  assert.equal(!refused.ok && refused.code, "OUTREACH_APPROVAL_STALE");
  assert.ok(approveOutreachLetter(letter.id, { revision: 2, approvedBy: APPROVER }, WS));
  const released = await releaseOutreachLetter(letter.id, WS, APPROVER);
  assert.equal(released.ok, true);
  assert.equal(listOutboxFiltered({ ref: entry.id, kind: "outreach" }).length, 1);
});

test("what leaves is what was approved: the stored (cleaned) body is the body of the sent letter", async () => {
  const { entry, letter } = held("Hello <b>there</b>,\r\n\r\n\r\nwe have a role.<script>x()</script>");
  assert.equal(letter.body, "Hello there,\n\nwe have a role.", "the draft is stored as the text the send path will send");
  approveOutreachLetter(letter.id, { revision: 1, approvedBy: APPROVER }, WS);
  const out = await releaseOutreachLetter(letter.id, WS, APPROVER);
  assert.equal(out.ok, true);
  const [row] = listOutboxFiltered({ ref: entry.id, kind: "outreach" });
  assert.equal(row.subject, letter.subject);
  assert.ok((row.body ?? "").startsWith(letter.body!), "the approved text, byte for byte, then kp's footers");
  const sent = listPipelineEventsForEntry(entry.id, 50, WS).filter((e) => e.kind === "outreach_sent");
  assert.equal(sent[0].actor, APPROVER, "the timeline names the approver");
});

test("the refusal predicate is pure and pins the digest's coverage", () => {
  const base = { letterId: "ol_1", messageId: "msg_1", recipient: "a@example.cz", subject: "S", body: "B", lang: "en" };
  const digest = outreachApprovalDigest(base);
  const row = { id: "ol_1", entryId: "e1", state: "approved", subject: "S", body: "B", lang: "en", messageId: "msg_1", approvedBy: APPROVER, approvedDigest: digest, erasedAt: null };
  assert.equal(outreachSendRefusal(row, "e1", "a@example.cz"), null);
  for (const [field, value] of [["recipient", "b@example.cz"], ["subject", "S2"], ["body", "B2"], ["lang", "cs"], ["messageId", "msg_2"]] as const) {
    assert.notEqual(outreachApprovalDigest({ ...base, [field]: value }), digest, `${field} is covered`);
  }
  assert.equal(outreachSendRefusal(row, "e1", "b@example.cz"), "OUTREACH_APPROVAL_STALE");
  assert.equal(outreachSendRefusal({ ...row, state: "drafted" }, "e1", "a@example.cz"), "OUTREACH_LETTER_CONFLICT");
  assert.equal(outreachSendRefusal({ ...row, erasedAt: "2026-01-01" }, "e1", "a@example.cz"), "OUTREACH_LETTER_CONFLICT");
  assert.equal(outreachSendRefusal(null, "e1", "a@example.cz"), "OUTREACH_LETTER_CONFLICT");
  // Framing: moving characters between fields changes the digest.
  assert.notEqual(outreachApprovalDigest({ ...base, subject: "SB", body: "" }), outreachApprovalDigest({ ...base, subject: "S", body: "B" }));
});

// --- 3. the races ----------------------------------------------------------------------

test("RACE: two approvers on one revision, exactly one wins and is the one named", () => {
  const { letter } = held();
  const first = approveOutreachLetter(letter.id, { revision: 1, approvedBy: APPROVER }, WS);
  const second = approveOutreachLetter(letter.id, { revision: 1, approvedBy: OTHER }, WS);
  assert.ok(first);
  assert.equal(second, null);
  // The store CAS on its own, as a second process would hit it after reading `drafted`.
  assert.equal(outreachLetterApprove(letter.id, { revision: 1, approvedBy: OTHER, digest: first.approvedDigest! }, WS), null);
  assert.equal(outreachLetterById(letter.id, WS)!.approvedBy, APPROVER);
});

test("RACE: an edit that lands first voids an approval of the revision the approver read", () => {
  const { letter } = held();
  const edited = outreachLetterEdit(letter.id, { revision: 1, subject: "A role for you", body: "Changed under the reviewer." }, WS);
  assert.equal(edited?.changed, true);
  assert.equal(approveOutreachLetter(letter.id, { revision: 1, approvedBy: APPROVER }, WS), null);
  assert.equal(outreachLetterById(letter.id, WS)!.state, "drafted");
});

test("RACE: an approval that lands first is RE-CLOSED by the edit after it — nothing is sent until re-approved", async () => {
  const { entry, letter } = held();
  approveOutreachLetter(letter.id, { revision: 1, approvedBy: APPROVER }, WS);
  const edited = outreachLetterEdit(letter.id, { revision: 1, subject: "A role for you", body: "Edited after approval." }, WS);
  assert.equal(edited?.changed, true);
  assert.equal(edited?.letter.state, "drafted", "an edit after approval returns the letter to draft");
  assert.equal(edited?.letter.approvedBy, null);
  assert.equal(edited?.letter.approvedDigest, null);
  const out = await releaseOutreachLetter(letter.id, WS, APPROVER);
  assert.equal(out.ok, false);
  assertNothingSent(entry.id);
});

test("RACE: an edit cannot land while a release holds the letter", () => {
  const { letter } = held();
  const approved = approveOutreachLetter(letter.id, { revision: 1, approvedBy: APPROVER }, WS)!;
  assert.ok(outreachLetterClaimRelease(approved, WS), "a release claimed the row");
  assert.equal(outreachLetterEdit(letter.id, { revision: 1, subject: "A role for you", body: "Mid-send edit." }, WS), null);
  const row = outreachLetterById(letter.id, WS)!;
  assert.equal(row.state, "approved");
  assert.equal(row.body, letter.body);
});
