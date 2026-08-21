import { actOnPipelineEntry, entryIdsWithEvent, listPipeline, recordAutomationEvent } from "./db/pipeline";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";
import { getDecisionConfig, type ScreeningRule } from "./decision-config-store";
import { sealDecisionSafe, SCREEN_WAVE_HOLDOUT_KIND, AUTO_REJECTED_KIND } from "./decision-record-store";
import { DecisionConfigError, effectiveFloor, effectiveHoldoutPercent, screenBottomCount, tieSafeBottomCount, validateScreeningOverride } from "./decision-config-schema";
import { dispatchRejection } from "./comms-dispatch";
import { isFairnessProtected, isKnownArchetype } from "./archetypes";
import { screenWaveApprovalToken, verifyScreenWaveApprovalToken, ScreenWaveApprovalError } from "./screen-wave-approval";
import { selectHoldout } from "./screen-wave-holdout";
import { operatorApprover } from "./auth/operator-approver";
import { isScored } from "./match-score";
import { withCanonicalScores } from "./match-score-resolve";
import { jdSlugOfJobId } from "./jd-limits";
import { jdLastEditedAt } from "./db/jobs";
import { isScoreStale } from "@/app/features/shared/decisionsTypes";

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
  /** Direction 2 (queue-staleness) — set when this candidate's match score was
   *  computed BEFORE the JD's last content edit, so the row is ranking on a score
   *  against stale text. Server-derived (same isScoreStale rule as the library /
   *  prep chips); informs, never blocks. `staleSince` is the JD's last-edit date.
   *  Absent (fresh score / never-edited JD / unscored) → no stale chrome. */
  stale?: boolean;
  staleSince?: string;
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
  | "unscored"
  // A recruiter reversed an earlier auto-rejection on this entry, which returned it
  // to active/Screened — the wave's own cohort predicate. Spared so the machine
  // can't immediately re-reject (and re-email) someone a human deliberately rescued.
  | "reinstated"
  // The tamper-evident Art. 22 record could not be written, so the rejection was
  // NOT applied. See the seal-first ordering on the adverse path below.
  | "sealFailed"
  // Spared from a would-be auto-reject to form the calibration clean arm.
  | "holdout";

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
  tieSpared: boolean,
  reinstatedSpared = false
): { reasonCode: ScreenReasonCode; reasonParams: Record<string, string | number> } {
  if (!cfg.autoRejectEnabled) return { reasonCode: "autoRejectOff", reasonParams: {} };
  if (protectedFromAutoReject) {
    return { reasonCode: knownArchetype ? "earlyCareer" : "unknownArchetype", reasonParams: {} };
  }
  if (reinstatedSpared) return { reasonCode: "reinstated", reasonParams: {} };
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
  tieSpared: boolean,
  // Defaulted so every existing caller (and every pinned string) is unchanged.
  reinstatedSpared = false
): string {
  if (!cfg.autoRejectEnabled) return "auto-reject off";
  if (protectedFromAutoReject) {
    return knownArchetype ? "early-career — never auto-rejected" : "unknown archetype — shielded (fail-closed)";
  }
  // A person a human pulled back out of the machine's rejection. `reinstatePipelineEntry`
  // returns them to active/Screened — byte-for-byte the cohort this wave selects — so
  // without this branch the very next run re-rejects them on the same unchanged score
  // and sends a SECOND rejection email. Kept (never silently made unrejectable): the
  // reviewer sees this reason on the row and must move them out of Screened, change the
  // policy, or reject them by hand to act on it.
  if (reinstatedSpared) return "reinstated — a recruiter reversed an earlier auto-rejection; not re-rejected automatically";
  // Spared because rejecting them would split a tied match score across the cutoff
  // (idea-50062f77): kept so an indistinguishable peer above the cutoff isn't
  // treated differently. Checked before the plain "above the cutoff" reason — a
  // tie-spared candidate IS above the *effective* cutoff, but only because the tie
  // moved the boundary, and the audit trail should say so explicitly.
  if (tieSpared) return "tie at cutoff — kept so equal scores aren't split";
  if (!inBottom) return "above the bottom cutoff";
  return "match at/above threshold";
}

