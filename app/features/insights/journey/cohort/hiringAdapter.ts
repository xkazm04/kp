import type { JourneyCohort, JourneyCohortOutcome } from "@/app/_lib/journey/types";
import type { SpineInstance, SpineStep } from "./spine";

/**
 * Hiring journeys -> Spine instances.
 *
 * The first layer is the pipeline's stages, not its 30-odd event kinds: source, screen,
 * interview, offer, onboard. Events interleave too finely for an order to exist between all
 * of them (a reminder, a hold, a reinstatement); stages do have one. The board below keeps
 * every event kind for the person who descends into one role.
 */

export const HIRING_STAGES = ["source", "screen", "interview", "offer", "onboard"] as const;
export type HiringStage = (typeof HIRING_STAGES)[number];

const STAGE_OF: Record<string, HiringStage> = {
  matched: "source", applied: "source", added: "source", outreach_sent: "source", acknowledgement_sent: "source",
  moved: "source", consent_recorded: "source",
  advanced: "screen", auto_advanced: "screen", auto_rejected: "screen", screening_hold: "screen", reinstated: "screen",
  rematched: "screen", rematched_from: "screen", group_eval: "screen", human_round_queued: "screen",
  intake_degraded: "screen", decision_sealed: "screen", case_opened: "screen", case_submitted: "screen",
  interview_prep_generated: "interview", schedule_invite_sent: "interview", interview_scheduled: "interview",
  scheduled: "interview", interview_reminder_sent: "interview", interview_started: "interview",
  interview_completed: "interview", interview_scorecard: "interview", interview_session: "interview",
  offer_drafted: "offer", offer_sent: "offer", offer_reminder_sent: "offer", offer_expired: "offer", offer_accepted: "offer",
  onboarding_started: "onboard", onboarding_intake_submitted: "onboard",
};

/** The stage an event kind files under, or undefined for a kind that is no stage (an analysis,
 *  a decision marker). Read by the cohort below and by the kit lane board's steps, so the two
 *  layers of the Journeys overlay file every kind under the same stage. */
export function hiringStageOf(kind: string): HiringStage | undefined {
  return STAGE_OF[kind];
}

/** Events that are friction by themselves: a hold, a chase, a lapse, a re-route. */
const FRICTION = new Set(["screening_hold", "interview_reminder_sent", "offer_reminder_sent", "offer_expired",
  "intake_degraded", "reinstated", "rematched_from", "moved"]);

/** A rejection is a decision, not a failure of the process; a lapse is. */
export const hiringFailure = (o: string) => o === "withdrawn" || o === "stalled";
export const HIRING_OUTCOMES: JourneyCohortOutcome[] = ["hired", "open", "rejected", "rematched", "withdrawn", "stalled"];

export interface HiringInstance extends SpineInstance {
  jobId: string;
}

export function hiringInstances(cohort: JourneyCohort): HiringInstance[] {
  return cohort.instances.map((j) => {
    const steps: SpineStep[] = [];
    let t0: number | null = null;
    for (const s of j.steps) {
      const stage = STAGE_OF[s.kind];
      const friction = FRICTION.has(s.kind);
      // Decision markers (rejected, rejection_sent, withdrawn) end a journey; they are its
      // outcome, not a stage it passed through. An `analysis` is attached, not taken: a CV
      // analysed years before the candidate entered this pipeline would start the clock then.
      if (!stage) continue;
      const at = Date.parse(s.at);
      t0 ??= at;
      steps.push({ k: stage, t: (at - t0) / 1000, err: 0, friction });
    }
    return { id: j.id, group: j.jobId, jobId: j.jobId, outcome: j.outcome, steps };
  });
}
