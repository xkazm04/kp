import {
  approveLifecycleCase,
  createPipelineEntry,
  getDevCase,
  getLifecycle,
  listSubmissions,
  saveDevCaseScenario,
  saveDevCaseSeed,
  updateLifecycle,
  type LifecycleAnalysis,
} from "./db";
import {
  mintObservedFromSubmission,
  promoteSubmission,
  runDesignArtifacts,
  runEvaluateSubmission,
  runInterviewScenario,
  runMaterializeSeed,
  runNeedAnalysis,
  runSourceForRole,
} from "./devcase-run";
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

function gateApproval(analysis: LifecycleAnalysis | null): { pass: boolean; reason: string } {
  const conf = analysis?.confidence ?? 0;
  if (conf < DEV_POLICY.autoApproveMinConfidence) {
    return { pass: false, reason: `low grounding confidence (${Math.round(conf * 100)}%) — human review` };
  }
  // Fail closed: a missing/non-array reality-reflection field means "we don't know how many
  // reality gaps there are", NOT "verified zero". The old `?? 0` conflated absent with clean,
  // letting an ungrounded design auto-publish on confidence alone — eroding the human gate.
  const gapsField = analysis?.statedVsRealGaps;
  if (!Array.isArray(gapsField)) {
    return { pass: false, reason: "reality reflection incomplete — human review before publishing" };
  }
  if (gapsField.length > DEV_POLICY.autoApproveMaxGaps) {
    return { pass: false, reason: `${gapsField.length} stated-vs-real gaps — human review before publishing` };
  }
  return { pass: true, reason: "clean (auto-approved)" };
}

type Progress = (done: number, total: number, msg?: string) => void;

const STAGES = ["intake", "analyzed", "designed", "awaiting_approval", "approved", "published", "collecting", "ranked", "promoted", "closed"];

// Safety bound on the drive loop below. Every iteration either returns or advances the
// lifecycle one position forward through STAGES — the walk is monotonic and acyclic (no
// stage transition ever moves backward), so a healthy run reaches a return within at most
// STAGES.length iterations (in practice fewer, since several stages are return-only).
// Deriving the bound from STAGES rather than a magic literal keeps it from drifting if a
// stage is ever added. Reaching the bound is therefore NOT a normal outcome: it means a
// handled stage ran without advancing — a bug — which the loop tail surfaces loudly.
const MAX_LIFECYCLE_STEPS = STAGES.length;