/** Canonical, order-independent serialization of the per-family floor overrides for
 *  the approval-token policyVersion. Empty / absent → "" (byte-identical to the
 *  pre-family-floors token), so a wave with no family floors signs exactly as before. */
function familyFloorSuffix(cfg: ScreeningRule): string {
  const ff = cfg.familyFloors;
  if (!ff) return "";
  const keys = Object.keys(ff).sort();
  if (keys.length === 0) return "";
  return `/fam:${keys.map((k) => `${k}=${ff[k]}`).join(",")}`;
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
  /** Candidates the wave would have rejected but did NOT, because their Art. 22
   *  decision record could not be sealed (see the seal-first ordering below). They
   *  are reported as keeps with reasonCode "sealFailed"; a non-zero count means the
   *  chain is unwritable (missing signing key, locked DB) and the wave under-rejected
   *  on purpose. Counted so the gap is visible instead of living in a console.warn.
   *  Always 0 on a dry run (nothing is sealed). */
  sealFailures: number;
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
  // Read the screening rule for THIS team (tenancy): every other read in this
  // wave threads workspaceId, but this first config read omitted it and fell to
  // DEFAULT_WORKSPACE_ID — so a non-default team's saved familyFloors (never part
  // of the modal override) came from the wrong tenant, and the sealed record's
  // policyVersion attested to a floor the team never set.
  const cfg: ScreeningRule = { ...getDecisionConfig<ScreeningRule>("screening", workspaceId), ...checked.override };
  const cohort = listPipeline(workspaceId).filter((e) => e.jobId === jobId && e.status === "active" && e.stage === "Screened");
  // Direction 2 (queue-staleness) — derive, ONCE per wave, whether each candidate's
  // score predates the JD's last content edit, using the exact isScoreStale rule the
  // library roster + prep chips use. jdEditedAt is per-role (a JD-backed job's last
  // revision, workspace-scoped; null for a corpus job or a never-edited JD). Each
  // entry's scoredAt is the canonical analysis timestamp (scoreProvenance.at) — a
  // snapshot-only or unscored entry has none and is never stale. Server-derived so
  // the preview payload carries the honest flag; the modal only renders it.
  const jdSlug = jdSlugOfJobId(jobId);
  const jdEditedAt = jdSlug ? jdLastEditedAt(jdSlug, workspaceId) : null;
  const scoredAtById = new Map<string, string | null>();
  for (const e of withCanonicalScores(cohort, workspaceId)) {
    scoredAtById.set(e.id, e.scoreProvenance?.source === "analysis" ? e.scoreProvenance.at : null);
  }
  const staleFields = (id: string): { stale: true; staleSince: string } | Record<string, never> =>
    jdEditedAt && isScoreStale(scoredAtById.get(id) ?? null, jdEditedAt) ? { stale: true, staleSince: jdEditedAt } : {};
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
  // family-floors: the auto-reject floor is resolved PER CANDIDATE — a family
  // override when this role family carries one, else the global maxMatchToReject.
  // The approval-token policyVersion carries a canonical serialization of the family
  // floors so that changing a family floor (even one that leaves the reject SET
  // unchanged) forces a fresh preview+approval, never a stale rubber-stamp. Absent
  // familyFloors → empty suffix → byte-identical to the pre-family-floors token.
  // holdout rides the policyVersion so the sealed record attests to the rate in
  // force, and changing that rate forces a fresh preview+approval rather than a
  // stale rubber-stamp (same contract as the family floors). Omitted when 0, so a
  // holdout-disabled wave signs a byte-identical token to the pre-holdout build.
  const holdoutPct = effectiveHoldoutPercent(cfg);
  const policyVersion = `screen-wave/bottom${cfg.rejectBottomPercent}/maxMatch${cfg.maxMatchToReject}${familyFloorSuffix(cfg)}${holdoutPct ? `/holdout${holdoutPct}` : ""}`;
  const wouldReject = new Set<string>();
  for (let rank = 0; rank < sorted.length; rank++) {
    const e = sorted[rank];
    const inBottom = rank < effectiveBottomCount;
    // `sorted` holds only scored entries, so this threshold always compares a real
    // measurement — an unscored candidate can never be auto-reject-eligible. The
    // floor is the candidate's EFFECTIVE floor (family override or global).
    const belowThreshold = e.matchScore < effectiveFloor(cfg, e.roleFamily);
    if (cfg.autoRejectEnabled && inBottom && belowThreshold && !isFairnessProtected(e.archetype)) {
      wouldReject.add(e.id);
    }
  }
  // CALIBRATION HOLDOUT (UAT KAT-L1-001/002) — spare a small, stable sample of the
  // would-be rejects so their outcomes are uncontaminated by the score that would
  // have rejected them. Without this arm, calibration pairs the score against a
  // label the score itself produced and can never falsify its own selection quality.
  //
  // Applied HERE, before the approval token is signed, so the token covers the set
  // the recruiter actually sees and a commit re-derives byte-identically. Membership
  // is a pure function of (jobId, entryId) — see screen-wave-holdout.ts for why it
  // must not depend on the threshold or on Math.random.
  // REINSTATEMENT SHIELD — a reversed auto-rejection comes back to
  // status='active', stage='Screened' (reinstatePipelineEntry), which is EXACTLY the
  // cohort predicate above. Unshielded, the next run of the same unchanged rule
  // re-rejects the person a recruiter deliberately rescued and queues them a second
  // rejection email. Removed from the reject set BEFORE the holdout draw and before
  // the token is signed, so the recruiter approves the set they can actually see,
  // and each spared row carries the `reinstated` keep-reason (below) — the human is
  // still in the loop: nobody becomes permanently unrejectable, they just can't be
  // re-rejected by the machine on the same evidence.
  const reinstatedSpared = entryIdsWithEvent([...wouldReject], "reinstated", workspaceId);
  for (const id of reinstatedSpared) wouldReject.delete(id);
  const heldOut = new Set(selectHoldout(jobId, [...wouldReject], holdoutPct).spared);
  for (const id of heldOut) wouldReject.delete(id);
  // Art. 22 staleness (approval-token issued-at): a preview mints a token stamped
  // NOW; a commit re-derives the signature using the token's OWN stamp, so it can
  // neither cover a different set nor be back-dated, and is refused once it is older
  // than SCREEN_WAVE_APPROVAL_MAX_AGE_MS. "A human reviewed this set" has to mean a
  // human reviewed it recently — otherwise a token signed weeks ago still commits.
  const approvalToken = screenWaveApprovalToken(jobId, policyVersion, [...wouldReject]);
  if (!dryRun) {
    if (!opts?.approval) {
      throw new ScreenWaveApprovalError(
        "Human review and approval are required before committing an automated rejection wave. Preview it, then approve the reviewed set."
      );
    }
    const check = verifyScreenWaveApprovalToken(opts.approval.token, jobId, policyVersion, [...wouldReject]);
    if (!check.ok) {
      throw new ScreenWaveApprovalError(
        check.reason === "expired"
          ? "This approval has expired — a review has to be recent to stand. Re-preview and approve the current set before committing."
          : "The candidate set changed since it was previewed — re-preview and approve the current set before committing."
      );
    }
  }
  const approvedBy = opts?.approval?.approvedBy?.trim() || operatorApprover();

  const decisions: ScreenDecision[] = [];
  let rejected = 0;
  let commsFailures = 0;
  let sealFailures = 0;
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

    // Calibration clean arm: this candidate cleared every auto-reject test and was
    // then SPARED at random so their outcome can be observed without the score
    // acting on it. Reported explicitly — a silent exemption would look like a bug
    // to the recruiter and would be invisible in the audit trail. Sealed on commit
    // below so the clean arm is identifiable when calibration reads it back.
    if (heldOut.has(e.id)) {
      const holdoutRationale = `Kept — calibration holdout (${holdoutPct}% of would-be auto-rejects are spared so their outcomes can measure whether the score was right). Match ${score} was below the ${effectiveFloor(cfg, e.roleFamily)} threshold.`;
      if (!dryRun) {
        recordAutomationEvent(e.id, "screen_wave_holdout", holdoutRationale, workspaceId);
        sealDecisionSafe({
          kind: SCREEN_WAVE_HOLDOUT_KIND,
          actor: "auto:screen-wave",
          policyVersion,
          candidateRef: e.id,
          rationale: `${holdoutRationale} · approved by ${approvedBy}`,
          reasonCode: "holdout",
          inputs: { score, threshold: effectiveFloor(cfg, e.roleFamily), rank: rank + 1, holdoutPercent: holdoutPct, approvedBy },
        });
      }
      decisions.push({
        entryId: e.id,
        label: e.candidateLabel,
        archetype: e.archetype,
        matchScore: score,
        action: "keep",
        rationale: holdoutRationale,
        reasonCode: "holdout",
        reasonParams: { score, threshold: effectiveFloor(cfg, e.roleFamily), pct: holdoutPct },
        ...staleFields(e.id),
      });
      continue;
    }

    // The reject gate is the SAME predicate already used to build `wouldReject`
    // (and to sign the approval token) — read from that set so the committed set
    // can never diverge from the set the recruiter reviewed and approved.
    if (wouldReject.has(e.id)) {
      // The floor ACTUALLY applied to this candidate — a family override when this
      // role family carries one, else the global value. The rationale, the structured
      // reasonParams, and the sealed policyVersion below all report THIS number, so
      // the audit trail can never claim a floor the wave didn't use. With no family
      // override it equals cfg.maxMatchToReject → byte-identical to before.
      const floor = effectiveFloor(cfg, e.roleFamily);
      // Report the EFFECTIVE (tie-safe) cutoff actually applied, noting when it was
      // shrunk from the raw bottom-% so the auto-reject boundary stays reproducible.
      const tieNote = effectiveBottomCount < bottomCount ? ` (tie-adjusted from ${bottomCount} so no equal score is split)` : "";
      const verb = dryRun ? "Would auto-reject" : "Auto-rejected";
      const rationale = `${verb} · bottom ${cfg.rejectBottomPercent}% of ${n} → ${effectiveBottomCount}${tieNote} (rank ${rank + 1}) and match ${score} < ${floor} threshold.`;
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
        threshold: floor,
        tieAdjusted: effectiveBottomCount < bottomCount ? bottomCount : 0,
      };
      // DEC2 preview: compute the verdict + rationale but commit NOTHING — no CAS
      // write, no audit event, no rejection email. The recruiter reviews this set,
      // then re-runs with dryRun:false to apply it.
      const stale = staleFields(e.id);
      if (dryRun) {
        decisions.push({ entryId: e.id, label: e.candidateLabel, archetype: e.archetype, matchScore: score, action: "reject", rationale, reasonCode: "reject", reasonParams, ...stale });
        rejected += 1;
        continue;
      }
      // Decision System of Record (moonshot D) — sealed BEFORE anything irreversible
      // happens. The seal used to run after the status flip and the rejection email,
      // through sealDecisionSafe, whose every failure (missing signing key, locked DB,
      // schema drift) is a console.warn: that left committed, emailed, irreversible
      // rejections with NO tamper-evident record — and status-decisions.ts derives the
      // candidate's own "why" from that record, so the person couldn't be told either.
      // Now the record is the PRECONDITION: no seal, no rejection. A candidate whose
      // record can't be written is kept (reasonCode "sealFailed") and counted, so the
      // wave under-rejects loudly instead of rejecting people unrecorded.
      const sealed = sealDecisionSafe({
        kind: AUTO_REJECTED_KIND,
        actor: "auto:screen-wave",
        // Per-record policyVersion carries the EFFECTIVE floor this candidate was
        // judged against (family override or global) — byte-identical when none.
        policyVersion: `screen-wave/bottom${cfg.rejectBottomPercent}/maxMatch${floor}`,
        candidateRef: e.id,
        rationale: committedRationale,
        reasonCode: "reject",
        // The decisive numbers + WHO approved this reviewed set (the Art. 22 record),
        // plus the SCORE-STALENESS caveat the preview already showed the approver.
        // The wave computed `stale` and dropped it at the seal, so a record could
        // present a clean score-vs-threshold comparison while omitting the one fact
        // that undermines it: the score predates the JD's last edit. Always present —
        // an explicit `stale: false` affirms the score was fresh, which "absent"
        // cannot do when reconstructing the decision later.
        inputs: { ...reasonParams, approvedBy, stale: stale.stale === true, ...(stale.staleSince ? { staleSince: stale.staleSince } : {}) },
      });
      if (!sealed) {
        sealFailures += 1;
        const sealFailedRationale = "Kept — the Art. 22 decision record could not be sealed, so the auto-rejection was not applied. Retry once the decision chain is writable.";
        // Logged like the comms failure below (sealDecisionSafe logs the cause); the
        // row + the counted `sealFailures` are what actually surface it to the caller.
        console.warn(`[screen-wave] decision seal failed for ${e.candidateLabel} (${e.id}) — rejection NOT applied`);
        decisions.push({ entryId: e.id, label: e.candidateLabel, archetype: e.archetype, matchScore: score, action: "keep", rationale: sealFailedRationale, reasonCode: "sealFailed", reasonParams: {}, ...stale });
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
        // Seal-first leaves ONE residue: the record was written microseconds ago and
        // this flip then no-op'd, so the append-only chain holds an auto-rejection that
        // did not apply. That window is now a single synchronous statement wide — it
        // used to span the whole awaited comms dispatch — and it is the right trade
        // against the alternative it replaces: an APPLIED, emailed rejection with no
        // record at all. The staleSkipped keep below is the wave's own report of it.
        console.warn(`[screen-wave] ${e.candidateLabel} (${e.id}) changed stage between seal and commit — the sealed record does not reflect an applied rejection`);
        decisions.push({ entryId: e.id, label: e.candidateLabel, archetype: e.archetype, matchScore: score, action: "keep", rationale: skipped, reasonCode: "staleSkipped", reasonParams: { wasStage: e.stage } });
        continue;
      }
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
      decisions.push({ entryId: e.id, label: e.candidateLabel, archetype: e.archetype, matchScore: score, action: "reject", rationale: committedRationale, reasonCode: "reject", reasonParams, ...(commsFailed ? { commsFailed } : {}), ...stale });
      rejected += 1;
    } else {
      // reinstatedSpared: this candidate met every auto-reject test and was removed
      // from the set ONLY because a human had already reversed a rejection on them —
      // say that, rather than reporting a threshold reason that isn't why they're here.
      const wasReinstated = reinstatedSpared.has(e.id);
      const reason = keepReason(cfg, protectedFromAutoReject, knownArchetype, inBottom, tieSpared, wasReinstated);
      const structured = keepReasonStructured(cfg, protectedFromAutoReject, knownArchetype, inBottom, tieSpared, wasReinstated);
      decisions.push({ entryId: e.id, label: e.candidateLabel, archetype: e.archetype, matchScore: score, action: "keep", rationale: reason, ...structured, ...staleFields(e.id) });
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
  return { decisions, rejected, kept: decisions.length - rejected, cohort: cohort.length, config: cfg, commsFailures, sealFailures, dryRun, approvalToken };
}
