import { NextResponse } from "next/server";
import { getDevSession, getPostingByToken, submitDevSession } from "@/app/_lib/db/devcase";
import { intakeSubmission, PostingClosedError } from "@/app/_lib/distribution";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { rateLimit } from "@/app/_lib/rate-limit";
import { resumeCollectingLifecycle } from "@/app/_lib/tasks";
import { sessionTokenMatches } from "@/app/_lib/devcase-session-auth";
import { submissionReference } from "@/app/_lib/devcase-reference";

// THROTTLE (session-intake-guards.test.ts, rate-limit-contract.test.ts). Since this
// door joined the shared intake below, one accepted call sends the candidate
// acknowledgement over the comms relay to a CALLER-SUPPLIED address and can resume a
// collecting lifecycle — a real Python/LLM evaluation pass. That is the same spend the
// inbound webhook carries two windows for, and this was the one public intake door with
// no bound at all. Keyed by the apply TOKEN, never the caller's IP: candidates sitting a
// timed assessment legitimately share a NAT (the devcase-chat/flush rationale), and an
// abuser rotates IPs anyway. 60/24h is far above real use — session-start already caps a
// posting at 50 sessions/day, and a session finalizes ONCE (a repeat finalize is
// idempotent and costs nothing), so a genuine posting cannot reach it.
//
// The budget is written as a LITERAL at the call site, the same way the flush and chat
// siblings write theirs: rate-limit-contract.test.ts pins that text verbatim, and a
// route module may not `export const` anything but a handler (Next's generated route
// types reject it — see session-limits.ts, backlog item 57).