// Drive a lifecycle from its current stage as far as policy + readiness allow, stopping at a
// human gate (awaiting_approval), at collecting (no submissions yet), or at promoted (done).
export async function runLifecycle(id: string, progress?: Progress, signal?: AbortSignal): Promise<{ stage: string; detail: string }> {
  for (let step = 0; step < MAX_LIFECYCLE_STEPS; step += 1) {
    // Stop advancing on cancel (the heaviest steps — analyze/design — also forward
    // the signal so their Python child is killed; the loop break stops further stages).
    if (signal?.aborted) return { stage: getLifecycle(id)?.stage ?? "unknown", detail: "canceled" };
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
      if (!lc.need) throw new Error("lifecycle has no need to analyze");
      const { analysis } = await runNeedAnalysis(lc.need, signal);
      updateLifecycle(id, { stage: "analyzed", analysis, detail: "reality reflection done" });
      recordAudit({ lifecycleId: id, actor: "auto", action: "analyzed", reason: lc.title ?? undefined });
    } else if (lc.stage === "analyzed") {
      if (!lc.need) throw new Error("lifecycle has no need to design from");
      // DEVP5 — render the candidate-facing case brief/tasks in the lifecycle's language.
      const { role, case: kase } = await runDesignArtifacts(lc.need, lc.analysis ?? {}, signal, undefined, lc.lang);
      updateLifecycle(id, { stage: "designed", role, case: kase, detail: "role + assignment designed" });
      recordAudit({ lifecycleId: id, actor: "auto", action: "designed" });
    } else if (lc.stage === "designed") {
      const gate = gateApproval(lc.analysis);
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
      // Idempotent publish. publish() mints a NEW posting + token with no caseId dedup
      // (createPosting), so a crash/restart between here and the stage→collecting write
      // below would re-run this handler and orphan a DUPLICATE posting — submissions on
      // the earlier still-live token then disconnect from the lifecycle. If a prior run
      // already published, reuse its postingId; otherwise publish once and persist the id
      // IMMEDIATELY (before the long best-effort scenario/seed/sourcing steps) so a resume
      // skips re-publishing. (Sourcing re-runs are safe — createPipelineEntry dedups on
      // the stable dc-<caseId> jobId.)
      let postingId = lc.postingId;
      if (!postingId) {
        const posting = await getAdapter("local").publish(devCase);
        postingId = posting.id;
        updateLifecycle(id, { postingId });
      }

      // Case-designed interview: turn the approved case into the role's
      // AI-interview scenario (one per role, reused for every candidate so
      // ratings stay comparable). Best-effort — a scenario failure must never
      // block publishing; early-career interviews fall back to the generic script.
      let scenarioNote = "";
      try {
        const { scenario } = await runInterviewScenario(
          (devCase.case as Record<string, unknown>) ?? {},
          lc.role ?? {},
          lc.lang
        );
        saveDevCaseScenario(devCase.id, scenario);
        scenarioNote = "; interview scenario ready";
        recordAudit({ lifecycleId: id, actor: "auto", action: "interview_scenario", ref: devCase.id });
      } catch {
        /* interviews fall back to the generic early-career script */
      }

      // Materialized seed: the case's prose starting materials become a concrete
      // starter file tree (one per case, shared by every candidate) — the
      // anti-essay-grading half of the take-home hardening. Best-effort: a
      // materialization failure must never block publishing; the case simply
      // ships with prose materials as before.
      try {
        const { seed } = await runMaterializeSeed((devCase.case as Record<string, unknown>) ?? {}, lc.role ?? {}, lc.lang);
        saveDevCaseSeed(devCase.id, seed);
        scenarioNote += "; seed materialized";
        recordAudit({ lifecycleId: id, actor: "auto", action: "seed_materialized", ref: devCase.id });
      } catch {
        /* the case ships with prose starting materials as before */
      }

      // Proactive sourcing: rank the existing candidate DB against the role and seed the
      // pipeline at the Accepted stage — so the role finds candidates, not only waits for them.
      let sourced = 0;
      let skipped = 0;
      let sourcingError: string | null = null;
      try {
        const roleTitle = lc.role?.title ?? lc.title ?? "Dev case";
        const outcome = await runSourceForRole(lc.role ?? {});
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
            // d95fed6d — origin marker for case-sourced candidates.
            sourceChannel: "devcase",
          });
          sourced += 1;
        }
      } catch (err) {
        // Sourcing is best-effort — never block publishing — but record the failure so a real
        // crash (e.g. the matching bridge threw) is distinguishable from a legitimately empty
        // result, instead of hiding behind a benign-looking "sourced 0 candidate(s)".
        sourcingError = err instanceof Error ? err.message : String(err);
        recordAudit({ lifecycleId: id, actor: "system", action: "sourcing_failed", reason: sourcingError, ref: postingId });
      }
      // Note unparseable candidates in the detail so "sourced 0" reads as "nobody
      // qualified", not "the pool silently failed to load" — and a real sourcing
      // CRASH stays distinguishable from a legitimately empty result.
      const skippedNote = skipped > 0 ? `; ${skipped} candidate(s) skipped (unparseable)` : "";
      const sourcedDetail = sourcingError
        ? `published${scenarioNote}; sourced ${sourced} candidate(s) before sourcing failed (${sourcingError}); awaiting submissions`
        : `published${scenarioNote}; sourced ${sourced} candidate(s) into the pipeline${skippedNote}; awaiting submissions`;
      updateLifecycle(id, {
        stage: "collecting",
        postingId,
        detail: sourcedDetail,
      });
      recordAudit({
        lifecycleId: id,
        actor: "auto",
        action: "published",
        reason: sourcingError ? `sourcing failed after ${sourced} (${sourcingError})` : `sourced ${sourced} into pipeline`,
        ref: postingId,
      });
    } else if (lc.stage === "collecting") {
      const subs = lc.postingId ? listSubmissions(lc.postingId) : [];
      if (subs.length === 0) return { stage: "collecting", detail: "awaiting submissions" };
      const todo = subs.filter((s) => !s.evaluation);
      let done = 0;
      let failed = 0;
      for (const s of todo) {
        try {
          await runEvaluateSubmission(s.id);
        } catch (err) {
          // Keep going; a failed eval shouldn't block the batch — but record it so a crash is
          // distinguishable from a legitimately unscored submission, and count it for the detail.
          failed += 1;
          recordAudit({
            lifecycleId: id,
            actor: "system",
            action: "eval_failed",
            reason: err instanceof Error ? err.message : String(err),
            ref: s.id,
          });
        }
        progress?.(STAGES.indexOf("collecting"), STAGES.length, `evaluating ${++done}/${todo.length}`);
      }
      const evalDetail =
        failed > 0
          ? `evaluated ${todo.length - failed}, ${failed} failed (of ${subs.length} submission(s))`
          : `evaluated ${subs.length} submission(s)`;
      updateLifecycle(id, { stage: "ranked", detail: evalDetail });
      recordAudit({ lifecycleId: id, actor: "auto", action: "evaluated", reason: evalDetail });
    } else if (lc.stage === "ranked") {
      // Floor is calibration-adjustable (Direction E): a human applies an outcome-driven
      // suggestion via dev_control; we fall back to the DEV_POLICY default when unset.
      const floor = getPromoteFloor() ?? DEV_POLICY.promoteFloor;
      const ranked = (lc.postingId ? listSubmissions(lc.postingId) : [])
        .filter((s) => (s.transferScore ?? 0) >= floor)
        .sort((a, b) => (b.transferScore ?? 0) - (a.transferScore ?? 0))
        .slice(0, DEV_POLICY.promoteTopN);
      const roleTitle = lc.role?.title ?? lc.title ?? "the role";
      let promoted = 0;
      for (const s of ranked) {
        const entryId = promoteSubmission(s.id);
        if (!entryId) continue;
        promoted += 1;
        // Take-home -> observed bridge: a promoted submission already cleared the
        // transfer floor, so when its candidateRef resolves to a saved profile the
        // demonstrated skills become observed-provenance evidence. Best-effort
        // enrichment — a minting failure must never block the promotion batch.
        try {
          await mintObservedFromSubmission(s.id, entryId);
        } catch {
          /* minting is enrichment, not a gate */
        }
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
  // Step budget exhausted. A handled stage ran without advancing or returning, so the walk
  // would have spun forever without the bound above. This is a bug, not a terminal state —
  // and it is dangerous to swallow: control reconcile (api/devcase/control) treats only
  // promoted/closed/awaiting_approval as terminal, so returning a quiet "success" here strands
  // the run permanently non-terminal yet making no progress, with no audit trail an operator
  // could act on.
  //
  // Decision — error, do NOT auto-schedule a retry. We record an audit row (the durable,
  // operator-visible signal) and then throw, which the task runner turns into a `failed` task
  // visible in the Background-tasks view. Auto-retrying would just re-run the same stuck stage
  // and exhaust the budget again in an endless loop; instead a human can hit `reconcile` to
  // retry once they believe the underlying stage bug is fixed (a budget-exhausted run is still
  // non-terminal, so reconcile will re-enqueue it on demand).
  const lc = getLifecycle(id);
  const stage = lc?.stage ?? "unknown";
  recordAudit({
    lifecycleId: id,
    actor: "system",
    action: "step_budget_exhausted",
    reason: `stuck at stage "${stage}" — ${MAX_LIFECYCLE_STEPS}-step budget exhausted without advancing`,
  });
  throw new Error(
    `lifecycle ${id} stuck at stage "${stage}": ${MAX_LIFECYCLE_STEPS}-step budget exhausted without advancing`
  );
}
