import { NextResponse } from "next/server";
import { claimLifecycleClose, listPostings, listSubmissions, setPostingStatus, updateLifecycle } from "@/app/_lib/db/devcase";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
// The shared by-id owner guard (sibling module - a route file may export only handlers).
import { ownedLifecycle } from "../../../devcase-owned-lifecycle";
import { sendComm } from "@/app/_lib/comms";
import { recordAudit } from "@/app/_lib/dev-control";


// W5-3 (DEVO3) — human-gated case close-out. "closed" sat in the lifecycle
// STAGES (and the control room's TERMINAL set) with no writer: a lifecycle
// parked at `promoted` forever, every non-promoted submitter was ghosted
// despite an ack promising review, and the never-expiring apply token kept
// collecting applications nobody would process. Closing is an adverse-adjacent
// action, so it is HUMAN-triggered (this route has no automated caller),
// mirroring the orchestrator's adverse-action policy.
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    // OWNERSHIP. Closing dispatches a wrap-up rejection to every non-promoted submitter,
    // so a known lifecycle id from another studio used to reach THEIR candidates through
    // this door. A cross-tenant id now answers the same 404 a nonexistent one does. The
    // row's own workspace still drives the enumeration and the outbox filing below - that
    // is the tenant of the WORK; this is the tenant of the CALLER.
    const lc = ownedLifecycle(id, await currentWorkspace());
    if (!lc) return NextResponse.json({ error: "lifecycle not found" }, { status: 404 });

    // ATOMIC CLAIM (bug-ui-scan-2026-07-09 #1). The old guard read `lc.stage`, then
    // hit `await sendComm(...)` in the loop below, then wrote `stage = "closed"` — a
    // check-then-act window in which a second overlapping/retried close read the same
    // still-open stage and re-dispatched the ENTIRE rejection batch (the dedup Set is
    // per-request, useless across requests). Instead, flip the stage NOW via one
    // conditional UPDATE (`WHERE stage != 'closed'`): exactly the request that flips
    // it (changes === 1) owns the close and proceeds to notify; any concurrent or
    // later call sees changes === 0 and no-ops here — before a single comm is sent.
    // The flip is committed before the first `await`, so a mid-send failure can't undo
    // the close (adverse comms are best-effort + Outbox-recoverable; the decision is
    // the source of truth).
    if (!claimLifecycleClose(id)) return NextResponse.json({ ok: true, alreadyClosed: true, notified: 0 });

    // Every posting this lifecycle distributed through (directly linked, or any
    // posting of its approved case).
    //
    // TENANT SCOPE (D5): enumerate within the LIFECYCLE'S OWN workspace, not the
    // session's and not the default. `listPostings()` bare read the DEFAULT workspace,
    // so closing any non-default team's lifecycle matched zero postings: nobody was
    // notified, no posting was closed, and the route still answered `{ok:true,
    // notified:0}` — a silent success over a close that did nothing. Deriving the
    // tenant from the lifecycle (rather than from currentWorkspace()) also keeps the
    // route correct for a future automated/background caller that has no session.
    const postings = listPostings(lc.workspaceId).filter(
      (p) => (lc.postingId && p.id === lc.postingId) || (lc.caseId && p.caseId === lc.caseId)
    );

    // Courteous wrap-up to every non-promoted submitter — the same no-ghosting
    // standard the main pipeline enforces (screen-wave dispatches rejections).
    // Deduped by recipient so two submissions from one person get one note.
    const seen = new Set<string>();
    let notified = 0;
    let notifyFailures = 0;
    for (const posting of postings) {
      const role = posting.roleTitle ?? posting.caseTitle ?? "the role";
      for (const submission of listSubmissions(posting.id, lc.workspaceId)) {
        if (submission.status === "promoted") continue;
        const to = submission.contact || submission.candidateRef;
        if (!to || seen.has(to)) continue;
        seen.add(to);
        // ISOLATE each send: a relay/network failure on ONE wrap-up note must NOT
        // abort the close. The old loop let a single throw leave the lifecycle
        // half-closed — some postings flipped, stage never set, no audit — and a
        // re-run re-notified everyone already messaged (the dedup Set is per-request).
        // sendComm's durable Outbox records the attempt, so a failed note is
        // recoverable via Resend; here we just count it and carry on.
        try {
          await sendComm({
            to,
            subject: `Update on your submission — ${role}`,
            body: `Hi ${submission.candidateRef ?? "there"},\n\nThank you for the time you put into the assignment for ${role}. The intake for this role has now closed, and we won't be moving forward with your submission. We'd be glad to see you apply for a future role.\n\nBest,\nThe hiring team`,
            kind: "rejection",
            ref: submission.id,
            // TENANT SCOPE (D5): the outbox's tenant derivation reads pipeline_entries by
            // ref, and a dev-case submission id is not a pipeline entry — so without this
            // the wrap-up note filed into the DEFAULT team's Outbox, invisible (and
            // un-resendable) to the team whose case was actually closed.
            workspaceId: lc.workspaceId,
          });
          notified += 1;
        } catch (commError) {
          notifyFailures += 1;
          console.error(
            `[lifecycle:close] wrap-up note failed for "${to}" (${submission.id}):`,
            commError instanceof Error ? commError.message : commError
          );
        }
      }
      setPostingStatus(posting.id, "closed");
    }

    // Stage is already "closed" (claimed atomically above); now that the count is
    // known, stamp the human-facing detail and write the audit. Only the claiming
    // request reaches here, so exactly one audit row and one notified-count are
    // written per close. (sends no longer throw out of the loop, so this is always
    // reached.)
    const failNote = notifyFailures ? `, ${notifyFailures} note(s) failed (recoverable via Resend)` : "";
    // HONEST REPORTING over erroring (D5). "No postings" is a legitimate state — a
    // lifecycle can be closed before it ever reached `published` — and the close itself
    // genuinely happened (the stage flip is committed above), so a 4xx/5xx would tell the
    // client the lifecycle is still open when it is not. What must NOT happen is the old
    // bare `{ok:true, notified:0}` that reads identically to a successful close of a case
    // with nothing to notify. The response therefore says so explicitly (`noPostings`),
    // and the lifecycle detail + audit row record it in the same words a human reads.
    const noPostings = postings.length === 0;
    const detail = noPostings
      ? "closed by a human — no open postings were found, so no candidate was notified"
      : `closed by a human — ${notified} candidate(s) notified${failNote}`;
    updateLifecycle(id, { detail });
    recordAudit({
      lifecycleId: id,
      actor: "human",
      action: "closed",
      reason: noPostings
        ? "no postings found for this lifecycle — nothing was closed and nobody was notified"
        : `${postings.length} posting(s) closed; ${notified} non-promoted candidate(s) notified${failNote}`,
    });
    return NextResponse.json({ ok: true, notified, notifyFailures, postingsClosed: postings.length, noPostings });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Close failed." }, { status: 500 });
  }
}