// Live Work Surface (moonshot E) — finalize a session: resolve the posting from the
// session's token and create the linked submission (idempotent via submitDevSession).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = getDevSession(id);
    // A dead or structurally-broken session (no owning token) is one refusal: both mean
    // "this attempt cannot be sealed, open your apply link again", and separating them
    // would confirm which session ids exist. It was two different bare English sentences.
    if (!session || !session.token) return jsonRefusal("DEVCASE_SESSION_NOT_FOUND", 404);
    // UAT M9 — the live-work surface is now the SOLE submit path for workspace
    // cases, so it carries the candidate's identity (name + contact) the repo form
    // used to, keeping a winning evaluation reachable.
    const body = (await request.json().catch(() => ({}))) as {
      candidate?: unknown;
      contact?: unknown;
      token?: unknown;
      locale?: unknown;
    };
    // A session id alone is not authority to FINALIZE someone's session: sealing it
    // early would end another candidate's attempt mid-work. Same apply-token re-check
    // as the flush and chat routes (devcase-session-auth.ts).
    if (!sessionTokenMatches(session.token, body.token)) {
      return jsonRefusal("SESSION_TOKEN_REQUIRED", 403);
    }
    const posting = getPostingByToken(session.token);
    if (!posting) return jsonRefusal("DEVCASE_SESSION_UNAVAILABLE", 404);
    // bug-ui-scan-2026-07-09 (dev-submissions-live-work-surface #2): the live-session
    // finalize is a SECOND intake path — it must inherit the inbound webhook's honest
    // closed-posting rejection (inbound/route.ts:33) instead of minting a submission on
    // an intake the recruiter has closed. Re-read via the session token and 410 when
    // the posting has closed, matching the public path so the two intakes agree.
    if (posting.status === "closed") {
      // The English here was a hand-copy of REFUSAL_ERRORS.POSTING_CLOSED, on a public
      // candidate surface — so the one sentence existed twice and only one copy was
      // localizable. One producer now, and the client reads the code.
      return jsonRefusal("POSTING_CLOSED", 410);
    }

    // Throttle AFTER the 403/404/410 refusals — those must keep answering honestly
    // without consuming a real candidate's slot — and BEFORE the intake, so a refused
    // call sends no mail, writes no row and starts no run.
    if (!rateLimit(`devcase-finalize:${session.token}`, { limit: 60, windowMs: 24 * 60 * 60_000 })) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }

    // The identity the submission is filed under, computed ONCE here so the seal below
    // and the shared intake that follows agree on the dedup key (posting, candidate,
    // repo). `submitDevSession` applies the same fallback chain when handed no name; we
    // hand it the resolved one so there is a single spelling of it in this request.
    const candidateRef = (typeof body.candidate === "string" ? body.candidate.trim() : "") || session.candidateRef || "live-session";
    const contact = (typeof body.contact === "string" ? body.contact.trim() : "") || undefined;
    // Whether THIS call is the one that sealed the session — the "genuinely new arrival"
    // signal `resumeCollectingLifecycle` wants. Read before the write: a retry from a
    // candidate who double-clicked must not start a second evaluation pass.
    const alreadyFinalized = Boolean(session.submissionId);

    // Seal first, in ONE transaction (submitDevSession) — the candidate's work is what
    // this request exists to protect, and the link is what makes a retry idempotent.
    const submission = submitDevSession(id, posting.id, { candidate: candidateRef, contact: contact ?? null });
    if (!submission) {
      return safeJsonError(
        new Error(`submitDevSession returned null for session ${id}`),
        "api:devcase/session/submit",
        "DEVCASE_SUBMIT_FAILED"
      );
    }

    // Event trigger, on the SEAL rather than on the intake's `isNew`: the row already
    // exists by the time the shared intake runs below (that is what makes the ack
    // idempotent), so `isNew` is structurally false here and reading it would mean the
    // lifecycle never resumed at all. The seal is the honest newness signal — and it
    // runs BEFORE the acknowledgement so a relay outage cannot permanently cost this
    // posting its evaluation pass (the ack itself stays retryable on its own marker).
    if (!alreadyFinalized) resumeCollectingLifecycle(posting.id, posting.workspaceId);

    // …then through the SHARED intake, exactly like the two sibling doors
    // (inbound/route.ts, submit/route.ts). This is the whole point of the change: the
    // live surface used to call the store directly, so it produced no acknowledgement
    // and resumed no lifecycle — the screen said "you'll hear back" and nothing was
    // sent and nothing was evaluated, on the ONE intake path a workspace case has.
    //
    // `intakeSubmission` is safe to call on the row we just created: createSubmission is
    // idempotent on (posting, candidate, repo) — it re-selects rather than inserting a
    // second row — and the ack is driven off a DURABLE outbox marker, not an in-request
    // flag, so this is the "new-or-unacked" path that helper documents. It cannot run
    // inside the transaction above (it awaits sendComm; `await` inside a
    // db.transaction() silently voids the atomicity).
    await intakeSubmission({
      postingId: posting.id,
      candidateRef,
      // The same synthetic repo ref submitDevSession stamps, so the dedup key matches
      // the row it just wrote instead of minting a twin.
      repoRef: `session:${id}`,
      contact,
      // The acknowledgement is written to the CANDIDATE, so it is written in the
      // language they worked the case in — the surface sends its own locale.
      locale: typeof body.locale === "string" ? body.locale : null,
    });

    // The candidate gets an OPAQUE reference, not the store id (devcase-reference.ts).
    // The store id never rides this public wire; an operator reads it from
    // GET /api/devcase/postings (submissions inlined), which is what the e2e journey does.
    return NextResponse.json({ reference: submissionReference(submission.id) });
  } catch (error) {
    // Defensive: the pre-check above already 410s a closed posting, but the shared
    // core also guards (e.g. if the posting closes mid-request) — map it to 410 too,
    // the same way the inbound webhook does.
    if (error instanceof PostingClosedError) return jsonRefusal("POSTING_CLOSED", 410);
    // A PUBLIC candidate door: the thrown message is a store/relay detail (SQLITE_*
    // codes, the absolute db path, relay stderr) and must never reach an applicant.
    return safeJsonError(error, "api:devcase/session/submit", "DEVCASE_SUBMIT_FAILED");
  }
}
