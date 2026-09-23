// POST-COMMIT arrival hook: what happens when a candidate STANDS on a `homework`
// column — the work-sample step of the Enterprise funnel (Accepted → Homework →
// AI interview → Screened → Human interview → Offer → Hired).
//
// THE GAP THIS CLOSES. Before this module nothing in the product ever sent a case to
// a NAMED candidate. A dev case was published as a POSTING — a shareable apply token
// candidates had to discover — while sourced candidates were seeded straight onto the
// board. Two halves of one step, joined by a recruiter remembering to copy a link.
// A homework column therefore did nothing on arrival: the candidate sat in it, and the
// AI interview that follows had no submission to be grounded in.
//
// It holds the SAME THREE RULES as stage-hooks.ts, for the same reasons:
//
//  1. It runs AFTER the stage write has COMMITTED, never inside the transaction — it
//     awaits an LLM design chain, a Python spawn and a comms round trip, any one of
//     which between BEGIN and COMMIT would silently destroy the move's atomicity.
//  2. It is BEST-EFFORT. No design failure, dead relay or empty meter may turn a
//     completed stage move into a failed one. Every refusal is logged and the move stands.
//  3. It never CLAIMS more than happened. The outcome carries the outbox's real
//     delivery status (`sent` / `queued` / `failed`), never a blanket "sent", and an
//     unaddressable candidate produces no row that says a case went out.
//
// DELIBERATELY NO NEW EVENT KINDS — the same constraint stage-hooks.ts documents. The
// pipeline event vocabulary is pinned by set equality across `decision-attribution.ts`,
// the feed's `pipelineEventCatalog.ts` and a localized label per kind in all four
// catalogs. This hook reports itself through state the recruiter's surfaces already
// read: the OUTBOX row `dispatchCaseInvite` writes (Comms Center + the candidate
// drawer's Messages section, keyed by the entry id), the lifecycle's own
// `awaiting_approval` card in the Dev/Cases control room, and a server log line for
// every refusal. That outbox row is also this hook's idempotence key.

import { meterGate } from "./billing/enforce";
import { dispatchCaseInvite } from "./comms-dispatch";
import { entryContactability } from "./comms-contactability";
import type { OutboxStatus } from "./comms-status";
import { planStep } from "./decision-config-schema";
import { getDevCase, listDevCasesForJob, listOutboxFiltered, listPostings, createLifecycle, getLifecycle, getOpenPosting, type DevCaseRecord } from "./db/devcase";
import { getJob, loadJd } from "./db/jobs";
import type { PipelineEntry } from "./db/core";
import { getInterviewPlan } from "./interview-plan";
import { jdSlugOfJobId } from "./jd-limits";
import { publicBaseUrl } from "./public-base-url.ts";
import { effectiveInterviewGate } from "./stage-hooks";
import { intakeOf } from "../features/tools/devcases/DevCaseDetail.publish";

/** The comms/outbox kind one homework invite writes. Read back as the idempotence
 *  key, so the pair "(entry, posting) → at most one assignment letter" needs no new
 *  column and no new table. */
const CASE_INVITE_KIND = "case_invite";

/** The distribution channel a board-driven invite publishes on. `local` is the
 *  in-product apply surface (`/devcase/apply/<token>`) — the only channel that both
 *  mints a token we can mail and accepts the submission back. */
const INVITE_CHANNEL = "local";

/** How far back the idempotence read looks in the candidate's own outbox. A hiring
 *  cycle produces a handful of letters; 50 covers a pathological one without turning a
 *  post-commit hook into a table scan. */
const OUTBOX_LOOKBACK = 50;

/** A dev case is sendable once it has been APPROVED — the status `saveDevCase` writes,
 *  which both the auto-approve gate and the recruiter's Approve button funnel through
 *  (db/devcase.ts). A lifecycle still at `designed` / `awaiting_approval` has no
 *  `dev_cases` row at all, so there is nothing here to send. */
const SENDABLE_CASE_STATUS = "approved";

export type HomeworkArrivalOutcome =
  /** The hook does not govern this arrival. */
  | { outcome: "skipped"; reason: "no_job" | "no_jd" }
  /** An assignment letter already exists for this (entry, posting) — the idempotence guard. */
  | { outcome: "already_invited" }
  /** No case yet and the column gates case creation for a human: the lifecycle is
   *  parked at its own `awaiting_approval` gate. Nothing was sent. */
  | { outcome: "case_pending"; lifecycleId: string; stage: string }
  /** Published (or reused) a posting and mailed it; `delivery` is the outbox's real
   *  claim, forwarded verbatim — never narrowed or upgraded on the way out. */
  | { outcome: "invited"; delivery: OutboxStatus; postingId: string }
  /** Nothing was sent, and the reason is on the server log. The move still stands. */
  | { outcome: "failed"; reason: HomeworkRefusal };

