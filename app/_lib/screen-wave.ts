import { actOnPipelineEntry, listPipeline, recordAutomationEvent } from "./db";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";
import { getDecisionConfig, type ScreeningRule } from "./decision-config-store";
import { sealDecisionSafe } from "./decision-record-store";
import { DecisionConfigError, screenBottomCount, tieSafeBottomCount, validateScreeningOverride } from "./decision-config-schema";
import { dispatchRejection } from "./comms-dispatch";
import { isFairnessProtected, isKnownArchetype } from "./archetypes";
import { screenWaveApprovalToken, ScreenWaveApprovalError } from "./screen-wave-approval";
import { operatorApprover } from "./auth/operator-approver";
import { isScored } from "./match-score";

export { ScreenWaveApprovalError } from "./screen-wave-approval";

// Phase 3 — the screening "first wave" of automated decisions. For a role's
// matched cohort, auto-reject the bottom `rejectBottomPercent` that are ALSO
// below `maxMatchToReject` match — NEVER an early-career (or otherwise
// unclassifiable) candidate: the fairness gate from automation.py is preserved
// and now FAILS CLOSED via isFairnessProtected. NEVER an UNSCORED candidate
// either (SD-L1-002 / REC-03): an entry with no match score is excluded from the
// ranked cohort entirely — kept with an explicit "unscored" outcome — instead of
// being coerced to a fabricated "match 0" that the threshold would reject and the
// sealed record would assert as a measurement. Every auto-decision is audited
// with a rationale and the candidate gets a queued rejection comm.

export type ScreenDecision = {
  entryId: string;
  label: string;
  archetype: string | null;
  // null = the candidate has no match score (never measured). Such candidates are
  // always `action: "keep"` with reasonCode "unscored" — a fabricated 0 must never
  // reach a threshold, a preview row, or a sealed record.
  matchScore: number | null;
  action: "reject" | "keep";
  // The audit-trail rationale — byte-identical English, persisted on a committed
  // run (the recorded audit event) and pinned by the unit tests. UNCHANGED.
  rationale: string;
  // DEC4 — a structured, locale-renderable mirror of `rationale`: the modal
  // renders `decisions.wave.reasons.<reasonCode>` interpolated with
  // `reasonParams`, so a Czech recruiter reads a Czech rationale in the preview
  // and the committed view while the persisted audit string stays English (zero
  // audit risk). Falls back to `rationale` when a code is unmapped.
  reasonCode: ScreenReasonCode;
  reasonParams: Record<string, string | number>;
  /** Set on a committed reject whose rejection email failed to queue — the
   *  candidate is out of the funnel and needs a manual nudge (mirrors the
   *  rejection_comms_failed audit event, but addressable per row in the UI). */
  commsFailed?: boolean;
};

// The closed set of rationale shapes. Each maps to a `decisions.wave.reasons.*`
// catalog key; params carry the interpolated numbers.
export type ScreenReasonCode =
  | "autoRejectOff"
  | "earlyCareer"
  | "unknownArchetype"
  | "tieAtCutoff"
  | "aboveCutoff"
  | "atThreshold"
  | "reject"
  | "staleSkipped"
  | "unscored";

// The keep rationale for a candidate with NO match score (audit-string register,
// mirrored by `decisions.wave.reasons.unscored` for localized rendering). Exported
// so the behavioral tests pin it — this exact honesty replaced the fabricated
// "match 0" that used to be sealed into the decision chain (SD-L1-002).
export const UNSCORED_KEEP_RATIONALE =
  "unscored — no match score yet; excluded from auto-rejection (needs scoring)";

// The structured mirror of keepReason: same branch order, returns the code +
// interpolation params instead of the English string. Kept beside keepReason so
// the two can't drift (the audit string and the localized one describe the same
// decision).
export function keepReasonStructured(
  cfg: ScreeningRule,
  protectedFromAutoReject: boolean,
  knownArchetype: boolean,
  inBottom: boolean,
  tieSpared: boolean
): { reasonCode: ScreenReasonCode; reasonParams: Record<string, string | number> } {
  if (!cfg.autoRejectEnabled) return { reasonCode: "autoRejectOff", reasonParams: {} };
  if (protectedFromAutoReject) {
    return { reasonCode: knownArchetype ? "earlyCareer" : "unknownArchetype", reasonParams: {} };
  }
  if (tieSpared) return { reasonCode: "tieAtCutoff", reasonParams: {} };
  if (!inBottom) return { reasonCode: "aboveCutoff", reasonParams: {} };
  return { reasonCode: "atThreshold", reasonParams: {} };
}

