// Pins the DIRECTOR section every directed brief carries (spark ai-interview-parity):
// the candidate listing is an allow-list that never reads a block's competency, the
// private listing carries the interviewer's notes, the protocol names every tool and
// the stage-direction prefix as constraints, ROLE FACTS carry only public text, and
// the resumed-call addendum quotes only what the candidate said or heard.
//
// Pure — no DB. Runner: npm run test:unit.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agendaHeader,
  agendaTopicCount,
  candidateAgendaListing,
  capPostingText,
  directorProtocol,
  kitQuestionListing,
  leadershipFrame,
  MAX_ROLE_FACTS_POSTING_CHARS,
  MUST_ASK_MARK,
  privateAgendaListing,
  privateDirectedBrief,
  RESUME_TURN_MAX_CHARS,
  resumeAddendum,
  resumeBlock,
  type RoleFacts,
} from "./director-brief.ts";
import { DIRECTOR_NOTE_PREFIX, DIRECTOR_TOOL_NAMES } from "./director-tools.mjs";
import type { InterviewAgenda, ResumeContext } from "./director-types.ts";

const GAP = "Test automation fundamentals (missing must-have)";
const AGENDA: InterviewAgenda = {
  version: 1,
  durationMin: 20,
  hardCapMin: 24,
  closeReserveMin: 4,
  blocks: [
    { id: "b0", kind: "warmup", title: "Warm-up", budgetMin: 2, competency: null, scored: false, questions: ["Where are you joining from?"] },
    { id: "b1", kind: "topic", title: "Test automation fundamentals", budgetMin: 8, competency: GAP, scored: true, questions: ["“Which tests would you write first?”"] },
    { id: "b2", kind: "open", title: "Open discussion", budgetMin: 6, competency: "Open discussion & deep dive", scored: true, questions: [] },
    { id: "b3", kind: "role_qa", title: "Your questions about the role", budgetMin: 2, competency: null, scored: false, questions: [] },
    { id: "b4", kind: "close", title: "Wrap-up", budgetMin: 2, competency: null, scored: false, questions: [] },
  ],
};
const NOTES = { b1: "Listen for: hedging about who wrote the suite. Internal red flag — never say this aloud: claims 8 skills" };
const FACTS: RoleFacts = { title: "QA Engineer", company: "Acme", location: "Praha", workMode: "hybrid", posting: "We build test tooling." };

test("candidate listing: ids, titles, budgets and aloud questions — never the competency or a note", () => {
  const listing = candidateAgendaListing(AGENDA);
  for (const b of AGENDA.blocks) assert.ok(listing.includes(`${b.id} · ${b.title} (${b.budgetMin} min)`), `${b.id} head is listed`);
  assert.ok(listing.includes("“Which tests would you write first?”"), "aloud questions survive");
  assert.doesNotMatch(listing, /“““|”””/, "a pre-quoted probe is not double-quoted");
  assert.doesNotMatch(listing, /missing must-have|Listen for|red flag|Evidence for|deep dive/);
});

test("private listing: the same heads, plus the competency and the kit's notes", () => {
  const listing = privateAgendaListing(AGENDA, NOTES);
  for (const b of AGENDA.blocks) assert.ok(listing.includes(`${b.id} · ${b.title} (${b.budgetMin} min)`), `${b.id} head is listed`);
  assert.match(listing, /Evidence for: Test automation fundamentals \(missing must-have\)\./);
  assert.match(listing, /Listen for: hedging/);
  // A block without a note falls back to its aloud questions.
  assert.match(listing, /b0 · Warm-up \(2 min\) — Ask: “Where are you joining from\?”/);
});

test("the frame counts only the scored blocks and states the clock", () => {
  assert.equal(agendaTopicCount(AGENDA), 2);
  assert.match(leadershipFrame(AGENDA), /lead them through 2 short topics in about 20 minutes and may move things along to keep time/);
  assert.match(agendaHeader(AGENDA), /about 20 minutes in total/);
});

test("the protocol names every director tool, the stage-direction prefix and the ROLE FACTS", () => {
  const p = directorProtocol(FACTS);
  for (const name of DIRECTOR_TOOL_NAMES) assert.ok(p.includes(name), `${name} is named`);
  assert.ok(p.includes(`Messages that begin with ${DIRECTOR_NOTE_PREFIX}`));
  assert.match(p, /never read, quote or mention them/);
  assert.match(p, /ROLE FACTS — title: QA Engineer; company: Acme; location: Praha; work mode: hybrid\. Published posting: “We build test tooling\.”/);
  assert.match(p, /a recruiter reviews this conversation and contacts the candidate about next steps/);
  // No posting (a job that is not live) → no posting clause at all.
  assert.doesNotMatch(directorProtocol({ ...FACTS, posting: null }), /Published posting/);
  assert.match(directorProtocol(null), /every question about the role gets forward_question/);
});

