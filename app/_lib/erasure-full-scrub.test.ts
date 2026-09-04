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
delete process.env.DATABASE_URL;

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

// ---------------------------------------------------------------------------
// Lot CP — THE ERASURE LIST IS PINNED TO THE TENANCY MANIFEST.
//
// The test above asserts that the tables it KNOWS about are scrubbed. Nothing
// asserted that the set of tables it knows about is the set of tables that hold
// candidate data — so a new per-tenant table could join TENANCY_SCOPED_TABLES (the
// manifest that IS machine-checked) and silently stay outside erasure's reach. That
// is how the candidate survey comment, the whole dev-case family and the signed
// skill credential came to survive an Art. 17 request while /data told the candidate
// their data was gone.
//
// These tests close the loop: every scoped table must be written by the erasure
// region, delegated to a named scrub, or carry a legal retention reason.
// ---------------------------------------------------------------------------
const { TENANCY_SCOPED_TABLES, TENANCY_EXEMPT_TABLES } = await import("./tenancy.ts");
const { ERASURE_EXEMPT, ERASURE_DELEGATED_SCRUBS } = await import("./db/pipeline.ts");

/** The erasure region of db/pipeline.ts: scrubEntryLinkedPii + anonymizeEntry, with
 *  comments stripped (a table named in PROSE must never count as scrubbed) and line
 *  endings normalized (this repo is CRLF on Windows, LF in a worktree). */
