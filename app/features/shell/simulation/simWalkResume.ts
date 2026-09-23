// Where a reloaded walk picks up, read off the BOARD rather than out of browser memory.
//
// The walk's progress already lives on the server: the (SIM) job and its entries
// survive a reload, a crashed tab or a presenter who navigated away. What did not
// survive was the walk's own idea of where it was (closure locals in run()), and the
// only way back in was chapter one, whose first act is a purge. So the console that
// correctly surfaced the residue offered exactly two buttons, and both deleted it.
//
// The guided-tours rule is the opposite: progress persists and resume is the default,
// and a resume RE-VALIDATES rather than repainting saved state. The board is the
// validated record. `resumePointOf` finds the (SIM) job, the candidate the walk was
// following and the first chapter whose postcondition the board does not yet show,
// every stage resolved by ROLE from the live axis, the way the walk itself resolves
// them (useSimulationWalk: stageWithRole / screenedLandingStage).
//
// Pure: no React, no fetch. The provider reads the board once and hands it in.
import { compareByMatchScoreDesc } from "@/app/_lib/match-score";
import { screenedLandingStage, stageHasRole, stageIndex, stageWithRole, type StageDef } from "@/app/_lib/pipeline-stages";
import { isSimTitle, type SimPhaseId } from "./constants";
import { SIM_CHAPTERS, type SimChapter } from "./simWalkSteps";

/** The board fields a resume point is derived from: a subset of PipelineEntryView,
 *  declared structurally so a test (or a caller) never has to build a whole row. */
export type ResumeEntry = {
  id: string;
  candidateLabel: string;
  jobId: string | null;
  jobTitle: string | null;
  stage: string;
  status: string;
  approvalKind: string | null;
  matchScore: number | null;
  createdAt: string | null;
};

/** Where a walk re-enters: the chapter to run first, and the context the chapters
 *  after it need (the job, and from the screen chapter on, the followed candidate). */
export type SimResumePoint = {
  phase: SimPhaseId;
  jobId: string;
  targetId?: string;
  targetLabel?: string;
};

/** Why there is no resume point. `empty`: the board holds no (SIM) walk, Start is the
 *  action. `complete`: the walk reached Hired, Reset is the action (resuming a
 *  finished run would replay a hire that already happened). */
export type SimResumeRead =
  | { point: SimResumePoint; reason: null }
  | { point: null; reason: "empty" | "complete" };

/** An entry the walk can still follow. A rejected, declined or closed entry is part
 *  of the story the board tells, never the candidate being walked to Hired. */
const followable = (e: ResumeEntry) => e.status === "active";

/** Read the board: the resume point, or why there is none. */
export function readResume(board: { entries: readonly ResumeEntry[]; axis: readonly StageDef[] }): SimResumeRead {
  const { axis } = board;
  // Only the walk's OWN rows. A real candidate standing on the offer column is the
  // operator's hiring, and must never become the subject of a scripted accept.
  const sim = board.entries.filter((e) => isSimTitle(e.jobTitle) && e.jobId);
  if (sim.length === 0) return { point: null, reason: "empty" };

  // The walk's job: the one its newest row belongs to. One run makes one job; more
  // than one (SIM) job only happens after a purge failed, and the newest is the walk
  // the console was last showing.
  const newest = [...sim].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))[0];
  const jobId = newest.jobId as string;
  const job = sim.filter((e) => e.jobId === jobId);

  if (job.some((e) => stageHasRole(e.stage, "terminal", axis))) return { point: null, reason: "complete" };

  // On-axis, still in play. An entry on a retired column has no chapter to map to.
  const live = job.filter((e) => followable(e) && stageIndex(e.stage, axis) >= 0);
  if (live.length === 0) return { point: null, reason: "empty" };

  const entryStage = stageWithRole("entry", axis);
  const screened = screenedLandingStage(axis);
  const screenedIdx = stageIndex(screened, axis);
  const offerStage = stageWithRole("offer", axis);
  const offerIdx = offerStage ? stageIndex(offerStage, axis) : axis.length;

  // Nobody has left the entry column: the pool is sourced, matching has not run.
  if (live.every((e) => e.stage === entryStage || stageIndex(e.stage, axis) < screenedIdx)) {
    return { point: { phase: "match", jobId }, reason: null };
  }

  // The followed candidate is the one furthest along; on the screened column itself
  // that is the walk's own pick (topScreened: best match first, unscored last).
  const furthest = Math.max(...live.map((e) => stageIndex(e.stage, axis)));
  const target = live.filter((e) => stageIndex(e.stage, axis) === furthest).sort(compareByMatchScoreDesc)[0];
  const followed = { jobId, targetId: target.id, targetLabel: target.candidateLabel };

  if (furthest <= screenedIdx) return { point: { phase: "screen", ...followed }, reason: null };
  if (furthest < offerIdx) return { point: { phase: "interview", ...followed }, reason: null };
  // On the offer column: a drafted offer still waiting on the recruiter is the offer
  // chapter; no approval left means it was sent, and the candidate's accept is next.
  if (target.approvalKind === null) return { point: { phase: "hired", ...followed }, reason: null };
  return { point: { phase: "offer", ...followed }, reason: null };
}

/** The resume point, or null when there is nothing to resume (see readResume for why). */
export function resumePointOf(board: { entries: readonly ResumeEntry[]; axis: readonly StageDef[] }): SimResumePoint | null {
  return readResume(board).point;
}

/** The chapters a walk entering at `phase` runs, in SIM_CHAPTERS order. Throws on an
 *  unknown id: a resume that silently ran nothing would narrate a finished walk. */
export function chaptersFrom(phase: SimPhaseId): SimChapter[] {
  const i = SIM_CHAPTERS.findIndex((c) => c.id === phase);
  if (i < 0) throw new Error(`unknown sim chapter: ${phase}`);
  return SIM_CHAPTERS.slice(i);
}
