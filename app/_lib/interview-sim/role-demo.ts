// The goal-1 demo run's SIMULATED INTERVIEW (ADR-0011 amendment 2026-10-06): after the
// demo's stand-in approves an interview invite, play that candidate's first-round
// interview through the existing simulator and seal its scorecard, so the role run's
// scorecard stage (S5) reads a real sealed scorecard instead of "unrated".
//
// WHERE IT RUNS. Only inside the child half of scripts/kpi/role-demo-run.mjs, on the
// scratch copy of the database, and only under --approve-gates. The engine is untouched:
// the invite gate parks S4, the stand-in approves it between two advanceRoleRun passes,
// and S5 runs on the NEXT pass — so sealing here, right after the approval, is early
// enough.
//
// IT IS NEVER A REAL DATABASE, AND THAT IS A DECLARATION RATHER THAN A GUESS.
// assertRoleDemoScratchDb() (instrument.ts) refuses unless KP_ROLE_DEMO_SCRATCH_DB names
// the very database the stores opened — the positive marker the demo's parent half sets
// on the copy it made. The path heuristic it is built on would, alone, have let a
// self-hosted install whose KP_DB_PATH lies outside the repository's data/ directory
// through, and a simulated interview there seals a model-written scorecard onto a real
// candidate's entry.
//
// IT IS NEVER A REAL CANDIDATE EITHER, FOR THE SAME REASON: A PROOF, NOT A CONVENTION.
// An entry is played only when seedOriginProblem (seed-origin.ts) can match its row and its
// stored CV payload against data/seed_pipeline/pipeline.json and data/seed_candidates/
// candidates.json. Anything unproven — a candidate a human added, a seeded candidate whose
// CV was edited, or any entry at all when the fixtures cannot be read — is refused with a
// recorded reason, BEFORE the provider preflight and before the CV reaches a prompt. The
// operator's answer to finding 2b of docs/security/role-demo-sim-scan-2026-10-06.md.
//
// WHAT IS REAL. The interviewer holds the entry's real private brief and agenda (the
// connect-time build: interview-run.ts + interview-agenda.ts). The candidate is the
// model, playing the CV profile on the entry and nothing else. The transcript is stored
// and the session completed through the interview store's own functions, and the
// scorecard is the `scorecard` automation task through finalizeCandidateInterviewScoring.
//
// WHAT IS NEVER ACCEPTED. A scorecard whose verdictSource is not "llm". A keyless install
// scores from a template; letting that count would put a recommendation nobody made under
// an offer approval. The scorer wrapper throws on anything but "llm", so nothing is
// attached and S5 reads the session as unscored — "unrated". No provider (KP_OFFLINE, no
// claude CLI), a provider that throws, or no agenda also leave the branch unrated, with
// the reason recorded in the row and no session minted.
//
// THE LABEL. The session's candidate label carries " (simulated)", and every row this
// returns says so. A row holds counts and the recommendation only — never transcript text
// or scorecard evidence.
//
// …AND THAT HOLDS ON THE ERROR PATHS TOO, which is where it did not. A row's `skipped`
// reason used to carry the thrown message: the engine's `dump.error` is a provider message
// sliced to 2000 chars, and the provider's own "output was not JSON" quoted 300 bytes of
// the model's turn — the candidate speaking from their CV, printed by the demo and sealed
// into the --json reading. The call's end reason is now the whole of what a failed call
// says, and a message is quoted only when its error TYPE guarantees it holds no interview
// text (reasonOf).

import { getPipelineEntry } from "../db/pipeline";
import { getProfileRecord } from "../db/profiles";
import { completeInterviewSession, createInterviewSession, type InterviewSession } from "../db/interviews";
import { coerceInterviewRecommendation } from "../interview-recommendation";
import { buildInterviewKit } from "../interview-agenda";
import { buildGroundedInterview } from "../interview-run";
import { latestPublishedKit } from "../interview-kit";
import { finalizeCandidateInterviewScoring, synthesizeCandidateScorecard, type FinalizeScoringDeps } from "../interview-scorecard-commit";
import type { VerdictProvenance } from "../automation-run";
import type { VoiceTurn } from "../voice/types";
import { runConversation, type SimLimits } from "./engine";
import { briefSha, assertRoleDemoScratchDb, directorVersion, type SimInstrument } from "./instrument";
import { claudeCliLlm, SimProviderError } from "./providers";
import { seedOriginProblem } from "./seed-origin";
import type { SimFixture, SimLlm, SimSituation, SimTurn } from "./types";

