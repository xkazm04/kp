import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { appendDialogTurns, getDialog } from "@/app/_lib/db/jobseeker-dialogs";
import { getJobseekerProfileById, mergePreferences, setPolishedCv } from "@/app/_lib/db/jobseeker-profiles";
import { fitTurnContext } from "@/app/_lib/jobseeker-fit-context";
import { JobseekerInputError, JobseekerTimeoutError, runJobseekerExchange } from "@/app/_lib/jobseeker-run";
import type { DialogReply, StudioTurn } from "@/app/_lib/jobseeker/types";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

const MAX_MESSAGE_CHARS = 4_000;

// POST /api/jobseeker/dialogs/[id]/message — one exchange: the seeker's message in,
// the agent's reply + the updated artifact out, persisted by COMPARE-AND-SWAP.
//
// Every refusal carries a CODE (api-contracts.md §1.1). An empty body answers
// INTAKE_TEXT_REQUIRED — the one existing generic "there is nothing to send"
// refusal; the studio kit resolves it in the reader's language. An oversized body is
// not refused but CUT at MAX_MESSAGE_CHARS, the intake route's shape.
//
// THROTTLE (rate-limit-contract.test.ts): every accepted message is a real,
// potentially-paid LLM call. Operator-gated, but in open mode the gate is a no-op,
// so per-IP 30/10min — a human reading a reply and typing runs far under one message
// per 20s. Runs AFTER the cheap refusals (404/409/400) so a rejected call never
// consumes budget, and BEFORE the spawn.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  // The seeker's own data, but still a WRITE behind a seat: a viewer seat may read the
  // feed, not spend a scan, a model turn or a source acknowledgement (route-capability-coverage).
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  try {
    const { id } = await params;
    const ws = await currentWorkspace();
    const dialog = getDialog(id, ws);
    if (!dialog) return jsonRefusal("JOBSEEKER_DIALOG_NOT_FOUND", 404);
    if (dialog.status !== "open") return jsonRefusal("JOBSEEKER_DIALOG_CLOSED", 409);
    const body = (await request.json().catch(() => ({}))) as { message?: unknown };
    const message = typeof body.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE_CHARS) : "";
    if (!message) return jsonRefusal("INTAKE_TEXT_REQUIRED", 400);
    const profile = getJobseekerProfileById(dialog.profileId, ws);
    if (!profile) return jsonRefusal("JOBSEEKER_PROFILE_MISSING", 404);

    if (!rateLimit(`jobseeker-dialog-message:${clientIpFrom(request.headers)}`, { limit: 30, windowMs: 10 * 60_000 })) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }

    // The transcript handed to the engine is the history BEFORE this message — the
    // engine fences the new message separately (exactly-once).
    const exchange = await runJobseekerExchange(
      {
        kind: dialog.kind,
        lang: dialog.lang,
        profile: profile.profile,
        preferences: profile.preferences,
        cvSourceText: profile.cvSourceText,
        artifact: dialog.artifact,
        transcript: dialog.transcript,
        message,
        // fit (WP5): the posting, its match and the seeker's last ten dismissals ride
        // every turn, read fresh so a dismissal made mid-conversation is seen.
        ...(dialog.kind === "fit" ? (fitTurnContext(dialog.postingId, ws) ?? {}) : {}),
      },
      // The seeker's cancel is a real cancel: a closed overlay must not leave a Python
      // child (and a paid completion) running for a screen nobody is watching.
      request.signal
    );

    const now = new Date().toISOString();
    const turns: StudioTurn[] = [
      { role: "candidate", text: message, at: now },
      // The card set rides the AGENT TURN THAT MADE IT: a reload re-offers exactly the
      // set that was on the table, attached to the question it answers.
      { role: "interviewer", text: exchange.reply, at: now, ...(exchange.choices ? { choices: exchange.choices } : {}) },
    ];
    // COMPARE-AND-SWAP: `dialog.updatedAt` was read before a spawn that takes as long
    // as a model call. A turn that landed meanwhile answers `moved` and the client
    // re-reads rather than clobbering it.
    const write = appendDialogTurns(id, dialog.updatedAt, turns, exchange.artifact, exchange.done, ws);
    if (write === "missing") return jsonRefusal("JOBSEEKER_DIALOG_CLOSED", 409);
    if (write === "moved") return jsonRefusal("JOBSEEKER_DIALOG_MOVED", 409);

    // On close the dialog's product becomes the profile's: the preferences it
    // elicited merge over the stored ones, the polished CV is stored for export.
    if (exchange.done && exchange.artifact && "cvMarkdown" in exchange.artifact) {
      mergePreferences(profile.id, exchange.artifact.preferences, ws);
      setPolishedCv(profile.id, exchange.artifact.cvMarkdown, ws);
    }

    const reply: DialogReply = exchange;
    return NextResponse.json(reply);
  } catch (error) {
    // An aborted request is not a fault: the client is gone.
    if (request.signal.aborted) return new NextResponse(null, { status: 499 });
    // The turn overran JOBSEEKER_DIALOG_TIMEOUT_MS — a decision, named so the composer
    // can offer a retry instead of the generic store sentence.
    if (error instanceof JobseekerTimeoutError) return jsonRefusal("JOBSEEKER_TURN_TIMEOUT", 504);
    // The engine refused what it was handed — the stored row, not the seeker's words.
    if (error instanceof JobseekerInputError) return safeJsonError(error, "api:jobseeker/dialogs/message", "JOBSEEKER_STORE_FAILED");
    return safeJsonError(error, "api:jobseeker/dialogs/message", "JOBSEEKER_STORE_FAILED");
  }
}
