// Publish-gate logic for CaseDetail, extracted as pure TS so it is unit-testable
// (the .tsx can't be loaded by node --test). Publishing a case mints a live
// candidate-facing apply token and (via the lifecycle) proactively sources real
// candidates into the pipeline. Intake can be stopped again (POST
// /api/devcase/[id]/intake, the intake rules at the bottom of this file), but the
// sourcing cannot be taken back, so publishing
// always needs an explicit confirm step; a case flagged DEGRADED (interview scenario
// fell back to template probes, or the seed is a prose-only skeleton) additionally
// needs a deliberate "publish anyway" acknowledgement, because those are exactly the
// cases that should not ship to candidates.
// bug-ui-scan-2026-07-09 (dev-case-authoring-publishing #3).

export type PublishGateInput = { scenarioDegraded: boolean; seedDegraded: boolean };

/** Whether the case is in a known-degraded state at publish time. */
export function isDegradedPublish(input: PublishGateInput): boolean {
  return input.scenarioDegraded || input.seedDegraded;
}

/** Whether the confirm dialog's primary "publish" action may fire. A healthy case
 *  only needs the confirm step (the dialog being open IS the confirmation); a degraded
 *  case additionally requires the explicit acknowledgement checkbox to be ticked. */
export function canConfirmPublish(input: {
  scenarioDegraded: boolean;
  seedDegraded: boolean;
  acknowledgedDegraded: boolean;
}): boolean {
  return isDegradedPublish(input) ? input.acknowledgedDegraded : true;
}

/** The reasons the assignment is degraded, as CODES rather than prose.
 *
 *  This module is pure TS with no reader attached, so the two sentences it used to
 *  return were English shipped into a four-locale product — and they were also the
 *  last place on this surface that still called the entity a "case", where neither
 *  the catalog walk nor the source guard in devcase-vocabulary.test.ts could see
 *  them. The confirm dialog resolves each code through
 *  `devcase.studio.degradedReason.<code>` in the reader's own language.
 *  Empty when the assignment is healthy. */
export const DEGRADED_REASONS = ["scenario", "seed"] as const;
export type DegradedReason = (typeof DEGRADED_REASONS)[number];

export function degradedReasons(input: PublishGateInput): DegradedReason[] {
  const reasons: DegradedReason[] = [];
  if (input.scenarioDegraded) reasons.push("scenario");
  if (input.seedDegraded) reasons.push("seed");
  return reasons;
}

// ---- Intake state (challenge-r09 devcase-lifecycle/B) ------------------------------
//
// The detail used to decide "published" as `casePostings.length > 0`, so a case whose
// every posting was closed (the lifecycle's close-out, the r07 fence withdrawing a
// just-minted token, or the stop door) still read as live, with a disabled "Published"
// button and a copyable link that answers 410. The state is read from the postings'
// STATUS instead, and which intake action is legal is ONE rule: `lifecycleOwnsIntake`
// is also what POST /api/devcase/[id]/intake refuses on (closeCaseIntake takes it as its
// predicate), so the header never offers a stop the server would refuse.
//
// Here, beside the publish gate, and not in a module of its own: app/page.tsx reaches
// this reader through next/dynamic and sits at its module ceiling in perf-budget.json.

/** A posting as far as intake cares. `status` is dev_postings.status ('open' | 'closed');
 *  anything but 'closed' reads open, which is what the store treats as accepting. */
export type IntakePosting = { status?: string | null };

export type IntakeState =
  | { state: "unpublished" }
  | { state: "live"; open: number; closed: number }
  | { state: "closed"; open: 0; closed: number };

export type IntakeAction = "publish" | "stop" | "reopen";

/** Whether a posting still accepts candidates (its apply link resolves, its intake form
 *  is taken). The channel cards hide a closed posting's link and form by this. */
export function isPostingOpen(posting: IntakePosting): boolean {
  return posting.status !== "closed";
}

/** The case's intake state from its postings: none at all, at least one open, or every
 *  one closed. */
export function intakeOf(postings: readonly IntakePosting[]): IntakeState {
  if (postings.length === 0) return { state: "unpublished" };
  const open = postings.filter(isPostingOpen).length;
  const closed = postings.length - open;
  return open > 0 ? { state: "live", open, closed } : { state: "closed", open: 0, closed };
}

/** Whether the case's newest lifecycle owns its intake: any lifecycle that is not closed.
 *  A running lifecycle ends intake through its own Close, which wraps the submitters up
 *  (closing-withdraws-candidates-in-flight); the stop door notifies nobody, so it must
 *  not end a run's intake behind its back. No lifecycle, or a closed one, leaves intake
 *  to the recruiter. */
export function lifecycleOwnsIntake(lifecycleStage: string | null | undefined): boolean {
  return lifecycleStage != null && lifecycleStage !== "closed";
}

/** The one intake action the detail offers, or null when a running lifecycle owns intake.
 *  An unpublished case can always be published (the publish door dedups onto an open
 *  posting); a live one can be stopped, and a closed one reopened - a reopen is an
 *  ordinary publish that mints a FRESH link while the old one stays closed - only when no
 *  running lifecycle owns intake. */
export function intakeAction(intake: IntakeState, lifecycleStage: string | null | undefined): IntakeAction | null {
  if (intake.state === "unpublished") return "publish";
  if (lifecycleOwnsIntake(lifecycleStage)) return null;
  return intake.state === "live" ? "stop" : "reopen";
}