/** Why nothing was sent. `intake_stopped`: the case HAS postings and every one is closed
 *  (a recruiter's stop, or a lifecycle's close-out) — intake was ended deliberately, and
 *  an arrival is not the door that reopens it. */
type HomeworkRefusal = "unaddressable" | "suppressed" | "billing" | "no_case" | "intake_stopped" | "error";

/**
 * Run the homework arrival for an already-COMMITTED stage move.
 *
 * `attempt` is the re-entry counter for the ONE legitimate re-run: a workspace whose
 * job had no case yet designs one in this same background task and then comes back
 * around to send it. Bounded at 1 so a lifecycle that lands anywhere other than a
 * sendable case can never loop.
 *
 * Never throws — the caller's move already committed.
 */
export type HomeworkArrivalOptions = {
  /** Request origin when one exists; the hook normally has none. */
  origin?: string | null;
  /** Re-entry counter — see the docblock. */
  attempt?: number;
  /** The design chain, injectable ONLY so the arrival's own wiring can be tested
   *  without spawning the Python/LLM lifecycle (the unit suite is Node-only and
   *  keyless by contract). Production never passes it: the default is the same
   *  `runLifecycle` the `lifecycle` task kind wraps. */
  runDesign?: (lifecycleId: string, workspaceId: string) => Promise<unknown>;
};

export async function runHomeworkArrival(
  entry: PipelineEntry,
  stage: string,
  workspaceId: string,
  opts: HomeworkArrivalOptions = {}
): Promise<HomeworkArrivalOutcome> {
  const attempt = opts.attempt ?? 0;
  const jobId = (entry.jobId ?? "").trim();
  if (!jobId) return { outcome: "skipped", reason: "no_job" };

  try {
    // THE SEND GATE FIRST — before a case is designed or a token published. A candidate
    // whose consent has lapsed (not yet swept) or who was erased still carries a contact,
    // so the addressability check further down let them through: the hook published a
    // live apply token (or ran the whole design chain first) and only the dispatch threw.
    // entryContactability asks commsSendSuppression the way sendComm will.
    const gate = entryContactability(entry, CASE_INVITE_KIND);
    if (!gate.ok && gate.code) {
      return refuse(entry, "suppressed", `the send gate refuses this candidate (${gate.reason})`);
    }

    // The job's newest SENDABLE assignment. Newest-first is `listDevCasesForJob`'s own
    // order, and it is workspace-scoped there — a job id is not an authority to read
    // another team's cases.
    const existing = listDevCasesForJob(jobId, workspaceId).find((c) => c.status === SENDABLE_CASE_STATUS);
    if (existing) return await inviteToCase(entry, existing, workspaceId, opts.origin ?? null);

    // NO CASE YET. Re-entry must not design a second one: if the design round we just
    // ran produced nothing sendable, stop and say so rather than starting again.
    if (attempt > 0) {
      return refuse(entry, "no_case", "the designed assignment did not reach an approved case");
    }
    return await designThenInvite(entry, jobId, stage, workspaceId, opts);
  } catch (error) {
    // The stage move already committed and stands. All this can do is decline to act
    // and say why — the candidate simply waits in the column where a recruiter sees them.
    return refuse(entry, "error", error instanceof Error ? error.message : String(error));
  }
}

