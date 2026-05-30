import {
  createPipelineEntry,
  getDevCase,
  getLifecycle,
  listSubmissions,
  saveDevCase,
  updateLifecycle,
  type LifecycleRecord,
} from "./db";
import { promoteSubmission, runDesignArtifacts, runEvaluateSubmission, runNeedAnalysis, runSourceForRole, type DevNeed } from "./devcase-run";
import { getAdapter } from "./distribution";
import { sendComm } from "./comms";

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

    if (lc.stage === "intake") {
      const { analysis } = await runNeedAnalysis(lc.need as DevNeed);
      updateLifecycle(id, { stage: "analyzed", analysis, detail: "reality reflection done" });
    } else if (lc.stage === "analyzed") {
      const { role, case: kase } = await runDesignArtifacts(lc.need as DevNeed, (lc.analysis as Record<string, unknown>) ?? {});
      updateLifecycle(id, { stage: "designed", role, case: kase, detail: "role + assignment designed" });
    } else if (lc.stage === "designed") {
      const gate = gateApproval(lc.analysis as Analysis | null);
      if (lc.auto && gate.pass) {
        const saved = saveDevCase({ need: lc.need, analysis: lc.analysis, role: lc.role as Record<string, unknown>, case: lc.case as Record<string, unknown> });
        updateLifecycle(id, { stage: "approved", caseId: saved.id, detail: gate.reason });
      } else {
        updateLifecycle(id, { stage: "awaiting_approval", detail: gate.reason });
        return { stage: "awaiting_approval", detail: gate.reason };
      }
    } else if (lc.stage === "approved") {
      const devCase = lc.caseId ? getDevCase(lc.caseId) : null;
      if (!devCase) throw new Error("approved lifecycle has no dev case");
      const posting = await getAdapter("local").publish(devCase);

      // Proactive sourcing: rank the existing candidate DB against the role and seed the
      // pipeline at the Sourced stage — so the role finds candidates, not only waits for them.
      let sourced = 0;
      try {
        const roleTitle = (lc.role as { title?: string } | null)?.title ?? lc.title ?? "Dev case";
        for (const m of await runSourceForRole((lc.role as Record<string, unknown>) ?? {})) {
          if (!m.candidateId) continue;
          createPipelineEntry({
            candidateId: m.candidateId,
            candidateLabel: m.label,
            archetype: m.archetype,
            roleFamily: "software_engineering",
            jobId: `dc-${lc.caseId}`,
            jobTitle: roleTitle,
            matchScore: m.score,
            stage: "Sourced",
          });
          sourced += 1;
        }
      } catch {
        /* sourcing is best-effort — never block publishing */
      }
      updateLifecycle(id, {
        stage: "collecting",
        postingId: posting.id,
        detail: `published; sourced ${sourced} candidate(s) into the pipeline; awaiting submissions`,
      });
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
    } else if (lc.stage === "ranked") {
      const ranked = (lc.postingId ? listSubmissions(lc.postingId) : [])
        .filter((s) => (s.transferScore ?? 0) >= DEV_POLICY.promoteFloor)
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
      const detail = `promoted ${promoted}/${DEV_POLICY.promoteTopN} (floor ${DEV_POLICY.promoteFloor}) to the pipeline`;
      updateLifecycle(id, { stage: "promoted", detail });
      return { stage: "promoted", detail };
    } else {
      return { stage: lc.stage, detail: lc.detail ?? "" };
    }
  }
  const lc = getLifecycle(id);
  return { stage: lc?.stage ?? "unknown", detail: "step budget exhausted" };
}

// Human gate resume: approve the designed artifacts, then continue the walk.
export async function approveLifecycle(id: string, progress?: Progress): Promise<{ stage: string; detail: string }> {
  const lc = getLifecycle(id);
  if (!lc) throw new Error("lifecycle not found");
  if (lc.stage === "awaiting_approval" || lc.stage === "designed") {
    const saved = saveDevCase({ need: lc.need, analysis: lc.analysis, role: lc.role as Record<string, unknown>, case: lc.case as Record<string, unknown> });
    updateLifecycle(id, { stage: "approved", caseId: saved.id, detail: "approved by a human" });
  }
  return runLifecycle(id, progress);
}