test("capPostingText: one paragraph, capped at a word boundary", () => {
  assert.equal(capPostingText("  a\n\n b  "), "a b");
  assert.equal(capPostingText(""), null);
  assert.equal(capPostingText(42), null);
  const long = capPostingText("word ".repeat(1000)) ?? "";
  assert.ok(long.length <= MAX_ROLE_FACTS_POSTING_CHARS + 1, "the cap holds (plus the ellipsis)");
  assert.ok(long.endsWith("…") && !long.endsWith(" …"));
});

const RESUME: ResumeContext = {
  attempt: 2,
  activeBlockId: "b1",
  coveredBlockIds: ["b0"],
  elapsedSec: 400,
  priorTurns: [
    { seq: 1, role: "interviewer", text: "Where are you joining from?", at: "2026-09-18T10:00:00Z" },
    { seq: 2, role: "candidate", text: "From Brno.", at: "2026-09-18T10:00:05Z" },
    { seq: 3, role: "system", text: "INTERNAL system note", at: "2026-09-18T10:00:06Z" },
    { seq: 4, role: "interviewer", text: `${DIRECTOR_NOTE_PREFIX} move on`, at: "2026-09-18T10:00:07Z" },
    { seq: 5, role: "candidate", text: "x".repeat(400), at: "2026-09-18T10:00:09Z" },
  ],
};

test("resume addendum: continue at the active block, list what is covered, quote only spoken turns", () => {
  const a = resumeAddendum(RESUME, AGENDA);
  assert.match(a, /attempt 2/);
  assert.match(a, /do not introduce yourself, the agenda or the transcription note again/);
  assert.match(a, /Continue with b1 · Test automation fundamentals \(8 min\)/);
  assert.match(a, /Already covered: b0 · Warm-up\./);
  assert.match(a, /About 7 minutes/);
  assert.match(a, /Candidate: “From Brno\.”/);
  assert.doesNotMatch(a, /INTERNAL system note/, "system turns are never quoted");
  assert.doesNotMatch(a, /\[Director\] move on/, "a stage direction is never quoted");
  assert.ok(a.includes(`${"x".repeat(RESUME_TURN_MAX_CHARS)}…`), "a long turn is capped");
  assert.doesNotMatch(a, /missing must-have/, "the addendum names blocks by title, never by competency");
});

// ---- the job kit (spark interview-kit-template) ------------------------------------------

const KIT_BRIEF_AGENDA: InterviewAgenda = {
  ...AGENDA,
  blocks: AGENDA.blocks.map((b) =>
    b.id === "b1"
      ? {
          ...b,
          questions: ["How do you decide what to automate first?", "What does a healthy suite look like?"],
          mustAsks: [{ id: "q-first", text: "How do you decide what to automate first?" }],
          weight: 3 as const,
        }
      : b,
  ),
};
const FAQ = [
  { question: "Is the team hybrid?", answer: "Two days in the office." },
  { question: "   ", answer: "an entry with no question never rides" },
];

test("private listing states the must-asks as un-skippable and marks the heaviest weight; the candidate listing carries neither", () => {
  const priv = privateAgendaListing(KIT_BRIEF_AGENDA, {});
  assert.match(priv, /b1 · Test automation fundamentals \(8 min\) — .*Required, never skipped even if you are over time: “How do you decide what to automate first\?”\./);
  assert.match(priv, /This competency carries the most of the decision — protect its time\./);
  assert.doesNotMatch(priv, /Ask: “How do you decide what to automate first\?”/, "the required question is not listed twice");
  const cand = candidateAgendaListing(KIT_BRIEF_AGENDA);
  assert.ok(cand.includes("“How do you decide what to automate first?”"), "the question itself is aloud material");
  assert.doesNotMatch(cand, /Required|never skipped|protect its time|carries the most/);
  // A weight of 1 or 2 adds nothing: only the block to PROTECT is marked.
  const light = privateAgendaListing({ ...KIT_BRIEF_AGENDA, blocks: KIT_BRIEF_AGENDA.blocks.map((b) => ({ ...b, weight: 1 as const })) }, {});
  assert.doesNotMatch(light, /protect its time|weight/i);
});