// Why a candidate was KEPT (not auto-rejected). These strings are persisted to the
// audit trail and shown to users, so they must stay byte-identical — a guarded pure
// helper keeps the branches readable and unit-testable. Order mirrors the auto-reject
// gate: auto-reject off / fairness-protected (known=early-career vs unknown archetype)
// / tie spared at the cutoff / above the bottom cutoff / at-or-above the match
// threshold. `inBottom` is measured against the TIE-SAFE effective cutoff (see
// tieSafeBottomCount); `tieSpared` flags a candidate the raw bottom-% would have
// rejected but the tie-break kept so an equal score isn't split.
export function keepReason(
  cfg: ScreeningRule,
  protectedFromAutoReject: boolean,
  knownArchetype: boolean,
  inBottom: boolean,
  tieSpared: boolean
): string {
  if (!cfg.autoRejectEnabled) return "auto-reject off";
  if (protectedFromAutoReject) {
    return knownArchetype ? "early-career — never auto-rejected" : "unknown archetype — shielded (fail-closed)";
  }
  // Spared because rejecting them would split a tied match score across the cutoff
  // (idea-50062f77): kept so an indistinguishable peer above the cutoff isn't
  // treated differently. Checked before the plain "above the cutoff" reason — a
  // tie-spared candidate IS above the *effective* cutoff, but only because the tie
  // moved the boundary, and the audit trail should say so explicitly.
  if (tieSpared) return "tie at cutoff — kept so equal scores aren't split";
  if (!inBottom) return "above the bottom cutoff";
  return "match at/above threshold";
}