/** Ensure the case is live on an apply token and mail it to THIS candidate, once. */
async function inviteToCase(
  entry: PipelineEntry,
  devCase: DevCaseRecord,
  workspaceId: string,
  origin: string | null
): Promise<HomeworkArrivalOutcome> {
  // Uncontactable candidates are refused BEFORE anything is published — the same verdict
  // (and the same send gate) the comms layer itself applies, so "unaddressable" and
  // "suppressed" mean here exactly what they mean in the Outbox. Asked again here, after
  // a design round that may have taken minutes, because publishing mints a live apply
  // token and minting one for a letter that cannot go is a real side effect nobody asked
  // for. The dispatch's own gate stays the final re-check.
  const contactable = entryContactability(entry, CASE_INVITE_KIND);
  if (!contactable.ok) {
    return contactable.code
      ? refuse(entry, "suppressed", `the send gate refuses this candidate (${contactable.reason})`)
      : refuse(entry, "unaddressable", "no deliverable contact address is on file");
  }

  // An OPEN posting is reused verbatim — a case must hand every candidate the identical
  // materials and the identical submit channel (the freeze-at-publish rule the
  // orchestrator states), so a second token for one case is never the right answer.
  // `createPosting` behind the adapter dedups on (workspace, case, channel) as well, so
  // even a concurrent arrival resolves to the same row.
  let posting = getOpenPosting(devCase.id, INVITE_CHANNEL, workspaceId);
  if (!posting) {
    const { getAdapter } = await import("./distribution");
    // A STOPPED INTAKE STAYS STOPPED. No open posting on this channel means one of two
    // things: the case was never published (publish it — the step this hook exists for),
    // or its intake was ENDED — every posting closed, by the recruiter's stop door or a
    // lifecycle's close-out. The second is a decision, and minting a fresh token here
    // would silently reverse it; reopening is the recruiter's Reopen, never a board move.
    // The state is read by `intakeOf`, the same rule the assignment detail renders and
    // offers Stop / Reopen by. Read AFTER the await and immediately before the adapter:
    // `publish` reaches createPosting's IMMEDIATE transaction without yielding, so a stop
    // cannot land between this re-check and the write.
    const casePostings = listPostings(workspaceId).filter((p) => p.caseId === devCase.id);
    if (intakeOf(casePostings).state === "closed") {
      return refuse(entry, "intake_stopped", `case ${devCase.id}'s intake was stopped; a recruiter reopens it in Dev → Cases`);
    }
    posting = await getAdapter(INVITE_CHANNEL).publish(devCase);
  }
  if (!posting.token) return refuse(entry, "no_case", `posting ${posting.id} carries no apply token`);

  // IDEMPOTENCE, before anything is composed. The candidate's own outbox is the ledger:
  // one `case_invite` row whose body carries THIS posting's token means the letter has
  // already gone out, whoever sent it. Re-entering the column, a bulk move touching the
  // row twice and a retried poll all resolve to the same (entry, posting) pair. A case
  // legitimately re-published after a close mints a new token and so is a new letter,
  // which is the behaviour we want.
  if (alreadyInvited(entry.id, posting.token, workspaceId)) return { outcome: "already_invited" };

  const link = `${publicBaseUrl(origin)}/devcase/apply/${posting.token}`;
  // The delivery claim is the dispatcher's, handed back untouched: `queued` when no
  // relay is configured, `failed` when the relay threw. Never upgraded to "sent" here.
  const delivery = await dispatchCaseInvite(entry, link, { workspaceId });
  return { outcome: "invited", delivery, postingId: posting.id };
}

/**
 * NO CASE YET — design one, then come back and send it.
 *
 * THE "RE-RUN ONCE PUBLISHED" SEAM, and why it is this one. `startTask("lifecycle", …)`
 * is fire-and-forget: it returns a TaskRecord, not a promise, and tasks.ts exposes no
 * completion callback. Chaining onto it would mean either polling the task row from a
 * post-commit hook or adding a completion notification to a module several other
 * features share. This hook is ALREADY a background task with its own lifetime
 * (`afterResponse`, scheduled by stage-hooks.ts), so the smallest reliable seam is to
 * await the orchestrator in place and re-enter once — the same function the `lifecycle`
 * task kind wraps, with the same tenant assertion, and no new cross-module wiring.
 * The cost is that this run does not appear in the recruiter's task tray; it is
 * recorded instead on the lifecycle itself, which the Dev/Cases control room lists.
 *
 * The column's gate governs the LIFECYCLE's own human gate rather than adding a second
 * one: `auto` designs and publishes unattended; `human` designs and then parks at
 * `awaiting_approval`, where the recruiter approves it in the Dev/Cases control room
 * (the same Approve button POST /api/devcase/lifecycle/[id]/approve is behind). On the
 * next arrival — or the next move into the column — the case is sendable and the
 * branch above mails it.
 */
