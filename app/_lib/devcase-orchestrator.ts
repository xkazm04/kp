import {
  approveLifecycleCase,
  createPipelineEntry,
  getDevCase,
  getLifecycle,
  listSubmissions,
  updateLifecycle,
} from "./db";
import { promoteSubmission, runDesignArtifacts, runEvaluateSubmission, runNeedAnalysis, runSourceForRole, type DevNeed } from "./devcase-run";
import { getAdapter } from "./distribution";
import { sendComm } from "./comms";
import { getAutonomy, getPromoteFloor, recordAudit } from "./dev-control";

// Direction A — the lifecycle orchestrator. Drives a dev case through its stages under
// policy, with human gates where policy requires. Each long step reuses the existing
// run* cores; the whole walk runs inside one resumable `lifecycle` background task.

// The control surface: how autonomous the pipeline is. Tunable like the automation POLICY.
export const DEV_POLICY = {
  autoApproveMaxGaps: 1, // auto-approve a design only if reality reflection found <= this many gaps
  autoApproveMinConfidence: 0.5, // ...and the analysis is at least this confident
  promoteFloor: 55, // a submission must score at least this to be promotable
  promoteTopN: 3, // promote at most this many per posting
};

type Analysis = { statedVsRealGaps?: string[]; confidence?: number };

function gateApproval(analysis: Analysis | null): { pass: boolean; reason: string } {
  const gaps = analysis?.statedVsRealGaps?.length ?? 0;
  const conf = analysis?.confidence ?? 0;
  if (conf < DEV_POLICY.autoApproveMinConfidence) {
    return { pass: false, reason: `low grounding confidence (${Math.round(conf * 100)}%) — human review` };
  }
  if (gaps > DEV_POLICY.autoApproveMaxGaps) {
    return { pass: false, reason: `${gaps} stated-vs-real gaps — human review before publishing` };
  }
  return { pass: true, reason: "clean (auto-approved)" };
}

type Progress = (done: number, total: number, msg?: string) => void;

const STAGES = ["intake", "analyzed", "designed", "awaiting_approval", "approved", "published", "collecting", "ranked", "promoted", "closed"];