export async function runScreenWave(
  jobId: string,
  override?: Partial<ScreeningRule>,
  // `approval` is REQUIRED to commit (dryRun:false): the token the recruiter
  // approved from the preview, plus who approved it. A commit without it — or with
  // a token that no longer matches the live set — is refused (no solely-automated
  // adverse decision; EU AI Act / GDPR Art. 22). A dry run needs no approval.
  opts?: { dryRun?: boolean; approval?: { approvedBy: string; token: string } },
  // Tenant (P1): the team whose Screened cohort this wave ranks, rejects, and seals.
  // Threaded from the route's currentWorkspace(); an unscoped default here would run
  // the whole wave (preview, approval token, commits, seals) on the default team's
  // cohort regardless of who called it. Defaults to the single default workspace so
  // scripts/tests keep today's behavior.
  workspaceId: string = DEFAULT_WORKSPACE_ID
): Promise<{
  decisions: ScreenDecision[];
  rejected: number;
  kept: number;
  cohort: number;
  config: ScreeningRule;
  /** Signature of the EXACT set this run would reject under the active policy.
   *  Returned on a dry run so the recruiter's commit can echo it; the commit is
   *  refused unless it still matches the live set (the human-approval gate). */
  approvalToken: string;
  /** Rejections that applied but whose candidate notification failed to queue
   *  (idea-961de357) — the wave completed; these candidates need a manual nudge.
   *  Always 0 on a dry run (nothing is dispatched). */
  commsFailures: number;
  /** True when this was a PREVIEW (DEC2): the full ranking / fairness / tie-break
   *  math ran and `decisions` is populated with rationales, but NO status was
   *  flipped, NO rejection email queued, and NO audit event written. The recruiter
   *  reviews this, then re-runs with dryRun:false to commit. */
  dryRun: boolean;
}> {
  const dryRun = opts?.dryRun ?? false;
  // Backstop: never merge an unvalidated override into the live config that
  // drives irreversible auto-rejections. The route validates first (→ 400), but
  // enforcing the schema HERE — at the actual destructive operation — guarantees
  // a malformed/out-of-range override can't reach the bottom-% math through any
  // other caller. Mirrors setDecisionConfig's write-boundary backstop; throws
  // DecisionConfigError, which the route maps to a 400.
  const checked = validateScreeningOverride(override);
  if (!checked.ok) throw new DecisionConfigError(checked.error);
  const cfg: ScreeningRule = { ...getDecisionConfig<ScreeningRule>("screening"), ...checked.override };
  const cohort = listPipeline(workspaceId).filter((e) => e.jobId === jobId && e.status === "active" && e.stage === "Screened");
  // NULL-SCORE POLICY — fail closed (SD-L1-002 / REC-03): a candidate with NO
  // match score has not been measured. The old `?? 0` coercion on matchScore made
  // them a genuine-looking 0 that ranked worst, passed `0 < maxMatchToReject`,
  // and sealed "match 0" into the immutable decision record. Unscored entries are
  // therefore excluded from the ranked cohort entirely — never sorted, never
  // counted into the bottom-%, never threshold-eligible. Each is returned as an
  // explicit "unscored" KEEP (appended after the loop below) so the preview names
  // them for scoring instead of hiding them among the zeros.
  const unscored = cohort.filter((e) => !isScored(e));
  const sorted = cohort.filter(isScored).sort((a, b) => a.matchScore - b.matchScore); // worst first
  // The bottom-% math runs over the SCORED cohort only (`n` = scored count): a
  // percentage of candidates who can be ranked, not of a pool padded with
  // unmeasured people. When everyone is scored this is byte-identical to before.
  const n = sorted.length;
  // Small-cohort policy lives in decision-config-schema.ts: floor, but never
  // below one candidate in a non-empty pool — so a small role is no longer
  // silently exempt from an auto-reject the recruiter switched on (idea-582ff3b2).
  const bottomCount = screenBottomCount(n, cfg.rejectBottomPercent);
  // Tie-break: that raw count can split a run of IDENTICAL match scores across the
  // cutoff, and the stable sort above would decide that split by pipeline arrival
  // order — equal candidates getting opposite automated outcomes (idea-50062f77).
  // tieSafeBottomCount shrinks the cutoff so no tied score is split; the straddling
  // tie is KEPT. Operates on the scored cohort's genuine scores (the unscored were
  // excluded above, so no fabricated 0 can form or split a tie).
  const effectiveBottomCount = tieSafeBottomCount(
    sorted.map((e) => e.matchScore),
    bottomCount
  );

  // Human-approval gate (EU AI Act / GDPR Art. 22). Determine the EXACT set this
  // run would auto-reject (single source of the gate predicate, reused by the loop
  // below) and sign it. A dry run returns the token for the recruiter to review;
  // a commit MUST carry that token and it must still match — otherwise the adverse
  // decision would be solely automated, or would apply to a set the human never saw.
  const policyVersion = `screen-wave/bottom${cfg.rejectBottomPercent}/maxMatch${cfg.maxMatchToReject}`;
  const wouldReject = new Set<string>();
  for (let rank = 0; rank < sorted.length; rank++) {
    const e = sorted[rank];
    const inBottom = rank < effectiveBottomCount;
    // `sorted` holds only scored entries, so this threshold always compares a real
    // measurement — an unscored candidate can never be auto-reject-eligible.
    const belowThreshold = e.matchScore < cfg.maxMatchToReject;
    if (cfg.autoRejectEnabled && inBottom && belowThreshold && !isFairnessProtected(e.archetype)) {
      wouldReject.add(e.id);
    }
  }
  const approvalToken = screenWaveApprovalToken(jobId, policyVersion, [...wouldReject]);
  if (!dryRun) {
    if (!opts?.approval) {
      throw new ScreenWaveApprovalError(
        "Human review and approval are required before committing an automated rejection wave. Preview it, then approve the reviewed set."
      );
    }
    if (opts.approval.token !== approvalToken) {
      throw new ScreenWaveApprovalError(
        "The candidate set changed since it was previewed — re-preview and approve the current set before committing."
      );
    }
  }
  const approvedBy = opts?.approval?.approvedBy?.trim() || operatorApprover();

  const decisions: ScreenDecision[] = [];
  let rejected = 0;
  let commsFailures = 0;
  for (let rank = 0; rank < sorted.length; rank++) {
    const e = sorted[rank];
    // Genuine by construction (the unscored never enter `sorted`): the rationale
    // and the sealed record below always carry a measurement that was taken.
    const score = e.matchScore;
    // Fairness gate fails CLOSED: early-career AND any unknown/renamed archetype
    // are shielded from auto-rejection. An unrecognized archetype is data drift —
    // record it so the desync is visible instead of silently auto-rejecting a
    // candidate the fairness rule was meant to protect.
    const protectedFromAutoReject = isFairnessProtected(e.archetype);
    const knownArchetype = isKnownArchetype(e.archetype);
    // A preview writes nothing — the unknown-archetype audit marker only fires on a
    // committed run, so a recruiter re-previewing doesn't spam the audit trail.
    if (!knownArchetype && !dryRun) {
      recordAutomationEvent(e.id, "fairness_gate_unknown_archetype", `Unknown archetype "${e.archetype ?? "(null)"}" — shielded from auto-rejection (fail-closed).`, workspaceId);
    }
    const inBottom = rank < effectiveBottomCount;
    // Inside the raw bottom-% but above the tie-safe cutoff → kept only because the
    // tie-break refused to split an equal score (idea-50062f77).
    const tieSpared = rank >= effectiveBottomCount && rank < bottomCount;

    // The reject gate is the SAME predicate already used to build `wouldReject`
    // (and to sign the approval token) — read from that set so the committed set
    // can never diverge from the set the recruiter reviewed and approved.
    if (wouldReject.has(e.id)) {
      // Report the EFFECTIVE (tie-safe) cutoff actually applied, noting when it was
      // shrunk from the raw bottom-% so the auto-reject boundary stays reproducible.
      const tieNote = effectiveBottomCount < bottomCount ? ` (tie-adjusted from ${bottomCount} so no equal score is split)` : "";
      const verb = dryRun ? "Would auto-reject" : "Auto-rejected";
      const rationale = `${verb} · bottom ${cfg.rejectBottomPercent}% of ${n} → ${effectiveBottomCount}${tieNote} (rank ${rank + 1}) and match ${score} < ${cfg.maxMatchToReject} threshold.`;
      // On commit the audit string names the human who approved the reviewed set,
      // so the record reads as human-approved automated screening — not a solely
      // automated adverse decision (EU AI Act / GDPR Art. 22).
      const committedRationale = `${rationale} · approved by ${approvedBy}`;
      // DEC4 — structured mirror for localized rendering; the modal picks the
      // would/did phrasing from the run's dryRun flag and notes the tie adjustment.
      const reasonParams: Record<string, string | number> = {
        pct: cfg.rejectBottomPercent,
        n,
        count: effectiveBottomCount,
        rank: rank + 1,
        score,
        threshold: cfg.maxMatchToReject,
        tieAdjusted: effectiveBottomCount < bottomCount ? bottomCount : 0,
      };
      // DEC2 preview: compute the verdict + rationale but commit NOTHING — no CAS
      // write, no audit event, no rejection email. The recruiter reviews this set,
      // then re-runs with dryRun:false to apply it.
      if (dryRun) {
        decisions.push({ entryId: e.id, label: e.candidateLabel, archetype: e.archetype, matchScore: score, action: "reject", rationale, reasonCode: "reject", reasonParams });
        rejected += 1;
        continue;
      }
      // Optimistic CAS (idea-b24a6d3c): the cohort was snapshotted up-front and
      // this loop awaits a comms dispatch between iterations — a wide window in
      // which a recruiter can manually advance a candidate. Pinning the wave's
      // verdict to the snapshot stage makes a stale reject a NO-OP: no status
      // flip, no audit event claiming an action that didn't happen, and — the
      // part a candidate would have felt — no rejection email.
      // actor "system" makes this the ONE auto_rejected write (rationale rides as
      // the event detail). The old shape — a `rejected` event from the act PLUS a
      // separate recordAutomationEvent("auto_rejected") — counted every wave
      // reject once as HUMAN and once as AUTO, and twice in momentum's bars.
      const updated = actOnPipelineEntry(e.id, "reject", committedRationale, { expectedStage: e.stage, actor: "system" }, workspaceId);
      if (!updated) {
        const skipped = `Skipped — stage changed mid-wave (was ${e.stage}); left untouched.`;
        decisions.push({ entryId: e.id, label: e.candidateLabel, archetype: e.archetype, matchScore: score, action: "keep", rationale: skipped, reasonCode: "staleSkipped", reasonParams: { wasStage: e.stage } });
        continue;
      }
      // Decision System of Record (moonshot D): seal a tamper-evident, replayable
      // record of this auto-rejection — the inputs it saw, the policy version, the
      // actor, the rationale — alongside the auto_rejected audit event the act above
      // already wrote (actor:"system"). Best-effort (sealDecisionSafe never throws):
      // a seal failure must NEVER abort the wave.
      sealDecisionSafe({
        kind: "auto_rejected",
        actor: "auto:screen-wave",
        policyVersion: `screen-wave/bottom${cfg.rejectBottomPercent}/maxMatch${cfg.maxMatchToReject}`,
        candidateRef: e.id,
        rationale: committedRationale,
        reasonCode: "reject",
        // The decisive numbers + WHO approved this reviewed set (the Art. 22 record).
        inputs: { ...reasonParams, approvedBy },
      });
      // A comms failure must not abort the wave (idea-961de357): the rejection
      // is already applied + audited, and the loop holds the REST of the cohort
      // — one transient SMTP error used to escape here, leaving the batch
      // half-applied with a bare 500 and no record of what had landed. Isolate
      // it per candidate: log it, surface it in the activity feed, count it for
      // the caller, and keep going.
      let commsFailed = false;
      try {
        await dispatchRejection(updated, { automated: true }); // queued, never ghosts
      } catch (commsError) {
        commsFailed = true;
        commsFailures += 1;
        const msg = commsError instanceof Error ? commsError.message : String(commsError);
        console.warn(`[screen-wave] rejection comms failed for ${e.candidateLabel} (${e.id}): ${msg}`);
        recordAutomationEvent(e.id, "rejection_comms_failed", `Auto-rejected, but the notification failed to queue — nudge manually. (${msg})`, workspaceId);
      }
      // commsFailed rides the decision row so the committed view can badge WHO
      // needs a manual nudge — the bare commsFailures count names nobody.
      decisions.push({ entryId: e.id, label: e.candidateLabel, archetype: e.archetype, matchScore: score, action: "reject", rationale: committedRationale, reasonCode: "reject", reasonParams, ...(commsFailed ? { commsFailed } : {}) });
      rejected += 1;
    } else {
      const reason = keepReason(cfg, protectedFromAutoReject, knownArchetype, inBottom, tieSpared);
      const structured = keepReasonStructured(cfg, protectedFromAutoReject, knownArchetype, inBottom, tieSpared);
      decisions.push({ entryId: e.id, label: e.candidateLabel, archetype: e.archetype, matchScore: score, action: "keep", rationale: reason, ...structured });
    }
  }
  // Unscored candidates (null-score policy above): each gets an EXPLICIT keep
  // outcome — visibly "unscored", eligible for scoring — never a phantom row and
  // never a fabricated "match 0" reject. Listed after the ranked cohort; on a
  // committed run nothing is written for them (no status flip, no audit event,
  // no sealed record — there is no decision to record).
  for (const e of unscored) {
    decisions.push({
      entryId: e.id,
      label: e.candidateLabel,
      archetype: e.archetype,
      matchScore: null,
      action: "keep",
      rationale: UNSCORED_KEEP_RATIONALE,
      reasonCode: "unscored",
      reasonParams: {},
    });
  }
  // `cohort` reports the FULL stage cohort (scored + unscored) so the modal's
  // "would reject X of N" matches the number of rows it lists; the bottom-% math
  // above used the scored count `n`.
  return { decisions, rejected, kept: decisions.length - rejected, cohort: cohort.length, config: cfg, commsFailures, dryRun, approvalToken };
}
