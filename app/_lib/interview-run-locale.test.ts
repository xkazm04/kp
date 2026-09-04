// Wave 37 / lot IR — the interview speaks all four languages.
//
// Two things a candidate reads were hard-coded English literals no matter which
// language they applied in:
//   1. the SUBMISSION-DEBRIEF agenda, persisted on `interview_sessions.run_of_show_json`
//      by POST /api/interview/create and rendered on the candidate portal's sidebar —
//      four English bullets under an otherwise fully-translated German page; and
//   2. the "Recruiter-added questions" topic injected into the candidate-safe voice
//      brief (buildCandidateSafeBrief), which the agent narrates aloud.
// …and the opening-language instruction knew exactly two languages
// (`preferred === "cs" ? "Czech" : "English"`), so a German or French applicant's
// interviewer was told to open in ENGLISH — the language they had just declined at apply.
//
// These are DB-backed on purpose: the bug was not in the string table, it was that
// nothing between `pipeline_entries.locale` and the stored agenda ever consulted it.
//
// testing/unit-db.ts MUST be the first project import — it sets KP_DB_PATH before
// db-path.ts is evaluated by the transitive `@/app/_lib/db` import.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createPipelineEntry, createPosting, createSubmission, saveSubmissionEvaluation } from "./db.ts";
import { LOCALES } from "@/i18n/locales";
import { interviewBriefStrings } from "./interview-prep-strings.ts";
import { buildCandidateSafeBrief, buildGroundedInterview, OPENING_LANGUAGE_NAMES } from "./interview-run.ts";

after(() => cleanupUnitDb());

let seq = 0;

/** An entry whose submission carries minted authorship follow-ups — the state that
 *  routes both briefs down the SUBMISSION DEBRIEF branch, which is the one whose
 *  agenda is a fixed four-item list rather than a generated chronology. */
function debriefEntry(locale: string | null): string {
  seq += 1;
  const posting = createPosting({
    caseId: `case-loc-${seq}`,
    channel: "local",
    token: `tok-loc-${seq}`,
    roleTitle: `Backend Engineer ${seq}`,
    caseTitle: `Case ${seq}`,
  });
  const { submission } = createSubmission({
    postingId: posting.id,
    candidateRef: `cand-loc-${seq}`,
    repoRef: `repo-loc-${seq}`,
  });
  saveSubmissionEvaluation(
    submission.id,
    {
      evaluation: { summary: "Solid work.", strengths: [], concerns: [], confidence: 0.8 },
      followups: { questions: [{ question: "Why a queue and not a direct call?", listenFor: "trade-offs", redFlag: "no rationale" }] },
    },
    80
  );
  const { entry } = createPipelineEntry({
    candidateId: `cand-loc-${seq}`,
    candidateLabel: `Kandidat ${seq}`,
    jobId: `jd-loc-${seq}`,
    jobTitle: "Backend Engineer",
    locale,
    devSubmissionId: submission.id,
  });
  return entry.id;
}

// --- the stored agenda ------------------------------------------------------

test("a `de` entry STORES a German debrief agenda, not four English bullets", async () => {
  const entryId = debriefEntry("de");
  const grounded = await buildGroundedInterview(entryId);
  const de = await interviewBriefStrings("de");

  assert.deepEqual(grounded.runOfShow, de.debriefRunOfShow, "the persisted run-of-show is the entry-locale catalog's");
  // NON-VACUITY: German is actually German. If the loader silently fell back to `en`
  // (an untranslated catalog, a bad locale narrow) this passes the deepEqual above and
  // fails here — which is exactly the failure mode the feature exists to prevent.
  const en = await interviewBriefStrings("en");
  assert.notDeepEqual(de.debriefRunOfShow, en.debriefRunOfShow, "the German agenda differs from the English one");
  for (const item of grounded.runOfShow) assert.ok(item.trim().length > 0, "no empty agenda row");
});

test("an entry with NO locale keeps the English agenda (the default-locale path is unchanged)", async () => {
  const grounded = await buildGroundedInterview(debriefEntry(null));
  assert.deepEqual(grounded.runOfShow, (await interviewBriefStrings("en")).debriefRunOfShow);
});

test("a garbage locale on the row does not reach the catalog loader", async () => {
  // `pipeline_entries.locale` is free text at the DB level (inbound apply writes it),
  // so an unsupported tag must narrow to the default rather than attempt a
  // `messages/pt-BR.json` import that would throw mid-brief.
  const grounded = await buildGroundedInterview(debriefEntry("pt-BR"));
  assert.deepEqual(grounded.runOfShow, (await interviewBriefStrings("en")).debriefRunOfShow);
});

// --- the candidate-safe (agent-narrated) brief ------------------------------

test("the candidate-safe debrief brief speaks the entry's language too", async () => {
  const brief = await buildCandidateSafeBrief(debriefEntry("fr"));
  assert.ok(brief, "an entry with follow-ups grounds a candidate-safe brief");
  const fr = await interviewBriefStrings("fr");
  assert.ok(brief.includes(fr.debriefRunOfShow[0]), "the French agenda topic is in the client-sent prompt");
  assert.ok(
    !brief.includes("Your take-home — how you approached it"),
    "and the hard-coded English topic is gone"
  );
});

// --- the opening-language table ---------------------------------------------

test("every supported locale has an opening-language name — the table is the locale list", () => {
  assert.deepEqual(Object.keys(OPENING_LANGUAGE_NAMES).sort(), [...LOCALES].sort());
  for (const l of LOCALES) assert.ok(OPENING_LANGUAGE_NAMES[l].trim().length > 0, `${l} names a language`);
  // Distinct names: a copy-paste that mapped `de` to "English" would otherwise pass.
  assert.equal(new Set(Object.values(OPENING_LANGUAGE_NAMES)).size, LOCALES.length);
});

test("a German applicant's interviewer is told to open in German, not English", async () => {
  const grounded = await buildGroundedInterview(debriefEntry("de"));
  assert.match(grounded.instructions, /open the interview in German/);
  assert.doesNotMatch(grounded.instructions, /open the interview in English/);
});

test("a French applicant's interviewer is told to open in French", async () => {
  const grounded = await buildGroundedInterview(debriefEntry("fr"));
  assert.match(grounded.instructions, /open the interview in French/);
});

// --- the catalog itself -----------------------------------------------------

test("interviewBriefStrings renders a complete pack in all four locales", async () => {
  for (const l of LOCALES) {
    const s = await interviewBriefStrings(l);
    assert.equal(s.debriefRunOfShow.length, 4, `${l}: four debrief phases`);
    for (const v of [...s.debriefRunOfShow, s.recruiterAddedQuestions]) {
      assert.ok(typeof v === "string" && v.trim().length > 0, `${l}: every entry renders`);
      // next-intl echoes the dotted key path when a key is missing from a catalog.
      assert.doesNotMatch(v, /^interview\.brief\./, `${l}: no missing-key echo`);
    }
  }
});