function erasureRegion(): string {
  const text = fs.readFileSync(fileURLToPath(new URL("./db/pipeline.ts", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
  const start = text.indexOf("function scrubEntryLinkedPii(");
  const end = text.indexOf("export function anonymizeExpiredConsents(");
  assert.ok(start > 0 && end > start, "erasure region (scrubEntryLinkedPii → anonymizeExpiredConsents) found in db/pipeline.ts");
  return text
    .slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
}

/** The tables the erasure path actually WRITES, read off its SQL. Derived, never
 *  declared: a hand-maintained list of table names is exactly the artifact that
 *  drifts away from the code it claims to describe. */
function scrubbedTables(): Set<string> {
  const out = new Set<string>();
  for (const m of erasureRegion().matchAll(/(?:UPDATE|DELETE\s+FROM)\s+([a-z_][a-z0-9_]*)/gi)) out.add(m[1]);
  return out;
}

test("every workspace-scoped table is reached by erasure or exempted with a legal reason", () => {
  const scrubbed = scrubbedTables();
  const gaps = [...TENANCY_SCOPED_TABLES]
    .filter((t) => !scrubbed.has(t) && !ERASURE_DELEGATED_SCRUBS.has(t) && !ERASURE_EXEMPT.has(t))
    .sort();
  assert.deepEqual(
    gaps,
    [],
    "these tenancy-manifest tables hold per-tenant data but erasure neither scrubs nor exempts them: " +
      gaps.join(", ") +
      ". Scrub them in scrubEntryLinkedPii, or add each to ERASURE_EXEMPT (db/pipeline.ts) with the reason it is lawfully retained."
  );
});

test("the erasure exemption map is honest: known tables, real reasons, no double-claim", () => {
  const scrubbed = scrubbedTables();
  const known = new Set([...TENANCY_SCOPED_TABLES, ...TENANCY_EXEMPT_TABLES]);
  for (const [table, reason] of ERASURE_EXEMPT) {
    assert.ok(known.has(table), 'ERASURE_EXEMPT names "' + table + '", which is in no tenancy manifest — a stale exemption');
    // A reason is a sentence saying WHY it is lawful to keep the data, not a shrug.
    assert.ok(reason.trim().length >= 40, 'ERASURE_EXEMPT["' + table + '"] needs a real legal/factual reason, got: "' + reason + '"');
    assert.ok(!scrubbed.has(table), '"' + table + '" is BOTH scrubbed and exempt — one of the two claims is wrong');
  }
  // A delegated scrub must name a function the erasure region really calls.
  const region = erasureRegion();
  for (const [table, fn] of ERASURE_DELEGATED_SCRUBS) {
    assert.ok(
      region.includes(fn + "("),
      'ERASURE_DELEGATED_SCRUBS claims "' + table + '" is scrubbed by ' + fn + "(), which the erasure region never calls"
    );
  }
});

test("erasure reaches the candidate-keyed family: survey comment, dev-case chain, skill credential, calibration row", async () => {
  const { startDevSession, appendDevSessionChat, saveDevSessionFiles, submitDevSession, getSubmission, getDevSession, getDevSessionChat } =
    await import("./db/devcase.ts");
  const { recordCandidateNps, candidateNpsFor } = await import("./candidate-nps-store.ts");
  const { recordHirePerformance } = await import("./dev-outcomes.ts");
  const Database = (await import("better-sqlite3")).default;

  const cid = "c-fam-" + process.pid;
  // The Live Work Surface session: the candidate's own prompts and authored files.
  const session = startDevSession({ token: null, candidateRef: NAME });
  appendDevSessionChat(session.id, "assistant", "user", "Hi, I'm " + NAME + " — reach me at " + EMAIL + ".");
  saveDevSessionFiles(session.id, [{ path: "README.md", contents: "Authored by " + NAME + " <" + EMAIL + ">" }]);
  const submission = submitDevSession(session.id, "post-erasure-" + process.pid, { candidate: NAME, contact: EMAIL })!;
  assert.ok(submission, "the session submits into a dev_submissions row");

  const raw = new Database(TMP);
  // Free-text recruiter notes on the submission (the intake writes them; no store setter).
  raw.prepare("UPDATE dev_submissions SET notes = ? WHERE id = ?").run(NAME + " pasted a lot; call " + PHONE, submission.id);
  // The signed, candidate-owned credential minted from that submission.
  raw
    .prepare(
      "INSERT INTO skill_profiles (token, submission_id, candidate_ref, case_id, profile_json, signature, version, issued_at)" +
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      "dsp-" + process.pid,
      submission.id,
      NAME,
      "case-1",
      JSON.stringify({ candidateRef: NAME, contact: EMAIL, axes: [] }),
      "sig",
      "1",
      new Date().toISOString()
    );

  const { entry } = createPipelineEntry({
    candidateId: cid,
    candidateLabel: NAME,
    jobId: "job-fam-" + process.pid,
    jobTitle: "Data Engineer",
    stage: "Interview",
    contact: EMAIL,
    devSubmissionId: submission.id,
  });
  // The candidate's own survey comment, and the calibration row a rated hire leaves.
  recordCandidateNps(entry.id, 9, "Great process — " + NAME + ", " + EMAIL);
  recordHirePerformance({ id: entry.id, candidateId: cid, candidateLabel: NAME, matchScore: 70 }, 4);

  // Sanity: they really hold the PII BEFORE the erasure (never a tautological pass).
  assert.match(JSON.stringify(getDevSessionChat(session.id)), /zdenka/i, "session chat holds PII pre-erasure");
  assert.match(String(candidateNpsFor(entry.id)?.comment), /Zdenka/i, "survey comment holds PII pre-erasure");

  assert.ok(anonymizeEntry(entry.id, "erasure"), "anonymizeEntry returns the entry");

  assert.equal(candidateNpsFor(entry.id)?.comment, null, "candidate_nps comment nulled");
  const sub = getSubmission(submission.id)!;
  assert.equal(sub.contact, null, "dev_submissions contact nulled");
  assert.equal(sub.notes, null, "dev_submissions notes nulled");
  assertScrubbed(JSON.stringify(sub), "dev_submissions");
  const sess = getDevSession(session.id)!;
  assertScrubbed(JSON.stringify(sess), "dev_sessions");
  assert.deepEqual(sess.files, [], "dev_sessions authored files dropped");
  assertScrubbed(JSON.stringify(getDevSessionChat(session.id)), "dev_session_chat");

  const cred = raw.prepare("SELECT candidate_ref, profile_json, revoked_at FROM skill_profiles WHERE submission_id = ?").get(submission.id) as {
    candidate_ref: string;
    profile_json: string;
    revoked_at: string | null;
  };
  assertScrubbed(JSON.stringify(cred), "skill_profiles");
  assert.equal(cred.profile_json, "{}", "the signed credential's payload is dropped");
  assert.ok(cred.revoked_at, "the credential is revoked, not left presentable as an empty valid one");

  const outcome = raw.prepare("SELECT candidate_ref, note, performance FROM dev_outcomes WHERE ref = ?").get("pe:" + entry.id) as {
    candidate_ref: string;
    note: string | null;
    performance: number;
  };
  assertScrubbed(JSON.stringify(outcome), "dev_outcomes");
  assert.equal(outcome.performance, 4, "the de-identified calibration measurement is RETAINED");
  raw.close();
});
