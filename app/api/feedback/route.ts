import { NextResponse, type NextRequest } from "next/server";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { currentSession } from "@/app/_lib/auth/current-user";
import { currentUserId } from "@/app/_lib/auth/session";
import { getUserById } from "@/app/_lib/db/users";
import { parseFeedbackSubmission, replyEmailFrom } from "@/app/_lib/feedback";
import { listFeedback, recordFeedback } from "@/app/_lib/feedback-store";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";

// Recruiter feedback door. Workspace-gated by the fail-closed proxy (this route
// is deliberately NOT in public-routes.ts): in password mode only a signed
// session reaches it, and every row is stamped with the session's workspace.
//
// POST — record one "Send feedback" submission (message + the route the dialog
// was opened from). The reply address is NOT accepted from the client: it is
// read from the signed-in user, so nobody can file a report under someone else's
// address, and the dialog no longer asks for what the session already knows. It
// resolves to null in open dev mode (no session identity) — an unattributed
// report, which is the truth rather than a guess. The app version is likewise
// stamped server-side, never trusted from the client. Rate-limited per IP: the write is
// cheap but unmetered free-text storage is a spam / disk-pressure vector on an
// open-mode deploy, and 10 messages in 10 minutes is far beyond a human's rate.
//
// GET — newest-first read for the operator view on /control. Read-only.

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as unknown;
  // Validation refuses before the limiter, so a rejected submission never
  // consumes budget (the contract's servedBefore convention).
  const parsed = parseFeedbackSubmission(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.reason, code: "FEEDBACK_INVALID" }, { status: 400 });
  }
  if (!rateLimit(`feedback:${clientIpFrom(request.headers)}`, { limit: 10, windowMs: 10 * 60_000 })) {
    return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
  }
  try {
    const userId = currentUserId(await currentSession());
    recordFeedback(
      {
        ...parsed.value,
        // Who wrote this, from the session — the one authority on identity.
        email: replyEmailFrom(userId ? getUserById(userId)?.email : null),
        // Stamped from the running server's own package metadata (npm sets it for
        // dev/start scripts); null when the runtime doesn't carry it. Never client-supplied.
        appVersion: process.env.npm_package_version ?? null,
      },
      await currentWorkspace()
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    // Store errors carry internal detail (paths, SQLITE_*) — log server-side,
    // return only a generic message + machine code (the safeJsonError doctrine).
    console.error("[feedback] record failed", error);
    return NextResponse.json({ error: "Could not send feedback. Please try again.", code: "FEEDBACK_SAVE_FAILED" }, { status: 500 });
  }
}

export async function GET() {
  try {
    return NextResponse.json({ feedback: listFeedback(50, await currentWorkspace()) });
  } catch (error) {
    console.error("[feedback] list failed", error);
    return NextResponse.json({ error: "Could not load feedback. Please try again.", code: "FEEDBACK_LIST_FAILED" }, { status: 500 });
  }
}