/** Suffix on the candidate label of every session the demo plays. */
export const SIMULATED_LABEL = " (simulated)";

/** Branches simulated per demo run unless --sim-interviews says otherwise, and the ceiling
 *  that flag cannot pass: each branch is a dozen subscription-billed model calls. */
export const DEFAULT_SIM_INTERVIEWS = 2;
export const MAX_SIM_INTERVIEWS = 5;

/** A short call: the demo needs a scorable transcript, not a 25-minute one. */
export const DEMO_SIM_LIMITS: Partial<SimLimits> = { maxCandidateTurns: 8, maxCalls: 48 };

/** One row per approved-invite branch — counts and the recommendation, never text. */
export type SimulatedInterviewRow = {
  branchRef: string;
  sessionId: string | null;
  /** The canonical recommendation the S5 card will carry, or null when no scorecard was accepted. */
  recommendation: string | null;
  verdictSource: string | null;
  turns: number;
  endReason: string | null;
  /** Why this branch is not rated by a simulated interview, or null when it is. */
  skipped: string | null;
};

export type RoleDemoSimDeps = {
  /** Two DIFFERENT SimLlm instances for one conversation, built once the instrument is known
   *  and BEFORE any session exists. The default is the Claude CLI (providers.ts), which
   *  throws under KP_OFFLINE or with no CLI on PATH. */
  llms?: (situation: SimSituation, instrument: SimInstrument) => { interviewer: SimLlm; candidate: SimLlm };
  /** Runs before anything is built, so a missing provider costs nothing — not even a prep
   *  plan. Throws when the provider is unavailable. The default checks the Claude CLI; a
   *  test that injects `llms` has no CLI to check. */
  preflight?: () => void;
  /** The scorer, as FinalizeScoringDeps.score. The default is the real `scorecard` task. */
  score?: FinalizeScoringDeps["score"];
  /** The rest of finalize's seams (mint, seal), for a test that must not touch them. */
  finalize?: Omit<FinalizeScoringDeps, "score">;
  limits?: Partial<SimLimits>;
};

const skippedRow = (branchRef: string, skipped: string, extra: Partial<SimulatedInterviewRow> = {}): SimulatedInterviewRow => ({
  branchRef,
  sessionId: null,
  recommendation: null,
  verdictSource: null,
  turns: 0,
  endReason: null,
  skipped,
  ...extra,
});

const PROVIDER_UNAVAILABLE = "not simulated: provider unavailable";

/** The refusal of an entry that is not provably seed data — the whole of finding 2b's close
 *  (seed-origin.ts). The parenthesis is the operator-facing fact: the refusal happens before
 *  anything is built, so this CV never reached a provider. */
export const NOT_SEED_DATA = "not simulated: not seed data (CV not sent to the provider)";

/** Refusals that spent nothing, so they do not consume the batch loop's cap. */
const NO_SPEND_REFUSALS = [PROVIDER_UNAVAILABLE, NOT_SEED_DATA];

const clip = (text: string, max = 140) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Errors whose MESSAGE is this module's own vocabulary, written here or in providers.ts,
 *  and provably free of model output. Everything else — the Python scorer, a store, a
 *  builder that quoted the brief — is of unknown provenance. */
const SAFE_MESSAGE_ERRORS = [SimProviderError] as const;

/**
 * An error's message is only quoted when its TYPE guarantees it holds no interview text.
 *
 * Why a redaction barrier and not a sanitiser: the reasons on these rows are printed to
 * the operator and ride the `--json` reading, and the errors reaching them come from the
 * whole scoring stack — a Python subprocess whose stderr may echo the transcript notes it
 * was handed, an LLM adapter quoting its own prompt, a store quoting a row. There is no
 * way to inspect such a message and know what is in it, so the default is to name the
 * failure and withhold the text. A diagnosis reads the server log, which is not a reading
 * anyone publishes.
 */
