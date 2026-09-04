import { NextRequest, NextResponse } from "next/server";
import { getPosting, recordOutbox } from "@/app/_lib/db/devcase";
// The shared by-id owner guard (sibling module - a route file may export only handlers).
import { ownedSubmission } from "../devcase-owned-lifecycle";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { buildFeedbackBrief } from "@/app/_lib/devcase-feedback";
import { safeJsonError } from "@/app/_lib/api-response";


// d142462d — queue a kind, non-adverse strengths/growth feedback brief for a
// non-promoted candidate, assembled from their already-computed evaluation
// (strengths + concerns + transfer gaps). It lands in the dev outbox as a
// `queued` row — the recruiter sends it; the adverse decision itself stays
// human-gated, so this only turns the work they did into respectful feedback.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { submissionId?: string };
    if (!body.submissionId) return NextResponse.json({ error: "submissionId is required." }, { status: 400 });
    // getSubmission is a by-id point read (globally-unique id), so ownership is checked
    // here — through the SHARED guard all six by-id doors now use. recordOutbox files the
    // drafted letter under `sub.workspaceId` (below), so an unguarded id from another team
    // planted a candidate-facing letter — their candidate by name, with their strengths and
    // growth areas — in THAT team's outbox, ready for their recruiter to dispatch.
    const sub = ownedSubmission(body.submissionId, await currentWorkspace());
    if (!sub) {
      return NextResponse.json({ error: "submission not found" }, { status: 404 });
    }
    if (!sub.evaluation) return NextResponse.json({ error: "evaluate the submission first." }, { status: 400 });

    const bundle = sub.evaluation as {
      // `narrativeLang` is stamped by the Python evaluator (evaluate.py) and says which
      // language these bullets are IN. buildFeedbackBrief compares it to the language the
      // letter is written in and adds a one-line engine note when they disagree, instead
      // of presenting foreign-language findings under a localized heading. Absent on a
      // bundle scored before the evaluator took a --lang: treated as "no claim", no note.
      evaluation?: { strengths?: string[]; concerns?: string[]; narrativeLang?: string };
      transfer?: { gaps?: string[] };
    };
    const posting = sub.postingId ? getPosting(sub.postingId) : null;
    const brief = await buildFeedbackBrief({
      candidateRef: sub.candidateRef ?? "",
      roleTitle: posting?.roleTitle ?? null,
      strengths: bundle.evaluation?.strengths ?? [],
      concerns: bundle.evaluation?.concerns ?? [],
      gaps: bundle.transfer?.gaps ?? [],
      narrativeLang: bundle.evaluation?.narrativeLang ?? null,
      // The candidate's language resolves through THEIR team's default_locale when the
      // submission records none (comms-locale.resolveCommsLocale). Without the tenant
      // the letter fell back to the DEFAULT team's language — the same tenant the row
      // below is filed under, so the two would have disagreed about whose candidate
      // this is.
      workspaceId: sub.workspaceId,
    });

    const entry = recordOutbox({
      recipient: sub.contact ?? sub.candidateRef ?? "candidate",
      subject: brief.subject,
      body: brief.body,
      kind: "feedback",
      channel: posting?.channel ?? "devcase",
      // Queued, not sent: it waits in the outbox for the recruiter to dispatch.
      status: "queued",
      ref: sub.id,
      // `ref` here is a SUBMISSION id, not a pipeline entry id, so recordOutbox's
      // ref-based tenant resolution finds no entry and falls back to this — which
      // was previously omitted, filing the drafted candidate letter (their name and
      // their strengths/gaps) into the DEFAULT team's outbox instead of this one's.
      workspaceId: sub.workspaceId,
    });
    return NextResponse.json({ ok: true, outboxId: entry.id });
  } catch (error) {
    // better-sqlite3 + buildFeedbackBrief's model call: provider stderr and store
    // internals both land in `.message`. Log it, answer a code.
    return safeJsonError(error, "api:devcase/feedback", "DEVCASE_FEEDBACK_FAILED");
  }
}
