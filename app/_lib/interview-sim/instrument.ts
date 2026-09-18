// The INSTRUMENT under test (spark interview-uat-tranche, WP-1): for one fixture, the
// directed agenda and BOTH briefs, built by the REAL builders against a THROWAWAY
// database — the same path /api/interview/connect takes, minus the session row.
//
//   kit        an entry with no prep of its own, on a link pinned to the job's PUBLISHED
//              kit → buildInterviewKit (branch "kit") + buildGroundedInterview /
//              buildCandidateSafeBrief with that kit;
//   prep       an experienced candidate with a generated prep plan, no kit (branch "prep");
//   debrief    a promoted work-sample submission with minted authorship questions
//              (branch "debrief");
//   student    an early-career entry on the generic student script (branch "student");
//   rehearsal  a recruiter rehearsing a DRAFT version of the job's kit — no entry at all
//              → buildKitOnlyInterviewKit + buildRehearsalBriefs.
//
// The PRIVATE brief (the server-minted OpenAI one, carrying the director protocol, the
// private notes, the must-asks and the weights) is what the stand-in interviewer
// receives. The candidate-safe brief is recorded beside it — WP-2's leak checks read
// it — and is never sent to the simulated candidate.
//
// THE BOOKING. connect fits the agenda to the session's booked `duration_min`, which the
// mint takes from buildGroundedInterview's `durationMin`. For prep, debrief and student
// that equals the branch's own planned length, which is what buildInterviewKit falls
// back to with no booking — so no booking is passed. For the kit and rehearsal
// fixtures that fallback is interview-kit-booking.ts kitBookedMin: the one booking rule
// the mint, the rehearse door and the scheduling estimate read too, so the fixtures'
// 20 minutes are exactly what a real no-prep link on SIM_KIT is booked for. (Before
// that rule a no-prep kit-pinned link was minted at the quick screen's 5 minutes — a
// WP-1 finding.)
//
// NEVER THE OPERATOR'S DATABASE. Every seed here writes, so assertThrowawayDb() runs
// first and refuses unless KP_DB_PATH is set, matches the path db-path.ts froze, and
// lies outside the repository's data/ directory (data/kp.sqlite is the operator's own
// DB; data/kp-e2e.sqlite and kp-empty.sqlite are other tools'). The CLI points
// KP_DB_PATH at a fresh temp file before it imports anything; a unit test gets one from
// testing/unit-db.ts.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DB_PATH, DEFAULT_DB_PATH } from "../db-path";
import { createPipelineEntry } from "../db/pipeline";
import { createPosting, createSubmission, saveSubmissionEvaluation } from "../db/devcase";
import { interviewKitAppendVersion } from "../db/interview-kits";
import { DEFAULT_WORKSPACE_ID } from "../db/workspaces";
import { saveInterviewPrep } from "../interview-prep";
import { rosStrings } from "../interview-prep-strings";
import { buildRunOfShow, type PrepQuestion } from "../run-of-show";
import { insertJob } from "../job-ingest";
import { buildInterviewKit, buildKitOnlyInterviewKit, type InterviewKit, type InterviewKitBranch } from "../interview-agenda";
import { buildCandidateSafeBrief, buildGroundedInterview, buildRehearsalBriefs } from "../interview-run";
import type { InterviewKit as JobKit } from "../interview-kit-types";
import type { InterviewAgenda } from "../voice/director-types";
import type { SimConversation, SimFixture } from "./types";

// ---- the throwaway-database guard ----------------------------------------------------

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const OPERATOR_DATA_DIR = path.join(REPO_ROOT, "data");

const samePath = (a: string, b: string) =>
  process.platform === "win32" ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);

/** Why seeding `dbPath` would be unsafe, or null when it is a throwaway database. */
export function throwawayDbProblem(dbPath: string = DB_PATH, env: Readonly<Partial<NodeJS.ProcessEnv>> = process.env): string | null {
  const envPath = env.KP_DB_PATH?.trim();
  if (!envPath) return "KP_DB_PATH is not set, so the database would be the operator's data/kp.sqlite";
  if (!samePath(envPath, dbPath)) return `KP_DB_PATH (${envPath}) is not the path the stores opened (${dbPath}) — it was set too late`;
  if (samePath(dbPath, DEFAULT_DB_PATH) || samePath(dbPath, path.join(OPERATOR_DATA_DIR, "kp.sqlite"))) {
    return `${dbPath} is the operator's database`;
  }
  const rel = path.relative(OPERATOR_DATA_DIR, path.resolve(dbPath));
  const inside = rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  if (inside || samePath(path.dirname(dbPath), OPERATOR_DATA_DIR)) return `${dbPath} lies inside the repository's data/ directory`;
  return null;
}