const reasonOf = (err: unknown) => {
  if (SAFE_MESSAGE_ERRORS.some((E) => err instanceof E)) return clip((err as Error).message);
  const name = err instanceof Error ? err.name || "Error" : typeof err;
  return `${name} (message withheld: it can quote the interview)`;
};

/** Thrown by the scorer wrapper for a scorecard the demo will not count. */
class ScorecardNotAccepted extends Error {
  constructor(
    readonly verdictSource: string | null,
    message: string
  ) {
    super(message);
  }
}

const defaultPreflight = () => {
  claudeCliLlm({ role: "interviewer" });
};

const defaultLlms: NonNullable<RoleDemoSimDeps["llms"]> = () => ({
  interviewer: claudeCliLlm({ role: "interviewer" }),
  candidate: claudeCliLlm({ role: "candidate" }),
});

/** The candidate's system persona: the entry's CV profile, and a rule against going past it.
 *
 *  WHOSE CV. A SEEDED candidate's, and that is now a proof rather than a hope: no caller
 *  reaches this function until seedOriginProblem has matched the entry's row and this very
 *  payload against the committed fixtures (seed-origin.ts), so the profile rendered into the
 *  system prompt of a Claude CLI call is a fixture record and never a real person's — however
 *  the stand-in's approvals fell and whatever board the copy was made from. Finding 2b of
 *  docs/security/role-demo-sim-scan-2026-10-06.md, closed on the operator's answer of
 *  2026-10-06 ("seeded entries only"). */
export function candidatePersona(label: string, jobTitle: string | null, profile: unknown): string {
  const cv = JSON.stringify(profile);
  return [
    `You are ${label}, a real person taking a first-round spoken job interview${jobTitle ? ` for the role "${jobTitle}"` : ""}.`,
    "Everything you know about your own background is the CV profile below (JSON). Answer as that person, in the first person, in short spoken answers of two to four sentences.",
    "Stay true to the CV. Invent no employers, job titles, degrees, certifications, tools, projects or numbers it does not contain. When you are asked about something it does not cover, say plainly that you have not done that, or that it is not something you have worked on; you may say what you would do, as a guess, but never claim it as experience.",
    "Answer in the language the interviewer speaks to you in.",
    "CV profile:",
    clip(cv, 8000),
  ].join("\n");
}

/** The stored transcript of a simulated call: what was SPOKEN, by the two real parties. */
export function spokenTranscript(turns: readonly SimTurn[]): VoiceTurn[] {
  return turns
    .filter((t) => (t.role === "candidate" || t.role === "interviewer") && t.text.trim() !== "")
    .map((t) => ({ role: t.role as "candidate" | "interviewer", text: t.text }));
}

const FIXTURE_OF_BRANCH: Record<string, SimFixture> = { kit: "kit", prep: "prep", debrief: "debrief", student: "student", case: "student" };

