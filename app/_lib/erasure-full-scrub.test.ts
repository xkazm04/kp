// GDPR Art. 17 regression (bug-ui-scan 2026-07-09 critical #1 + high #2): anonymizeEntry
// must erase the candidate's PII from EVERY entry-linked table — not just the pipeline
// entry + profile + analyses the earlier fix covered. Before this fix the voice-interview
// transcript (verbatim spoken answers), the AI scorecard, the comms outbox (recipient
// email + personalized body), the offer/prep/schedule/onboarding/rediscovery artifacts and
// the recruiter notes all SURVIVED an erasure request — a reportable retention breach while
// /data affirmatively promised "we remove your interview records". This test asserts NO row
// in ANY covered table still holds the candidate's name or email after anonymizeEntry, so a
// newly-added PII table can't silently opt out. It also pins finding #2: the analyses join
// must match on NORMALIZED (case/whitespace-insensitive) label AND stay workspace-scoped, so
// a padded/differently-cased analysis is caught while a same-named candidate in ANOTHER
// tenant is NOT over-scrubbed. Drives the REAL db.ts (+ the isolated sibling stores, which
// open the same SQLite file) against a throwaway file. Run: npm run test:unit
import { test, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
// Pre-load better-sqlite3 BEFORE installing the resolve hook, so the hook never sees its
// internal extensionless `./lib/database` require — same as the other real-db tests.
import "better-sqlite3";

const ROOT = new URL("../../", import.meta.url).href; // repo root (app/_lib/ -> ../../)
registerHooks({
  resolve(specifier, context, nextResolve) {
    let spec = specifier;
    if (spec.startsWith("@/")) spec = new URL(spec.slice(2), ROOT).href;
    else if ((spec.startsWith("./") || spec.startsWith("../")) && context.parentURL) {
      spec = new URL(spec, context.parentURL).href;
    }
    if (spec.startsWith("file:") && !/\.[a-z0-9]+$/i.test(spec) && fs.existsSync(fileURLToPath(spec + ".ts"))) {
      spec += ".ts";
    }
    return nextResolve(spec, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".json")) {
      const source = "export default " + fs.readFileSync(fileURLToPath(url), "utf8") + ";";
      return { format: "module", source, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

// A UNIQUE directory per run, not a `${process.pid}` filename — see erasure-analyses-scrub.test.ts:
// pids are reused and a locked SQLite file survives cleanup, so a pid-derived path can open a
// stale, already-populated database.
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "kp-erasure-full-scrub-"));
const TMP = path.join(TMP_DIR, "kp.sqlite");
process.env.KP_DB_PATH = TMP;

// Import AFTER KP_DB_PATH is set so every connection (db.ts + each isolated store) opens the
// throwaway file. The stores each open their own connection on the SAME file (db-path.ts).
const { createPipelineEntry, setEntryNotes, anonymizeEntry, getPipelineEntry, saveAnalysis, loadAnalysis, createInterviewSession, completeInterviewSession, latestInterviewByEntry, recordOutbox, getOutboxEntry } =
  await import("./db.ts");
const { createOffer, listOffersForEntry } = await import("./offers-store.ts");
const { createScheduleInvite, getScheduleInviteByToken } = await import("./schedule-store.ts");
const { saveInterviewPrep, getInterviewPrep } = await import("./interview-prep.ts");
const { recordRediscoveryAlerts, listRediscoveryAlerts } = await import("./rediscovery-alert-store.ts");

after(() => {
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {
    /* file locked — the unique dir means a leftover can never poison a later run */
  }
});

const NAME = "Zdenka Procházková";
const EMAIL = "zdenka.prochazkova@example.com";
const PHONE = "+420777123456";

/** No directly-identifying PII may survive anywhere in a serialized surface. */
function assertScrubbed(blob: string, where: string): void {
  assert.doesNotMatch(blob, /Zdenka Procházková/i, `${where}: name must not survive erasure`);
  assert.doesNotMatch(blob, /zdenka\.prochazkova@example\.com/i, `${where}: email must not survive erasure`);
  assert.doesNotMatch(blob, /\+420777123456/, `${where}: phone must not survive erasure`);
}

test("erasure scrubs the candidate's PII from EVERY entry-linked table (transcript, comms, offer, prep, schedule, rediscovery, notes)", () => {
  const cid = `c-full-${process.pid}`;
  const jobId = `job-full-${process.pid}`;
  const { entry } = createPipelineEntry({
    candidateId: cid,
    candidateLabel: NAME,
    jobId,
    jobTitle: "Data Engineer",
    stage: "Interview",
    contact: EMAIL,
  });
  // Recruiter call-notes: free text about the candidate (name + phone).
  setEntryNotes(entry.id, `${NAME} — reachable on ${PHONE}, wants 80k, available August`);

  // analyses (exact-label link the earlier fix already covered).
  const { slug: exactSlug } = saveAnalysis({
    candidateLabel: NAME,
    jdSlug: null,
    score: 77,
    roleFamily: "data",
    seniority: "mid",
    payload: { candidate: { name: NAME, email: EMAIL, phone: PHONE }, rawText: `${NAME} full CV body`, score: 77 },
  });
  // analyses saved at a different intake as a PADDED / lowercased label — finding #2: the
  // old raw `= candidate_label` join MISSED this, leaving the CV readable after erasure.
  const { slug: driftSlug } = saveAnalysis({
    candidateLabel: `  ${NAME.toLowerCase()}  `,
    jdSlug: null,
    score: 77,
    roleFamily: "data",
    seniority: "mid",
    payload: { candidate: { name: NAME, email: EMAIL }, rawText: `${NAME} second CV`, score: 77 },
  });
  // A genuine NAMESAKE in ANOTHER tenant — finding #2: must NOT be over-scrubbed.
  const { slug: namesakeSlug } = saveAnalysis(
    {
      candidateLabel: NAME,
      jdSlug: null,
      score: 55,
      roleFamily: "data",
      seniority: "mid",
      payload: { candidate: { name: NAME, email: EMAIL }, rawText: "a different real person", score: 55 },
    },
    "other-team"
  );

  // Voice interview: verbatim transcript + free-text scorecard.
  const session = createInterviewSession({ provider: "openai", mode: "candidate", entryId: entry.id, candidateLabel: NAME, jobId, jobTitle: "Data Engineer" });
  completeInterviewSession(session.id, {
    transcript: [
      { role: "interviewer", text: "Please introduce yourself." },
      { role: "candidate", text: `Hi, I'm ${NAME}, you can reach me at ${EMAIL} or ${PHONE}.` },
    ],
    scorecard: { summary: `${NAME} interviewed strongly; email ${EMAIL}.`, recommendation: "advance", ratings: [] },
  });

  // Comms outbox: recipient email + personalized subject/body.
  const outbox = recordOutbox({ recipient: EMAIL, subject: `Interview for ${NAME}`, body: `Dear ${NAME}, we'd like to proceed. Reply to ${EMAIL}.`, kind: "interview_invite", channel: "outbox", status: "queued", ref: entry.id });

  // Offer letter (isolated store): label + free-text payload.
  createOffer({ entryId: entry.id, candidateLabel: NAME, jobId, jobTitle: "Data Engineer", currency: "CZK", salary: 90000, payload: { letter: `Dear ${NAME}, your offer…`, contactEmail: EMAIL } });

  // Interview-prep dossier (isolated store): label + free-text payload.
  saveInterviewPrep(entry.id, NAME, "Data Engineer", { notes: `Probe ${NAME} on Spark; contact ${EMAIL}` });

  // Self-scheduling invite (isolated store): label.
  const invite = createScheduleInvite({ entryId: entry.id, candidateLabel: NAME, jobTitle: "Data Engineer" });

  // Rediscovery alert (isolated store, keyed by candidate_id).
  recordRediscoveryAlerts(jobId, "Data Engineer", [{ candidateId: cid, label: NAME, archetype: "builder", score: 71, prior: { kind: "rejected", label: NAME, stage: "Interview", depth: 2 } }]);

  // --- Sanity: the PII is present BEFORE erasure (guards against a tautological test). ---
  assert.match(JSON.stringify(latestInterviewByEntry(entry.id)), /zdenka\.prochazkova@example\.com/i, "transcript holds PII pre-erasure");
  assert.match(JSON.stringify(getOutboxEntry(outbox.id)), /zdenka\.prochazkova@example\.com/i, "outbox holds PII pre-erasure");
  assert.match(JSON.stringify(loadAnalysis(driftSlug)), /zdenka\.prochazkova@example\.com/i, "drift-label analysis holds PII pre-erasure");

  // --- Erase ---
  const result = anonymizeEntry(entry.id, "erasure");
  assert.ok(result, "anonymizeEntry returns the entry");

  // --- After erasure: NO covered surface may hold the name / email / phone. ---
  const scrubbedEntry = getPipelineEntry(entry.id)!;
  assert.equal(scrubbedEntry.contact, null, "contact nulled");
  assert.equal(scrubbedEntry.notes, null, "recruiter notes nulled");
  assertScrubbed(JSON.stringify(scrubbedEntry), "pipeline_entry");

  assertScrubbed(JSON.stringify(loadAnalysis(exactSlug)), "analyses(exact)");
  assertScrubbed(JSON.stringify(loadAnalysis(driftSlug)), "analyses(drift-label)");

  const iv = latestInterviewByEntry(entry.id)!;
  assert.deepEqual(iv.transcript, [], "transcript dropped to []");
  assert.equal(iv.scorecard, null, "scorecard dropped");
  assertScrubbed(JSON.stringify(iv), "interview_session");

  const ob = getOutboxEntry(outbox.id)!;
  assert.equal(ob.recipient, null, "outbox recipient nulled");
  assertScrubbed(JSON.stringify(ob), "dev_outbox");

  assertScrubbed(JSON.stringify(listOffersForEntry(entry.id)), "offers");
  assertScrubbed(JSON.stringify(getInterviewPrep(entry.id)), "interview_preps");
  assertScrubbed(JSON.stringify(getScheduleInviteByToken(invite.token)), "schedule_invites");
  assertScrubbed(JSON.stringify(listRediscoveryAlerts()), "rediscovery_alerts");

  // --- finding #2: a same-named NAMESAKE in another tenant is NOT over-scrubbed. ---
  const namesake = loadAnalysis(namesakeSlug, "other-team")!;
  assert.match(JSON.stringify(namesake.payload), /zdenka\.prochazkova@example\.com/i, "a different tenant's namesake analysis is preserved");
});
