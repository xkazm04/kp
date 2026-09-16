import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { currentSession } from "@/app/_lib/auth/current-user";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { currentUserId } from "@/app/_lib/auth/session";
import { createDialog, listDialogs } from "@/app/_lib/db/jobseeker-dialogs";
import { getJobseekerProfile, getJobseekerProfileById } from "@/app/_lib/db/jobseeker-profiles";
import { intakeLang } from "@/app/_lib/intake-lang";
import { fitTurnContext } from "@/app/_lib/jobseeker-fit-context";
import { JobseekerInputError, JobseekerTimeoutError, runJobseekerOpening } from "@/app/_lib/jobseeker-run";
import { isDialogKind, type StudioTurn } from "@/app/_lib/jobseeker/types";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// The seeker's Studio dialogs: POST opens one (cv_polish over the stored CV, or fit
// about one posting), GET lists a profile's.
//
// The opening turn is DETERMINISTIC Python (identical keyless and keyed), so a
// create never waits on a model; the spend starts at the first message.

const CREATE_RATE_LIMIT = { limit: 30, windowMs: 10 * 60_000 };

export async function GET(request: Request): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const ws = await currentWorkspace();
    const url = new URL(request.url);
    const profileId = url.searchParams.get("profileId") ?? "";
    // The list is scoped to a profile THIS workspace holds — a leaked profile id from
    // another workspace resolves to nothing, never to its dialogs.
    if (!profileId || !getJobseekerProfileById(profileId, ws)) return jsonRefusal("JOBSEEKER_PROFILE_MISSING", 404);
    return NextResponse.json({ dialogs: listDialogs(profileId, ws) });
  } catch (err) {
    return safeJsonError(err, "api:jobseeker/dialogs", "JOBSEEKER_STORE_FAILED");
  }
}

// THROTTLE (rate-limit-contract.test.ts): a create spawns one Python child for the
// opening. Operator-gated, but open mode makes the gate a no-op, so per-IP 30/10min
// — a person opens one conversation, not thirty. Runs after the cheap refusals
// (a body that names no kind, a seeker with no profile yet) so a rejected call never
// consumes budget, and before the spawn.
export async function POST(request: Request): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  // The seeker's own data, but still a WRITE behind a seat: a viewer seat may read the
  // feed, not spend a scan, a model turn or a source acknowledgement (route-capability-coverage).
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  try {
    const body = (await request.json().catch(() => ({}))) as { kind?: unknown; postingId?: unknown; lang?: unknown };
    // An absent kind is the one persona this page opens; a kind outside the closed
    // vocabulary names a conversation that does not exist, and is answered as such.
    const kind = body.kind === undefined ? "cv_polish" : body.kind;
    if (!isDialogKind(kind)) return jsonRefusal("JOBSEEKER_DIALOG_NOT_FOUND", 404);
    const [session, ws] = await Promise.all([currentSession(), currentWorkspace()]);
    const profile = getJobseekerProfile(currentUserId(session), ws);
    if (!profile) return jsonRefusal("JOBSEEKER_PROFILE_MISSING", 404);
    if (!rateLimit(`jobseeker-dialogs-create:${clientIpFrom(request.headers)}`, CREATE_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    const lang = intakeLang(body.lang);
    const postingId = typeof body.postingId === "string" && body.postingId ? body.postingId.slice(0, 64) : null;
    // A fit dialog is ABOUT one posting of this workspace (WP5): the opening lists its
    // gaps, so the posting, its match and the seeker's dismissals ride the first turn
    // too. A fit request naming no posting, or a foreign one, is a posting not found.
    const fit = kind === "fit" ? fitTurnContext(postingId, ws) : null;
    if (kind === "fit" && !fit) return jsonRefusal("POSTING_NOT_FOUND", 404);
    const opening = await runJobseekerOpening(
      {
        kind,
        lang,
        profile: profile.profile,
        preferences: profile.preferences,
        cvSourceText: profile.cvSourceText,
        artifact: null,
        ...(fit ?? {}),
      },
      request.signal
    );
    const turn: StudioTurn = {
      role: "interviewer",
      text: opening.reply,
      at: new Date().toISOString(),
      ...(opening.choices ? { choices: opening.choices } : {}),
    };
    const dialog = createDialog({ profileId: profile.id, kind, postingId, lang, opening: [turn] }, ws);
    // The opening's artifact (the re-flowed CV, the grounded suggestions) is the
    // sheet's first paint; it rides the create response and the first write.
    return NextResponse.json({
      dialog: { ...dialog, artifact: opening.artifact ?? dialog.artifact },
      fallbackReason: opening.fallbackReason ?? null,
      fallbackLang: opening.fallbackLang ?? null,
    });
  } catch (error) {
    if (request.signal.aborted) return new NextResponse(null, { status: 499 });
    if (error instanceof JobseekerTimeoutError) return jsonRefusal("JOBSEEKER_TURN_TIMEOUT", 504);
    // The engine refused the request it was handed — the STORED profile row did not
    // validate, which is our data, not the seeker's message: a store fault, logged.
    if (error instanceof JobseekerInputError) return safeJsonError(error, "api:jobseeker/dialogs", "JOBSEEKER_STORE_FAILED");
    return safeJsonError(error, "api:jobseeker/dialogs", "JOBSEEKER_STORE_FAILED");
  }
}