/** Play and score ONE branch (a pipeline entry id). Never throws: every refusal is a row. */
export async function simulateInterviewForEntry(
  entryId: string,
  workspaceId: string,
  deps: RoleDemoSimDeps = {}
): Promise<SimulatedInterviewRow> {
  // BEFORE the first read, let alone the first write: a declared throwaway copy, not
  // merely a path that does not look like data/kp.sqlite (see assertRoleDemoScratchDb).
  assertRoleDemoScratchDb();
  const entry = getPipelineEntry(entryId, workspaceId);
  if (!entry) return skippedRow(entryId, "not simulated: no pipeline entry");
  const profile = entry.candidateId ? getProfileRecord(entry.candidateId, workspaceId) : null;
  if (!profile) return skippedRow(entryId, "not simulated: no CV profile for the entry");

  // 0. SEEDED ENTRIES ONLY, and it is a proof rather than a convention (seed-origin.ts;
  // finding 2b, the operator's answer of 2026-10-06). BEFORE the provider preflight, before
  // candidatePersona, before a session exists and before any model call: an entry whose row
  // and CV payload do not match the committed fixtures is refused, and its CV is never
  // rendered into a prompt. Unreadable fixtures refuse everything.
  const notSeed = seedOriginProblem({
    entryId,
    candidateId: entry.candidateId ?? null,
    candidateLabel: entry.candidateLabel ?? null,
    profileId: profile.row.id,
    profilePayload: profile.payload,
  });
  if (notSeed) return skippedRow(entryId, `${NOT_SEED_DATA}: ${notSeed}`);

  // 1. The provider FIRST: offline or without a CLI nothing is built and no session exists.
  try {
    (deps.preflight ?? (deps.llms ? () => undefined : defaultPreflight))();
  } catch (err) {
    return skippedRow(entryId, `${PROVIDER_UNAVAILABLE} (${reasonOf(err)})`);
  }

  // 2. The real interviewer side — what /api/interview/create mints and /connect rebuilds.
  const situation: SimSituation = {
    id: `role-demo-${entryId}`,
    title: "Goal-1 demo interview",
    behaviour: "plain",
    language: entry.locale ?? "en",
    fixture: "kit",
    persona: candidatePersona(entry.candidateLabel, entry.jobTitle, profile.payload),
    provokes: [],
    handles: "A plain first-round interview: the candidate answers from the CV.",
  };
  let llms: { interviewer: SimLlm; candidate: SimLlm };
  let session: InterviewSession | null;
  let instrument: SimInstrument;
  try {
    const jobId = entry.jobId;
    const pinned = jobId ? latestPublishedKit(jobId, workspaceId) : null;
    // Non-readOnly, as the mint is: a missing prep plan is generated (the same automation
    // task a recruiter's "Start interview" would run), and it falls back to a template
    // keylessly. The directed build below is then read-only, exactly as connect's.
    const minted = await buildGroundedInterview(entryId, workspaceId, { pinnedKit: pinned?.kit ?? null });
    const kit = await buildInterviewKit(entryId, workspaceId, { kitId: pinned?.id ?? null, bookedMin: minted.durationMin });
    if (!kit) return skippedRow(entryId, "not simulated: the entry has no interview agenda (no job kit, no prep plan)");
    const directed = await buildGroundedInterview(entryId, workspaceId, { readOnly: true, kit });
    if (!directed.grounded) return skippedRow(entryId, "not simulated: no grounded interview brief");
    const fixture = FIXTURE_OF_BRANCH[kit.branch] ?? "kit";
    instrument = {
      key: `${fixture}.${entry.locale ?? "auto"}`,
      fixture,
      locale: entry.locale ?? null,
      branch: kit.branch,
      agenda: kit.agenda,
      privateBrief: directed.instructions,
      candidateBrief: null,
      record: { briefSha: briefSha(directed.instructions), agendaBlockIds: kit.agenda.blocks.map((b) => b.id), directorVersion: directorVersion() },
      seeded: { jobId: entry.jobId ?? "", entryId, kitId: pinned?.id ?? null },
    };
    situation.fixture = fixture;
    try {
      llms = (deps.llms ?? defaultLlms)(situation, instrument);
    } catch (err) {
      return skippedRow(entryId, `${PROVIDER_UNAVAILABLE} (${reasonOf(err)})`);
    }
    // 3. The candidate-mode session, labelled simulated, in the run's workspace.
    session = createInterviewSession({
      provider: "openai",
      mode: "candidate",
      entryId,
      candidateLabel: `${minted.candidateLabel ?? entry.candidateLabel}${SIMULATED_LABEL}`,
      jobId: minted.jobId,
      jobTitle: minted.jobTitle,
      instructions: minted.instructions,
      runOfShow: minted.runOfShow,
      durationMin: minted.durationMin,
      language: entry.locale ?? null,
      workspaceId,
      kitId: pinned?.id ?? null,
    });
  } catch (err) {
    return skippedRow(entryId, `not simulated: could not build the interview (${reasonOf(err)})`);
  }
  if (!session) return skippedRow(entryId, "not simulated: the session could not be created");
  const sessionId = session.id;

  // 4. The conversation.
  let dump: Awaited<ReturnType<typeof runConversation>>;
  try {
    dump = await runConversation({
      runId: `role-demo-${sessionId}`,
      situation,
      instrument,
      interviewer: llms.interviewer,
      candidate: llms.candidate,
      limits: { ...DEMO_SIM_LIMITS, ...deps.limits },
    });
  } catch (err) {
    completeInterviewSession(sessionId, { transcript: [], status: "failed" });
    return skippedRow(entryId, `not simulated: the conversation failed (${reasonOf(err)})`, { sessionId });
  }
  const transcript = spokenTranscript(dump.turns);
  const candidateTurns = transcript.filter((t) => t.role === "candidate").length;
  const counts = { sessionId, turns: transcript.length, endReason: dump.endedBy };
  if (dump.endedBy === "error" || candidateTurns === 0) {
    completeInterviewSession(sessionId, { transcript, status: "failed" });
    return skippedRow(entryId, `not rated: the simulated call did not complete (${dump.endedBy})`, counts);
  }

  // 5. Store, complete, score. The wrapper below is the whole 'llm'-only rule.
  const stored = completeInterviewSession(sessionId, { transcript, status: "completed" });
  if (!stored.applied || !stored.session) return skippedRow(entryId, "not rated: the session could not be completed", counts);
  let provenance: VerdictProvenance | null = null;
  const scorer: NonNullable<FinalizeScoringDeps["score"]> = async (s, t) => {
    const scored = deps.score ? await deps.score(s, t) : await synthesizeCandidateScorecard(s, t);
    if (!scored) throw new ScorecardNotAccepted(null, "the scorer produced nothing");
    provenance = scored.provenance;
    if (scored.provenance.verdictSource !== "llm") {
      throw new ScorecardNotAccepted(scored.provenance.verdictSource, `scorecard not accepted: verdictSource ${scored.provenance.verdictSource}, not llm`);
    }
    return scored;
  };
  try {
    const result = await finalizeCandidateInterviewScoring(stored.session, transcript, { ...deps.finalize, score: scorer });
    const attached = result.session?.scorecard as { recommendation?: unknown } | null | undefined;
    if (!result.attached || attached == null) return skippedRow(entryId, "not rated: the scorecard could not be attached", counts);
    return {
      branchRef: entryId,
      sessionId,
      recommendation: attached.recommendation == null ? "unrated" : coerceInterviewRecommendation(attached.recommendation),
      verdictSource: (provenance as VerdictProvenance | null)?.verdictSource ?? null,
      turns: counts.turns,
      endReason: counts.endReason,
      skipped: null,
    };
  } catch (err) {
    if (err instanceof ScorecardNotAccepted) {
      return skippedRow(entryId, `not rated: ${err.message}`, { ...counts, verdictSource: err.verdictSource });
    }
    return skippedRow(entryId, `not rated: the scorer failed (${reasonOf(err)})`, counts);
  }
}

