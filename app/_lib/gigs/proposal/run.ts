import { getGig, setGigProposal } from "../../db/gigs";
import { getAcceptedGigPlan } from "../../db/gigs-plans";
import { runPythonCli, type CliRunner } from "../../jobseeker/python-cli";
import { GIG_DISCLOSURE_SENTENCE } from "../contract";
import { requestGigReport } from "../report/trigger";
import { gigTrackOf, type Gig, type GigPlan, type GigProposal } from "../types";
import { proposalDeliverable, writeProposalDraft, type ProposalDraftResult } from "./draft";
import { gigProposalPathFor, gigProposalsRoot, writeGigProposalFile } from "./file";
import { deterministicProposal, parseGigProposalBody, type GigProposalBody } from "./model";
import { renderGigProposalPage } from "./template";

// The `gig_proposal` task's body (late-bound-boot.ts registers it; nothing on the task hub
// imports it): a PROPOSAL-TRACK gig (a freelance bid, types.ts gigTrackOf) gets a client
// proposal instead of a build. Read the gig, its brief and the accepted plan (none = a
// brief-only proposal that says the detailed plan follows the client's answers), hand them to
// the pinned writer (gig_proposal_cli.py, Claude Sonnet 5.5 at high effort), validate its
// plain-text answer (model.ts), render the client page (template.ts), write it atomically
// (file.ts), record it (db/gigs.ts setGigProposal), and - for a qualified gig - write the
// draft attempt (draft.ts). Then ask for the gig's report.
//
// The rules: a build-track gig is `build_track`, a gig with no brief `no_brief` (nothing is
// touched); while it runs the record says `writing`; a suspect gig never reaches a model;
// keyless / failed / unusable answers are kp's own composition (`source: "deterministic"`).

/** Kept in lockstep with gig_proposal_cli.py PROMPT_VERSION (proposal.test.ts reads both). */
export const GIG_PROPOSAL_PROMPT_VERSION = "gig-proposal-v1";
/** The pinned writer (gig_proposal_cli.py PIN; llm-pins.ts mirrors it). */
export const GIG_PROPOSAL_MODEL = "claude-sonnet-5-5";
/** One spawn's hang backstop, over the CLI's own deadline. */
export const GIG_PROPOSAL_SPAWN_TIMEOUT_MS = 6 * 60_000;
export const GIG_PROPOSAL_CLI_TIMEOUT_S = 300;
const LISTING_CHARS = 4_000;
const BRIEF_CHARS = 8_000;

export type GigProposalRunDeps = {
  runCli: CliRunner;
  proposalsRoot: () => string;
  writeFile: (file: string, html: string) => void;
  now: () => Date;
  log: (line: string, error?: unknown) => void;
};

export function defaultGigProposalRunDeps(): GigProposalRunDeps {
  return {
    runCli: runPythonCli,
    proposalsRoot: () => gigProposalsRoot(),
    writeFile: writeGigProposalFile,
    now: () => new Date(),
    log: (line, error) => (error === undefined ? console.warn(`[gigs:proposal] ${line}`) : console.error(`[gigs:proposal] ${line}`, error)),
  };
}

export type GigProposalRunResult = {
  gigId: string;
  status: "written" | "skipped" | "failed";
  reason: string | null;
  source: "llm" | "deterministic" | null;
  fallbackReason: string | null;
  costUsd: number | null;
  path: string | null;
  draft: ProposalDraftResult["status"] | null;
};

/** The task's params, re-validated (a retry replays them from the row). Null without a gig. */
export function parseGigProposalTaskParams(params: Record<string, unknown>): { gigId: string } | null {
  const gigId = typeof params.gigId === "string" && params.gigId.trim() && params.gigId.length <= 200 ? params.gigId : null;
  return gigId ? { gigId } : null;
}

const LANG = /^[a-z]{2,3}$/;

/** The CLI's input: the listing, the brief and the accepted plan, all fenced as data by the
 *  CLI; the language code and the disclosure are the only values that reach its instructions. */
export function gigProposalCliInput(gig: Gig, plan: GigPlan | null) {
  const brief = gig.brief;
  const language = brief?.language && LANG.test(brief.language) ? brief.language : "en";
  return {
    language,
    disclosure: GIG_DISCLOSURE_SENTENCE,
    listing: {
      title: gig.title,
      org: gig.org,
      excerpt: gig.bodyText.slice(0, LISTING_CHARS),
      reward: gig.reward?.text ?? null,
      deadlineAt: gig.deadlineAt,
      language: brief?.language ?? null,
      english: brief?.listingEnglish ?? null,
    },
    brief: brief
      ? {
          category: brief.category,
          difficulty: brief.difficulty,
          summary: brief.markdown.slice(0, BRIEF_CHARS),
          challenges: brief.challenges,
          missingArtifacts: brief.missingArtifacts ?? [],
          outreachMessage: brief.outreachMessage ?? null,
          effort: brief.effort,
        }
      : {},
    plan,
  };
}

function costOf(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v * 1e6) / 1e6 : null;
}

