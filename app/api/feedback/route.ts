import { NextResponse, type NextRequest } from "next/server";
import { jsonRefusal } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { currentSession, requireCapability } from "@/app/_lib/auth/current-user";
import { currentUserId } from "@/app/_lib/auth/session";
import { getUserById } from "@/app/_lib/db/users";
import { parseFeedbackSubmission, replyEmailFrom } from "@/app/_lib/feedback";
import { listFeedback, recordFeedback } from "@/app/_lib/feedback-store";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

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
// GET — newest-first read for the operator view on /control. Read-only, and
// `members:manage`-GATED (/perfect wave 17, api-workspace). It used to require only
// a session, which on a team deployment meant ANY signed-in member — a viewer, a
// hiring manager, a recruiter — could ask for 50 rows of their colleagues' free-text
// complaints WITH the reply address stamped on each one (feedback-store.ts keeps
// `email`, taken from the author's session). That is other people's words and other
// people's addresses, and nothing in the product asked for it to be readable by the
// whole team.
//
// `members:manage`, not `org:manage`: this is a read OF the people in the org, which
// is exactly the capability that already gates the member list and the invite list
// (app/api/org/invites/route.ts). `org:manage` is owner-only (roles.ts) and would
// lock out the admin who actually runs the control room — the wrong bar for a read.
// A recruiter/hiring-manager/viewer is refused with a CODE, so the console renders
// the refusal in the reader's language instead of the server's English.
//
// /control's own feedback section carries the same gate server-side
// (app/control/page.tsx), so the panel is not rendered only to 403 on load.

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as unknown;
  // Validation refuses before the limiter, so a rejected submission never
  // consumes budget (the contract's servedBefore convention).
  const parsed = parseFeedbackSubmission(body);
  if (!parsed.ok) {
    // The validator names its refusal; the sentence is the catalogs' to write, in
    // the sender's language (it used to ship its own English `reason` here).
    return jsonRefusal(parsed.code, 400);
  }
  if (!rateLimit(`feedback:${clientIpFrom(request.headers)}`, { limit: 10, windowMs: 10 * 60_000 })) {
    // A CODE, not a bare string: without it the dialog fell through to its generic
    // "couldn't send, try again", so the recruiter retried straight back into the
    // wall the catalogs already have a sentence for (errors.TOO_MANY_REQUESTS).
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
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
  const denied = await requireCapability("members:manage");
  // requireCapability answers 401 unauthenticated / 403 under-privileged. Keep its
  // status, replace its bare English body with the code the console resolves.
  if (denied) return jsonRefusal("FEEDBACK_READ_FORBIDDEN", denied.status);
  try {
    return NextResponse.json({ feedback: listFeedback(50, await currentWorkspace()) });
  } catch (error) {
    console.error("[feedback] list failed", error);
    return NextResponse.json({ error: "Could not load feedback. Please try again.", code: "FEEDBACK_LIST_FAILED" }, { status: 500 });
  }
}