/** The demo's simulator: a cap on how many branches are played, rows kept in order. */
export function createRoleDemoSimulator(opts: { cap?: number; workspaceId: string; deps?: RoleDemoSimDeps }) {
  const cap = Math.max(0, Math.min(MAX_SIM_INTERVIEWS, Math.floor(opts.cap ?? DEFAULT_SIM_INTERVIEWS)));
  const rows: SimulatedInterviewRow[] = [];
  let played = 0;
  return {
    cap,
    rows,
    /** Simulate one approved-invite branch, or record why it was not. */
    async run(branchRef: string): Promise<SimulatedInterviewRow> {
      if (rows.some((r) => r.branchRef === branchRef)) return rows.find((r) => r.branchRef === branchRef) as SimulatedInterviewRow;
      let row: SimulatedInterviewRow;
      if (played >= cap) {
        row = skippedRow(branchRef, "not simulated: cap");
      } else {
        row = await simulateInterviewForEntry(branchRef, opts.workspaceId, opts.deps);
        // The cap bounds SPEND. A branch that never reached a provider spent nothing — an
        // unavailable provider, or an entry refused as not-seed before anything was built.
        if (!NO_SPEND_REFUSALS.some((prefix) => row.skipped?.startsWith(prefix))) played += 1;
      }
      rows.push(row);
      return row;
    },
  };
}