/** Refuse to seed anything unless the stores point at a throwaway database. */
export function assertThrowawayDb(dbPath: string = DB_PATH, env: Readonly<Partial<NodeJS.ProcessEnv>> = process.env): void {
  const problem = throwawayDbProblem(dbPath, env);
  if (problem) throw new Error(`[interview-sim] refusing to seed a database: ${problem}. Point KP_DB_PATH at a temp file.`);
}

// ---- instrument identity -----------------------------------------------------------------

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** The director POLICY's identity: a digest of the pure modules that decide every tool
 *  result and stage direction (the policy, the tool vocabulary, the quote matcher),
 *  line endings normalised. The brief's director section is covered by `briefSha`. */
export function directorVersion(): string {
  const files = ["../voice/director.ts", "../voice/director-tools.mjs", "../quote-match.ts"];
  const text = files.map((f) => readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n")).join("\0");
  return `sha256:${sha256(text).slice(0, 16)}`;
}

/** The private brief's identity. */
export function briefSha(brief: string): string {
  return `sha256:${sha256(brief).slice(0, 16)}`;
}

// ---- the fixture world -----------------------------------------------------------------

export const SIM_COMPANY = "Northwind Payments";

const SENIOR_JOB = {
  title: "Backend Engineer",
  seniority: "senior",
  location: "Praha",
  workMode: "hybrid",
  description:
    "Northwind Payments runs card payments for forty Czech retailers. As a Backend Engineer you build and operate Go services " +
    "on PostgreSQL and Kafka, own them in production, and work in a squad of six with a product manager and a designer. " +
    "You will take part in design reviews, write the runbooks for what you ship, and mentor newer engineers.",
};

const JUNIOR_JOB = {
  title: "Junior Backend Developer",
  seniority: "junior",
  location: "Praha",
  workMode: "hybrid",
  description:
    "Northwind Payments is hiring a Junior Backend Developer to join a squad that builds the merchant reporting API in Go. " +
    "You will pair with a senior engineer, write tests and small features from your first week, and learn how a payment platform runs in production.",
};

/** The job kit every kit-spined fixture uses: three competencies, two must-asks (one in
 *  the LAST competency, so a call that runs long reaches the close reserve still owing
 *  it — the overrun situations depend on that), one weight-3 block, a follow-up, and a
 *  FAQ the posting text does not duplicate (on-call, office days, next steps). */
export const SIM_KIT: JobKit = {
  version: 1,
  competencies: [
    {
      id: "c-ownership",
      title: "Service ownership",
      weight: 3,
      budgetMin: 6,
      questions: [
        { id: "q-own-1", text: "Walk me through a service you owned end to end. What exactly was your part in it?", mustAsk: true, followUp: "Which decision in it was yours alone?" },
        { id: "q-own-2", text: "What would you change in that service if you started it again today?", mustAsk: false },
      ],
    },
    {
      id: "c-collab",
      title: "Working with others",
      weight: 1,
      budgetMin: 4,
      questions: [{ id: "q-collab-1", text: "Tell me about a technical disagreement with a colleague and how it was resolved.", mustAsk: false }],
    },
    {
      id: "c-incidents",
      title: "Incidents and recovery",
      weight: 2,
      budgetMin: 5,
      questions: [
        {
          id: "q-inc-1",
          text: "Tell me about a production incident you led. What happened between the alert and the fix?",
          mustAsk: true,
          followUp: "What did you change afterwards so it would not happen again?",
        },
      ],
    },
  ],
  faq: [
    { id: "f-oncall", question: "What does on-call look like?", answer: "One week in six, with a paid on-call allowance; nights are handed over to the Lisbon team." },
    { id: "f-office", question: "How many days are in the office?", answer: "Two days a week in the Prague office; the rest is remote." },
    { id: "f-next", question: "What happens after this call?", answer: "A recruiter reviews the conversation within five working days; the next round is a technical conversation with two engineers." },
  ],
  note: "Tone: curious, never a quiz. Never read aloud.",
};

/** The prep plan's generator questions — one carries the bracketed gap annotation the
 *  candidate-facing surfaces must scrub, so a leak of it is detectable. */
const PREP_QUESTIONS: PrepQuestion[] = [
  {
    competency: "Event-driven systems (missing must-have: Kafka)",
    question: "Tell me about a system you built where messages could arrive twice or out of order. How did you handle it?",
    whatsGoodLooksLike: "Listen for: idempotency keys, ordering guarantees, a replay story",
    followUpIfAnswer: "What broke first when you tested it?",
  },
  {
    competency: "PostgreSQL performance",
    question: "Walk me through the slowest query you ever fixed. How did you find it and what did you change?",
    whatsGoodLooksLike: "Listen for: EXPLAIN, an index or a rewrite, a measured before and after",
  },
  {
    competency: "Production ownership",
    question: "What is a production decision you made that you would reverse today?",
    whatsGoodLooksLike: "Listen for: owns the decision, names the cost, what they learned",
  },
];

/** The authorship probes a work-sample evaluation would mint for the debrief fixture. */
const DEBRIEF_FOLLOWUPS = [
  {
    decision: "Kept the ORM for the report endpoint despite N+1 queries",
    question: "Your report endpoint goes through the ORM. What alternative did you consider, and why did you keep it?",
    listenFor: "a trade-off between delivery speed and query cost",
    redFlag: "cannot name the N+1 or says the tool chose it",
  },
  {
    decision: "No retries on the webhook consumer",
    question: "Your webhook consumer does not retry. Walk me through what happens when the downstream service is down.",
    listenFor: "failure modes, idempotency, a dead-letter path",
  },
  {
    decision: "Every event in one PostgreSQL table",
    question: "You stored every event in one table. At what volume would you change that, and to what?",
    listenFor: "partitioning, archival, a number",
  },
];

type World = { seniorJobId: string; juniorJobId: string; publishedKitId: string; draftKitId: string };

let world: World | null = null;
let serial = 0;
const nextId = (prefix: string) => `${prefix}-${process.pid}-${++serial}`;

/** The jobs and kit versions every instrument in this process shares — one role's round,
 *  like production: the kit fixture's link pins the PUBLISHED version, the rehearsal
 *  rehearses a DRAFT of the same kit. */
function ensureWorld(): World {
  if (world) return world;
  assertThrowawayDb();
  const seniorJobId = insertJob({ id: nextId("sim-job-senior"), company: SIM_COMPANY, ...SENIOR_JOB }, undefined, "published").id;
  const juniorJobId = insertJob({ id: nextId("sim-job-junior"), company: SIM_COMPANY, ...JUNIOR_JOB }, undefined, "published").id;
  const publishedKitId = interviewKitAppendVersion({ jobId: seniorJobId, kit: SIM_KIT, source: "edited", status: "published" }).id;
  const draftKitId = interviewKitAppendVersion({ jobId: seniorJobId, kit: SIM_KIT, source: "edited", status: "draft" }).id;
  world = { seniorJobId, juniorJobId, publishedKitId, draftKitId };
  return world;
}

// ---- building one instrument -------------------------------------------------------------

/** One fixture's instrument, as the stand-in interviewer meets it. */
export type SimInstrument = {
  /** `${fixture}.${locale ?? "auto"}` — one instrument per fixture and applicant locale. */
  key: string;
  fixture: SimFixture;
  /** The applicant's chosen locale the entry carries (the rehearsing recruiter's for a
   *  rehearsal), or null for the bilingual greet-then-detect opener. */
  locale: string | null;
  /** Which branch of the agenda builder produced it (asserted against the fixture). */
  branch: InterviewKitBranch;
  agenda: InterviewAgenda;
  /** The private, server-minted brief — what the stand-in interviewer receives. */
  privateBrief: string;
  /** The candidate-safe (client-sent) brief, recorded for leak checks; never sent anywhere. */
  candidateBrief: string | null;
  /** What the contract records on every conversation. */
  record: SimConversation["instrument"];
  seeded: { jobId: string; entryId: string | null; kitId: string | null };
};

const EXPECTED_BRANCH: Record<SimFixture, InterviewKitBranch> = {
  kit: "kit",
  prep: "prep",
  debrief: "debrief",
  student: "student",
  rehearsal: "kit",
};

async function entryInstrument(
  fixture: Exclude<SimFixture, "rehearsal">,
  locale: string | null,
  w: World,
): Promise<{ kit: InterviewKit | null; privateBrief: string; candidateBrief: string | null; jobId: string; entryId: string; kitId: string | null }> {
  const candidateId = nextId(`sim-cand-${fixture}`);
  const common = { candidateId, candidateLabel: "Alex", locale };
  let jobId = w.seniorJobId;
  let kitId: string | null = null;
  let entryId: string;
  if (fixture === "student") {
    jobId = w.juniorJobId;
    entryId = createPipelineEntry({ ...common, jobId, jobTitle: JUNIOR_JOB.title, archetype: "student" }).entry.id;
  } else if (fixture === "debrief") {
    const caseId = nextId("sim-case");
    const posting = createPosting({ caseId, channel: "local", token: nextId("sim-tok"), roleTitle: SENIOR_JOB.title, caseTitle: "Billing service" });
    const { submission } = createSubmission({ postingId: posting.id, candidateRef: candidateId, repoRef: nextId("sim-repo") });
    saveSubmissionEvaluation(
      submission.id,
      { evaluation: { summary: "Working service, three questionable decisions.", strengths: [], concerns: [], confidence: 0.8 }, followups: { questions: DEBRIEF_FOLLOWUPS } },
      70,
    );
    entryId = createPipelineEntry({ ...common, jobId, jobTitle: SENIOR_JOB.title, devSubmissionId: submission.id }).entry.id;
  } else {
    entryId = createPipelineEntry({ ...common, jobId, jobTitle: SENIOR_JOB.title }).entry.id;
    if (fixture === "prep") {
      const plan = buildRunOfShow(PREP_QUESTIONS, ["event-driven systems", "postgresql"], "Alex", SENIOR_JOB.title, await rosStrings("en"));
      saveInterviewPrep(entryId, "Alex", SENIOR_JOB.title, { ...plan, lang: "en" });
    } else {
      kitId = w.publishedKitId;
    }
  }
  const kit = await buildInterviewKit(entryId, undefined, { kitId });
  const built = await buildGroundedInterview(entryId, undefined, { readOnly: true, kit });
  if (!built.grounded) throw new Error(`[interview-sim] the ${fixture} fixture produced no grounded brief`);
  const candidateBrief = await buildCandidateSafeBrief(entryId, { kit });
  return { kit, privateBrief: built.instructions, candidateBrief, jobId, entryId, kitId };
}

/** Build one fixture's instrument through the real builders. */
export async function buildSimInstrument(fixture: SimFixture, locale: string | null): Promise<SimInstrument> {
  assertThrowawayDb();
  const w = ensureWorld();
  let kit: InterviewKit | null;
  let privateBrief: string;
  let candidateBrief: string | null;
  let seeded: SimInstrument["seeded"];
  if (fixture === "rehearsal") {
    kit = await buildKitOnlyInterviewKit(w.draftKitId, DEFAULT_WORKSPACE_ID, { locale });
    if (!kit) throw new Error("[interview-sim] the rehearsal fixture's kit directs nothing");
    const briefs = buildRehearsalBriefs(w.seniorJobId, kit, { locale });
    privateBrief = briefs.instructions;
    candidateBrief = briefs.candidateBrief;
    seeded = { jobId: w.seniorJobId, entryId: null, kitId: w.draftKitId };
  } else {
    const built = await entryInstrument(fixture, locale, w);
    kit = built.kit;
    privateBrief = built.privateBrief;
    candidateBrief = built.candidateBrief;
    seeded = { jobId: built.jobId, entryId: built.entryId, kitId: built.kitId };
  }
  if (!kit) throw new Error(`[interview-sim] the ${fixture} fixture produced no agenda`);
  // Instrument identity: assert WHICH variant was built, not merely that one was.
  if (kit.branch !== EXPECTED_BRANCH[fixture]) {
    throw new Error(`[interview-sim] the ${fixture} fixture built the "${kit.branch}" branch, not "${EXPECTED_BRANCH[fixture]}"`);
  }
  return {
    key: `${fixture}.${locale ?? "auto"}`,
    fixture,
    locale,
    branch: kit.branch,
    agenda: kit.agenda,
    privateBrief,
    candidateBrief,
    record: { briefSha: briefSha(privateBrief), agendaBlockIds: kit.agenda.blocks.map((b) => b.id), directorVersion: directorVersion() },
    seeded,
  };
}
