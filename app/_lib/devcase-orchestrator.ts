import { approveLifecycleCase, getDevCase, getDevCaseBaseline, getLifecycle, listSubmissions, saveDevCaseBaselineIfAbsent, saveDevCaseScenarioIfAbsent, saveDevCaseSeedIfAbsent, updateLifecycle, type LifecycleAnalysis } from "./db/devcase";
import {
  mintObservedFromSubmission,
  promoteSubmission,
  runBaselineSolve,
  runDesignArtifacts,
  runEvaluateSubmission,
  runInterviewScenario,
  runMaterializeSeed,
  runNeedAnalysis,
  runSourceForRole,
  seedPipelineFromMatches,
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

// THE promote-floor resolution: a human's outcome-driven calibration (dev_control)
// when set, else the DEV_POLICY default. getPromoteFloor returns null when unset
// by design, so the fallback is load-bearing and co-located with the default here.
// Shared by the orchestrator's ranked stage and the outcomes route so the floor the
// pipeline promotes against can never diverge from the one the calibration UI shows.
export const activePromoteFloor = (): number => getPromoteFloor() ?? DEV_POLICY.promoteFloor;

function gateApproval(analysis: LifecycleAnalysis | null, designCase?: Record<string, unknown> | null): { pass: boolean; reason: string } {
  // Design provenance: auto-publish only a genuinely LLM-grounded case. If the design
  // step FELL BACK to a deterministic template (source != "llm"), confidence in the
  // unrelated need-analysis must not auto-ship a generic assignment presented as a
  // bespoke, codebase-grounded case. Mirror the CaseDetail degradation semantics
  // (a KNOWN non-llm source is degraded; an absent/unrecorded source isn't blocked).
  const designSource = designCase?.designSource;
  if (typeof designSource === "string" && designSource !== "llm") {
    return { pass: false, reason: `design degraded to a ${designSource} template (not LLM-grounded) — human review before publishing` };
  }
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

// The stages where a lifecycle sits at the human review gate (a designed case
// waiting for approve / redesign). Co-located with STAGES so adding a third
// reviewable stage updates this domain set in one place — the approve and
// redesign routes both gate on it, so they can't desync.
const REVIEW_GATE_STAGES = new Set(["awaiting_approval", "designed"]);
export const isAtReviewGate = (stage: string): boolean => REVIEW_GATE_STAGES.has(stage);

// Safety bound on the drive loop below. Every iteration either returns or advances the
// lifecycle one position forward through STAGES — the walk is monotonic and acyclic (no
// stage transition ever moves backward), so a healthy run reaches a return within at most
// STAGES.length iterations (in practice fewer, since several stages are return-only).
// Deriving the bound from STAGES rather than a magic literal keeps it from drifting if a
// stage is ever added. Reaching the bound is therefore NOT a normal outcome: it means a
// handled stage ran without advancing — a bug — which the loop tail surfaces loudly.
const MAX_LIFECYCLE_STEPS = STAGES.length;

// Bound on the collecting handler's drain-with-recheck inner loop (see below). Each
// pass evaluates every not-yet-attempted submission, so a pass only repeats when a
// genuinely-new submission arrived mid-evaluation; this caps a pathological flood
// within one step rather than letting it spin. Generous — real postings see far
// fewer late waves than this.
const MAX_COLLECT_PASSES = 50;

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
      const design = await runDesignArtifacts(lc.need, lc.analysis ?? {}, signal, undefined, lc.lang);
      // Persist the DESIGN step's provenance onto the case so the auto-approve gate can
      // see whether the case was actually LLM-grounded — a deterministic-template
      // fallback must NOT auto-publish to candidates as if it were bespoke.
      const kase = { ...design.case, designSource: design.source } as Record<string, unknown>;
      updateLifecycle(id, { stage: "designed", role: design.role, case: kase, detail: "role + assignment designed" });
      recordAudit({ lifecycleId: id, actor: "auto", action: "designed" });
    } else if (lc.stage === "designed") {
      const gate = gateApproval(lc.analysis, lc.case as Record<string, unknown> | null);
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
      // FREEZE-AT-PUBLISH (bug-ui-scan-2026-07-09 #1). The seed + interview scenario ARE
      // the candidate-facing assignment; two candidates on ONE case must be handed the
      // IDENTICAL materials and submit channel (comparability + audit trail — the core
      // promise of a work-sample test). So the freeze boundary is the live token itself:
      // materialize BOTH BEFORE minting the posting, and treat `postingId` (token live)
      // as the immutability line. Once it is set, this whole block is skipped on ANY
      // resume — a re-enqueued `approved` handler can never re-run the (non-deterministic)
      // LLM and swap the assignment under candidates mid-flight, and there is no first-run
      // window where the token is live but the seed not yet materialized (which used to
      // route early candidates to a DIFFERENT submit channel). The old code published
      // FIRST, then overwrote the seed/scenario in place via unconditional UPDATEs.
      //
      // Idempotency layers, both required: (1) the `!postingId` gate skips the block after
      // the token is live; (2) each materialize is guarded by "artifact still absent" so a
      // PARTIAL prior run (scenario frozen, crash before the seed / before publish) doesn't
      // pay for the LLM again, and the save itself is a compare-and-set (…IfAbsent) that
      // can only FILL an absent column — never clobber a frozen one. Publishing stays
      // idempotent too: createPosting has no caseId dedup, so we persist postingId
      // IMMEDIATELY after minting so a resume reuses it instead of orphaning a duplicate
      // live token. (Sourcing re-runs below are safe — createPipelineEntry dedups on the
      // stable dc-<caseId> jobId.)
      let scenarioNote = "";
      let postingId = lc.postingId;
      if (!postingId) {
        // Case-designed interview: turn the approved case into the role's AI-interview
        // scenario (one per role, reused for every candidate so ratings stay comparable).
        // Best-effort — a scenario failure must never block publishing; early-career
        // interviews fall back to the generic script. The CLI's `source` rides INSIDE the
        // stored blob (the save helper persists opaque JSON) so the case detail can badge a
        // template-only scenario; a degraded generation gets its OWN audit action — it used
        // to record the same success row as a real LLM scenario, hiding that every candidate
        // would face generic template probes.
        if (!devCase.scenario) {
          try {
            const { scenario, source: scenarioSource, fallbackReason } = await runInterviewScenario(
              (devCase.case as Record<string, unknown>) ?? {},
              lc.role ?? {},
              lc.lang
            );
            saveDevCaseScenarioIfAbsent(devCase.id, { ...scenario, source: scenarioSource });
            if (scenarioSource === "llm") {
              scenarioNote = "; interview scenario ready";
              recordAudit({ lifecycleId: id, actor: "auto", action: "interview_scenario", ref: devCase.id });
            } else {
              scenarioNote = "; interview scenario degraded (template probes)";
              recordAudit({
                lifecycleId: id,
                actor: "system",
                action: "scenario_template_only",
                reason: fallbackReason.scenario ?? "LLM unavailable — deterministic template",
                ref: devCase.id,
              });
            }
          } catch {
            /* interviews fall back to the generic early-career script */
          }
        }

        // Materialized seed: the case's prose starting materials become a concrete
        // starter file tree (one per case, shared by every candidate) — the
        // anti-essay-grading half of the take-home hardening. Best-effort: a
        // materialization failure must never block publishing; the case simply
        // ships with prose materials as before. Same honesty contract as the
        // scenario above: persist the provenance with the blob and audit a
        // skeleton-only seed distinctly — never as "seed_materialized" SUCCESS.
        if (!devCase.seed) {
          try {
            const { seed, source: seedSource, fallbackReason } = await runMaterializeSeed(
              (devCase.case as Record<string, unknown>) ?? {},
              lc.role ?? {},
              lc.lang
            );
            saveDevCaseSeedIfAbsent(devCase.id, { ...seed, source: seedSource });
            if (seedSource === "llm") {
              scenarioNote += "; seed materialized";
              recordAudit({ lifecycleId: id, actor: "auto", action: "seed_materialized", ref: devCase.id });
            } else {
              scenarioNote += "; seed skeleton only (prose materials)";
              recordAudit({
                lifecycleId: id,
                actor: "system",
                action: "seed_skeleton_only",
                reason: fallbackReason.seed ?? "LLM unavailable — deterministic template",
                ref: devCase.id,
              });
            }
          } catch {
            /* the case ships with prose starting materials as before */
          }
        }

        // Naive-LLM baseline (LLM-era controls #6): solve the case once, one-shot, with
        // zero simulated judgment — frozen per case like the seed, so every candidate is
        // compared against the SAME "what a bare model does unattended". Best-effort:
        // without it, evaluation simply reports the comparison unavailable. Same freeze
        // discipline (…IfAbsent) and the same honesty contract as the artifacts above —
        // a deterministic (empty) baseline gets its own audit action, never a success row.
        {
          const frozen = getDevCase(devCase.id); // re-read: the seed may have just been frozen above
          if (frozen && !getDevCaseBaseline(frozen.id)) {
            try {
              const { baseline, source: baselineSource } = await runBaselineSolve(
                (frozen.case as Record<string, unknown>) ?? {},
                lc.role ?? {},
                (frozen.seed as Record<string, unknown> | null) ?? null
              );
              saveDevCaseBaselineIfAbsent(frozen.id, { ...baseline, source: baselineSource });
              if (baselineSource === "llm") {
                scenarioNote += "; baseline frozen";
                recordAudit({ lifecycleId: id, actor: "auto", action: "baseline_frozen", ref: frozen.id });
              } else {
                recordAudit({
                  lifecycleId: id,
                  actor: "system",
                  action: "baseline_unavailable",
                  reason: "LLM unavailable — submissions will not be baseline-diffed",
                  ref: frozen.id,
                });
              }
            } catch {
              /* comparisons will report unavailable */
            }
          }
        }

        // Now — and only now, with the assignment frozen onto the case — mint the live
        // token. From here the seed/scenario are immutable (this block is skipped on resume).
        const posting = await getAdapter("local").publish(devCase);
        postingId = posting.id;
        updateLifecycle(id, { postingId });
      }

      // Proactive sourcing: rank the existing candidate DB against the role and seed the
      // pipeline at the Accepted stage — so the role finds candidates, not only waits for them.
      let sourced = 0;
      let skipped = 0;
      let sourcingError: string | null = null;
      try {
        const roleTitle = lc.role?.title ?? lc.title ?? "Dev case";
        // Off-request (the runner has no session), so the LIFECYCLE row is the
        // authority on which team is sourcing. Both halves get the same one: an
        // unscoped read here ranked the default team's candidates and then seeded
        // them into this lifecycle's workspace.
        const outcome = await runSourceForRole(lc.role ?? {}, { workspaceId: lc.workspaceId });
        skipped = outcome.skipped;
        sourced = seedPipelineFromMatches(outcome.candidates, {
          caseId: lc.caseId,
          roleTitle,
          workspaceId: lc.workspaceId,
        }).added;
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
      // Drain-with-recheck: evaluate the current batch, then RE-READ for submissions
      // that arrived DURING the (seconds-long) evaluation. Such an arrival had its
      // resumeCollectingLifecycle COALESCED into this still-running task (the dedupe
      // key lifecycle:<id> is stable), so advancing to "ranked" on the original
      // snapshot would strand it un-evaluated and unranked — a silent ghost (the worst
      // failure a hiring tool can have, and its probability scales with eval duration).
      // Loop until no NOT-YET-ATTEMPTED submission remains; `attempted` excludes this
      // run's failures so a permanently-failing eval can't pin the lifecycle here, and
      // MAX_COLLECT_PASSES bounds a continuous flood within this single step (so the
      // outer step budget is untouched).
      const attempted = new Set<string>();
      let evaluated = 0;
      let failed = 0;
      let sawAny = false;
      for (let pass = 0; pass < MAX_COLLECT_PASSES; pass += 1) {
        const subs = lc.postingId ? listSubmissions(lc.postingId) : [];
        if (subs.length > 0) sawAny = true;
        const todo = subs.filter((s) => !s.evaluation && !attempted.has(s.id));
        if (todo.length === 0) break;
        for (const s of todo) {
          attempted.add(s.id);
          try {
            await runEvaluateSubmission(s.id);
            evaluated += 1;
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
          progress?.(STAGES.indexOf("collecting"), STAGES.length, `evaluating ${evaluated + failed}`);
        }
      }
      // Nothing has ever been submitted — stay in collecting rather than advancing to
      // an empty ranking (preserves the prior "awaiting submissions" behavior).
      if (!sawAny) return { stage: "collecting", detail: "awaiting submissions" };
      const evalDetail =
        failed > 0 ? `evaluated ${evaluated}, ${failed} failed` : `evaluated ${evaluated} submission(s)`;
      updateLifecycle(id, { stage: "ranked", detail: evalDetail });
      recordAudit({ lifecycleId: id, actor: "auto", action: "evaluated", reason: evalDetail });
    } else if (lc.stage === "ranked") {
      // Floor is calibration-adjustable (Direction E): a human applies an outcome-driven
      // suggestion via dev_control; we fall back to the DEV_POLICY default when unset.
      const floor = activePromoteFloor();
      const ranked = (lc.postingId ? listSubmissions(lc.postingId) : [])
        .filter((s) => (s.transferScore ?? 0) >= floor)
        .sort((a, b) => (b.transferScore ?? 0) - (a.transferScore ?? 0))
        .slice(0, DEV_POLICY.promoteTopN);
      const roleTitle = lc.role?.title ?? lc.title ?? "the role";
      let promoted = 0;
      let held = 0;
      for (const s of ranked) {
        // The calibrated floor rides into promoteSubmission so the reviewer-facing
        // advice and this stage's behavior share ONE threshold (case-sim round 2:
        // the advice hardcoded 70 while this stage promoted on the floor).
        const result = promoteSubmission(s.id, floor);
        if (!result) continue;
        promoted += 1;
        // Take-home -> observed bridge: a promoted submission already cleared the
        // transfer floor, so when its candidateRef resolves to a saved profile the
        // demonstrated skills become observed-provenance evidence. Best-effort
        // enrichment — a minting failure must never block the promotion batch.
        try {
          await mintObservedFromSubmission(s.id, result.entryId);
        } catch {
          /* minting is enrichment, not a gate */
        }
        // Say/do consistency (case-sim round 2 — every persona converged on this):
        // the "we'd like to take it forward" comm only goes out when the verdict
        // written on the reviewer's card actually IS "advance". A held submission
        // (suspect authenticity, low evidence-confidence) still enters the pipeline
        // for human triage, but the candidate is never told they advanced — that
        // read as an advance-then-silent-rejection, the exact trust breach the
        // round's brief described. The hold is audited with its reasons so a
        // reviewer can answer "why" (compliance/explainability).
        if (result.recommendation === "advance") {
          // Non-adverse comm — safe to automate. Adverse actions (rejections) stay human-gated.
          await sendComm({
            to: s.contact || s.candidateRef || "candidate",
            subject: `Next step — ${roleTitle}`,
            body: `Hi ${s.candidateRef},\n\nYour submission for ${roleTitle} stood out (fit ${s.transferScore ?? "—"}/100) and we'd like to take it forward. We'll be in touch with next steps shortly.\n\nBest,\nThe hiring team`,
            kind: "invite",
            ref: s.id,
          });
        } else {
          held += 1;
          recordAudit({
            lifecycleId: id,
            actor: "system",
            action: "promote_held",
            reason: result.reasons.join("; "),
            ref: s.id,
          });
        }
      }
      const heldNote = held > 0 ? `, ${held} held for review` : "";
      const detail = `promoted ${promoted}/${DEV_POLICY.promoteTopN} (floor ${floor}) to the pipeline${heldNote}`;
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