test("kitQuestionListing: authored order, the must-ask marked on its own question, each follow-up right after its question", () => {
  const listing = kitQuestionListing([
    { text: "Which part of your stack do you enjoy most?", mustAsk: false, followUp: null },
    { text: "Walk me through a service you owned end to end.", mustAsk: true, followUp: "Which decision in it was yours alone?" },
    { text: "What would you change in that service today?", mustAsk: false, followUp: "Why not before?" },
  ]);
  assert.equal(
    listing,
    "Ask in this order: 1) “Which part of your stack do you enjoy most?” " +
      `2) “Walk me through a service you owned end to end.” — ${MUST_ASK_MARK}. Optional follow-up: “Which decision in it was yours alone?” ` +
      "3) “What would you change in that service today?” Optional follow-up: “Why not before?”",
  );
  // One question needs no numbering; a clause that ends without punctuation gets its stop.
  assert.equal(kitQuestionListing([{ text: "Tell me about a hard bug", mustAsk: false, followUp: "What fixed it" }]), "Ask: “Tell me about a hard bug”. Optional follow-up: “What fixed it”.");
  assert.equal(kitQuestionListing([{ text: "   ", mustAsk: true, followUp: "orphan" }]), "", "nothing to ask, nothing listed");
});

test("the private listing never states a must-ask twice: a note that marks it inline replaces the separate line", () => {
  const MUST = "How do you decide what to automate first?";
  const note = kitQuestionListing([
    { text: "What does a healthy suite look like?", mustAsk: false, followUp: null },
    { text: MUST, mustAsk: true, followUp: null },
  ]);
  const priv = privateAgendaListing(KIT_BRIEF_AGENDA, { b1: note });
  assert.equal(priv.split(MUST).length - 1, 1, "the required question appears once");
  assert.equal(priv.split(MUST_ASK_MARK).length - 1, 1, "…and so does its marker");
  assert.ok(priv.indexOf("healthy suite") < priv.indexOf(MUST), "in the order the note lists them");
  // A note that does NOT mark a must-ask (a note from before this listing, or any other
  // author) still gets the separate required line — a requirement is never lost.
  const legacy = privateAgendaListing(KIT_BRIEF_AGENDA, { b1: "Ask: “What does a healthy suite look like?”." });
  assert.match(legacy, new RegExp(`${MUST_ASK_MARK}: “How do you decide what to automate first\\?”\\.`));
});

test("the kit FAQ rides ROLE FACTS, after the public facts, whenever a caller passes it", () => {
  const withFaq = directorProtocol(FACTS, FAQ);
  assert.match(withFaq, /The recruiter also answered these, and you may answer them the same way: “Is the team hybrid\?” — Two days in the office\./);
  assert.doesNotMatch(withFaq, /never rides/, "an entry without a question is dropped");
  assert.ok(withFaq.indexOf("Published posting") < withFaq.indexOf("The recruiter also answered"), "after the public facts");
  assert.doesNotMatch(directorProtocol(FACTS), /recruiter also answered|hybrid\?/, "no FAQ argument, no FAQ");
  assert.match(directorProtocol(null, FAQ), /none are available for this call.*Is the team hybrid\?/, "still reachable with no job facts");
  assert.match(privateDirectedBrief(KIT_BRIEF_AGENDA, {}, FACTS, FAQ).protocol, /Is the team hybrid\?/);
  assert.doesNotMatch(privateDirectedBrief(KIT_BRIEF_AGENDA, {}, FACTS).protocol, /Is the team hybrid\?/);
});

test("resumeBlock: a covered active block moves on to the first uncovered one", () => {
  assert.equal(resumeBlock({ ...RESUME, activeBlockId: "b1", coveredBlockIds: ["b0", "b1"] }, AGENDA)?.id, "b2");
  assert.equal(resumeBlock({ ...RESUME, activeBlockId: null, coveredBlockIds: [] }, AGENDA)?.id, "b0");
  const all = AGENDA.blocks.map((b) => b.id);
  assert.equal(resumeBlock({ ...RESUME, coveredBlockIds: all }, AGENDA)?.id, "b4", "everything covered → the closing");
  assert.match(resumeAddendum(RESUME, null), /Continue where the conversation left off/);
});