// Drive a lifecycle from its current stage as far as policy + readiness allow, stopping at a
// human gate (awaiting_approval), at collecting (no submissions yet), or at promoted (done).
export async function runLifecycle(id: string, progress?: Progress): Promise<{ stage: string; detail: string }> {
  for (let step = 0; step < 16; step += 1) {
    const lc = getLifecycle(id);
    if (!lc) throw new Error("lifecycle not found");
    const pct = (s: string) => progress?.(Math.max(0, STAGES.indexOf(s)), STAGES.length, s);
    pct(lc.stage);

    // Kill switch: when paused, halt auto-advancement (human oversight requirement).
    if (getAutonomy() === "paused" && lc.stage !== "promoted") {
      recordAudit({ lifecycleId: id, actor: "system", action: "halted", reason: "automation paused by operator" });
      return { stage: lc.stage, detail: "halted — automation paused" };
    }

    if (lc.stage === "intake") {
      const { analysis } = await runNeedAnalysis(lc.need as DevNeed);
      updateLifecycle(id, { stage: "analyzed", analysis, detail: "reality reflection done" });
      recordAudit({ lifecycleId: id, actor: "auto", action: "analyzed", reason: lc.title ?? undefined });
    } else if (lc.stage === "analyzed") {
      const { role, case: kase } = await runDesignArtifacts(lc.need as DevNeed, (lc.analysis as Record<string, unknown>) ?? {});
      updateLifecycle(id, { stage: "designed", role, case: kase, detail: "role + assignment designed" });
      recordAudit({ lifecycleId: id, actor: "auto", action: "designed" });
    } else if (lc.stage === "designed") {
      const gate = gateApproval(lc.analysis as Analysis | null);
      if (lc.auto && gate.pass) {
        const { caseId } = approveLifecycleCase(id, lc, gate.reason);
        recordAudit({ lifecycleId: id, actor: "auto", action: "auto_approved", reason: gate.reason, ref: caseId });
      } else {
        updateLifecycle(id, { stage: "awaiting_approval", detail: gate.reason });
        recordAudit({ lifecycleId: id, actor: "auto", action: "routed_to_human", reason: gate.reason });
        return { stage: "awaiting_approval", detail: gate.reason };
      }
    } else if (lc.stage === "approved") {
      const devCase = lc.caseId ? getDevCase(lc.caseId) : null;
      if (!devCase) throw new Error("approved lifecycle has no dev case");
      const posting = await getAdapter("local").publish(devCase);

      // Proactive sourcing: rank the existing candidate DB against the role and seed the
      // pipeline at the Accepted stage — so the role finds candidates, not only waits for them.
      let sourced = 0;
      let skipped = 0;
      try {
        const roleTitle = (lc.role as { title?: string } | null)?.title ?? lc.title ?? "Dev case";
        const outcome = await runSourceForRole((lc.role as Record<string, unknown>) ?? {});
        skipped = outcome.skipped;
        for (const m of outcome.candidates) {
          if (!m.candidateId) continue;
          createPipelineEntry({
            candidateId: m.candidateId,
            candidateLabel: m.label,
            archetype: m.archetype,
            roleFamily: "software_engineering",
            jobId: `dc-${lc.caseId}`,
            jobTitle: roleTitle,
            matchScore: m.score,
            stage: "Accepted",
          });
          sourced += 1;
        }
      } catch {
        /* sourcing is best-effort — never block publishing */
      }
      // Note unparseable candidates in the detail so "sourced 0" reads as "nobody qualified",
      // not "the pool silently failed to load".
      const skippedNote = skipped > 0 ? `; ${skipped} candidate(s) skipped (unparseable)` : "";
      updateLifecycle(id, {
        stage: "collecting",
        postingId: posting.id,
        detail: `published; sourced ${sourced} candidate(s) into the pipeline${skippedNote}; awaiting submissions`,
      });
      recordAudit({ lifecycleId: id, actor: "auto", action: "published", reason: `sourced ${sourced} into pipeline`, ref: posting.id });
    } else if (lc.stage === "collecting") {
      const subs = lc.postingId ? listSubmissions(lc.postingId) : [];
      if (subs.length === 0) return { stage: "collecting", detail: "awaiting submissions" };
      const todo = subs.filter((s) => !s.evaluation);
      let done = 0;
      for (const s of todo) {
        try {
          await runEvaluateSubmission(s.id);
        } catch {
          /* keep going; a failed eval shouldn't block the batch */
        }
        progress?.(STAGES.indexOf("collecting"), STAGES.length, `evaluating ${++done}/${todo.length}`);
      }
      updateLifecycle(id, { stage: "ranked", detail: `evaluated ${subs.length} submission(s)` });
      recordAudit({ lifecycleId: id, actor: "auto", action: "evaluated", reason: `${subs.length} submission(s)` });
    } else if (lc.stage === "ranked") {
      // Floor is calibration-adjustable (Direction E): a human applies an outcome-driven
      // suggestion via dev_control; we fall back to the DEV_POLICY default when unset.
      const floor = getPromoteFloor() ?? DEV_POLICY.promoteFloor;
      const ranked = (lc.postingId ? listSubmissions(lc.postingId) : [])
        .filter((s) => (s.transferScore ?? 0) >= floor)
        .sort((a, b) => (b.transferScore ?? 0) - (a.transferScore ?? 0))
        .slice(0, DEV_POLICY.promoteTopN);
      const roleTitle = (lc.role as { title?: string } | null)?.title ?? lc.title ?? "the role";
      let promoted = 0;
      for (const s of ranked) {
        if (!promoteSubmission(s.id)) continue;
        promoted += 1;
        // Non-adverse comm — safe to automate. Adverse actions (rejections) stay human-gated.
        await sendComm({
          to: s.contact || s.candidateRef || "candidate",
          subject: `Next step — ${roleTitle}`,
          body: `Hi ${s.candidateRef},\n\nYour submission for ${roleTitle} stood out (fit ${s.transferScore ?? "—"}/100) and we'd like to take it forward. We'll be in touch with next steps shortly.\n\nBest,\nThe hiring team`,
          kind: "invite",
          ref: s.id,
        });
      }
      const detail = `promoted ${promoted}/${DEV_POLICY.promoteTopN} (floor ${floor}) to the pipeline`;
      updateLifecycle(id, { stage: "promoted", detail });
      recordAudit({ lifecycleId: id, actor: "auto", action: "promoted", reason: detail });
      return { stage: "promoted", detail };
    } else {
      return { stage: lc.stage, detail: lc.detail ?? "" };
    }
  }
  const lc = getLifecycle(id);
  return { stage: lc?.stage ?? "unknown", detail: "step budget exhausted" };
}
