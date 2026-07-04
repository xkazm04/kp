import { NextResponse } from "next/server";
import { getLifecycle, listPostings, listSubmissions, setPostingStatus, updateLifecycle } from "@/app/_lib/db";
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
    const lc = getLifecycle(id);
    if (!lc) return NextResponse.json({ error: "lifecycle not found" }, { status: 404 });
    if (lc.stage === "closed") return NextResponse.json({ ok: true, alreadyClosed: true, notified: 0 });

    // Every posting this lifecycle distributed through (directly linked, or any
    // posting of its approved case).
    const postings = listPostings().filter(
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
      for (const submission of listSubmissions(posting.id)) {
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

    // Always reached now (sends no longer throw out of the loop): flip the stage and
    // write the audit so the close is atomic-in-effect and a re-run short-circuits on
    // the `stage === "closed"` guard above rather than re-notifying.
    const failNote = notifyFailures ? `, ${notifyFailures} note(s) failed (recoverable via Resend)` : "";
    updateLifecycle(id, { stage: "closed", detail: `closed by a human — ${notified} candidate(s) notified${failNote}` });
    recordAudit({
      lifecycleId: id,
      actor: "human",
      action: "closed",
      reason: `${postings.length} posting(s) closed; ${notified} non-promoted candidate(s) notified${failNote}`,
    });
    return NextResponse.json({ ok: true, notified, notifyFailures, postingsClosed: postings.length });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Close failed." }, { status: 500 });
  }
}
