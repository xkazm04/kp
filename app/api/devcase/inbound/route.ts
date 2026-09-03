import { NextRequest, NextResponse } from "next/server";
import { getPostingByToken } from "@/app/_lib/db/devcase";
import { intakeSubmission, PostingClosedError } from "@/app/_lib/distribution";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { rateLimit } from "@/app/_lib/rate-limit";
import { resumeCollectingLifecycle } from "@/app/_lib/tasks";
import { submissionReference } from "@/app/_lib/devcase-reference";


// THROTTLE (route.test.ts). Every accepted call here writes a submission row, sends the
// candidate acknowledgement over the comms relay to a CALLER-SUPPLIED address, and can
// resume a collecting lifecycle — a real Python/LLM evaluation pass. This route is PUBLIC
// (public-routes.ts lists `/api/devcase/inbound` exactly) and had no bound at all, so an
// unauthenticated holder of the shareable apply link could drive all three unboundedly by
// varying `candidate`/`repoRef` (the intake dedup key): an open mailer on the deployment's
// relay plus unmetered model spend. The sibling public paths already self-limit —
// session-start at 50 sessions/token/day, `[id]/chat` at 30/10min + 3000/24h.
//
// Two windows, both keyed by the apply TOKEN and never by the caller's IP (an abuser
// rotates IPs; genuine applicants behind one office/campus NAT share one — the
// devcase-chat rationale), and both far above real use: a per-POSTING apply link takes a
// handful of applications per 10 minutes, and the burst window recovers on its own so a
// throttled channel is never stuck for the day.
const BURST_LIMIT = 30; // per 10 min — one posting's arrival rate, generously
const DAILY_LIMIT = 300; // per 24h — the aggregate for the link (cf. 50 live sessions/day)

// Direction B — the public application webhook. An external channel (job board / ATS / an
// apply form) POSTs a candidate's application here using the posting's apply token; we
// record it, acknowledge the candidate, and — if a lifecycle is collecting — resume it
// automatically (evaluate → rank → promote). This removes the manual submission step.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      token?: string;
      candidate?: string;
      repoRef?: string;
      contact?: string;
      notes?: string;
      /** The applicant's language, so the acknowledgement is not written in ours. */
      locale?: string;
    };
    // PUBLIC webhook: the apply token is the ONLY accepted credential. We deliberately do
    // NOT accept a `postingId` shortcut here — posting ids are internal, non-crypto keys
    // (random-id.ts, "Never a security boundary") so accepting one would let an
    // unauthenticated caller guess/enumerate ids and inject submissions into any posting,
    // bypassing the bearer token entirely. The token is a 128-bit CSPRNG value
    // (distribution.ts) that resolves to exactly one existing posting. The authenticated
    // internal path that takes a postingId directly is /api/devcase/submit.
    const token = request.nextUrl.searchParams.get("token") || body.token || "";
    const posting = token ? getPostingByToken(token) : undefined;
    // A code, not prose: the public apply form renders this in the reader's language
    // (the same refusal the session mint answers when a link stops resolving).
    if (!posting) return jsonRefusal("DEVCASE_APPLY_TOKEN_REQUIRED", 401);
    // W5-3 — a closed posting answers honestly instead of acknowledging a
    // submission nobody will process ("queued, never ghosts" cuts both ways:
    // a false ack IS a ghost with extra steps).
    if (posting.status === "closed") {
      // Same refusal, same code as the catch below and as the live-session finalize —
      // three doors onto one intake must not disagree about what they say, and the
      // English sentence was hand-copied into two of them.
      return jsonRefusal("POSTING_CLOSED", 410);
    }
    const postingId = posting.id;
    if (!body.candidate || !body.repoRef) {
      return jsonRefusal("DEVCASE_SUBMISSION_FIELDS_REQUIRED", 400);
    }

    // Throttle AFTER the credential (401), lifecycle (410) and validation (400) refusals —
    // those must keep answering honestly without consuming a real applicant's slot — and
    // BEFORE the intake, so a refused call sends no mail, writes no row and starts no run.
    // Through the refusal CHOKEPOINT, not a hand-rolled envelope: the shared message
    // still reaches the client (REFUSAL_ERRORS.TOO_MANY_REQUESTS *is* RATE_LIMITED_ERROR)
    // and the code rides beside it, so a throttled apply form says so in Czech.
    if (!rateLimit(`devcase-inbound:${token}`, { limit: BURST_LIMIT, windowMs: 10 * 60_000 })) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    if (!rateLimit(`devcase-inbound-day:${token}`, { limit: DAILY_LIMIT, windowMs: 24 * 60 * 60_000 })) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }

    const { submission, isNew } = await intakeSubmission({
      postingId,
      candidateRef: body.candidate,
      repoRef: body.repoRef,
      contact: body.contact,
      notes: body.notes,
      locale: typeof body.locale === "string" ? body.locale : null,
    });

    if (isNew) resumeCollectingLifecycle(postingId);

    // The candidate is handed an OPAQUE reference (devcase-reference.ts), not the store
    // id the apply page used to print. `submissionId` still rides for external channels
    // that correlate their own records against it.
    return NextResponse.json({
      ok: true,
      submissionId: submission.id,
      reference: submissionReference(submission.id),
      duplicate: !isNew,
      acknowledged: true,
    });
  } catch (error) {
    // Defensive: the pre-check above already 410s a closed posting, but the shared
    // core also guards (e.g. if the posting closes mid-request) — map it to 410 too.
    if (error instanceof PostingClosedError) {
      return jsonRefusal("POSTING_CLOSED", 410);
    }
    // A PUBLIC candidate door: the thrown message is a store/spawn detail (SQLITE_*
    // codes, the absolute db path, relay stderr) and must never reach an applicant.
    // The code is what the apply surface localizes.
    return safeJsonError(error, "api:devcase/inbound", "DEVCASE_INTAKE_FAILED");
  }
}