async function designThenInvite(
  entry: PipelineEntry,
  jobId: string,
  stage: string,
  workspaceId: string,
  opts: HomeworkArrivalOptions
): Promise<HomeworkArrivalOutcome> {
  // The need is built off the JOB'S SAVED JD, which is also what ties the resulting case
  // back to this job: `resolveCaseJobId` re-derives `jd-<slug>` from `need.jdSlug` and
  // verifies the opening exists, so the case this designs is found by
  // `listDevCasesForJob` on every later arrival instead of being orphaned.
  const slug = jdSlugOfJobId(jobId);
  const jd = slug ? loadJd(slug, workspaceId) : null;
  if (!jd) return { outcome: "skipped", reason: "no_jd" };

  const gate = homeworkGate(stage, workspaceId);

  // Same cheap pre-gate the lifecycle route runs: one lifecycle is one dev-case design
  // pipeline, and an automatic hook firing across a bulk move must not be the thing that
  // drives the allowance negative.
  if (meterGate("case_designs", { workspace: workspaceId })) {
    return refuse(entry, "billing", "the case-design allowance is exhausted");
  }

  const job = getJob(jobId, workspaceId);
  const need = {
    title: jd.title || job?.title || "Work-sample assignment",
    jdSlug: jd.slug,
    jdText: jd.body ?? "",
    roleFamily: job?.roleFamily || "software_engineering",
    stack: [] as string[],
    responsibilities: [] as string[],
    codebaseRefs: [] as { kind: string; ref: string }[],
  };
  // `auto` on the lifecycle IS the column's gate: false routes the design to
  // `awaiting_approval` instead of auto-approving and publishing it.
  const lc = createLifecycle(need, gate === "auto", entry.locale ?? null, workspaceId);
  const runDesign =
    opts.runDesign ??
    (async (lifecycleId: string, ws: string) => {
      // Dynamic, not a static import: db/pipeline imports stage-hooks, which imports this
      // module, and the orchestrator imports db/pipeline — a static edge here would close
      // that cycle and put the orchestrator's module initialization inside the store's.
      const { runLifecycle } = await import("./devcase-orchestrator");
      return runLifecycle(lifecycleId, undefined, undefined, ws);
    });
  await runDesign(lc.id, workspaceId);

  const after = getLifecycle(lc.id);
  const landed = after?.stage ?? "unknown";
  if (gate === "human" || !after?.caseId) {
    console.warn(
      `[stage-hooks:homework] ${entry.id}: assignment designed but not sent — lifecycle ${lc.id} is at '${landed}'. A recruiter approves it in Dev → Cases.`
    );
    return { outcome: "case_pending", lifecycleId: lc.id, stage: landed };
  }

  const designed = getDevCase(after.caseId);
  if (!designed || designed.status !== SENDABLE_CASE_STATUS) {
    return refuse(entry, "no_case", `lifecycle ${lc.id} finished at '${landed}' with no approved case`);
  }
  // Re-enter through the front door rather than calling `inviteToCase` directly: the
  // case list is re-read, so a case another arrival designed in the meantime wins over
  // ours instead of two candidates on one job being handed different assignments.
  return runHomeworkArrival(entry, stage, workspaceId, { ...opts, attempt: 1 });
}

/**
 * The gate that actually governs a homework column — resolved by exactly the rule
 * `effectiveInterviewGate` states for an AI interview column, so the two arrival hooks
 * cannot drift: an explicitly SAVED hiring plan's gate is honored as saved, and only a
 * workspace that has never saved a plan at all falls to `auto`.
 *
 * A saved plan with NO step for this column resolves to `human`. That is the safe
 * reading of silence on a step that spends a design run and mails a candidate: nothing
 * configured it, so nothing goes out unattended.
 */
export function homeworkGate(stage: string, workspaceId: string): "auto" | "human" {
  const step = planStep(getInterviewPlan(workspaceId), stage);
  return effectiveInterviewGate(step ?? { gate: "human" }, workspaceId);
}

/** Has an assignment letter for this posting already gone to this candidate?
 *
 *  Read off the OUTBOX rather than a pipeline event, because this hook adds no event
 *  kind (see the module header). `listOutboxFiltered` is workspace-scoped, and the
 *  posting's token is the discriminator inside the body: a `bounced` receipt is not a
 *  send, and `listOutboxFiltered` returns every status, so the check is on the rows the
 *  dispatcher itself wrote for this entry. */
function alreadyInvited(entryId: string, token: string, workspaceId: string): boolean {
  return listOutboxFiltered({ ref: entryId, kind: CASE_INVITE_KIND, limit: OUTBOX_LOOKBACK }, workspaceId).some(
    (row) => row.status !== "bounced" && (row.body ?? "").includes(token)
  );
}

/**
 * REFUSE, ON THE RECORD. Nothing was published and nothing was sent; the candidate
 * simply stays in the homework column, where a recruiter sees them, and the reason goes
 * to the server log.
 *
 * No approval gate is armed here, unlike the interview hook's `failOpenToTheHumanQueue`:
 * the `calendar` approval IS the Schedule tab's AI-round docket and means "this person
 * is waiting for an interview link", which is a different — and false — claim about
 * someone waiting for an assignment. Inventing a seventh approval kind to say it
 * properly is a good follow-up; claiming the wrong one is not.
 */
function refuse(
  entry: { id: string },
  reason: HomeworkRefusal,
  why: string
): HomeworkArrivalOutcome {
  console.warn(`[stage-hooks:homework] ${entry.id}: no assignment sent (${reason}) — ${why}.`);
  return { outcome: "failed", reason };
}