/** Write one gig's client proposal. See the header for the rules. Never throws. */
export async function runGigProposal(workspaceId: string, gigId: string, opts: { signal?: AbortSignal; deps?: Partial<GigProposalRunDeps> } = {}): Promise<GigProposalRunResult> {
  const deps: GigProposalRunDeps = { ...defaultGigProposalRunDeps(), ...opts.deps };
  const none = (status: GigProposalRunResult["status"], reason: string): GigProposalRunResult => ({ gigId, status, reason, source: null, fallbackReason: null, costUsd: null, path: null, draft: null });
  let gig: Gig | null;
  let plan: { id: string; plan: GigPlan } | null = null;
  try {
    gig = getGig(workspaceId, gigId);
    const accepted = gig ? getAcceptedGigPlan(workspaceId, gigId) : null;
    if (accepted?.plan) plan = { id: accepted.id, plan: accepted.plan };
  } catch (error) {
    deps.log(`${gigId}: could not read the gig's records`, error);
    return none("failed", "store_error");
  }
  if (!gig) return none("skipped", "not_found");
  if (gigTrackOf(gig.arena) !== "proposal") return none("skipped", "build_track");
  if (!gig.brief) return none("skipped", "no_brief");
  const path = gigProposalPathFor(deps.proposalsRoot(), gig);
  if (!path) return none("failed", "proposal_outside_root");

  const startedAt = deps.now().toISOString();
  const base: GigProposal = gig.proposal ?? { path, status: "writing", source: "deterministic", model: null, fallbackReason: null, costUsd: null, generatedAt: startedAt, planId: null, message: "", questions: [], artifacts: [] };
  try {
    setGigProposal(workspaceId, gigId, { ...base, path, status: "writing" });
  } catch (error) {
    deps.log(`${gigId}: could not mark the proposal writing`, error);
  }

  const input = gigProposalCliInput(gig, plan?.plan ?? null);
  let body: GigProposalBody | null = null;
  let fallbackReason: string | null = null;
  let costUsd: number | null = null;
  if (gig.status === "suspect" || gig.suspectReasons.length > 0) fallbackReason = "gig_suspect";
  else {
    try {
      const out = await deps.runCli({
        module: "gig_proposal_cli",
        files: { "input.json": input },
        args: (f) => ["--input-json", f["input.json"], "--timeout-s", String(GIG_PROPOSAL_CLI_TIMEOUT_S)],
        signal: opts.signal,
        llm: true,
        timeoutMs: GIG_PROPOSAL_SPAWN_TIMEOUT_MS,
      });
      costUsd = costOf(out.costUsd);
      body = out.source === "llm" ? parseGigProposalBody(out.result, { rewardText: input.listing.reward, disclosure: GIG_DISCLOSURE_SENTENCE, fallbackTitle: gig.title }) : null;
      if (!body) fallbackReason = out.source === "llm" ? "llm_unusable" : typeof out.fallbackReason === "string" && out.fallbackReason ? out.fallbackReason.slice(0, 120) : "llm_unusable";
    } catch (error) {
      fallbackReason = opts.signal?.aborted ? "aborted" : "engine_error";
      deps.log(`${gigId}: the proposal engine failed; kp composes the proposal itself`, error);
    }
  }
  const source: "llm" | "deterministic" = body ? "llm" : "deterministic";
  const final = body ?? deterministicProposal(gig, plan?.plan ?? null, GIG_DISCLOSURE_SENTENCE);
  const generatedAt = deps.now().toISOString();
  const html = renderGigProposalPage({ body: final, language: body ? input.language : "en", generatedAt, disclosure: GIG_DISCLOSURE_SENTENCE });
  try {
    deps.writeFile(path, html);
  } catch (error) {
    deps.log(`${gigId}: could not write the proposal file`, error);
    try {
      setGigProposal(workspaceId, gigId, { ...base, path, status: "failed", fallbackReason: "write_failed", costUsd });
    } catch (storeError) {
      deps.log(`${gigId}: could not record the failed proposal`, storeError);
    }
    return { gigId, status: "failed", reason: "write_failed", source, fallbackReason: "write_failed", costUsd, path, draft: null };
  }
  const record: GigProposal = {
    path,
    status: "ready",
    source,
    model: body ? GIG_PROPOSAL_MODEL : null,
    fallbackReason: body ? null : fallbackReason,
    costUsd,
    generatedAt,
    planId: plan?.id ?? null,
    message: final.message,
    questions: final.questions,
    artifacts: final.artifacts,
  };
  try {
    setGigProposal(workspaceId, gigId, record);
  } catch (error) {
    deps.log(`${gigId}: the proposal was written but its record was not`, error);
  }
  const draft = writeProposalDraft(workspaceId, gigId, proposalDeliverable(final, path, GIG_DISCLOSURE_SENTENCE), costUsd, deps.log);
  // The gig's report (report/trigger.ts): best-effort; the runner reads the stage the records say.
  requestGigReport(workspaceId, gigId, "drafted");
  return { gigId, status: "written", reason: null, source, fallbackReason: record.fallbackReason, costUsd, path, draft: draft.status };
}
